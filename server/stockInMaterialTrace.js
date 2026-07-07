import { clampErpPageSize, ERP_MAX_PAGE_SIZE } from './erpPagination.js'
import { sql } from './db.js'
import { safeDecimalExpr } from './buyOrderSqlSafe.js'

const STOCK_IN_HEADER_FROM = 'dbo.[UB_ERP_Stocks_Storage]'
const STOCK_IN_LINE_FROM = 'dbo.[UB_ERP_Stocks_Storage_list]'

// 业务规则：物料追溯页只做高频字段搜索，避免把 kcaa01~kcaa35 全量 OR 进热路径。
const SEARCH_KEYWORD_COLS = [
  { alias: 'l', col: 'kcaa01' },
  { alias: 'l', col: 'kcaa02' },
  { alias: 'l', col: 'kcaa03' },
  { alias: 'l', col: 'kcaa11' },
  { alias: 'l', col: 'kcao01' },
  { alias: 'l', col: 'kcan04' },
  { alias: 'l', col: 'Reference' },
  { alias: 'l', col: 'Describe' },
  { alias: 'l', col: 'kcaa02_en' },
  { alias: 'l', col: 'kpname' },
  { alias: 'l', col: 'remark' },
  { alias: 'l', col: 'location' },
  { alias: 'h', col: 'kehu' },
  { alias: 'h', col: 'ck' },
]

const TRACE_JOIN_SQL = `
  FROM ${STOCK_IN_LINE_FROM} AS l
  INNER JOIN ${STOCK_IN_HEADER_FROM} AS h
    ON l.[kcao01] = h.[kcan01]
`

function text(v) {
  return String(v ?? '').trim()
}

function parseIntPositive(v, fallback) {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.floor(n)
}

export function parseStockInMaterialTraceQuery(query = {}) {
  return {
    page: parseIntPositive(query.page, 1),
    pageSize: clampErpPageSize(query.pageSize, 10),
    keyword: text(query.keyword),
    all: ['1', 'true', 'yes'].includes(text(query.all).toLowerCase()),
  }
}

