/**
 * 成品出库批量添加：按销售订单明细 + 本单已出/未出占用计算可出货数量。
 * SQL Server 2008 R2 兼容（ROW_NUMBER 分页）。
 */
import { sql } from './db.js'
import { safeDecimalExpr, safeIntExpr, nvarcharTextExpr } from './buyOrderSqlSafe.js'
import { calcOtherBatchStockQty } from './stockOutOtherBatchAdd.js'
import { computeKsum } from './stockInPurchaseBatchAdd.js'

const SALES_HEADER_FROM = 'dbo.[UB_ERP_Sales_order]'
const SALES_LINE_FROM = 'dbo.[UB_ERP_Sales_order_list]'
const STOCK_IN_FROM = 'dbo.[UB_ERP_Stocks_Storage]'
const STOCK_IN_LINE_FROM = 'dbo.[UB_ERP_Stocks_Storage_list]'
const STOCK_OUT_FROM = 'dbo.[UB_ERP_Stocks_out]'
const STOCK_OUT_LINE_FROM = 'dbo.[UB_ERP_Stocks_out_list]'
const CURRENCY_FROM = 'dbo.[UB_ERP_Finance_currency]'

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

function delActiveSql(alias) {
  return `ISNULL(${alias}.[del], N'0') IN (N'', N'0')`
}

/** 可出货 = 销售换算量 − 已审出库 − 未审出库占用 */
export function computeFinishedGoodsShippableQty({ orderQty, approvedOutQty, pendingOutQty }) {
  const qty = round(toNumber(orderQty) - toNumber(approvedOutQty) - toNumber(pendingOutQty), 4)
  return qty > 0 ? qty : 0
}

export function resolveFinishedGoodsBatchSelectState({ shippableQty, alreadySelected }) {
  if (alreadySelected) {
    return { selectState: 'picked', selectLabel: '已选择', selectable: false }
  }
  if (toNumber(shippableQty) > 0) {
    return { selectState: 'select', selectLabel: '选择', selectable: true }
  }
  return { selectState: 'disabled_full', selectLabel: '不可选', selectable: false }
}

export function resolveFinishedGoodsDetailKey(row) {
  return text(row.xsak02 || row.systemcode || row.GUID)
}

export function formatFinishedGoodsPendingText(rows, qtyKey = 'qty') {
  const list = Array.isArray(rows) ? rows : []
  if (!list.length) return '-'
  const totalQty = round(list.reduce((sum, row) => sum + toNumber(row[qtyKey]), 0), 4)
  const docNos = list.map((row) => text(row.docNo)).filter(Boolean)
  const uniqueDocs = [...new Set(docNos)]
  const docText = uniqueDocs.length > 3 ? `${uniqueDocs.slice(0, 3).join('、')}...` : uniqueDocs.join('、')
  return `${totalQty} / ${uniqueDocs.length} / ${docText || '-'}`
}

function parsePage(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1)
  const rawPageSize = Number.parseInt(query.pageSize, 10) || 20
  const pageSize = Math.min(200, Math.max(1, rawPageSize))
  return { page, pageSize, startRow: (page - 1) * pageSize + 1, endRow: page * pageSize }
}

function buildKeywordWhere(keyword) {
  const kw = text(keyword)
  if (!kw) return ''
  // 销售明细表无 Reference/info（属采购明细/出库明细），关键字改搜 remark、客款/厂款等
  const likeCols = ['kcaa01', 'kcaa02', 'kcaa03', 'kcaa11', 'kcaa06', 'kcaa09', 'remark', 'location', 'xsak02', 'systemcode']
  const parts = likeCols.map((col) => `${nvarcharTextExpr('l', col)} LIKE @keyword`)
  return `AND (${parts.join(' OR ')})`
}

