/**
 * Stock-in production batch add (inbound type 4).
 *
 * Quantity rules align with legacy production inbound:
 * tempx = converted dispatch qty - approved inbound - pending inbound.
 * Outbound (rework) quantities are display-only and do not reduce tempx.
 * Link keys: kcan04 = scak01, kcao02 = scak02.
 */
import { sql } from './db.js'
import { safeDecimalExpr, safeIntExpr, nvarcharTextExpr } from './buyOrderSqlSafe.js'
import {
  computeAssistKcao031,
  computeAssistKsum,
  parseAssistFloatRate,
  resolveAssistBatchSelectState,
} from './stockInAssistBatchAdd.js'
import { customerSupplyLabel } from './stockInSaveLogic.js'
import { getStockInLineMeta, getStockOutLineMeta } from './stockInBatchLineMeta.js'

const DISPATCH_HEADER_FROM = 'dbo.[UB_ERP_Dispatch_order]'
const DISPATCH_LINE_FROM = 'dbo.[UB_ERP_Dispatch_order_list]'
const STOCK_IN_FROM = 'dbo.[UB_ERP_Stocks_Storage]'
const STOCK_IN_LINE_FROM = 'dbo.[UB_ERP_Stocks_Storage_list]'
const STOCK_OUT_FROM = 'dbo.[UB_ERP_Stocks_out]'
const STOCK_OUT_LINE_FROM = 'dbo.[UB_ERP_Stocks_out_list]'
const MATERIAL_CAT_FROM = 'dbo.[UB_ERP_Stocks_material]'
const BOM_FROM = 'dbo.[UB_ERP_Bom_000]'

const KCAA_COLS = Array.from({ length: 35 }, (_, i) => `kcaa${String(i + 1).padStart(2, '0')}`)

function text(v) {
  return String(v ?? '').trim()
}

function toNumber(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function round(n, p = 4) {
  const m = 10 ** p
  return Math.round((toNumber(n) + Number.EPSILON) * m) / m
}

/** 生产入库可入数量：允许负数展示（超入时显示负值），选择按钮仍只看 tempx>0 */
export function computeProductionTempx(ksum, approvedInboundQty, pendingInboundQty) {
  return round(toNumber(ksum) - toNumber(approvedInboundQty) - toNumber(pendingInboundQty), 4)
}

/**
 * 批量添加前校验派工主表（对齐旧系统）；dispatchSystemcode 有值时才校验 systemcode。
 */
export async function validateProductionDispatchHeader(pool, { sourceOrderNo, workshopCode, dispatchSystemcode }) {
  try {
    const req = pool.request().input('sourceOrderNo', sql.NVarChar(200), sourceOrderNo)
    const r = await req.query(`
      SELECT TOP 1
        ${nvarcharTextExpr('h', 'scaj01', 200)} AS scaj01,
        ${nvarcharTextExpr('h', 'scaj05', 200)} AS scaj05,
        ${nvarcharTextExpr('h', 'closed', 20)} AS closed,
        ${nvarcharTextExpr('h', 'del', 20)} AS del,
        ${nvarcharTextExpr('h', 'pass', 20)} AS pass,
        ${nvarcharTextExpr('h', 'systemcode', 200)} AS systemcode
      FROM ${DISPATCH_HEADER_FROM} AS h
      WHERE ${nvarcharTextExpr('h', 'scaj01', 200)} = @sourceOrderNo
    `)
    const row = r.recordset?.[0]
    if (!row || !text(row.scaj01)) {
      return { ok: false, status: 400, msg: `派工单「${sourceOrderNo}」不存在或已删除` }
    }
    if (!['', '0'].includes(text(row.del))) {
      return { ok: false, status: 400, msg: `派工单「${sourceOrderNo}」已删除，无法批量添加` }
    }
    if (text(row.pass) !== '1') {
      return { ok: false, status: 400, msg: `派工单「${sourceOrderNo}」未审核，无法批量添加` }
    }
    if (!['', '0'].includes(text(row.closed))) {
      return { ok: false, status: 400, msg: `派工单「${sourceOrderNo}」已结案，无法批量添加` }
    }
    if (text(row.scaj05) !== text(workshopCode)) {
      return { ok: false, status: 400, msg: '派工单车间与当前所选生产车间不一致，请重新选择派工单' }
    }
    const expectSystemcode = text(dispatchSystemcode)
    if (expectSystemcode && text(row.systemcode) !== expectSystemcode) {
      return { ok: false, status: 400, msg: '派工单标识与当前所选不一致，请重新选择派工单' }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, status: 500, msg: `校验派工单主表失败：${String(err?.message ?? err)}` }
  }
}

/** 派工明细行优先，BOM 兜底（两表均有该列时使用） */
function lineFirstTextExpr(lineAlias, bomAlias, col, len = 500) {
  return `COALESCE(NULLIF(${nvarcharTextExpr(lineAlias, col, len)}, N''), ${nvarcharTextExpr(bomAlias, col, len)})`
}

/** 说明/备注：派工 info → 派工 d_info → BOM d_info（两表均无 Describe/info 混用列） */
function lineInfoExpr(lineAlias, bomAlias, len = 500) {
  return `COALESCE(
    NULLIF(${nvarcharTextExpr(lineAlias, 'info', len)}, N''),
    NULLIF(${nvarcharTextExpr(lineAlias, 'd_info', len)}, N''),
    NULLIF(${nvarcharTextExpr(bomAlias, 'd_info', len)}, N'')
  )`
}

/** PI/参考号：派工明细 pi（BOM 表无 reference 列） */
function lineReferenceExpr(lineAlias, len = 200) {
  return nvarcharTextExpr(lineAlias, 'pi', len)
}

function parsePage(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1)
  const rawPageSize = Number.parseInt(query.pageSize, 10) || 20
  const pageSize = Math.min(100, Math.max(1, rawPageSize))
  return { page, pageSize, startRow: (page - 1) * pageSize + 1, endRow: page * pageSize }
}

