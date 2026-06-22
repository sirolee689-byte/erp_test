/**
 * 采购入库批量添加：按采购单明细行分页展示，数量池按 kcak02（BOM systemcode）共享。
 */
import { sql } from './db.js'
import { safeDecimalExpr, safeIntExpr, nvarcharTextExpr } from './buyOrderSqlSafe.js'

const BUY_HEADER_FROM = 'dbo.[UB_ERP_Buy_order]'
const BUY_LINE_FROM = 'dbo.[UB_ERP_Buy_order_list]'
const STOCK_IN_FROM = 'dbo.[UB_ERP_Stocks_Storage]'
const STOCK_IN_LINE_FROM = 'dbo.[UB_ERP_Stocks_Storage_list]'
const STOCK_OUT_FROM = 'dbo.[UB_ERP_Stocks_out]'
const STOCK_OUT_LINE_FROM = 'dbo.[UB_ERP_Stocks_out_list]'
const MATERIAL_CAT_FROM = 'dbo.[UB_ERP_Stocks_material]'
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

/** 采购数量换算为使用单位数量（与入库单 computeConvertedOrderQty 一致） */
export function computeKsum(kcak03, kcaa26, kcaa27) {
  const qty = toNumber(kcak03)
  const ratio = toNumber(kcaa26)
  const dir = text(kcaa27)
  if (!(ratio > 0)) return round(qty, 4)
  if (dir === '1') return round(qty / ratio, 4)
  if (dir === '0') return round(qty * ratio, 4)
  return round(qty, 4)
}

export function parseFloatRate(raw) {
  const s = text(raw)
  if (!s) return 0
  if (s.endsWith('%')) {
    const n = toNumber(s.slice(0, -1))
    return n > 1 ? n / 100 : n
  }
  const n = toNumber(s)
  return n > 1 ? n / 100 : n
}

/** 需入数量：采购换算量 - 净已占（已审+未审入库 - 已审+未审退货） */
export function computeTempx(ksum, sumr, sumrx, osum, sumox) {
  const occupied = (toNumber(sumr) + toNumber(sumrx)) - (toNumber(osum) + toNumber(sumox))
  return round(Math.max(0, toNumber(ksum) - occupied), 4)
}

/** 可超量入库上限；小于 0 时按定稿取 max(0, 值) */
export function computeKcao031(ksum, stocksInRate, sumr, sumrx, osum, sumox) {
  const rate = toNumber(stocksInRate)
  const tempxs = toNumber(ksum) + toNumber(ksum) * rate
  const occupied = (toNumber(sumr) + toNumber(sumrx)) - (toNumber(osum) + toNumber(sumox))
  return round(Math.max(0, tempxs - occupied), 4)
}

export function resolvePurchaseBatchSelectState({
  tempx,
  kcao031,
  pendingReturnQty,
  alreadySelected,
  isAdmin,
}) {
  if (alreadySelected) {
    return { selectState: 'picked', selectLabel: '已选择', selectable: false }
  }
  if (toNumber(pendingReturnQty) > 0) {
    return { selectState: 'disabled_return', selectLabel: '有未审退货不可选', selectable: false }
  }
  if (toNumber(tempx) > 0 || toNumber(kcao031) > 0) {
    return { selectState: 'select', selectLabel: '选择', selectable: true }
  }
  if (isAdmin) {
    return { selectState: 'admin_force', selectLabel: '选择', selectable: true }
  }
  return { selectState: 'disabled_full', selectLabel: '不可选', selectable: false }
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
  const likeCols = ['kcaa01', 'kcaa02', 'kcaa03', 'kcaa11', 'Reference', 'info', 'kcak02', 'systemcode']
  const parts = likeCols.map((col) => `${nvarcharTextExpr('l', col)} LIKE @keyword`)
  return `AND (${parts.join(' OR ')})`
}

function toRmbPrice(price, rate) {
  const r = toNumber(rate)
  const p = toNumber(price)
  if (!(r > 0)) return round(p, 4)
  return round(p / r, 4)
}