async function validateSalesHeader(pool, { sourceOrderNo, customerCode, sourceSystemcodeId }) {
  const r = await pool.request()
    .input('sourceOrderNo', sql.NVarChar(200), sourceOrderNo)
    .input('customerCode', sql.NVarChar(200), customerCode)
    .input('sourceSystemcodeId', sql.NVarChar(500), sourceSystemcodeId)
    .query(`
      SELECT TOP 1
        ${nvarcharTextExpr('h', 'rmb', 200)} AS currencyName,
        ${nvarcharTextExpr('h', 'xsaj06', 200)} AS poNo,
        ISNULL((
          SELECT TOP 1 ${safeDecimalExpr('c', 'rate')}
          FROM ${CURRENCY_FROM} AS c
          WHERE ${nvarcharTextExpr('c', 'name', 200)} = ${nvarcharTextExpr('h', 'rmb', 200)}
             OR ${nvarcharTextExpr('c', 'code', 200)} = ${nvarcharTextExpr('h', 'rmb', 200)}
        ), 1) AS currencyRate
      FROM ${SALES_HEADER_FROM} AS h
      WHERE ${nvarcharTextExpr('h', 'xsaj01', 200)} = @sourceOrderNo
        AND ${nvarcharTextExpr('h', 'xsaj05', 200)} = @customerCode
        AND ${nvarcharTextExpr('h', 'systemcode', 500)} = @sourceSystemcodeId
        AND ${delActiveSql('h')}
        AND h.[pass] = N'1'
        AND LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), h.[closed]), N'0'))) = N'0'
    `)
  return r.recordset?.[0] ?? null
}

async function fetchApprovedOutByMaterial(pool, { sourceOrderNo, materialCodes, excludeOutboundNo }) {
  const mats = (materialCodes ?? []).map((k) => text(k)).filter(Boolean)
  if (!mats.length) return new Map()
  const exclude = text(excludeOutboundNo)
  const excludeSql = exclude ? `AND h.[kcap01] <> @excludeOutboundNo` : ''
  const req = pool.request().input('sourceOrderNo', sql.NVarChar(200), sourceOrderNo)
  if (exclude) req.input('excludeOutboundNo', sql.NVarChar(200), exclude)
  const inList = mats.map((k, i) => {
    const p = `mc${i}`
    req.input(p, sql.NVarChar(300), k)
    return `@${p}`
  }).join(', ')
  const r = await req.query(`
    SELECT
      ${nvarcharTextExpr('l', 'kcaa01', 300)} AS materialCode,
      SUM(${safeDecimalExpr('l', 'kcaq03')}) AS approvedOutQty
    FROM ${STOCK_OUT_FROM} AS h
    INNER JOIN ${STOCK_OUT_LINE_FROM} AS l
      ON l.[kcaq01] = h.[kcap01]
    WHERE ${delActiveSql('h')}
      AND ${delActiveSql('l')}
      AND h.[pass] = N'1'
      AND h.[kcap04] = @sourceOrderNo
      ${excludeSql}
      AND ${nvarcharTextExpr('l', 'kcaa01', 300)} IN (${inList})
    GROUP BY l.[kcaa01]
  `)
  const map = new Map()
  for (const row of r.recordset ?? []) {
    map.set(text(row.materialCode), toNumber(row.approvedOutQty))
  }
  return map
}

async function fetchPendingOutByDetailKey(pool, { sourceOrderNo, detailKeys, excludeOutboundNo }) {
  const keys = (detailKeys ?? []).map((k) => text(k)).filter(Boolean)
  if (!keys.length) return new Map()
  const exclude = text(excludeOutboundNo)
  const excludeSql = exclude ? `AND h.[kcap01] <> @excludeOutboundNo` : ''
  const req = pool.request().input('sourceOrderNo', sql.NVarChar(200), sourceOrderNo)
  if (exclude) req.input('excludeOutboundNo', sql.NVarChar(200), exclude)
  const inList = keys.map((k, i) => {
    const p = `dk${i}`
    req.input(p, sql.NVarChar(200), k)
    return `@${p}`
  }).join(', ')
  const r = await req.query(`
    SELECT
      ${nvarcharTextExpr('l', 'kcaq02', 200)} AS detailKey,
      SUM(${safeDecimalExpr('l', 'kcaq03')}) AS pendingOutQty
    FROM ${STOCK_OUT_FROM} AS h
    INNER JOIN ${STOCK_OUT_LINE_FROM} AS l
      ON l.[kcaq01] = h.[kcap01]
    WHERE ${delActiveSql('h')}
      AND ${delActiveSql('l')}
      AND ISNULL(h.[pass], N'0') <> N'1'
      AND h.[kcap04] = @sourceOrderNo
      ${excludeSql}
      AND ${nvarcharTextExpr('l', 'kcaq02', 200)} IN (${inList})
    GROUP BY l.[kcaq02]
  `)
  const map = new Map()
  for (const row of r.recordset ?? []) {
    map.set(text(row.detailKey), toNumber(row.pendingOutQty))
  }
  return map
}

