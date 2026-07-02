/**
 * Stock-in production batch add (inbound type 4/5).
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
import {
  batchExpandProductionDispatchLines,
  PRODUCTION_ISSUE_QTY_PRECISION,
} from './stockOutProductionIssueBomExpand.js'
import { fetchBom000Kcaa02ByMaterialBatch } from './stockOutAssistIssueBomExpand.js'

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

function normalizeProductionBatchInboundType(v) {
  return text(v) === '5' ? '5' : '4'
}

/** 生产入库可入数量：允许负数展示（超入时显示负值），选择按钮仍只看 tempx>0 */
export function computeProductionTempx(ksum, approvedInboundQty, pendingInboundQty) {
  return round(toNumber(ksum) - toNumber(approvedInboundQty) - toNumber(pendingInboundQty), 4)
}

const LEGACY_RETURN_HEADER_MISSING_MSG = '数据不存在,请联系IT部检查!'
const LEGACY_RETURN_NO_LINES_MSG = '此订单无清单数据,请检查订单数据!'
const LEGACY_RETURN_PARAM_ERROR_MSG = '参数错误！'

/**
 * 批量添加前校验派工主表。
 * 类型 4：按派工单号查主表；dispatchSystemcode 有值时才校验 systemcode。
 * 类型 5：按车间 + dispatchSystemcode 查主表，并与派工单号交叉校验（对齐旧系统）。
 */