function formatPendingText(rows, qtyKey = 'qty') {
  const list = Array.isArray(rows) ? rows : []
  if (!list.length) return '—'
  const totalQty = round(list.reduce((sum, row) => sum + toNumber(row[qtyKey]), 0), 4)
  const docNos = list.map((row) => text(row.docNo)).filter(Boolean)
  const uniqueDocs = [...new Set(docNos)]
  const docText = uniqueDocs.length > 3 ? `${uniqueDocs.slice(0, 3).join('、')}…` : uniqueDocs.join('、')
  return `${totalQty} / ${uniqueDocs.length} / ${docText || '—'}`
}

function unitConvertText(kcaa04, kcaa25, kcaa26, kcaa27, kcak03) {
  const useUnit = text(kcaa04)
  const buyUnit = text(kcaa25)
  if (!buyUnit || buyUnit === useUnit) return '否'
  const dir = text(kcaa27) === '1' ? '使用→采购' : '采购→使用'
  return `${buyUnit} / ${dir} / ${text(kcaa26) || '1'} / ${text(kcak03)}`
}

async function getStockOutMeta(pool) {
  const r = await pool.request().query(`
    SELECT
      CASE
        WHEN COL_LENGTH('dbo.UB_ERP_Stocks_out', 'kcap04') IS NOT NULL THEN N'kcap04'
        WHEN COL_LENGTH('dbo.UB_ERP_Stocks_out', 'kcan04') IS NOT NULL THEN N'kcan04'
        WHEN COL_LENGTH('dbo.UB_ERP_Stocks_out', 'sourceOrderNo') IS NOT NULL THEN N'sourceOrderNo'
        ELSE N''
      END AS linkCol,
      CASE
        WHEN COL_LENGTH('dbo.UB_ERP_Stocks_out_list', 'kcaq03') IS NOT NULL THEN N'kcaq03'
        WHEN COL_LENGTH('dbo.UB_ERP_Stocks_out_list', 'kcao03') IS NOT NULL THEN N'kcao03'
        ELSE N'kcaq03'
      END AS qtyCol
  `)
  return {
    linkCol: text(r.recordset?.[0]?.linkCol),
    qtyCol: text(r.recordset?.[0]?.qtyCol) || 'kcaq03',
  }
}

async function fetchInboundAggByDetailKey(pool, { sourceOrderNo, detailKeys, excludeReceiptNo }) {
  const keys = (detailKeys ?? []).map((k) => text(k)).filter(Boolean)
  if (!keys.length) return new Map()
  const exclude = text(excludeReceiptNo)
  const excludeSql = exclude
    ? `AND ${nvarcharTextExpr('h', 'kcan01', 200)} <> @excludeReceiptNo`
    : ''
  const req = pool.request()
    .input('sourceOrderNo', sql.NVarChar(200), sourceOrderNo)
  if (exclude) req.input('excludeReceiptNo', sql.NVarChar(200), exclude)
  const inList = keys.map((k, i) => {
    const p = `dk${i}`
    req.input(p, sql.NVarChar(200), k)
    return `@${p}`
  }).join(', ')
  const r = await req.query(`
    SELECT
      ${nvarcharTextExpr('l', 'kcao02', 200)} AS detailKey,
      SUM(CASE WHEN ${nvarcharTextExpr('h', 'pass', 20)} = N'1' THEN ${safeDecimalExpr('l', 'kcao03')} ELSE 0 END) AS sumr,
      SUM(CASE WHEN ${nvarcharTextExpr('h', 'pass', 20)} <> N'1' THEN ${safeDecimalExpr('l', 'kcao03')} ELSE 0 END) AS sumrx
    FROM ${STOCK_IN_FROM} AS h
    INNER JOIN ${STOCK_IN_LINE_FROM} AS l
      ON ${nvarcharTextExpr('l', 'kcao01', 200)}
       = ${nvarcharTextExpr('h', 'kcan01', 200)}
    WHERE ${nvarcharTextExpr('h', 'del', 20)} IN (N'', N'0')
      AND ${nvarcharTextExpr('l', 'del', 20)} IN (N'', N'0')
      AND ${nvarcharTextExpr('h', 'kcan03', 20)} = N'1'
      AND ${nvarcharTextExpr('h', 'kcan04', 200)} = @sourceOrderNo
      ${excludeSql}
      AND ${nvarcharTextExpr('l', 'kcao02', 200)} IN (${inList})
    GROUP BY l.[kcao02]
  `)
  const map = new Map()
  for (const row of r.recordset ?? []) {
    map.set(text(row.detailKey), { sumr: toNumber(row.sumr), sumrx: toNumber(row.sumrx) })
  }
  return map
}