async function fetchPendingOutDetails(pool, { sourceOrderNo, detailKeys, excludeOutboundNo }) {
  const keys = (detailKeys ?? []).map((k) => text(k)).filter(Boolean)
  if (!keys.length) return new Map()
  const exclude = text(excludeOutboundNo)
  const excludeSql = exclude ? `AND h.[kcap01] <> @excludeOutboundNo` : ''
  const req = pool.request().input('sourceOrderNo', sql.NVarChar(200), sourceOrderNo)
  if (exclude) req.input('excludeOutboundNo', sql.NVarChar(200), exclude)
  const inList = keys.map((k, i) => {
    const p = `dk${i}`
    req.input(p, sql.NVarChar(200), k)
    return `@${p}`
  }).join(', ')
  const r = await req.query(`
    SELECT
      ${nvarcharTextExpr('l', 'kcaq02', 200)} AS detailKey,
      ${nvarcharTextExpr('h', 'kcap01', 200)} AS docNo,
      SUM(${safeDecimalExpr('l', 'kcaq03')}) AS qty
    FROM ${STOCK_OUT_FROM} AS h
    INNER JOIN ${STOCK_OUT_LINE_FROM} AS l
      ON l.[kcaq01] = h.[kcap01]
    WHERE ${delActiveSql('h')}
      AND ${delActiveSql('l')}
      AND ISNULL(h.[pass], N'0') <> N'1'
      AND h.[kcap04] = @sourceOrderNo
      ${excludeSql}
      AND ${nvarcharTextExpr('l', 'kcaq02', 200)} IN (${inList})
    GROUP BY l.[kcaq02], h.[kcap01]
  `)
  const map = new Map()
  for (const row of r.recordset ?? []) {
    const key = text(row.detailKey)
    if (!map.has(key)) map.set(key, [])
    map.get(key).push({ docNo: text(row.docNo), qty: toNumber(row.qty) })
  }
  return map
}

async function fetchWarehouseStockByMaterial(pool, { warehouseCode, materialCodes, excludeOutboundNo }) {
  const mats = (materialCodes ?? []).map((k) => text(k)).filter(Boolean)
  if (!mats.length) return new Map()
  const exclude = text(excludeOutboundNo)
  const excludeSql = exclude ? `AND oh.[kcap01] <> @excludeOutboundNo` : ''
  const req = pool.request().input('warehouseCode', sql.NVarChar(200), warehouseCode)
  if (exclude) req.input('excludeOutboundNo', sql.NVarChar(200), exclude)
  const inList = mats.map((k, i) => {
    const p = `mc${i}`
    req.input(p, sql.NVarChar(300), k)
    return `@${p}`
  }).join(', ')
  const r = await req.query(`
    SELECT
      x.[materialCode],
      ISNULL(i.[approvedInQty], 0) AS approvedInQty,
      ISNULL(o.[approvedOutQty], 0) AS approvedOutQty,
      ISNULL(o.[pendingOutQty], 0) AS pendingOutQty
    FROM (
      SELECT DISTINCT v.[materialCode]
      FROM (VALUES ${mats.map((_, i) => `(@mc${i})`).join(', ')}) AS v([materialCode])
    ) AS x
    LEFT JOIN (
      SELECT
        il.[kcaa01] AS materialCode,
        SUM(${safeDecimalExpr('il', 'kcao03')}) AS approvedInQty
      FROM ${STOCK_IN_FROM} AS ih
      INNER JOIN ${STOCK_IN_LINE_FROM} AS il
        ON il.[kcao01] = ih.[kcan01]
      WHERE ${delActiveSql('ih')}
        AND ${delActiveSql('il')}
        AND ih.[pass] = N'1'
        AND ih.[kcan06] = @warehouseCode
        AND il.[kcaa01] IN (${inList})
      GROUP BY il.[kcaa01]
    ) AS i ON i.[materialCode] = x.[materialCode]
    LEFT JOIN (
      SELECT
        ol.[kcaa01] AS materialCode,
        SUM(CASE WHEN oh.[pass] = N'1' THEN ${safeDecimalExpr('ol', 'kcaq03')} ELSE 0 END) AS approvedOutQty,
        SUM(CASE WHEN ISNULL(oh.[pass], N'0') <> N'1' THEN ${safeDecimalExpr('ol', 'kcaq03')} ELSE 0 END) AS pendingOutQty
      FROM ${STOCK_OUT_FROM} AS oh
      INNER JOIN ${STOCK_OUT_LINE_FROM} AS ol
        ON ol.[kcaq01] = oh.[kcap01]
      WHERE ${delActiveSql('oh')}
        AND ${delActiveSql('ol')}
        AND oh.[kcap06] = @warehouseCode
        ${excludeSql}
        AND ol.[kcaa01] IN (${inList})
      GROUP BY ol.[kcaa01]
    ) AS o ON o.[materialCode] = x.[materialCode]
  `)
  const map = new Map()
  for (const row of r.recordset ?? []) {
    const stock = calcOtherBatchStockQty({
      approvedInQty: row.approvedInQty,
      approvedOutQty: row.approvedOutQty,
      pendingOutQty: row.pendingOutQty,
    })
    map.set(text(row.materialCode), stock)
  }
  return map
}