export function buildStockInMaterialTraceWhereSql(q) {
  let whereSql = `
    WHERE (ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')
      AND (ISNULL(h.[del], N'') = N'' OR h.[del] = N'0')
      AND LTRIM(RTRIM(ISNULL(l.[pass], N''))) = N'1'
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

export function buildStockInMaterialTraceListSql(whereSql) {
  return `
    SELECT *
    FROM (
      SELECT
        ROW_NUMBER() OVER (
          ORDER BY
            CASE WHEN h.[kcan02] IS NULL THEN 1 ELSE 0 END ASC,
            h.[kcan02] DESC,
            l.[id] DESC
        ) AS rn,
        l.[id],
        h.[kcan02] AS inboundDate,
        l.[kcao01] AS receiptNo,
        h.[pass] AS headerPass,
        h.[ck] AS warehouseName,
        h.[kcan04] AS sourceOrderNo,
        h.[kehu] AS relatedPartyName,
        ${safeDecimalExpr('l', 'kcao03')} AS kcao03,
        ${safeDecimalExpr('l', 'kcao04')} AS kcao04,
        ${safeDecimalExpr('l', 'kcao041')} AS kcao041,
        ${safeDecimalExpr('l', 'Tax')} AS tax,
        l.[Reference] AS reference,
        CAST(N'' AS nvarchar(200)) AS orderNo,
        l.[Describe] AS Describe,
        l.[systemcode] AS systemcode,
        l.[kcao02] AS sourceLineCode,
        l.[kcaa01] AS kcaa01,
        l.[version] AS version,
        l.[kcaa02] AS kcaa02,
        l.[kcaa02_en] AS kcaa02_en,
        l.[kpname] AS kpname,
        l.[kcaa03] AS kcaa03,
        l.[kcaa04] AS kcaa04,
        l.[kcaa05] AS kcaa05,
        l.[kcaa06] AS kcaa06,
        l.[kcaa07] AS kcaa07,
        l.[kcaa08] AS kcaa08,
        l.[kcaa09] AS kcaa09,
        l.[kcaa10] AS kcaa10,
        l.[kcaa11] AS kcaa11,
        l.[kcaa12] AS kcaa12,
        l.[kcaa13] AS kcaa13,
        l.[kcaa14] AS kcaa14,
        l.[kcaa15] AS kcaa15,
        l.[kcaa25] AS kcaa25,
        l.[kcaa26] AS kcaa26,
        l.[kcaa27] AS kcaa27,
        l.[kcaa28] AS kcaa28,
        l.[kcaa29] AS kcaa29,
        l.[kcaa30] AS kcaa30,
        l.[kcaa31] AS kcaa31,
        l.[kcaa32] AS kcaa32,
        l.[kcaa33] AS kcaa33,
        l.[kcaa34] AS kcaa34,
        l.[kcaa35] AS kcaa35,
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

export function buildStockInMaterialTraceCountSql(whereSql) {
  return `
    SELECT COUNT(1) AS total
    ${TRACE_JOIN_SQL}
    ${whereSql}
  `
}

function mapTraceRow(row) {
  return {
    id: row.id,
    inboundDate: row.inboundDate,
    receiptNo: text(row.receiptNo),
    headerPass: text(row.headerPass),
    warehouseName: text(row.warehouseName),
    sourceOrderNo: text(row.sourceOrderNo),
    relatedPartyName: text(row.relatedPartyName),
    kcao03: row.kcao03,
    kcao04: row.kcao04,
    kcao041: row.kcao041,
    tax: row.tax,
    reference: text(row.reference),
    orderNo: text(row.orderNo),
    Describe: text(row.Describe),
    systemcode: text(row.systemcode),
    sourceLineCode: text(row.sourceLineCode),
    kcaa01: text(row.kcaa01),
    version: text(row.version),
    kcaa02: text(row.kcaa02),
    kcaa02_en: text(row.kcaa02_en),
    kpname: text(row.kpname),
    kcaa03: text(row.kcaa03),
    kcaa04: text(row.kcaa04),
    kcaa05: text(row.kcaa05),
    kcaa06: text(row.kcaa06),
    kcaa07: text(row.kcaa07),
    kcaa08: text(row.kcaa08),
    kcaa09: text(row.kcaa09),
    kcaa10: text(row.kcaa10),
    kcaa11: text(row.kcaa11),
    kcaa12: text(row.kcaa12),
    kcaa13: text(row.kcaa13),
    kcaa14: text(row.kcaa14),
    kcaa15: text(row.kcaa15),
    kcaa25: text(row.kcaa25),
    kcaa26: text(row.kcaa26),
    kcaa27: text(row.kcaa27),
    kcaa28: text(row.kcaa28),
    kcaa29: text(row.kcaa29),
    kcaa30: text(row.kcaa30),
    kcaa31: text(row.kcaa31),
    kcaa32: text(row.kcaa32),
    kcaa33: text(row.kcaa33),
    kcaa34: text(row.kcaa34),
    kcaa35: text(row.kcaa35),
    remark: text(row.remark),
    location: text(row.location),
    sale_price: text(row.sale_price),
    cost_price: text(row.cost_price),
    Customer_supply: text(row.Customer_supply),
    Customer_Name: text(row.Customer_Name),
  }
}

export async function fetchStockInMaterialTrace(pool, query = {}) {
  const q = parseStockInMaterialTraceQuery(query)
  const { whereSql, params } = buildStockInMaterialTraceWhereSql(q)
  const startRow = (q.page - 1) * q.pageSize + 1
  const endRow = q.page * q.pageSize

  const countReq = pool.request()
  bindTraceParams(countReq, params)
  const countResult = await countReq.query(buildStockInMaterialTraceCountSql(whereSql))
  const total = Number(countResult.recordset?.[0]?.total ?? 0)

  const listReq = pool.request()
    .input('startRow', sql.Int, startRow)
    .input('endRow', sql.Int, endRow)
  bindTraceParams(listReq, params)
  const listResult = await listReq.query(buildStockInMaterialTraceListSql(whereSql))

  return {
    ok: true,
    page: q.page,
    pageSize: q.pageSize,
    total,
    list: (listResult.recordset ?? []).map(mapTraceRow),
  }
}