function buildKeywordWhere(keyword) {
  const kw = text(keyword)
  if (!kw) return ''
  const likeCols = ['kcaa01', 'kcaa02', 'kcaa03', 'kcaa11', 'scak02', 'systemcode', 'GUID']
  const parts = likeCols.map((col) => `${nvarcharTextExpr('l', col)} LIKE @keyword`)
  return `AND (${parts.join(' OR ')})`
}

function formatPendingText(rows, qtyKey = 'qty') {
  const list = Array.isArray(rows) ? rows : []
  if (!list.length) return '-'
  const totalQty = round(list.reduce((sum, row) => sum + toNumber(row[qtyKey]), 0), 4)
  const docNos = list.map((row) => text(row.docNo)).filter(Boolean)
  const uniqueDocs = [...new Set(docNos)]
  const docText = uniqueDocs.length > 3 ? `${uniqueDocs.slice(0, 3).join('、')}...` : uniqueDocs.join('、')
  return `${totalQty} / ${uniqueDocs.length} / ${docText || '-'}`
}

function kcaaSelectSql() {
  return KCAA_COLS.map((col) => `
    COALESCE(
      NULLIF(${nvarcharTextExpr('l', col, 500)}, N''),
      NULLIF(${nvarcharTextExpr('b', col, 500)}, N'')
    ) AS [${col}]
  `).join(', ')
}

async function fetchInboundAggByDetailKey(pool, { sourceOrderNo, detailKeys, excludeReceiptNo, inMeta }) {
  const keys = (detailKeys ?? []).map((k) => text(k)).filter(Boolean)
  if (!keys.length) return new Map()
  const lineDocCol = text(inMeta?.lineDocCol) || 'kcao01'
  const detailKeyCol = text(inMeta?.detailKeyCol) || 'kcao02'
  const qtyCol = text(inMeta?.qtyCol) || 'kcao03'
  const exclude = text(excludeReceiptNo)
  const excludeSql = exclude ? `AND ${nvarcharTextExpr('h', 'kcan01', 200)} <> @excludeReceiptNo` : ''
  const req = pool.request()
    .input('sourceOrderNo', sql.NVarChar(200), sourceOrderNo)
    .input('inboundType', sql.NVarChar(20), '4')
  if (exclude) req.input('excludeReceiptNo', sql.NVarChar(200), exclude)
  const inList = keys.map((k, i) => {
    const p = `dk${i}`
    req.input(p, sql.NVarChar(200), k)
    return `@${p}`
  }).join(', ')
  const r = await req.query(`
    SELECT
      ${nvarcharTextExpr('l', detailKeyCol, 200)} AS detailKey,
      SUM(CASE WHEN ${nvarcharTextExpr('h', 'pass', 20)} = N'1' THEN ${safeDecimalExpr('l', qtyCol)} ELSE 0 END) AS approvedQty,
      SUM(CASE WHEN ${nvarcharTextExpr('h', 'pass', 20)} <> N'1' THEN ${safeDecimalExpr('l', qtyCol)} ELSE 0 END) AS pendingQty
    FROM ${STOCK_IN_FROM} AS h
    INNER JOIN ${STOCK_IN_LINE_FROM} AS l
      ON ${nvarcharTextExpr('l', lineDocCol, 200)} = ${nvarcharTextExpr('h', 'kcan01', 200)}
    WHERE ${nvarcharTextExpr('h', 'del', 20)} IN (N'', N'0')
      AND ${nvarcharTextExpr('l', 'del', 20)} IN (N'', N'0')
      AND ${nvarcharTextExpr('h', 'kcan03', 20)} = @inboundType
      AND ${nvarcharTextExpr('h', 'kcan04', 200)} = @sourceOrderNo
      ${excludeSql}
      AND ${nvarcharTextExpr('l', detailKeyCol, 200)} IN (${inList})
    GROUP BY l.[${detailKeyCol}]
  `)
  const map = new Map()
  for (const row of r.recordset ?? []) {
    map.set(text(row.detailKey), { approvedQty: toNumber(row.approvedQty), pendingQty: toNumber(row.pendingQty) })
  }
  return map
}

