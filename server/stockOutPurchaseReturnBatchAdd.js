/**
 * 采购退货批量添加：按采购单明细 + 本仓入库/退货出库 + 仓库实际库存计算可退数量。
 * SQL Server 2008 R2 兼容（ROW_NUMBER 分页）。
 */
import { sql } from './db.js'
import { safeDecimalExpr, safeIntExpr, nvarcharTextExpr } from './buyOrderSqlSafe.js'
import { calcOtherBatchStockQty } from './stockOutOtherBatchAdd.js'
import { computeKsum } from './stockInPurchaseBatchAdd.js'

const BUY_HEADER_FROM = 'dbo.[UB_ERP_Buy_order]'
const BUY_LINE_FROM = 'dbo.[UB_ERP_Buy_order_list]'
const STOCK_IN_FROM = 'dbo.[UB_ERP_Stocks_Storage]'
const STOCK_IN_LINE_FROM = 'dbo.[UB_ERP_Stocks_Storage_list]'
const STOCK_OUT_FROM = 'dbo.[UB_ERP_Stocks_out]'
const STOCK_OUT_LINE_FROM = 'dbo.[UB_ERP_Stocks_out_list]'

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

/** 采购可退池 = 本仓已审入库 − 已审退货出库 − 未审退货出库占用 */
export function computePurchaseReturnPool({ approvedIn, approvedReturnOut, pendingReturnOut }) {
  const pool = round(toNumber(approvedIn) - toNumber(approvedReturnOut) - toNumber(pendingReturnOut), 4)
  return pool > 0 ? pool : 0
}

/** 当前可退 = min(采购可退池, 仓库实际库存) */
export function computePurchaseReturnableQty({ poolQty, warehouseActualQty }) {
  const pool = Math.max(0, toNumber(poolQty))
  const stock = Math.max(0, toNumber(warehouseActualQty))
  return round(Math.min(pool, stock), 4)
}

export function resolvePurchaseReturnSelectState({ returnableQty, alreadySelected }) {
  if (alreadySelected) {
    return { selectState: 'picked', selectLabel: '已选择', selectable: false }
  }
  if (toNumber(returnableQty) > 0) {
    return { selectState: 'select', selectLabel: '选择', selectable: true }
  }
  return { selectState: 'disabled_stock', selectLabel: '库存不足', selectable: false }
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
  const likeCols = ['kcaa01', 'kcaa02', 'kcaa03', 'kcaa11', 'Reference', 'info', 'kcak02', 'systemcode']
  const parts = likeCols.map((col) => `${nvarcharTextExpr('l', col)} LIKE @keyword`)
  return `AND (${parts.join(' OR ')})`
}

function resolveDetailKey(row) {
  return text(row.kcak02 || row.systemcode)
}

async function fetchInboundByDetailKey(pool, { sourceOrderNo, warehouseCode, detailKeys }) {
  const keys = (detailKeys ?? []).map((k) => text(k)).filter(Boolean)
  if (!keys.length) return new Map()
  const req = pool.request()
    .input('sourceOrderNo', sql.NVarChar(200), sourceOrderNo)
    .input('warehouseCode', sql.NVarChar(200), warehouseCode)
  const inList = keys.map((k, i) => {
    const p = `dk${i}`
    req.input(p, sql.NVarChar(200), k)
    return `@${p}`
  }).join(', ')
  const r = await req.query(`
    SELECT
      ${nvarcharTextExpr('l', 'kcao02', 200)} AS detailKey,
      SUM(${safeDecimalExpr('l', 'kcao03')}) AS approvedInQty
    FROM ${STOCK_IN_FROM} AS h
    INNER JOIN ${STOCK_IN_LINE_FROM} AS l
      ON ${nvarcharTextExpr('l', 'kcao01', 200)} = ${nvarcharTextExpr('h', 'kcan01', 200)}
    WHERE ${delActiveSql('h')}
      AND ${delActiveSql('l')}
      AND ${nvarcharTextExpr('h', 'pass', 20)} = N'1'
      AND ${nvarcharTextExpr('h', 'kcan03', 20)} = N'1'
      AND ${nvarcharTextExpr('h', 'kcan04', 200)} = @sourceOrderNo
      AND ${nvarcharTextExpr('h', 'kcan06', 200)} = @warehouseCode
      AND ${nvarcharTextExpr('l', 'kcao02', 200)} IN (${inList})
    GROUP BY l.[kcao02]
  `)
  const map = new Map()
  for (const row of r.recordset ?? []) {
    map.set(text(row.detailKey), toNumber(row.approvedInQty))
  }
  return map
}