async function fetchInboundPendingDocs(pool, { sourceOrderNo, detailKeys, excludeReceiptNo }) {
  const keys = (detailKeys ?? []).map((k) => text(k)).filter(Boolean)
  if (!keys.length) return new Map()
  const exclude = text(excludeReceiptNo)
  const excludeSql = exclude
    ? `AND ${nvarcharTextExpr('h', 'kcan01', 200)} <> @excludeReceiptNo`
    : ''
  const req = pool.request().input('sourceOrderNo', sql.NVarChar(200), sourceOrderNo)
  if (exclude) req.input('excludeReceiptNo', sql.NVarChar(200), exclude)
  const inList = keys.map((k, i) => {
    const p = `dk${i}`
    req.input(p, sql.NVarChar(200), k)
    return `@${p}`
  }).join(', ')
  const r = await req.query(`
    SELECT
      ${nvarcharTextExpr('l', 'kcao02', 200)} AS detailKey,
      ${nvarcharTextExpr('h', 'kcan01', 200)} AS docNo,
      ${safeDecimalExpr('l', 'kcao03')} AS qty
    FROM ${STOCK_IN_FROM} AS h
    INNER JOIN ${STOCK_IN_LINE_FROM} AS l
      ON ${nvarcharTextExpr('l', 'kcao01', 200)}
       = ${nvarcharTextExpr('h', 'kcan01', 200)}
    WHERE ${nvarcharTextExpr('h', 'del', 20)} IN (N'', N'0')
      AND ${nvarcharTextExpr('l', 'del', 20)} IN (N'', N'0')
      AND ${nvarcharTextExpr('h', 'kcan03', 20)} = N'1'
      AND ${nvarcharTextExpr('h', 'pass', 20)} <> N'1'
      AND ${nvarcharTextExpr('h', 'kcan04', 200)} = @sourceOrderNo
      ${excludeSql}
      AND ${nvarcharTextExpr('l', 'kcao02', 200)} IN (${inList})
  `)
  const map = new Map()
  for (const row of r.recordset ?? []) {
    const key = text(row.detailKey)
    if (!map.has(key)) map.set(key, [])
    map.get(key).push({ docNo: text(row.docNo), qty: toNumber(row.qty) })
  }
  return map
}

async function fetchReturnAggByMaterial(pool, { sourceOrderNo, materialCodes, linkCol, qtyCol }) {
  const mats = (materialCodes ?? []).map((k) => text(k)).filter(Boolean)
  if (!mats.length || !linkCol || !qtyCol) return new Map()
  const req = pool.request().input('sourceOrderNo', sql.NVarChar(200), sourceOrderNo)
  const inList = mats.map((k, i) => {
    const p = `mc${i}`
    req.input(p, sql.NVarChar(200), k)
    return `@${p}`
  }).join(', ')
  const r = await req.query(`
    SELECT
      ${nvarcharTextExpr('ol', 'kcaa01', 300)} AS materialCode,
      SUM(CASE WHEN ${nvarcharTextExpr('o', 'pass', 20)} = N'1' THEN ${safeDecimalExpr('ol', qtyCol)} ELSE 0 END) AS osum,
      SUM(CASE WHEN ${nvarcharTextExpr('o', 'pass', 20)} <> N'1' THEN ${safeDecimalExpr('ol', qtyCol)} ELSE 0 END) AS sumox
    FROM ${STOCK_OUT_FROM} AS o
    INNER JOIN ${STOCK_OUT_LINE_FROM} AS ol
      ON ${nvarcharTextExpr('ol', 'kcaq01', 200)}
       = ${nvarcharTextExpr('o', 'kcap01', 200)}
    WHERE ${nvarcharTextExpr('o', 'del', 20)} IN (N'', N'0')
      AND ${nvarcharTextExpr('ol', 'del', 20)} IN (N'', N'0')
      AND ${nvarcharTextExpr('o', 'kcap03', 20)} = N'1'
      AND ${nvarcharTextExpr('o', linkCol, 200)} = @sourceOrderNo
      AND ${nvarcharTextExpr('ol', 'kcaa01', 300)} IN (${inList})
    GROUP BY ol.[kcaa01]
  `)
  const map = new Map()
  for (const row of r.recordset ?? []) {
    map.set(text(row.materialCode), { osum: toNumber(row.osum), sumox: toNumber(row.sumox) })
  }
  return map
}