async function fetchInboundPendingDocs(pool, { sourceOrderNo, detailKeys, excludeReceiptNo, inMeta }) {
  const keys = (detailKeys ?? []).map((k) => text(k)).filter(Boolean)
  if (!keys.length) return new Map()
  const lineDocCol = text(inMeta?.lineDocCol) || 'kcao01'
  const detailKeyCol = text(inMeta?.detailKeyCol) || 'kcao02'
  const qtyCol = text(inMeta?.qtyCol) || 'kcao03'
  const exclude = text(excludeReceiptNo)
  const excludeSql = exclude ? `AND ${nvarcharTextExpr('h', 'kcan01', 200)} <> @excludeReceiptNo` : ''
  const req = pool.request()
    .input('sourceOrderNo', sql.NVarChar(200), sourceOrderNo)
    .input('inboundType', sql.NVarChar(20), '4')
  if (exclude) req.input('excludeReceiptNo', sql.NVarChar(200), exclude)
  const inList = keys.map((k, i) => {
    const p = `dk${i}`
    req.input(p, sql.NVarChar(200), k)
    return `@${p}`
  }).join(', ')
  const r = await req.query(`
    SELECT
      ${nvarcharTextExpr('l', detailKeyCol, 200)} AS detailKey,
      ${nvarcharTextExpr('h', 'kcan01', 200)} AS docNo,
      ${safeDecimalExpr('l', qtyCol)} AS qty
    FROM ${STOCK_IN_FROM} AS h
    INNER JOIN ${STOCK_IN_LINE_FROM} AS l
      ON ${nvarcharTextExpr('l', lineDocCol, 200)} = ${nvarcharTextExpr('h', 'kcan01', 200)}
    WHERE ${nvarcharTextExpr('h', 'del', 20)} IN (N'', N'0')
      AND ${nvarcharTextExpr('l', 'del', 20)} IN (N'', N'0')
      AND ${nvarcharTextExpr('h', 'kcan03', 20)} = @inboundType
      AND ${nvarcharTextExpr('h', 'pass', 20)} <> N'1'
      AND ${nvarcharTextExpr('h', 'kcan04', 200)} = @sourceOrderNo
      ${excludeSql}
      AND ${nvarcharTextExpr('l', detailKeyCol, 200)} IN (${inList})
  `)
  const map = new Map()
  for (const row of r.recordset ?? []) {
    const key = text(row.detailKey)
    if (!map.has(key)) map.set(key, [])
    map.get(key).push({ docNo: text(row.docNo), qty: toNumber(row.qty) })
  }
  return map
}