async function fetchReturnOutByDetailKey(pool, { sourceOrderNo, warehouseCode, detailKeys, excludeOutboundNo }) {
  const keys = (detailKeys ?? []).map((k) => text(k)).filter(Boolean)
  if (!keys.length) return new Map()
  const exclude = text(excludeOutboundNo)
  const excludeSql = exclude
    ? `AND ${nvarcharTextExpr('h', 'kcap01', 200)} <> @excludeOutboundNo`
    : ''
  const req = pool.request()
    .input('sourceOrderNo', sql.NVarChar(200), sourceOrderNo)
    .input('warehouseCode', sql.NVarChar(200), warehouseCode)
  if (exclude) req.input('excludeOutboundNo', sql.NVarChar(200), exclude)
  const inList = keys.map((k, i) => {
    const p = `dk${i}`
    req.input(p, sql.NVarChar(200), k)
    return `@${p}`
  }).join(', ')
  const r = await req.query(`
    SELECT
      ${nvarcharTextExpr('l', 'kcaq02', 200)} AS detailKey,
      SUM(CASE WHEN ${nvarcharTextExpr('h', 'pass', 20)} = N'1' THEN ${safeDecimalExpr('l', 'kcaq03')} ELSE 0 END) AS approvedReturnOutQty,
      SUM(CASE WHEN ${nvarcharTextExpr('h', 'pass', 20)} <> N'1' THEN ${safeDecimalExpr('l', 'kcaq03')} ELSE 0 END) AS pendingReturnOutQty
    FROM ${STOCK_OUT_FROM} AS h
    INNER JOIN ${STOCK_OUT_LINE_FROM} AS l
      ON ${nvarcharTextExpr('l', 'kcaq01', 200)} = ${nvarcharTextExpr('h', 'kcap01', 200)}
    WHERE ${delActiveSql('h')}
      AND ${delActiveSql('l')}
      AND ${nvarcharTextExpr('h', 'kcap03', 20)} = N'1'
      AND ${nvarcharTextExpr('h', 'kcap04', 200)} = @sourceOrderNo
      AND ${nvarcharTextExpr('h', 'kcap06', 200)} = @warehouseCode
      ${excludeSql}
      AND ${nvarcharTextExpr('l', 'kcaq02', 200)} IN (${inList})
    GROUP BY l.[kcaq02]
  `)
  const map = new Map()
  for (const row of r.recordset ?? []) {
    map.set(text(row.detailKey), {
      approvedReturnOutQty: toNumber(row.approvedReturnOutQty),
      pendingReturnOutQty: toNumber(row.pendingReturnOutQty),
    })
  }
  return map
}