function buildPoPiReference(ctx) {
  const poNo = text(ctx.poNo)
  const piNo = text(ctx.sourceOrderNo)
  if (poNo && piNo) return `${poNo}/${piNo}`
  return poNo || piNo
}

function mapLineRow(row, ctx) {
  const detailKey = resolveFinishedGoodsDetailKey(row)
  const materialCode = text(row.kcaa01)
  const orderQty = computeKsum(row.xsak03, row.kcaa26, row.kcaa27)
  const approvedOutQty = ctx.approvedOutMap.get(materialCode) ?? 0
  const pendingOutQty = ctx.pendingOutMap.get(detailKey) ?? 0
  const shippableQty = computeFinishedGoodsShippableQty({ orderQty, approvedOutQty, pendingOutQty })
  const stock = ctx.stockMap.get(materialCode) ?? calcOtherBatchStockQty({})
  const pendingRows = ctx.pendingDetailMap.get(detailKey) ?? []
  const pendingOutboundText = formatFinishedGoodsPendingText(pendingRows)
  const alreadySelected = ctx.selectedSet.has(detailKey.toLowerCase())
  const select = resolveFinishedGoodsBatchSelectState({ shippableQty, alreadySelected })
  const rate = toNumber(ctx.currencyRate) || 1
  const currencyName = text(ctx.currencyName)
  const lineRemark = text(row.remark)

  const out = {
    lineKey: detailKey,
    sourceLineCode: detailKey,
    xsak02: detailKey,
    id: row.id,
    systemcode: text(row.systemcode) || detailKey,
    GUID: text(row.GUID) || text(row.systemcode) || detailKey,
    kcaa01: materialCode,
    kcaa02: text(row.kcaa02),
    kcaa03: text(row.kcaa03),
    kcaa04: text(row.kcaa04),
    kcaa11: text(row.kcaa11),
    kcaa26: row.kcaa26,
    kcaa27: text(row.kcaa27),
    reference: buildPoPiReference(ctx),
    info: lineRemark,
    remark: lineRemark,
    orderQty,
    orderQtyRaw: toNumber(row.xsak03),
    stockQty: stock.displayActualQty,
    warehouseActualQty: stock.actualQty,
    approvedOutQty: round(approvedOutQty, 4),
    pendingOutQty: round(pendingOutQty, 4),
    shippableQty,
    tempx: shippableQty,
    pendingOutboundText,
    currencyDisplay: currencyName ? `${currencyName} / ${rate}` : `— / ${rate}`,
    currencyName,
    currencyRate: rate,
    availableQty: shippableQty,
    kcaq03: shippableQty,
    kcaq031: shippableQty,
    tax: 0,
    location: text(row.location),
    sale_price: row.sale_price,
    cost_price: row.cost_price,
    kcaa02_en: text(row.kcaa02_en),
    version: text(row.version),
    ...select,
  }
  for (const col of KCAA_COLS) {
    if (row[col] != null && out[col] == null) out[col] = row[col]
  }
  return out
}

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {Record<string, string>} query
 */