export async function validateProductionDispatchHeader(pool, {
  sourceOrderNo,
  workshopCode,
  dispatchSystemcode,
  inboundType = '4',
}) {
  const isReturn = normalizeProductionBatchInboundType(inboundType) === '5'
  try {
    const req = pool.request()
    let whereSql = ''
    if (isReturn) {
      const expectSystemcode = text(dispatchSystemcode)
      if (!expectSystemcode) {
        return { ok: false, status: 400, msg: LEGACY_RETURN_PARAM_ERROR_MSG }
      }
      req
        .input('dispatchSystemcode', sql.NVarChar(200), expectSystemcode)
        .input('workshopCode', sql.NVarChar(200), workshopCode)
      whereSql = `
        ${nvarcharTextExpr('h', 'systemcode', 200)} = @dispatchSystemcode
        AND ${nvarcharTextExpr('h', 'scaj05', 200)} = @workshopCode
        AND ${nvarcharTextExpr('h', 'del', 20)} IN (N'', N'0')
        AND ${nvarcharTextExpr('h', 'pass', 20)} = N'1'
        AND ${nvarcharTextExpr('h', 'closed', 20)} IN (N'', N'0')
      `
    } else {
      req.input('sourceOrderNo', sql.NVarChar(200), sourceOrderNo)
      whereSql = `${nvarcharTextExpr('h', 'scaj01', 200)} = @sourceOrderNo`
    }
    const r = await req.query(`
      SELECT TOP 1
        ${nvarcharTextExpr('h', 'scaj01', 200)} AS scaj01,
        ${nvarcharTextExpr('h', 'scaj05', 200)} AS scaj05,
        ${nvarcharTextExpr('h', 'closed', 20)} AS closed,
        ${nvarcharTextExpr('h', 'del', 20)} AS del,
        ${nvarcharTextExpr('h', 'pass', 20)} AS pass,
        ${nvarcharTextExpr('h', 'systemcode', 200)} AS systemcode
      FROM ${DISPATCH_HEADER_FROM} AS h
      WHERE ${whereSql}
    `)
    const row = r.recordset?.[0]
    if (!row || !text(row.scaj01)) {
      return {
        ok: false,
        status: 400,
        msg: isReturn ? LEGACY_RETURN_HEADER_MISSING_MSG : `派工单「${sourceOrderNo}」不存在或已删除`,
      }
    }
    if (!isReturn) {
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
    }
    if (text(row.scaj01) !== text(sourceOrderNo)) {
      return { ok: false, status: 400, msg: LEGACY_RETURN_HEADER_MISSING_MSG }
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

function parseProductionReturnPaging(query = {}) {
  const fetchAll = ['1', 'true', 'yes'].includes(String(query.fetchAll ?? '').trim().toLowerCase())
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1)
  const rawPageSize = Number.parseInt(query.pageSize, 10) || 20
  const pageSize = fetchAll ? Number.MAX_SAFE_INTEGER : Math.min(200, Math.max(1, rawPageSize))
  return { page, pageSize, fetchAll }
}

function sliceProductionReturnRows(list, paging) {
  const rows = Array.isArray(list) ? list : []
  const total = rows.length
  if (paging?.fetchAll) return { list: rows, total, page: 1, pageSize: total > 0 ? total : 1 }
  const page = Math.max(1, paging?.page ?? 1)
  const pageSize = Math.max(1, paging?.pageSize ?? 20)
  const start = (page - 1) * pageSize
  return { list: rows.slice(start, start + pageSize), total, page, pageSize }
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

async function fetchInboundAggByDetailKey(pool, { sourceOrderNo, detailKeys, excludeReceiptNo, inMeta, inboundType = '4' }) {
  const keys = (detailKeys ?? []).map((k) => text(k)).filter(Boolean)
  if (!keys.length) return new Map()
  const lineDocCol = text(inMeta?.lineDocCol) || 'kcao01'
  const detailKeyCol = text(inMeta?.detailKeyCol) || 'kcao02'
  const qtyCol = text(inMeta?.qtyCol) || 'kcao03'
  const exclude = text(excludeReceiptNo)
  const excludeSql = exclude ? `AND ${nvarcharTextExpr('h', 'kcan01', 200)} <> @excludeReceiptNo` : ''
  const req = pool.request()
    .input('sourceOrderNo', sql.NVarChar(200), sourceOrderNo)
    .input('inboundType', sql.NVarChar(20), normalizeProductionBatchInboundType(inboundType))
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

async function fetchInboundPendingDocs(pool, { sourceOrderNo, detailKeys, excludeReceiptNo, inMeta, inboundType = '4' }) {
  const keys = (detailKeys ?? []).map((k) => text(k)).filter(Boolean)
  if (!keys.length) return new Map()
  const lineDocCol = text(inMeta?.lineDocCol) || 'kcao01'
  const detailKeyCol = text(inMeta?.detailKeyCol) || 'kcao02'
  const qtyCol = text(inMeta?.qtyCol) || 'kcao03'
  const exclude = text(excludeReceiptNo)
  const excludeSql = exclude ? `AND ${nvarcharTextExpr('h', 'kcan01', 200)} <> @excludeReceiptNo` : ''
  const req = pool.request()
    .input('sourceOrderNo', sql.NVarChar(200), sourceOrderNo)
    .input('inboundType', sql.NVarChar(20), normalizeProductionBatchInboundType(inboundType))
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

async function fetchProductionIssueQtyByMaterial(pool, { sourceOrderNo, warehouseCode, materialCodes }) {
  const mats = (materialCodes ?? []).map((k) => text(k)).filter(Boolean)
  if (!mats.length) return { aggMap: new Map(), pendingMap: new Map() }
  const req = pool.request()
    .input('sourceOrderNo', sql.NVarChar(200), sourceOrderNo)
    .input('warehouseCode', sql.NVarChar(200), warehouseCode)
  const inList = mats.map((k, i) => {
    const p = `mc${i}`
    req.input(p, sql.NVarChar(300), k)
    return `@${p}`
  }).join(', ')
  const r = await req.query(`
    SELECT
      ${nvarcharTextExpr('l', 'kcaa01', 300)} AS materialCode,
      ${nvarcharTextExpr('h', 'kcap01', 200)} AS docNo,
      ${nvarcharTextExpr('h', 'pass', 20)} AS pass,
      ${safeDecimalExpr('l', 'kcaq03')} AS qty
    FROM ${STOCK_OUT_FROM} AS h
    INNER JOIN ${STOCK_OUT_LINE_FROM} AS l
      ON ${nvarcharTextExpr('l', 'kcaq01', 200)} = ${nvarcharTextExpr('h', 'kcap01', 200)}
    WHERE ${nvarcharTextExpr('h', 'del', 20)} IN (N'', N'0')
      AND ${nvarcharTextExpr('l', 'del', 20)} IN (N'', N'0')
      AND ${nvarcharTextExpr('h', 'kcap03', 20)} = N'4'
      AND ${nvarcharTextExpr('h', 'kcap04', 200)} = @sourceOrderNo
      AND ${nvarcharTextExpr('h', 'kcap06', 200)} = @warehouseCode
      AND ${nvarcharTextExpr('l', 'kcaa01', 300)} IN (${inList})
  `)
  const aggMap = new Map()
  const pendingMap = new Map()
  for (const row of r.recordset ?? []) {
    const key = text(row.materialCode)
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

async function fetchProductionReturnQtyByMaterial(pool, { sourceOrderNo, materialCodes, excludeReceiptNo }) {
  const mats = (materialCodes ?? []).map((k) => text(k)).filter(Boolean)
  if (!mats.length) return { aggMap: new Map(), pendingMap: new Map() }
  const exclude = text(excludeReceiptNo)
  const excludeSql = exclude ? `AND ${nvarcharTextExpr('h', 'kcan01', 200)} <> @excludeReceiptNo` : ''
  const req = pool.request().input('sourceOrderNo', sql.NVarChar(200), sourceOrderNo)
  if (exclude) req.input('excludeReceiptNo', sql.NVarChar(200), exclude)
  const inList = mats.map((k, i) => {
    const p = `mc${i}`
    req.input(p, sql.NVarChar(300), k)
    return `@${p}`
  }).join(', ')
  const r = await req.query(`
    SELECT
      ${nvarcharTextExpr('l', 'kcaa01', 300)} AS materialCode,
      ${nvarcharTextExpr('h', 'kcan01', 200)} AS docNo,
      ${nvarcharTextExpr('h', 'pass', 20)} AS pass,
      ${safeDecimalExpr('l', 'kcao03')} AS qty
    FROM ${STOCK_IN_FROM} AS h
    INNER JOIN ${STOCK_IN_LINE_FROM} AS l
      ON ${nvarcharTextExpr('l', 'kcao01', 200)} = ${nvarcharTextExpr('h', 'kcan01', 200)}
    WHERE ${nvarcharTextExpr('h', 'del', 20)} IN (N'', N'0')
      AND ${nvarcharTextExpr('l', 'del', 20)} IN (N'', N'0')
      AND ${nvarcharTextExpr('h', 'kcan03', 20)} = N'5'
      AND ${nvarcharTextExpr('h', 'kcan04', 200)} = @sourceOrderNo
      ${excludeSql}
      AND ${nvarcharTextExpr('l', 'kcaa01', 300)} IN (${inList})
  `)
  const aggMap = new Map()
  const pendingMap = new Map()
  for (const row of r.recordset ?? []) {
    const key = text(row.materialCode)
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
    actualReturnQty: round(inbound.approvedQty, 4),
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

function resolveProductionReturnMaterialSnapshot(row) {
  const snap = row.snapshot ?? {}
  const out = {
    kcaa01: text(row.childKcaa01),
    kcaa02: text(snap.kcaa02),
    kcaa03: text(snap.kcaa03),
    kcaa04: text(snap.kcaa04),
    kcaa11: text(snap.kcaa11),
    kcaa25: text(snap.kcaa25),
    kcaa26: snap.kcaa26,
    kcaa27: text(snap.kcaa27),
    kcaa05: text(snap.kcaa05),
    location: text(snap.location),
    sale_price: snap.sale_price,
    cost_price: snap.cost_price,
    Customer_Name: text(snap.Customer_Name),
    Customer_supply: snap.Customer_supply,
    remark: text(snap.remark),
    kpname: text(snap.kpname),
    kcaa02_en: text(snap.kcaa02_en),
    version: text(snap.version),
    systemcode: text(snap.systemcode || snap.GUID),
    GUID: text(snap.GUID || snap.systemcode),
  }
  for (const col of KCAA_COLS) {
    if (snap[col] != null && snap[col] !== '') out[col] = snap[col]
  }
  return out
}

function joinDistinctText(values = [], fallback = '-') {
  const list = [...new Set((values ?? []).map((v) => text(v)).filter(Boolean))]
  if (!list.length) return fallback
  if (list.length <= 2) return list.join(' / ')
  return `${list.slice(0, 2).join(' / ')} 等${list.length}项`
}

function joinProductionReturnProductNames(names = []) {
  const list = [...new Set((names ?? []).map((v) => text(v)).filter(Boolean))]
  return list.join(' / ')
}

function resolveProductionReturnDispatchName(dispatchKcaa01, fallbackName = '', dispatchProductNameMap) {
  const code = text(dispatchKcaa01).toLowerCase()
  const fromBom = code ? text(dispatchProductNameMap?.get(code)) : ''
  return fromBom || text(fallbackName)
}

function resolveProductionReturnSelectState({ returnableQty, alreadySelected }) {
  if (alreadySelected) return { selectable: false, selectState: 'picked', selectLabel: '已选择' }
  if (toNumber(returnableQty) > 0) return { selectable: true, selectState: 'available', selectLabel: '选择' }
  return { selectable: false, selectState: 'unavailable', selectLabel: '不可选' }
}

function isProductionReturnCuttingWorkshop(workshopCode) {
  return text(workshopCode) === '04'
}

function mapProductionReturnExpandedRow(row, ctx) {
  const materialCode = text(row.childKcaa01)
  const scak02 = text(row.scak02 || row.sourceLineCode)
  const mat = resolveProductionReturnMaterialSnapshot(row)
  const issued = ctx.issueMap.get(materialCode) ?? { approvedQty: 0, pendingQty: 0 }
  const returned = ctx.returnMap.get(materialCode) ?? { approvedQty: 0, pendingQty: 0 }
  const issuedQty = round(toNumber(issued.approvedQty) + toNumber(issued.pendingQty), PRODUCTION_ISSUE_QTY_PRECISION)
  const returnedQty = round(toNumber(returned.approvedQty) + toNumber(returned.pendingQty), PRODUCTION_ISSUE_QTY_PRECISION)
  const returnableQty = Math.max(0, round(issuedQty - returnedQty, PRODUCTION_ISSUE_QTY_PRECISION))
  const dispatchKcaa01 = text(row.dispatchKcaa01)
  const dispatchProductName = resolveProductionReturnDispatchName(dispatchKcaa01, row.dispatchKcaa02, ctx.dispatchProductNameMap)
  return {
    mergeKey: text(row.mergeKey),
    sourceLineCode: scak02,
    kcao02: scak02,
    scak02,
    dispatchKcaa01,
    dispatchKcaa02: dispatchProductName,
    dispatchQty: round(row.scak03, PRODUCTION_ISSUE_QTY_PRECISION),
    sourceDemandQty: round(row.dispatchDemandQty, PRODUCTION_ISSUE_QTY_PRECISION),
    issuedQty,
    issuedApprovedQty: round(issued.approvedQty, PRODUCTION_ISSUE_QTY_PRECISION),
    issuedPendingQty: round(issued.pendingQty, PRODUCTION_ISSUE_QTY_PRECISION),
    returnedQty,
    returnedApprovedQty: round(returned.approvedQty, PRODUCTION_ISSUE_QTY_PRECISION),
    returnedPendingQty: round(returned.pendingQty, PRODUCTION_ISSUE_QTY_PRECISION),
    returnableQty,
    tempx: returnableQty,
    needQty: returnableQty,
    availableQty: returnableQty,
    kcao031: returnableQty,
    overflowCap: returnableQty,
    orderQty: issuedQty,
    orderQtyRaw: issuedQty,
    pendingOutboundText: formatPendingText(ctx.issuePendingMap.get(materialCode)),
    pendingInboundText: formatPendingText(ctx.returnPendingMap.get(materialCode)),
    actualOutboundQty: round(issued.approvedQty, PRODUCTION_ISSUE_QTY_PRECISION),
    actualReturnQty: round(returned.approvedQty, PRODUCTION_ISSUE_QTY_PRECISION),
    actualInboundQty: round(returned.approvedQty, PRODUCTION_ISSUE_QTY_PRECISION),
    reworkQty: round(issued.approvedQty, PRODUCTION_ISSUE_QTY_PRECISION),
    kcao04: 0,
    kcao041: 0,
    kcao05: 0,
    kcao051: 0,
    tax: 0,
    reference: text(ctx.piNo),
    info: dispatchProductName,
    Describe: dispatchProductName,
    customerSupplyLabel: customerSupplyLabel(mat.Customer_supply) || '-',
    rmbUnitPrice: 0,
    rmbAmount: 0,
    ...mat,
  }
}

function mapCuttingIssueRowToProductionReturn(row, selectedSet = new Set(), ctx = {}) {
  const materialCode = text(row.kcaa01 || row.childKcaa01)
  const sourceLineCode = text(row.sourceLineCode || row.scak02) || (materialCode ? `CUT|${materialCode}` : '')
  const issued = ctx.issueMap?.get(materialCode) ?? {}
  const returned = ctx.returnMap?.get(materialCode) ?? { approvedQty: 0, pendingQty: 0 }
  const issuedApprovedQty = round(issued.approvedQty ?? row.sourceApprovedOutQty ?? row.dispatchApprovedOutQty, PRODUCTION_ISSUE_QTY_PRECISION)
  const issuedPendingQty = round(issued.pendingQty ?? row.sourcePendingOutQty ?? row.dispatchPendingOutQty, PRODUCTION_ISSUE_QTY_PRECISION)
  const issuedQty = round(issuedApprovedQty + issuedPendingQty, PRODUCTION_ISSUE_QTY_PRECISION)
  const returnedQty = round(toNumber(returned.approvedQty) + toNumber(returned.pendingQty), PRODUCTION_ISSUE_QTY_PRECISION)
  const returnableQty = Math.max(0, round(issuedQty - returnedQty, PRODUCTION_ISSUE_QTY_PRECISION))
  const materialLineKey = `material|${materialCode.toLowerCase()}`
  const alreadySelected = selectedSet.has(materialLineKey) || selectedSet.has(sourceLineCode.toLowerCase())
  const select = resolveProductionReturnSelectState({ returnableQty, alreadySelected })
  const info = text(row.info || row.Describe || row.dispatchKcaa02 || row.kcaa02)
  return {
    ...row,
    lineKey: materialLineKey,
    sourceLineCode,
    kcao02: sourceLineCode,
    scak02: sourceLineCode,
    issuedQty,
    issuedApprovedQty,
    issuedPendingQty,
    returnedQty,
    returnedApprovedQty: round(returned.approvedQty, PRODUCTION_ISSUE_QTY_PRECISION),
    returnedPendingQty: round(returned.pendingQty, PRODUCTION_ISSUE_QTY_PRECISION),
    returnableQty,
    tempx: returnableQty,
    needQty: returnableQty,
    availableQty: returnableQty,
    kcao031: returnableQty,
    overflowCap: returnableQty,
    orderQty: issuedQty,
    actualOutboundQty: issuedApprovedQty,
    actualReturnQty: round(returned.approvedQty, PRODUCTION_ISSUE_QTY_PRECISION),
    actualInboundQty: round(returned.approvedQty, PRODUCTION_ISSUE_QTY_PRECISION),
    pendingOutboundText: formatPendingText(ctx.issuePendingMap?.get(materialCode)) || text(row.pendingOutboundText) || '-',
    pendingInboundText: formatPendingText(ctx.returnPendingMap?.get(materialCode)),
    kcao03: returnableQty,
    kcao04: 0,
    kcao041: 0,
    kcao05: 0,
    kcao051: 0,
    tax: 0,
    reference: text(ctx.piNo),
    info,
    Describe: info,
    expandSource: text(row.expandSource) || 'pi_cost_cutting',
    ...select,
  }
}

export function aggregateProductionReturnRowsByMaterial(rows, selectedSet = new Set(), ctx = {}) {
  const groups = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const materialCode = text(row.kcaa01)
    const key = materialCode.toLowerCase()
    if (!key) continue
    const existing = groups.get(key)
    if (!existing) {
      groups.set(key, {
        ...row,
        __dispatchCodes: [text(row.dispatchKcaa01)],
        __dispatchProductNames: [text(row.info) || text(row.dispatchKcaa02)],
        __scak02List: [text(row.scak02 || row.sourceLineCode)],
      })
      continue
    }
    existing.sourceDemandQty = round(toNumber(existing.sourceDemandQty) + toNumber(row.sourceDemandQty), PRODUCTION_ISSUE_QTY_PRECISION)
    existing.dispatchQty = round(toNumber(existing.dispatchQty) + toNumber(row.dispatchQty), PRODUCTION_ISSUE_QTY_PRECISION)
    existing.__dispatchCodes.push(text(row.dispatchKcaa01))
    existing.__dispatchProductNames.push(text(row.info) || text(row.dispatchKcaa02))
    existing.__scak02List.push(text(row.scak02 || row.sourceLineCode))
  }

  const merged = []
  for (const item of groups.values()) {
    const materialCode = text(item.kcaa01)
    const materialLineKey = `material|${materialCode.toLowerCase()}`
    const sourceLineCode = text(item.__scak02List.find(Boolean))
    const issued = ctx.issueMap?.get(materialCode) ?? { approvedQty: item.issuedApprovedQty, pendingQty: item.issuedPendingQty }
    const returned = ctx.returnMap?.get(materialCode) ?? { approvedQty: item.returnedApprovedQty, pendingQty: item.returnedPendingQty }
    const issuedQty = round(toNumber(issued.approvedQty) + toNumber(issued.pendingQty), PRODUCTION_ISSUE_QTY_PRECISION)
    const returnedQty = round(toNumber(returned.approvedQty) + toNumber(returned.pendingQty), PRODUCTION_ISSUE_QTY_PRECISION)
    const returnableQty = Math.max(0, round(issuedQty - returnedQty, PRODUCTION_ISSUE_QTY_PRECISION))
    const alreadySelected = selectedSet.has(materialLineKey) || selectedSet.has(sourceLineCode.toLowerCase())
    const select = resolveProductionReturnSelectState({ returnableQty, alreadySelected })
    const info = joinProductionReturnProductNames(item.__dispatchProductNames)
    const next = {
      ...item,
      lineKey: materialLineKey,
      sourceLineCode,
      kcao02: sourceLineCode,
      scak02: sourceLineCode,
      dispatchKcaa01: joinDistinctText(item.__dispatchCodes),
      dispatchKcaa02: info,
      info,
      Describe: info,
      issuedQty,
      issuedApprovedQty: round(issued.approvedQty, PRODUCTION_ISSUE_QTY_PRECISION),
      issuedPendingQty: round(issued.pendingQty, PRODUCTION_ISSUE_QTY_PRECISION),
      returnedQty,
      returnedApprovedQty: round(returned.approvedQty, PRODUCTION_ISSUE_QTY_PRECISION),
      returnedPendingQty: round(returned.pendingQty, PRODUCTION_ISSUE_QTY_PRECISION),
      returnableQty,
      tempx: returnableQty,
      needQty: returnableQty,
      availableQty: returnableQty,
      kcao031: returnableQty,
      overflowCap: returnableQty,
      orderQty: issuedQty,
      actualOutboundQty: round(issued.approvedQty, PRODUCTION_ISSUE_QTY_PRECISION),
      actualReturnQty: round(returned.approvedQty, PRODUCTION_ISSUE_QTY_PRECISION),
      actualInboundQty: round(returned.approvedQty, PRODUCTION_ISSUE_QTY_PRECISION),
      pendingOutboundText: formatPendingText(ctx.issuePendingMap?.get(materialCode)),
      pendingInboundText: formatPendingText(ctx.returnPendingMap?.get(materialCode)),
      ...select,
    }
    delete next.__dispatchCodes
    delete next.__dispatchProductNames
    delete next.__scak02List
    merged.push(next)
  }
  return merged
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
  const warehouseCode = text(query.warehouseCode)
  const piNo = text(query.piNo || query.paperNo)
  const inboundType = normalizeProductionBatchInboundType(query.inboundType)
  const dispatchSystemcode = text(query.dispatchSystemcode)
  const keyword = text(query.keyword)
  const { page, pageSize, startRow, endRow } = parsePage(query)
  const isReturn = inboundType === '5'

  if (isReturn && !dispatchSystemcode) {
    return { ok: false, status: 400, msg: LEGACY_RETURN_PARAM_ERROR_MSG }
  }
  if (isReturn && !warehouseCode) {
    return { ok: false, status: 400, msg: '请先选择仓库' }
  }
  if (isReturn && !piNo) {
    return { ok: false, status: 400, msg: '请先带出 PI号' }
  }

  const headerCheck = await validateProductionDispatchHeader(pool, {
    sourceOrderNo,
    workshopCode,
    dispatchSystemcode,
    inboundType,
  })
  if (!headerCheck.ok) return headerCheck
  const selectedSet = new Set(
    text(query.selectedKeys)
      .split(',')
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean),
  )

  if (isReturn) {
    const paging = parseProductionReturnPaging(query)
    if (isProductionReturnCuttingWorkshop(workshopCode)) {
      const { fetchCuttingIssueBatchLines } = await import('./stockOutCuttingIssueBatchAdd.js')
      const cuttingResult = await fetchCuttingIssueBatchLines(pool, {
        ...query,
        sourceOrderNo,
        workshopCode,
        warehouseCode,
        piNo,
        dispatchSystemcode,
        keyword: '',
        fetchAll: '1',
      })
      if (!cuttingResult.ok) return cuttingResult
      const cuttingRows = Array.isArray(cuttingResult.list) ? cuttingResult.list : []
      const kw = keyword.toLowerCase()
      const filteredCuttingRows = kw
        ? cuttingRows.filter((row) => text(row.kcaa01 || row.childKcaa01).toLowerCase().includes(kw))
        : cuttingRows
      const materialCodes = [...new Set(filteredCuttingRows.map((row) => text(row.kcaa01 || row.childKcaa01)).filter(Boolean))]
      const [issueResult, returnResult] = await Promise.all([
        fetchProductionIssueQtyByMaterial(pool, { sourceOrderNo, warehouseCode, materialCodes }),
        fetchProductionReturnQtyByMaterial(pool, { sourceOrderNo, materialCodes, excludeReceiptNo }),
      ])
      const ctx = {
        piNo,
        issueMap: issueResult.aggMap,
        issuePendingMap: issueResult.pendingMap,
        returnMap: returnResult.aggMap,
        returnPendingMap: returnResult.pendingMap,
      }
      const mappedRows = filteredCuttingRows.map((row) => mapCuttingIssueRowToProductionReturn(row, selectedSet, ctx))
      const sliced = sliceProductionReturnRows(mappedRows, paging)
      return {
        ok: true,
        list: sliced.list,
        total: sliced.total,
        page: sliced.page,
        pageSize: sliced.pageSize,
        fetchAll: paging.fetchAll,
        sourceOrderNo,
        workshopCode,
        warehouseCode,
        piNo,
        batchMode: 'cutting',
        piCostHint: cuttingResult.piCostHint,
      }
    }

    const listReq = pool.request()
      .input('sourceOrderNo', sql.NVarChar(200), sourceOrderNo)
      .input('workshopCode', sql.NVarChar(200), workshopCode)
    const listR = await listReq.query(`
      SELECT
        l.[id],
        ${nvarcharTextExpr('l', 'scak02', 200)} AS scak02,
        ${nvarcharTextExpr('l', 'systemcode', 200)} AS systemcode,
        ${nvarcharTextExpr('l', 'GUID', 200)} AS GUID,
        ${safeDecimalExpr('l', 'scak03')} AS scak03,
        ${nvarcharTextExpr('l', 'pi', 200)} AS pi,
        ${nvarcharTextExpr('l', 'kcaa01', 300)} AS kcaa01,
        ${nvarcharTextExpr('l', 'kcaa02', 500)} AS kcaa02
      FROM ${DISPATCH_LINE_FROM} AS l
      INNER JOIN ${DISPATCH_HEADER_FROM} AS h
        ON ${nvarcharTextExpr('h', 'scaj01', 200)} = ${nvarcharTextExpr('l', 'scak01', 200)}
      WHERE ${nvarcharTextExpr('h', 'scaj01', 200)} = @sourceOrderNo
        AND ${nvarcharTextExpr('h', 'del', 20)} IN (N'', N'0')
        AND ${nvarcharTextExpr('h', 'pass', 20)} = N'1'
        AND ${nvarcharTextExpr('h', 'closed', 20)} IN (N'', N'0')
        AND ${nvarcharTextExpr('h', 'scaj05', 200)} = @workshopCode
        AND ${nvarcharTextExpr('l', 'del', 20)} IN (N'', N'0')
        AND ${nvarcharTextExpr('l', 'scak02', 200)} = ${nvarcharTextExpr('l', 'GUID', 200)}
        AND ${nvarcharTextExpr('l', 'scak02', 200)} <> N''
      ORDER BY ${safeIntExpr('l', 'seq')}, l.[id]
    `)
    const dispatchLines = listR.recordset ?? []
    if (!dispatchLines.length) {
      return { ok: false, status: 400, msg: LEGACY_RETURN_NO_LINES_MSG }
    }

    const expandedRaw = await batchExpandProductionDispatchLines(pool, dispatchLines, piNo)
    const kw = keyword.toLowerCase()
    const filtered = kw
      ? expandedRaw.filter((row) => text(row.childKcaa01).toLowerCase().includes(kw))
      : expandedRaw
    if (!filtered.length) {
      return {
        ok: true,
        list: [],
        total: 0,
        page: paging.page,
        pageSize: paging.pageSize,
        fetchAll: paging.fetchAll,
        sourceOrderNo,
        workshopCode,
        warehouseCode,
        piNo,
        piCostHint: '当前派工单未匹配到 PI 成本用量材料，请确认 PI 已完成一键运算',
      }
    }

    const materialCodes = [...new Set(filtered.map((row) => text(row.childKcaa01)).filter(Boolean))]
    const dispatchMaterialCodes = [...new Set(filtered.map((row) => text(row.dispatchKcaa01)).filter(Boolean))]
    const [issueResult, returnResult, dispatchProductNameMap] = await Promise.all([
      fetchProductionIssueQtyByMaterial(pool, { sourceOrderNo, warehouseCode, materialCodes }),
      fetchProductionReturnQtyByMaterial(pool, { sourceOrderNo, materialCodes, excludeReceiptNo }),
      fetchBom000Kcaa02ByMaterialBatch(pool, dispatchMaterialCodes),
    ])

    const ctx = {
      piNo,
      issueMap: issueResult.aggMap,
      issuePendingMap: issueResult.pendingMap,
      returnMap: returnResult.aggMap,
      returnPendingMap: returnResult.pendingMap,
      dispatchProductNameMap,
    }
    const mappedRows = filtered.map((row) => mapProductionReturnExpandedRow(row, ctx))
    const mergedRows = aggregateProductionReturnRowsByMaterial(mappedRows, selectedSet, ctx)
    const sliced = sliceProductionReturnRows(mergedRows, paging)
    return {
      ok: true,
      list: sliced.list,
      total: sliced.total,
      page: sliced.page,
      pageSize: sliced.pageSize,
      fetchAll: paging.fetchAll,
      sourceOrderNo,
      workshopCode,
      warehouseCode,
      piNo,
    }
  }

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
  if (isReturn && total <= 0) {
    return { ok: false, status: 400, msg: LEGACY_RETURN_NO_LINES_MSG }
  }

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
    fetchInboundAggByDetailKey(pool, { sourceOrderNo, detailKeys, excludeReceiptNo, inMeta, inboundType }),
    fetchInboundPendingDocs(pool, { sourceOrderNo, detailKeys, excludeReceiptNo, inMeta, inboundType }),
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
    inboundType,
  }
  return { ok: true, list: rawRows.map((row) => mapProductionLineRow(row, ctx)), total, page, pageSize }
}

export {
  computeAssistKsum as computeProductionKsum,
  computeAssistKcao031 as computeProductionKcao031,
  resolveAssistBatchSelectState as resolveProductionBatchSelectState,
}