async function fetchOutboundAggByDetailKey(pool, { sourceOrderNo, detailKeys, outMeta }) {
  const keys = (detailKeys ?? []).map((k) => text(k)).filter(Boolean)
  const linkCol = text(outMeta?.linkCol)
  const qtyCol = text(outMeta?.qtyCol) || 'kcaq03'
  const lineDocCol = text(outMeta?.lineDocCol) || 'kcaq01'
  const detailKeyCol = text(outMeta?.detailKeyCol) || 'kcaq02'
  if (!keys.length || !linkCol || !qtyCol || !lineDocCol || !detailKeyCol) {
    return { aggMap: new Map(), pendingMap: new Map() }
  }
  const req = pool.request().input('sourceOrderNo', sql.NVarChar(200), sourceOrderNo)
  const inList = keys.map((k, i) => {
    const p = `dk${i}`
    req.input(p, sql.NVarChar(200), k)
    return `@${p}`
  }).join(', ')
  const r = await req.query(`
    SELECT
      ${nvarcharTextExpr('ol', detailKeyCol, 200)} AS detailKey,
      ${nvarcharTextExpr('o', 'kcap01', 200)} AS docNo,
      ${nvarcharTextExpr('o', 'pass', 20)} AS pass,
      ${safeDecimalExpr('ol', qtyCol)} AS qty
    FROM ${STOCK_OUT_FROM} AS o
    INNER JOIN ${STOCK_OUT_LINE_FROM} AS ol
      ON ${nvarcharTextExpr('ol', lineDocCol, 200)} = ${nvarcharTextExpr('o', 'kcap01', 200)}
    WHERE ${nvarcharTextExpr('o', 'del', 20)} IN (N'', N'0')
      AND ${nvarcharTextExpr('ol', 'del', 20)} IN (N'', N'0')
      AND ${nvarcharTextExpr('o', linkCol, 200)} = @sourceOrderNo
      AND ${nvarcharTextExpr('ol', detailKeyCol, 200)} IN (${inList})
  `)
  const aggMap = new Map()
  const pendingMap = new Map()
  for (const row of r.recordset ?? []) {
    const key = text(row.detailKey)
    if (!aggMap.has(key)) aggMap.set(key, { approvedQty: 0, pendingQty: 0 })
    const item = aggMap.get(key)
    if (text(row.pass) === '1') item.approvedQty += toNumber(row.qty)
    else {
      item.pendingQty += toNumber(row.qty)
      if (!pendingMap.has(key)) pendingMap.set(key, [])
      pendingMap.get(key).push({ docNo: text(row.docNo), qty: toNumber(row.qty) })
    }
  }
  return { aggMap, pendingMap }
}

async function fetchFloatRates(pool, categoryCodes) {
  const codes = (categoryCodes ?? []).map((k) => text(k)).filter(Boolean)
  if (!codes.length) return new Map()
  const req = pool.request()
  const inList = codes.map((k, i) => {
    const p = `cc${i}`
    req.input(p, sql.NVarChar(200), k)
    return `@${p}`
  }).join(', ')
  const r = await req.query(`
    SELECT
      ${nvarcharTextExpr('m', 'code', 200)} AS categoryCode,
      ${nvarcharTextExpr('m', 'stocks_in', 50)} AS stocks_in
    FROM ${MATERIAL_CAT_FROM} AS m
    WHERE ${nvarcharTextExpr('m', 'code', 200)} IN (${inList})
  `)
  const map = new Map()
  for (const row of r.recordset ?? []) {
    map.set(text(row.categoryCode), parseAssistFloatRate(row.stocks_in))
  }
  return map
}