export async function fetchStockOutFinishedGoodsBatchLines(pool, query = {}) {
  const sourceOrderNo = text(query.sourceOrderNo)
  const customerCode = text(query.customerCode)
  const sourceSystemcodeId = text(query.sourceSystemcodeId)
  const warehouseCode = text(query.warehouseCode)
  if (!sourceOrderNo) return { ok: false, status: 400, msg: '请先选择订单单号.' }
  if (!customerCode) return { ok: false, status: 400, msg: '请先选择客户' }
  if (!sourceSystemcodeId) return { ok: false, status: 400, msg: '请先关联销售订单' }
  if (!warehouseCode) return { ok: false, status: 400, msg: '请先选择仓库' }

  const headerRow = await validateSalesHeader(pool, { sourceOrderNo, customerCode, sourceSystemcodeId })
  if (!headerRow) {
    return { ok: false, status: 400, msg: '销售订单不存在、未审核、已结案或与客户/主表标识不匹配' }
  }

  const keyword = text(query.keyword)
  const excludeOutboundNo = text(query.excludeOutboundNo)
  const { page, pageSize, startRow, endRow } = parsePage(query)
  const selectedSet = new Set(
    text(query.selectedKeys)
      .split(',')
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean),
  )

  const countReq = pool.request().input('sourceOrderNo', sql.NVarChar(200), sourceOrderNo)
  if (keyword) countReq.input('keyword', sql.NVarChar(400), `%${keyword}%`)

  const countR = await countReq.query(`
    SELECT COUNT(1) AS total
    FROM ${SALES_LINE_FROM} AS l
    WHERE l.[xsak01] = @sourceOrderNo
      AND ${delActiveSql('l')}
      AND l.[pass] = N'1'
      ${buildKeywordWhere(keyword)}
  `)
  const total = Number(countR.recordset?.[0]?.total ?? 0)

  const kcaaSelect = KCAA_COLS.map((col) => `l.[${col}]`).join(', ')
  const listReq = pool.request()
    .input('sourceOrderNo', sql.NVarChar(200), sourceOrderNo)
    .input('startRow', sql.Int, startRow)
    .input('endRow', sql.Int, endRow)
  if (keyword) listReq.input('keyword', sql.NVarChar(400), `%${keyword}%`)

  const listR = await listReq.query(`
    WITH base AS (
      SELECT
        l.[id],
        l.[xsak02],
        l.[systemcode],
        l.[GUID],
        l.[xsak03],
        l.[location],
        l.[sale_price],
        l.[cost_price],
        l.[remark],
        l.[kcaa02_en],
        l.[version],
        ${kcaaSelect},
        ROW_NUMBER() OVER (ORDER BY ${safeIntExpr('l', 'seq')}, l.[id]) AS rn
      FROM ${SALES_LINE_FROM} AS l
      WHERE l.[xsak01] = @sourceOrderNo
        AND ${delActiveSql('l')}
        AND l.[pass] = N'1'
        ${buildKeywordWhere(keyword)}
    )
    SELECT * FROM base WHERE rn BETWEEN @startRow AND @endRow ORDER BY rn
  `)

  const rawRows = listR.recordset ?? []
  if (!rawRows.length) {
    return {
      ok: true,
      list: [],
      total,
      page,
      pageSize,
      sourceOrderNo,
      customerCode,
      sourceSystemcodeId,
      warehouseCode,
      currencyName: text(headerRow.currencyName),
      currencyRate: toNumber(headerRow.currencyRate) || 1,
    }
  }

  const detailKeys = [...new Set(rawRows.map((row) => resolveFinishedGoodsDetailKey(row)).filter(Boolean))]
  const materialCodes = [...new Set(rawRows.map((row) => text(row.kcaa01)).filter(Boolean))]

  const [approvedOutMap, pendingOutMap, pendingDetailMap, stockMap] = await Promise.all([
    fetchApprovedOutByMaterial(pool, { sourceOrderNo, materialCodes, excludeOutboundNo }),
    fetchPendingOutByDetailKey(pool, { sourceOrderNo, detailKeys, excludeOutboundNo }),
    fetchPendingOutDetails(pool, { sourceOrderNo, detailKeys, excludeOutboundNo }),
    fetchWarehouseStockByMaterial(pool, { warehouseCode, materialCodes, excludeOutboundNo }),
  ])

  const ctx = {
    approvedOutMap,
    pendingOutMap,
    pendingDetailMap,
    stockMap,
    selectedSet,
    sourceOrderNo,
    poNo: text(headerRow.poNo),
    currencyName: text(headerRow.currencyName),
    currencyRate: toNumber(headerRow.currencyRate) || 1,
  }
  const list = rawRows.map((row) => mapLineRow(row, ctx))

  return {
    ok: true,
    list,
    total,
    page,
    pageSize,
    sourceOrderNo,
    customerCode,
    sourceSystemcodeId,
    warehouseCode,
    currencyName: ctx.currencyName,
    currencyRate: ctx.currencyRate,
  }
}
