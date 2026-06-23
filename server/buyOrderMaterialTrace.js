import { sql } from './db.js'
import { likeTextExpr, safeDecimalExpr } from './buyOrderSqlSafe.js'

const BUY_ORDER_HEADER_FROM = 'dbo.[UB_ERP_Buy_order]'
const BUY_ORDER_LINE_FROM = 'dbo.[UB_ERP_Buy_order_list]'
const BOM_CODE_FROM = 'dbo.[UB_ERP_Bom_code]'
const STORAGE_HEADER_FROM = 'dbo.[UB_ERP_Stocks_Storage]'
const STORAGE_LINE_FROM = 'dbo.[UB_ERP_Stocks_Storage_list]'

const SEARCH_COLS = [
  'systemcode', 'kcak01', 'kcak02', 'kcak03', 'kcak04', 'kcak05', 'tax', 'info',
  'kcaa01', 'kcaa02', 'kcaa03', 'kcaa04', 'kcaa05', 'kcaa06', 'kcaa07', 'kcaa08', 'kcaa09',
  'kcaa10', 'kcaa11', 'kcaa12', 'kcaa13', 'kcaa14', 'kcaa15', 'kcaa16', 'kcaa17', 'kcaa18', 'kcaa19',
  'kcaa20', 'kcaa21', 'kcaa22', 'kcaa23', 'kcaa24', 'kcaa25', 'kcaa26', 'kcaa27', 'kcaa28', 'kcaa29',
  'kcaa30', 'kcaa31', 'kcaa32', 'kcaa33', 'kcaa34', 'kcaa35',
  'kcaa02_en', 'kpname', 'location', 'sale_price', 'cost_price', 'Customer_supply', 'Customer_Name',
]

function text(v) {
  return String(v ?? '').trim()
}

function parseIntPositive(v, fallback) {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.floor(n)
}

function mapBomPrefixByName(name) {
  const key = text(name).toUpperCase()
  if (!key) return ''
  if (key.includes('成品')) return 'PQ-'
  if (key.includes('主袋')) return 'BAG-'
  if (key.includes('拉牌')) return 'TAG-'
  if (key.includes('裁片')) return 'CUT-'
  return ''
}

function parseTraceQuery(query = {}) {
  return {
    page: parseIntPositive(query.page, 1),
    pageSize: Math.min(100, parseIntPositive(query.pageSize, 10)),
    keyword: text(query.keyword),
    bomCodeId: parseIntPositive(query.bomCodeId, 0),
    bomPrefix: text(query.bomPrefix),
    all: ['1', 'true', 'yes'].includes(text(query.all).toLowerCase()),
  }
}

export async function fetchBuyOrderTraceBomCodes(pool) {
  const result = await pool.request().query(`
    SELECT
      [id],
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([name], N'')))) AS [name],
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([flag5], N'')))) AS [flag5]
    FROM ${BOM_CODE_FROM}
    WHERE [copen] = 1
    ORDER BY ISNULL([px], 2147483647), [id]
  `)
  return (result.recordset ?? []).map((row) => {
    const prefix = text(row.flag5) || mapBomPrefixByName(row.name)
    return { id: Number(row.id), name: text(row.name), prefix }
  })
}

function buildTraceWhereSql(q) {
  let whereSql = `
    WHERE (ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')
      AND LTRIM(RTRIM(ISNULL(l.[pass], N''))) = N'1'
  `
  const params = {}

  if (!q.all && q.keyword) {
    const parts = SEARCH_COLS.map((col) => `${likeTextExpr('l', col)} LIKE @kw`)
    whereSql += ` AND (${parts.join(' OR ')}) `
    params.kw = `%${q.keyword}%`
  }

  if (!q.all && q.bomPrefix) {
    whereSql += ` AND UPPER(${likeTextExpr('l', 'kcaa01', 300)}) LIKE UPPER(@bomPrefix) + N'%' `
    params.bomPrefix = q.bomPrefix
  } else if (!q.all && q.bomCodeId > 0) {
    // 业务注释：分类优先按 BOM 编码归属匹配，兼容旧数据中 kcaa05 存的是分类 id 的口径。
    whereSql += `
      AND EXISTS (
        SELECT 1
        FROM ${BOM_CODE_FROM} AS bc
        WHERE bc.[id] = @bomCodeId
          AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa05], N''))))
              = LTRIM(RTRIM(CONVERT(nvarchar(50), bc.[id])))
      )
    `
    params.bomCodeId = q.bomCodeId
  }

  return { whereSql, params }
}

function bindTraceParams(req, params) {
  Object.entries(params).forEach(([key, value]) => {
    req.input(key, sql.NVarChar(500), value)
  })
}