function mapProductionLineRow(row, ctx) {
  const detailKey = text(row.scak02 || row.systemcode || row.GUID)
  const inbound = ctx.inboundMap.get(detailKey) ?? { approvedQty: 0, pendingQty: 0 }
  const outbound = ctx.outboundMap.get(detailKey) ?? { approvedQty: 0, pendingQty: 0 }
  const orderQty = computeAssistKsum(row.scak03, row.kcaa26, row.kcaa27)
  const tempx = computeProductionTempx(orderQty, inbound.approvedQty, inbound.pendingQty)
  const floatRate = ctx.floatMap.get(text(row.kcaa05)) ?? 0
  const kcao031 = computeAssistKcao031(tempx, floatRate)
  const select = resolveAssistBatchSelectState({
    tempx,
    alreadySelected: ctx.selectedSet.has(detailKey.toLowerCase()),
  })
  const info = text(row.info)

  const out = {
    lineKey: detailKey,
    id: row.id,
    kcao02: detailKey,
    scak02: detailKey,
    systemcode: text(row.systemcode) || detailKey,
    GUID: text(row.GUID) || text(row.systemcode) || detailKey,
    kcaa01: text(row.kcaa01),
    kcaa02: text(row.kcaa02),
    kcaa03: text(row.kcaa03),
    kcaa04: text(row.kcaa04),
    kcaa11: text(row.kcaa11),
    kcaa25: text(row.kcaa25),
    kcaa26: row.kcaa26,
    kcaa27: text(row.kcaa27),
    kcaa05: text(row.kcaa05),
    reference: text(row.reference),
    info,
    tempx,
    needQty: tempx,
    kcao031,
    overflowCap: kcao031,
    floatRate,
    orderQty,
    orderQtyRaw: toNumber(row.scak03),
    pendingInboundText: formatPendingText(ctx.pendingInboundMap.get(detailKey)),
    pendingOutboundText: formatPendingText(ctx.pendingOutboundMap.get(detailKey)),
    actualInboundQty: round(inbound.approvedQty, 4),
    actualOutboundQty: round(outbound.approvedQty, 4),
    reworkQty: round(outbound.approvedQty, 4),
    approvedInboundQty: inbound.approvedQty,
    pendingInboundQty: inbound.pendingQty,
    approvedOutboundQty: outbound.approvedQty,
    pendingOutboundQty: outbound.pendingQty,
    kcao04: 0,
    kcao041: 0,
    kcao05: 0,
    kcao051: 0,
    tax: 0,
    availableQty: tempx,
    location: text(row.location),
    sale_price: row.sale_price,
    cost_price: row.cost_price,
    Customer_Name: text(row.Customer_Name),
    Customer_supply: row.Customer_supply,
    customerSupplyLabel: customerSupplyLabel(row.Customer_supply) || '-',
    remark: text(row.remark),
    kpname: text(row.kpname),
    kcaa02_en: text(row.kcaa02_en),
    version: text(row.version),
    rmbUnitPrice: 0,
    rmbAmount: 0,
    ...select,
  }
  for (const col of KCAA_COLS) {
    if (row[col] != null && out[col] == null) out[col] = row[col]
  }
  return out
}