async function fetchReturnPendingDocs(pool, { sourceOrderNo, materialCodes, linkCol, qtyCol }) {
  const mats = (materialCodes ?? []).map((k) => text(k)).filter(Boolean)
  if (!mats.length || !linkCol || !qtyCol) return new Map()
  const req = pool.request().input('sourceOrderNo', sql.NVarChar(200), sourceOrderNo)
  const inList = mats.map((k, i) => {
    const p = `mc${i}`
    req.input(p, sql.NVarChar(200), k)
    return `@${p}`
  }).join(', ')
  const r = await req.query(`
    SELECT
      ${nvarcharTextExpr('ol', 'kcaa01', 300)} AS materialCode,
      ${nvarcharTextExpr('o', 'kcap01', 200)} AS docNo,
      ${safeDecimalExpr('ol', qtyCol)} AS qty
    FROM ${STOCK_OUT_FROM} AS o
    INNER JOIN ${STOCK_OUT_LINE_FROM} AS ol
      ON ${nvarcharTextExpr('ol', 'kcaq01', 200)}
       = ${nvarcharTextExpr('o', 'kcap01', 200)}
    WHERE ${nvarcharTextExpr('o', 'del', 20)} IN (N'', N'0')
      AND ${nvarcharTextExpr('ol', 'del', 20)} IN (N'', N'0')
      AND ${nvarcharTextExpr('o', 'kcap03', 20)} = N'1'
      AND ${nvarcharTextExpr('o', 'pass', 20)} <> N'1'
      AND ${nvarcharTextExpr('o', linkCol, 200)} = @sourceOrderNo
      AND ${nvarcharTextExpr('ol', 'kcaa01', 300)} IN (${inList})
  `)
  const map = new Map()
  for (const row of r.recordset ?? []) {
    const key = text(row.materialCode)
    if (!map.has(key)) map.set(key, [])
    map.get(key).push({ docNo: text(row.docNo), qty: toNumber(row.qty) })
  }
  return map
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
    map.set(text(row.categoryCode), parseFloatRate(row.stocks_in))
  }
  return map
}