export async function fetchBuyOrderMaterialTrace(pool, query = {}) {
  const q = parseTraceQuery(query)
  const { whereSql, params } = buildTraceWhereSql(q)
  const startRow = (q.page - 1) * q.pageSize + 1
  const endRow = q.page * q.pageSize

  const countReq = pool.request()
  bindTraceParams(countReq, params)
  const countResult = await countReq.query(`
    SELECT COUNT(1) AS total
    FROM ${BUY_ORDER_LINE_FROM} AS l
    ${whereSql}
  `)
  const total = Number(countResult.recordset?.[0]?.total ?? 0)

  const listReq = pool.request()
    .input('startRow', sql.Int, startRow)
    .input('endRow', sql.Int, endRow)
  bindTraceParams(listReq, params)

  const listResult = await listReq.query(`
    SELECT *
    FROM (
      SELECT
        ROW_NUMBER() OVER (
          ORDER BY
            CASE WHEN h.[kcaj02] IS NULL THEN 1 ELSE 0 END ASC,
            h.[kcaj02] DESC,
            l.[id] DESC
        ) AS rn,
        l.[id],
        ${likeTextExpr('l', 'kcak01', 200)} AS buyOrderNo,
        ${likeTextExpr('h', 'kcaj04', 500)} AS referenceNo,
        h.[kcaj02] AS buyDate,
        ${likeTextExpr('h', 'utruename', 200)} AS creator,
        ${likeTextExpr('h', 'kcaj05', 500)} AS supplierCode,
        ${likeTextExpr('h', 'kehu', 500)} AS supplierName,
        ${likeTextExpr('l', 'kcaa01', 300)} AS kcaa01,
        ${likeTextExpr('l', 'kcaa02', 500)} AS kcaa02,
        ${safeDecimalExpr('l', 'kcak03')} AS kcak03,
        ISNULL(inboundAgg.inboundQty, 0) AS inboundQty,
        ${safeDecimalExpr('l', 'kcak04')} AS kcak04,
        ${safeDecimalExpr('l', 'kcak041')} AS kcak041,
        ${safeDecimalExpr('l', 'kcak05')} AS kcak05,
        ${safeDecimalExpr('l', 'kcak051')} AS kcak051,
        ${safeDecimalExpr('l', 'tax')} AS tax,
        ${likeTextExpr('l', 'Reference', 500)} AS poPi,
        ${likeTextExpr('l', 'OrderNo', 500)} AS orderNo,
        ${likeTextExpr('l', 'info', 1000)} AS info,
        ${likeTextExpr('l', 'gkcaa02', 500)} AS partnerName,
        ${likeTextExpr('l', 'kcak02', 300)} AS bomSystemCode,
        ${likeTextExpr('l', 'systemcode', 300)} AS systemcode,
        ${likeTextExpr('l', 'kcaa02_en', 500)} AS kcaa02_en,
        ${likeTextExpr('l', 'kpname', 500)} AS kpname,
        ${likeTextExpr('l', 'location', 500)} AS location,
        ${likeTextExpr('l', 'sale_price', 500)} AS sale_price,
        ${likeTextExpr('l', 'cost_price', 500)} AS cost_price,
        ${likeTextExpr('l', 'Customer_supply', 100)} AS Customer_supply,
        ${likeTextExpr('l', 'Customer_Name', 500)} AS Customer_Name
      FROM ${BUY_ORDER_LINE_FROM} AS l
      LEFT JOIN ${BUY_ORDER_HEADER_FROM} AS h
        ON ${likeTextExpr('h', 'kcaj01', 200)} = ${likeTextExpr('l', 'kcak01', 200)}
      LEFT JOIN (
        SELECT
          ${likeTextExpr('s', 'kcan04', 200)} AS buyOrderNo,
          ${likeTextExpr('sl', 'kcaa01', 300)} AS materialCode,
          SUM(${safeDecimalExpr('sl', 'kcao03')}) AS inboundQty
        FROM ${STORAGE_HEADER_FROM} AS s
        INNER JOIN ${STORAGE_LINE_FROM} AS sl
          ON ${likeTextExpr('sl', 'kcao01', 200)} = ${likeTextExpr('s', 'kcan01', 200)}
        WHERE (ISNULL(s.[del], N'') = N'' OR s.[del] = N'0')
          AND (ISNULL(sl.[del], N'') = N'' OR sl.[del] = N'0')
          AND LTRIM(RTRIM(ISNULL(s.[pass], N''))) = N'1'
          AND LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(s.[kcan03], N'')))) = N'1'
        GROUP BY ${likeTextExpr('s', 'kcan04', 200)}, ${likeTextExpr('sl', 'kcaa01', 300)}
      ) AS inboundAgg
        ON inboundAgg.buyOrderNo = ${likeTextExpr('l', 'kcak01', 200)}
       AND inboundAgg.materialCode = ${likeTextExpr('l', 'kcaa01', 300)}
      ${whereSql}
    ) AS src
    WHERE src.rn BETWEEN @startRow AND @endRow
    ORDER BY src.rn ASC
  `)

  return {
    ok: true,
    page: q.page,
    pageSize: q.pageSize,
    total,
    list: listResult.recordset ?? [],
  }
}