async function fetchWarehouseStockByMaterial(pool, { warehouseCode, materialCodes, excludeOutboundNo }) {
  const mats = (materialCodes ?? []).map((k) => text(k)).filter(Boolean)
  if (!mats.length) return new Map()
  const exclude = text(excludeOutboundNo)
  const excludeSql = exclude
    ? `AND oh.[kcap01] <> @excludeOutboundNo`
    : ''
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

function mapLineRow(row, ctx) {
  const detailKey = resolveDetailKey(row)
  const materialCode = text(row.kcaa01)
  const approvedInQty = ctx.inboundMap.get(detailKey) ?? 0
  const ret = ctx.returnOutMap.get(detailKey) ?? { approvedReturnOutQty: 0, pendingReturnOutQty: 0 }
  const stock = ctx.stockMap.get(materialCode) ?? calcOtherBatchStockQty({})
  const poolQty = computePurchaseReturnPool({
    approvedIn: approvedInQty,
    approvedReturnOut: ret.approvedReturnOutQty,
    pendingReturnOut: ret.pendingReturnOutQty,
  })
  const returnableQty = computePurchaseReturnableQty({
    poolQty,
    warehouseActualQty: stock.actualQty,
  })
  const orderQty = computeKsum(row.kcak03, row.kcaa26, row.kcaa27)
  const qty = returnableQty
  const kcaq04 = toNumber(row.kcak04)
  const kcaq041 = toNumber(row.kcak041)
  const tax = toNumber(row.tax)
  const kcaq05 = round(qty * kcaq04, 2)
  const kcaq051 = round(qty * kcaq041, 2)
  const alreadySelected = ctx.selectedSet.has(detailKey.toLowerCase())
  const select = resolvePurchaseReturnSelectState({ returnableQty, alreadySelected })

  const out = {
    lineKey: detailKey,
    sourceLineCode: detailKey,
    kcak02: detailKey,
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
    reference: text(row.Reference),
    info: text(row.info),
    remark: text(row.remark),
    orderQty,
    orderQtyRaw: toNumber(row.kcak03),
    approvedInQty: round(approvedInQty, 4),
    actualInboundQty: round(approvedInQty, 4),
    approvedReturnOutQty: round(ret.approvedReturnOutQty, 4),
    actualOutboundQty: round(ret.approvedReturnOutQty, 4),
    pendingReturnOutQty: round(ret.pendingReturnOutQty, 4),
    pendingOutboundQty: round(ret.pendingReturnOutQty, 4),
    warehouseActualQty: stock.actualQty,
    warehouseBookQty: stock.bookQty,
    poolQty,
    returnableQty,
    availableQty: returnableQty,
    kcaq03: returnableQty,
    kcaq031: returnableQty,
    kcaq04,
    kcaq041,
    kcaq05,
    kcaq051,
    kcak04: kcaq04,
    kcak041: kcaq041,
    kcak05: toNumber(row.kcak05),
    kcak051: toNumber(row.kcak051),
    tax,
    location: text(row.location),
    sale_price: row.sale_price,
    cost_price: row.cost_price,
    Customer_Name: text(row.Customer_Name),
    Customer_supply: text(row.Customer_supply),
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
 */
export async function fetchStockOutPurchaseReturnBatchLines(pool, query = {}) {
  const sourceOrderNo = text(query.sourceOrderNo)
  const supplierCode = text(query.supplierCode)
  const warehouseCode = text(query.warehouseCode)
  if (!sourceOrderNo) return { ok: false, status: 400, msg: '请先选择关联采购单号' }
  if (!supplierCode) return { ok: false, status: 400, msg: '请先选择供应商' }
  if (!warehouseCode) return { ok: false, status: 400, msg: '请先选择仓库' }

  const keyword = text(query.keyword)
  const excludeOutboundNo = text(query.excludeOutboundNo)
  const { page, pageSize, startRow, endRow } = parsePage(query)
  const selectedSet = new Set(
    text(query.selectedKeys)
      .split(',')
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean),
  )

  const countReq = pool.request()
    .input('sourceOrderNo', sql.NVarChar(200), sourceOrderNo)
    .input('supplierCode', sql.NVarChar(200), supplierCode)
  if (keyword) countReq.input('keyword', sql.NVarChar(400), `%${keyword}%`)

  const countR = await countReq.query(`
    SELECT COUNT(1) AS total
    FROM ${BUY_LINE_FROM} AS l
    INNER JOIN ${BUY_HEADER_FROM} AS h
      ON ${nvarcharTextExpr('h', 'kcaj01', 200)} = ${nvarcharTextExpr('l', 'kcak01', 200)}
    WHERE ${nvarcharTextExpr('l', 'kcak01', 200)} = @sourceOrderNo
      AND ${nvarcharTextExpr('h', 'kcaj05', 200)} = @supplierCode
      AND ${delActiveSql('h')}
      AND ${nvarcharTextExpr('h', 'pass', 20)} = N'1'
      AND ${nvarcharTextExpr('h', 'closed', 20)} = N'0'
      AND ${delActiveSql('l')}
      AND ${nvarcharTextExpr('l', 'pass', 20)} = N'1'
      ${buildKeywordWhere(keyword)}
  `)
  const total = Number(countR.recordset?.[0]?.total ?? 0)

  const kcaaSelect = KCAA_COLS.map((col) => `l.[${col}]`).join(', ')
  const listReq = pool.request()
    .input('sourceOrderNo', sql.NVarChar(200), sourceOrderNo)
    .input('supplierCode', sql.NVarChar(200), supplierCode)
    .input('startRow', sql.Int, startRow)
    .input('endRow', sql.Int, endRow)
  if (keyword) listReq.input('keyword', sql.NVarChar(400), `%${keyword}%`)

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
        l.[kcak05],
        l.[kcak051],
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
        ROW_NUMBER() OVER (ORDER BY ${safeIntExpr('l', 'seq')}, l.[id]) AS rn
      FROM ${BUY_LINE_FROM} AS l
      INNER JOIN ${BUY_HEADER_FROM} AS h
        ON ${nvarcharTextExpr('h', 'kcaj01', 200)} = ${nvarcharTextExpr('l', 'kcak01', 200)}
      WHERE ${nvarcharTextExpr('l', 'kcak01', 200)} = @sourceOrderNo
        AND ${nvarcharTextExpr('h', 'kcaj05', 200)} = @supplierCode
        AND ${delActiveSql('h')}
        AND ${nvarcharTextExpr('h', 'pass', 20)} = N'1'
        AND ${nvarcharTextExpr('h', 'closed', 20)} = N'0'
        AND ${delActiveSql('l')}
        AND ${nvarcharTextExpr('l', 'pass', 20)} = N'1'
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
      supplierCode,
      warehouseCode,
    }
  }

  const detailKeys = [...new Set(rawRows.map((row) => resolveDetailKey(row)).filter(Boolean))]
  const materialCodes = [...new Set(rawRows.map((row) => text(row.kcaa01)).filter(Boolean))]

  const [inboundMap, returnOutMap, stockMap] = await Promise.all([
    fetchInboundByDetailKey(pool, { sourceOrderNo, warehouseCode, detailKeys }),
    fetchReturnOutByDetailKey(pool, { sourceOrderNo, warehouseCode, detailKeys, excludeOutboundNo }),
    fetchWarehouseStockByMaterial(pool, { warehouseCode, materialCodes, excludeOutboundNo }),
  ])

  const ctx = { inboundMap, returnOutMap, stockMap, selectedSet }
  const list = rawRows.map((row) => mapLineRow(row, ctx))

  return {
    ok: true,
    list,
    total,
    page,
    pageSize,
    sourceOrderNo,
    supplierCode,
    warehouseCode,
  }
}