function mapLineRow(row, ctx) {
  const detailKey = text(row.kcak02 || row.systemcode)
  const materialCode = text(row.kcaa01)
  const inbound = ctx.inboundMap.get(detailKey) ?? { sumr: 0, sumrx: 0 }
  const returns = ctx.returnMap.get(materialCode) ?? { osum: 0, sumox: 0 }
  const ksum = computeKsum(row.kcak03, row.kcaa26, row.kcaa27)
  const floatRate = ctx.floatMap.get(text(row.kcaa05)) ?? 0
  const tempx = computeTempx(ksum, inbound.sumr, inbound.sumrx, returns.osum, returns.sumox)
  const kcao031 = computeKcao031(ksum, floatRate, inbound.sumr, inbound.sumrx, returns.osum, returns.sumox)
  const alreadySelected = ctx.selectedSet.has(detailKey.toLowerCase())
  const select = resolvePurchaseBatchSelectState({
    tempx,
    kcao031,
    pendingReturnQty: returns.sumox,
    alreadySelected,
    isAdmin: ctx.isAdmin,
  })
  const rate = toNumber(ctx.exchangeRate) || 1
  const kcao04 = toRmbPrice(row.kcak04, rate)
  const kcao041 = toRmbPrice(row.kcak041, rate)
  const actualInbound = round(inbound.sumr - returns.osum, 4)
  const floatPct = round(floatRate * 100, 2)

  const out = {
    lineKey: detailKey,
    id: row.id,
    kcao02: detailKey,
    kcak02: detailKey,
    systemcode: text(row.systemcode) || detailKey,
    GUID: text(row.GUID) || text(row.systemcode) || detailKey,
    kcaa01: materialCode,
    kcaa02: text(row.kcaa02),
    kcaa03: text(row.kcaa03),
    kcaa04: text(row.kcaa04),
    kcaa11: text(row.kcaa11),
    kcaa25: text(row.kcaa25),
    kcaa26: row.kcaa26,
    kcaa27: text(row.kcaa27),
    kcaa05: text(row.kcaa05),
    reference: text(row.Reference),
    info: text(row.info),
    currencyDisplay: `${text(ctx.currencyName) || text(ctx.currencyCode) || '—'} / ${rate}`,
    tempx,
    needQty: tempx,
    kcao031,
    overflowCap: kcao031,
    floatRate,
    floatRatePercent: floatPct,
    floatRateText: floatPct > 0 ? `${floatPct}%` : '0%',
    orderQty: ksum,
    orderQtyRaw: toNumber(row.kcak03),
    pendingInboundText: formatPendingText(ctx.pendingInboundMap.get(detailKey)),
    pendingReturnText: formatPendingText(ctx.pendingReturnMap.get(materialCode)),
    actualInboundQty: actualInbound,
    returnQty: returns.osum,
    unitConvertText: unitConvertText(row.kcaa04, row.kcaa25, row.kcaa26, row.kcaa27, row.kcak03),
    sumr: inbound.sumr,
    sumrx: inbound.sumrx,
    osum: returns.osum,
    sumox: returns.sumox,
    kcao04,
    kcao041,
    tax: toNumber(row.tax),
    kcak04: toNumber(row.kcak04),
    kcak041: toNumber(row.kcak041),
    availableQty: tempx,
    location: text(row.location),
    sale_price: row.sale_price,
    cost_price: row.cost_price,
    Customer_Name: text(row.Customer_Name),
    Customer_supply: text(row.Customer_supply),
    remark: text(row.remark),
    kpname: text(row.kpname),
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
 * @param {{ isAdmin?: boolean }} actor
 */
export async function fetchStockInPurchaseBatchLines(pool, query = {}, actor = {}) {
  const sourceOrderNo = text(query.sourceOrderNo)
  if (!sourceOrderNo) {
    return { ok: false, status: 400, msg: '请先选择采购单号' }
  }
  const supplierCode = text(query.supplierCode)
  const excludeReceiptNo = text(query.excludeReceiptNo)
  const keyword = text(query.keyword)
  const { page, pageSize, startRow, endRow } = parsePage(query)
  const selectedSet = new Set(
    text(query.selectedKeys)
      .split(',')
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean),
  )
  const isAdmin = Number(actor.is_admin) === 1 || actor.isAdmin === true

  const countReq = pool.request().input('sourceOrderNo', sql.NVarChar(200), sourceOrderNo)
  if (keyword) countReq.input('keyword', sql.NVarChar(200), `%${keyword}%`)
  if (supplierCode) countReq.input('supplierCode', sql.NVarChar(200), supplierCode)
  const countR = await countReq.query(`
    SELECT COUNT(1) AS total
    FROM ${BUY_LINE_FROM} AS l
    INNER JOIN ${BUY_HEADER_FROM} AS h
      ON ${nvarcharTextExpr('h', 'kcaj01', 200)}
       = ${nvarcharTextExpr('l', 'kcak01', 200)}
    WHERE ${nvarcharTextExpr('l', 'kcak01', 200)} = @sourceOrderNo
      AND ${nvarcharTextExpr('l', 'del', 20)} IN (N'', N'0')
      AND ${nvarcharTextExpr('h', 'del', 20)} IN (N'', N'0')
      ${supplierCode ? `AND ${nvarcharTextExpr('h', 'kcaj05', 200)} = @supplierCode` : ''}
      ${buildKeywordWhere(keyword)}
  `)
  const total = Number(countR.recordset?.[0]?.total ?? 0)

  const kcaaSelect = KCAA_COLS.map((col) => `l.[${col}]`).join(', ')
  const listReq = pool.request()
    .input('sourceOrderNo', sql.NVarChar(200), sourceOrderNo)
    .input('startRow', sql.Int, startRow)
    .input('endRow', sql.Int, endRow)
  if (keyword) listReq.input('keyword', sql.NVarChar(200), `%${keyword}%`)
  if (supplierCode) listReq.input('supplierCode', sql.NVarChar(200), supplierCode)

  const listR = await listReq.query(`
    WITH base AS (
      SELECT
        l.[id],
        l.[kcak02],
        l.[systemcode],
        l.[GUID],
        l.[kcak03],
        l.[kcak04],
        l.[kcak041],
        l.[tax],
        l.[Reference],
        l.[info],
        l.[location],
        l.[sale_price],
        l.[cost_price],
        l.[Customer_Name],
        l.[Customer_supply],
        l.[remark],
        l.[kpname],
        l.[kcaa02_en],
        l.[version],
        ${kcaaSelect},
        ${nvarcharTextExpr('h', 'kcaj05', 200)} AS supplierCode,
        ${nvarcharTextExpr('h', 'rmb', 200)} AS currencyName,
        ${nvarcharTextExpr('h', 'kcaj07', 200)} AS currencyCode,
        ISNULL(NULLIF(${nvarcharTextExpr('h', 'rmb_hl', 50)}, N''), N'1') AS headerRate,
        ISNULL((
          SELECT TOP 1 ISNULL(NULLIF(${nvarcharTextExpr('c', 'rate', 50)}, N''), N'1')
          FROM ${CURRENCY_FROM} AS c
          WHERE ${nvarcharTextExpr('c', 'code', 100)}
            = ${nvarcharTextExpr('h', 'kcaj07', 100)}
        ), N'1') AS currencyRate,
        ROW_NUMBER() OVER (ORDER BY ${safeIntExpr('l', 'seq')}, l.[id]) AS rn
      FROM ${BUY_LINE_FROM} AS l
      INNER JOIN ${BUY_HEADER_FROM} AS h
        ON ${nvarcharTextExpr('h', 'kcaj01', 200)}
         = ${nvarcharTextExpr('l', 'kcak01', 200)}
      WHERE ${nvarcharTextExpr('l', 'kcak01', 200)} = @sourceOrderNo
        AND ${nvarcharTextExpr('l', 'del', 20)} IN (N'', N'0')
        AND ${nvarcharTextExpr('h', 'del', 20)} IN (N'', N'0')
        ${supplierCode ? `AND ${nvarcharTextExpr('h', 'kcaj05', 200)} = @supplierCode` : ''}
        ${buildKeywordWhere(keyword)}
    )
    SELECT * FROM base WHERE rn BETWEEN @startRow AND @endRow ORDER BY rn
  `)

  const rawRows = listR.recordset ?? []
  if (!rawRows.length) {
    return { ok: true, list: [], total, page, pageSize, isAdmin }
  }

  const detailKeys = [...new Set(rawRows.map((row) => text(row.kcak02 || row.systemcode)).filter(Boolean))]
  const materialCodes = [...new Set(rawRows.map((row) => text(row.kcaa01)).filter(Boolean))]
  const categoryCodes = [...new Set(rawRows.map((row) => text(row.kcaa05)).filter(Boolean))]
  const outMeta = await getStockOutMeta(pool)
  const linkCol = outMeta.linkCol
  const qtyCol = outMeta.qtyCol

  const [inboundMap, pendingInboundMap, returnMap, pendingReturnMap, floatMap] = await Promise.all([
    fetchInboundAggByDetailKey(pool, { sourceOrderNo, detailKeys, excludeReceiptNo }),
    fetchInboundPendingDocs(pool, { sourceOrderNo, detailKeys, excludeReceiptNo }),
    fetchReturnAggByMaterial(pool, { sourceOrderNo, materialCodes, linkCol, qtyCol }),
    fetchReturnPendingDocs(pool, { sourceOrderNo, materialCodes, linkCol, qtyCol }),
    fetchFloatRates(pool, categoryCodes),
  ])

  const headerRate = toNumber(rawRows[0]?.headerRate) || toNumber(rawRows[0]?.currencyRate) || 1
  const ctx = {
    inboundMap,
    pendingInboundMap,
    returnMap,
    pendingReturnMap,
    floatMap,
    selectedSet,
    isAdmin,
    exchangeRate: headerRate,
    currencyName: text(rawRows[0]?.currencyName),
    currencyCode: text(rawRows[0]?.currencyCode),
  }

  const list = rawRows.map((row) => mapLineRow(row, ctx))
  return { ok: true, list, total, page, pageSize, isAdmin }
}
