import { clampErpPageSize, ERP_MAX_PAGE_SIZE } from './erpPagination.js'
import { sql } from './db.js'
import { safeDecimalExpr } from './buyOrderSqlSafe.js'

const STOCK_OUT_HEADER_FROM = 'dbo.[UB_ERP_Stocks_out]'
const STOCK_OUT_LINE_FROM = 'dbo.[UB_ERP_Stocks_out_list]'

/** 业务注释：关键字只搜高频列，避免 40+ 列 OR + 函数包裹导致全表扫。 */
const SEARCH_KEYWORD_COLS = [
  { alias: 'l', col: 'kcaa01' },
  { alias: 'l', col: 'kcaq01' },
  { alias: 'h', col: 'kcap04' },
  { alias: 'l', col: 'Reference' },
  { alias: 'l', col: 'Product' },
  { alias: 'l', col: 'Describe' },
  { alias: 'l', col: 'kcaa02' },
  { alias: 'l', col: 'remark' },
  { alias: 'h', col: 'kehu' },
  { alias: 'h', col: 'ck' },
]

const TRACE_JOIN_SQL = `
  FROM ${STOCK_OUT_LINE_FROM} AS l
  INNER JOIN ${STOCK_OUT_HEADER_FROM} AS h
    ON l.[kcaq01] = h.[kcap01]
`

function text(v) {
  return String(v ?? '').trim()
}

function parseIntPositive(v, fallback) {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.floor(n)
}

export function parseStockOutMaterialTraceQuery(query = {}) {
  return {
    page: parseIntPositive(query.page, 1),
    pageSize: clampErpPageSize(query.pageSize, 10),
    keyword: text(query.keyword),
    all: ['1', 'true', 'yes'].includes(text(query.all).toLowerCase()),
  }
}

/** 业务注释：追查页以主表已审核为准；明细仅要求未删除。 */
export function buildStockOutMaterialTraceWhereSql(q) {
  let whereSql = `
    WHERE (ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')
      AND (ISNULL(h.[del], N'') = N'' OR h.[del] = N'0')
      AND LTRIM(RTRIM(ISNULL(h.[pass], N''))) = N'1'
  `
  const params = {}

  if (!q.all && q.keyword) {
    const parts = SEARCH_KEYWORD_COLS.map(({ alias, col }) => `${alias}.[${col}] LIKE @kw`)
    whereSql += ` AND (${parts.join(' OR ')}) `
    params.kw = `%${q.keyword}%`
  }

  return { whereSql, params }
}

function bindTraceParams(req, params) {
  Object.entries(params).forEach(([key, value]) => {
    req.input(key, sql.NVarChar(500), value)
  })
}

export function buildStockOutMaterialTraceListSql(whereSql) {
  return `
    SELECT *
    FROM (
      SELECT
        ROW_NUMBER() OVER (
          ORDER BY
            CASE WHEN h.[kcap02] IS NULL THEN 1 ELSE 0 END ASC,
            h.[kcap02] DESC,
            l.[id] DESC
        ) AS rn,
        l.[id],
        h.[kcap02] AS outboundDate,
        l.[kcaq01] AS outboundNo,
        h.[pass] AS headerPass,
        h.[ck] AS warehouseName,
        h.[kcap04] AS sourceOrderNo,
        h.[kcap08] AS relatedNo,
        ${safeDecimalExpr('l', 'kcaq03')} AS kcaq03,
        ${safeDecimalExpr('l', 'kcaq04')} AS kcaq04,
        ${safeDecimalExpr('l', 'kcaq041')} AS kcaq041,
        ${safeDecimalExpr('l', 'tax')} AS tax,
        l.[Reference] AS reference,
        l.[Product] AS product,
        l.[Describe] AS Describe,
        ${safeDecimalExpr('l', 'kcaq08')} AS kcaq08,
        h.[kehu] AS relatedPartyName,
        l.[kcaa01] AS kcaa01,
        l.[kcaa02] AS kcaa02,
        l.[kcaa03] AS kcaa03,
        l.[version] AS version,
        l.[kcaa02_en] AS kcaa02_en,
        l.[kpname] AS kpname,
        l.[remark] AS remark,
        l.[location] AS location,
        l.[sale_price] AS sale_price,
        l.[cost_price] AS cost_price,
        l.[Customer_supply] AS Customer_supply,
        l.[Customer_Name] AS Customer_Name
      ${TRACE_JOIN_SQL}
      ${whereSql}
    ) AS src
    WHERE src.rn BETWEEN @startRow AND @endRow
    ORDER BY src.rn ASC
  `
}

export function buildStockOutMaterialTraceCountSql(whereSql) {
  return `
    SELECT COUNT(1) AS total
    ${TRACE_JOIN_SQL}
    ${whereSql}
  `
}

function mapTraceRow(row) {
  return {
    id: row.id,
    outboundDate: row.outboundDate,
    outboundNo: text(row.outboundNo),
    headerPass: text(row.headerPass),
    warehouseName: text(row.warehouseName),
    sourceOrderNo: text(row.sourceOrderNo),
    relatedNo: text(row.relatedNo),
    kcaq03: row.kcaq03,
    kcaq04: row.kcaq04,
    kcaq041: row.kcaq041,
    tax: row.tax,
    reference: text(row.reference),
    product: text(row.product),
    Describe: text(row.Describe),
    kcaq08: row.kcaq08,
    relatedPartyName: text(row.relatedPartyName),
    kcaa01: text(row.kcaa01),
    kcaa02: text(row.kcaa02),
    kcaa03: text(row.kcaa03),
    version: text(row.version),
    kcaa02_en: text(row.kcaa02_en),
    kpname: text(row.kpname),
    remark: text(row.remark),
    location: text(row.location),
    sale_price: text(row.sale_price),
    cost_price: text(row.cost_price),
    Customer_supply: text(row.Customer_supply),
    Customer_Name: text(row.Customer_Name),
  }
}

export async function fetchStockOutMaterialTrace(pool, query = {}) {
  const q = parseStockOutMaterialTraceQuery(query)
  const { whereSql, params } = buildStockOutMaterialTraceWhereSql(q)
  const startRow = (q.page - 1) * q.pageSize + 1
  const endRow = q.page * q.pageSize

  const countReq = pool.request()
  bindTraceParams(countReq, params)
  const countResult = await countReq.query(buildStockOutMaterialTraceCountSql(whereSql))
  const total = Number(countResult.recordset?.[0]?.total ?? 0)

  const listReq = pool.request()
    .input('startRow', sql.Int, startRow)
    .input('endRow', sql.Int, endRow)
  bindTraceParams(listReq, params)
  const listResult = await listReq.query(buildStockOutMaterialTraceListSql(whereSql))

  const list = (listResult.recordset ?? []).map(mapTraceRow)

  return {
    ok: true,
    page: q.page,
    pageSize: q.pageSize,
    total,
    list,
  }
}