export async function fetchStockInProductionBatchLines(pool, query = {}) {
  const sourceOrderNo = text(query.sourceOrderNo)
  if (!sourceOrderNo) {
    return { ok: false, status: 400, msg: '请先选择派工单号' }
  }
  const workshopCode = text(query.workshopCode || query.supplierCode)
  if (!workshopCode) {
    return { ok: false, status: 400, msg: '请先选择生产车间' }
  }
  const excludeReceiptNo = text(query.excludeReceiptNo)
  const dispatchSystemcode = text(query.dispatchSystemcode)
  const keyword = text(query.keyword)
  const { page, pageSize, startRow, endRow } = parsePage(query)

  const headerCheck = await validateProductionDispatchHeader(pool, {
    sourceOrderNo,
    workshopCode,
    dispatchSystemcode,
  })
  if (!headerCheck.ok) return headerCheck
  const selectedSet = new Set(
    text(query.selectedKeys)
      .split(',')
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean),
  )

  const headerWhere = `
    ${nvarcharTextExpr('h', 'scaj01', 200)} = @sourceOrderNo
    AND ${nvarcharTextExpr('h', 'del', 20)} IN (N'', N'0')
    AND ${nvarcharTextExpr('h', 'pass', 20)} = N'1'
    AND ${nvarcharTextExpr('h', 'closed', 20)} IN (N'', N'0')
    AND ${nvarcharTextExpr('h', 'scaj05', 200)} = @workshopCode
  `

  const countReq = pool.request()
    .input('sourceOrderNo', sql.NVarChar(200), sourceOrderNo)
    .input('workshopCode', sql.NVarChar(200), workshopCode)
  if (keyword) countReq.input('keyword', sql.NVarChar(200), `%${keyword}%`)
  const countR = await countReq.query(`
    SELECT COUNT(1) AS total
    FROM ${DISPATCH_LINE_FROM} AS l
    INNER JOIN ${DISPATCH_HEADER_FROM} AS h
      ON ${nvarcharTextExpr('h', 'scaj01', 200)} = ${nvarcharTextExpr('l', 'scak01', 200)}
    WHERE ${headerWhere}
      AND ${nvarcharTextExpr('l', 'del', 20)} IN (N'', N'0')
      ${buildKeywordWhere(keyword)}
  `)
  const total = Number(countR.recordset?.[0]?.total ?? 0)

  const listReq = pool.request()
    .input('sourceOrderNo', sql.NVarChar(200), sourceOrderNo)
    .input('workshopCode', sql.NVarChar(200), workshopCode)
    .input('startRow', sql.Int, startRow)
    .input('endRow', sql.Int, endRow)
  if (keyword) listReq.input('keyword', sql.NVarChar(200), `%${keyword}%`)

  const listR = await listReq.query(`
    WITH base AS (
      SELECT
        l.[id],
        ${nvarcharTextExpr('l', 'scak02', 200)} AS scak02,
        ${nvarcharTextExpr('l', 'systemcode', 200)} AS systemcode,
        ${nvarcharTextExpr('l', 'GUID', 200)} AS GUID,
        ${safeDecimalExpr('l', 'scak03')} AS scak03,
        ${nvarcharTextExpr('l', 'pi', 200)} AS pi,
        ${nvarcharTextExpr('l', 'version', 100)} AS version,
        ${lineFirstTextExpr('l', 'b', 'kcaa02_en', 500)} AS kcaa02_en,
        ${lineFirstTextExpr('l', 'b', 'location', 500)} AS location,
        ${lineReferenceExpr('l', 200)} AS reference,
        ${lineInfoExpr('l', 'b', 500)} AS info,
        ${safeDecimalExpr('b', 'sale_price')} AS sale_price,
        ${safeDecimalExpr('b', 'cost_price')} AS cost_price,
        ${lineFirstTextExpr('l', 'b', 'Customer_Name', 200)} AS Customer_Name,
        ${lineFirstTextExpr('l', 'b', 'Customer_supply', 50)} AS Customer_supply,
        ${lineFirstTextExpr('l', 'b', 'remark', 500)} AS remark,
        ${lineFirstTextExpr('l', 'b', 'kpname', 200)} AS kpname,
        ${kcaaSelectSql()},
        ${safeIntExpr('l', 'seq')} AS sortSeq
      FROM ${DISPATCH_LINE_FROM} AS l
      INNER JOIN ${DISPATCH_HEADER_FROM} AS h
        ON ${nvarcharTextExpr('h', 'scaj01', 200)} = ${nvarcharTextExpr('l', 'scak01', 200)}
      LEFT JOIN ${BOM_FROM} AS b
        ON ${nvarcharTextExpr('b', 'kcaa01', 200)} = ${nvarcharTextExpr('l', 'kcaa01', 200)}
       AND ${nvarcharTextExpr('b', 'del', 20)} IN (N'', N'0')
      WHERE ${headerWhere}
        AND ${nvarcharTextExpr('l', 'del', 20)} IN (N'', N'0')
        ${buildKeywordWhere(keyword)}
    ),
    numbered AS (
      SELECT base.*, ROW_NUMBER() OVER (ORDER BY sortSeq, id) AS rn
      FROM base
    )
    SELECT * FROM numbered WHERE rn BETWEEN @startRow AND @endRow ORDER BY rn
  `)

  const rawRows = listR.recordset ?? []
  if (!rawRows.length) return { ok: true, list: [], total, page, pageSize }

  const detailKeys = [...new Set(rawRows.map((row) => text(row.scak02 || row.systemcode || row.GUID)).filter(Boolean))]
  const categoryCodes = [...new Set(rawRows.map((row) => text(row.kcaa05)).filter(Boolean))]
  const [inMeta, outMeta] = await Promise.all([
    getStockInLineMeta(pool),
    getStockOutLineMeta(pool),
  ])
  const [inboundMap, pendingInboundMap, outboundResult, floatMap] = await Promise.all([
    fetchInboundAggByDetailKey(pool, { sourceOrderNo, detailKeys, excludeReceiptNo, inMeta }),
    fetchInboundPendingDocs(pool, { sourceOrderNo, detailKeys, excludeReceiptNo, inMeta }),
    fetchOutboundAggByDetailKey(pool, { sourceOrderNo, detailKeys, outMeta }),
    fetchFloatRates(pool, categoryCodes),
  ])

  const ctx = {
    inboundMap,
    pendingInboundMap,
    outboundMap: outboundResult.aggMap,
    pendingOutboundMap: outboundResult.pendingMap,
    floatMap,
    selectedSet,
  }
  return { ok: true, list: rawRows.map((row) => mapProductionLineRow(row, ctx)), total, page, pageSize }
}

export {
  computeAssistKsum as computeProductionKsum,
  computeAssistKcao031 as computeProductionKcao031,
  resolveAssistBatchSelectState as resolveProductionBatchSelectState,
}
