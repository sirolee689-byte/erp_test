import { sql } from './db.js'
import { likeTextExpr, safeDecimalExpr } from './buyOrderSqlSafe.js'

const HEADER_FROM = 'dbo.[UB_ERP_Sales_order]'
const LINE_FROM = 'dbo.[UB_ERP_Sales_order_list]'
const BOM_CODE_FROM = 'dbo.[UB_ERP_Bom_code]'
const MATERIAL_FROM = 'dbo.[New_UB_ERP_Stocks_material]'
const CURRENCY_FROM = 'dbo.[UB_ERP_Finance_currency]'
const PAGE_SIZES = new Set([10, 25, 50, 100, 200, 300, 500])

const SEARCH_COLUMNS = [
  'systemcode', 'xsak01', 'xsak02', 'xsak03', 'xsak04', 'xsak05', 'xsak06', 'xsak08', 'info', 'Describe',
  ...Array.from({ length: 35 }, (_, i) => `kcaa${String(i + 1).padStart(2, '0')}`),
  'version', 'kcaa02_en', 'kpname', 'remark', 'location', 'sale_price', 'cost_price', 'Customer_supply', 'Customer_Name',
]

function text(value) { return String(value ?? '').trim() }
function parsePositive(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

function parseDate(value, label) {
  const raw = text(value)
  if (!raw) return null
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) throw new Error(`${label}格式无效，请使用 YYYY-MM-DD`)
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) {
    throw new Error(`${label}无效`)
  }
  date.setHours(0, 0, 0, 0)
  return date
}

function parseQuery(query = {}) {
  const rawSize = parsePositive(query.pageSize, 10)
  const startDate = parseDate(query.startDate, '开始日期')
  const endDate = parseDate(query.endDate, '结束日期')
  if (startDate && endDate && startDate > endDate) throw new Error('开始日期不能晚于结束日期')
  return {
    page: parsePositive(query.page, 1),
    pageSize: PAGE_SIZES.has(rawSize) ? rawSize : 10,
    keyword: text(query.keyword),
    categoryId: parsePositive(query.categoryId, 0),
    groupName: text(query.groupName),
    startDate,
    endDate,
  }
}

export async function fetchSalesOrderMaterialTraceCategories(pool) {
  const result = await pool.request().query(`
    SELECT [id],
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([flag1], N'')))) AS flag1,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([flag5], N'')))) AS flag5
    FROM ${BOM_CODE_FROM}
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL([copen], N'')))) = N'1'
    ORDER BY ISNULL([px], 2147483647), [id]
  `)
  return (result.recordset ?? []).map((row) => ({
    id: Number(row.id), flag1: text(row.flag1), flag5: text(row.flag5),
  }))
}

function buildWhereSql(q) {
  let whereSql = `
    WHERE (ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')
      AND LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(l.[pass], N'')))) = N'1'
      AND (ISNULL(h.[del], N'') = N'' OR h.[del] = N'0')
      AND LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(h.[pass], N'')))) = N'1'
  `
  const params = {}
  if (q.keyword) {
    whereSql += ` AND (${SEARCH_COLUMNS.map((col) => `${likeTextExpr('l', col)} LIKE @keyword`).join(' OR ')}) `
    params.keyword = `%${q.keyword.replace(/\[/g, '[[]').replace(/%/g, '[%]').replace(/_/g, '[_')}%`
  }
  if (q.groupName) {
    whereSql += ` AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa10], N'')))) = @groupName `
    params.groupName = q.groupName
  }
  if (q.startDate) {
    whereSql += ' AND h.[xsaj02] >= @startDate '
    params.startDate = q.startDate
  }
  if (q.endDate) {
    whereSql += ' AND h.[xsaj02] < DATEADD(day, 1, @endDate) '
    params.endDate = q.endDate
  }
  if (q.categoryId > 0) {
    // 分类用 flag5 作为编码前缀；OUT 的旧口径是编码尾部 -OUT。
    whereSql += `
      AND EXISTS (
        SELECT 1 FROM ${BOM_CODE_FROM} AS bc
        WHERE bc.[id] = @categoryId
          AND LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(bc.[copen], N'')))) = N'1'
          AND (
            (UPPER(LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(bc.[flag5], N''))))) = N'OUT'
              AND UPPER(${likeTextExpr('l', 'kcaa01', 300)}) LIKE N'%-OUT%')
            OR
            (UPPER(LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(bc.[flag5], N''))))) <> N'OUT'
              AND UPPER(${likeTextExpr('l', 'kcaa01', 300)}) LIKE UPPER(LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(bc.[flag5], N''))))) + N'-%')
          )
      )
    `
    params.categoryId = q.categoryId
  }
  return { whereSql, params }
}

function bindParams(request, params) {
  if (params.keyword) request.input('keyword', sql.NVarChar(500), params.keyword)
  if (params.groupName) request.input('groupName', sql.NVarChar(300), params.groupName)
  if (params.startDate) request.input('startDate', sql.DateTime, params.startDate)
  if (params.endDate) request.input('endDate', sql.DateTime, params.endDate)
  if (params.categoryId) request.input('categoryId', sql.Int, params.categoryId)
}

export async function fetchSalesOrderMaterialTrace(pool, query = {}) {
  const q = parseQuery(query)
  const { whereSql, params } = buildWhereSql(q)
  const startRow = (q.page - 1) * q.pageSize + 1
  const endRow = q.page * q.pageSize

  const countRequest = pool.request()
  bindParams(countRequest, params)
  const countResult = await countRequest.query(`
    SELECT COUNT(1) AS total
    FROM ${LINE_FROM} AS l
    INNER JOIN ${HEADER_FROM} AS h
      ON ${likeTextExpr('h', 'xsaj01', 200)} = ${likeTextExpr('l', 'xsak01', 200)}
    ${whereSql}
  `)

  const listRequest = pool.request().input('startRow', sql.Int, startRow).input('endRow', sql.Int, endRow)
  bindParams(listRequest, params)
  const listResult = await listRequest.query(`
    SELECT * FROM (
      SELECT ROW_NUMBER() OVER (ORDER BY l.[id] DESC) AS rn,
        l.[id], h.[id] AS orderId, h.[xsaj02] AS salesDate,
        ${likeTextExpr('l', 'xsak01', 200)} AS salesOrderNo,
        ${safeDecimalExpr('l', 'xsak03')} AS xsak03,
        ${safeDecimalExpr('l', 'xsak04')} AS xsak04,
        ${safeDecimalExpr('l', 'xsak05')} AS xsak05,
        CAST(0 AS decimal(18, 6)) AS tax,
      ${likeTextExpr('l', 'xsak01', 200)} AS pi,
        ${likeTextExpr('h', 'kehu', 500)} AS supplierName,
        ${likeTextExpr('l', 'xsak02', 500)} AS bomSystemcode,
        ${likeTextExpr('l', 'kcaa01', 300)} AS kcaa01,
        LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(h.[pass], N'')))) AS orderPass,
        ${likeTextExpr('l', 'version', 100)} AS version,
        ${likeTextExpr('l', 'kcaa02', 500)} AS kcaa02,
        ${likeTextExpr('l', 'kcaa02_en', 500)} AS kcaa02_en,
        ${likeTextExpr('l', 'kpname', 500)} AS kpname,
        ${likeTextExpr('l', 'kcaa03', 500)} AS kcaa03,
        ${likeTextExpr('l', 'kcaa04', 100)} AS kcaa04,
        COALESCE(${likeTextExpr('m', 'name', 300)}, ${likeTextExpr('l', 'kcaa05', 100)}) AS kcaa05,
        ${likeTextExpr('l', 'kcaa06', 300)} AS kcaa06, ${likeTextExpr('l', 'kcaa07', 100)} AS kcaa07,
        ${likeTextExpr('l', 'kcaa08', 100)} AS kcaa08, ${likeTextExpr('l', 'kcaa09', 300)} AS kcaa09,
        ${likeTextExpr('l', 'kcaa10', 300)} AS kcaa10, ${likeTextExpr('l', 'kcaa11', 300)} AS kcaa11,
        ${likeTextExpr('l', 'kcaa12', 50)} AS kcaa12, ${likeTextExpr('l', 'kcaa13', 50)} AS kcaa13,
        ${likeTextExpr('l', 'kcaa14', 50)} AS kcaa14, ${likeTextExpr('l', 'kcaa15', 300)} AS kcaa15,
        ${likeTextExpr('l', 'kcaa16', 300)} AS kcaa16, ${likeTextExpr('l', 'kcaa17', 300)} AS kcaa17,
        ${likeTextExpr('l', 'kcaa18', 100)} AS kcaa18, ${likeTextExpr('l', 'kcaa19', 100)} AS kcaa19,
        ${likeTextExpr('l', 'kcaa20', 100)} AS kcaa20, ${likeTextExpr('l', 'kcaa21', 100)} AS kcaa21,
        ${likeTextExpr('l', 'kcaa22', 100)} AS kcaa22, ${likeTextExpr('l', 'kcaa23', 100)} AS kcaa23,
        ${likeTextExpr('l', 'kcaa24', 100)} AS kcaa24, ${likeTextExpr('l', 'kcaa25', 100)} AS kcaa25,
        ${likeTextExpr('l', 'kcaa26', 100)} AS kcaa26, ${likeTextExpr('l', 'kcaa27', 50)} AS kcaa27,
        ${likeTextExpr('l', 'kcaa28', 50)} AS kcaa28, ${likeTextExpr('l', 'kcaa29', 100)} AS kcaa29,
        ${likeTextExpr('l', 'kcaa30', 100)} AS kcaa30, ${likeTextExpr('l', 'kcaa31', 50)} AS kcaa31,
        ${likeTextExpr('l', 'kcaa32', 100)} AS kcaa32, ${likeTextExpr('l', 'kcaa33', 100)} AS kcaa33,
        COALESCE(${likeTextExpr('saleCurrency', 'name', 100)}, ${likeTextExpr('l', 'kcaa34', 100)}) AS kcaa34,
        COALESCE(${likeTextExpr('costCurrency', 'name', 100)}, ${likeTextExpr('l', 'kcaa35', 100)}) AS kcaa35,
        ${likeTextExpr('l', 'location', 300)} AS location, ${likeTextExpr('l', 'sale_price', 100)} AS sale_price,
        ${likeTextExpr('l', 'cost_price', 100)} AS cost_price, ${likeTextExpr('l', 'Customer_supply', 50)} AS Customer_supply,
        ${likeTextExpr('l', 'Customer_Name', 500)} AS Customer_Name, ${likeTextExpr('l', 'remark', 1000)} AS remark
      FROM ${LINE_FROM} AS l
      INNER JOIN ${HEADER_FROM} AS h
        ON ${likeTextExpr('h', 'xsaj01', 200)} = ${likeTextExpr('l', 'xsak01', 200)}
      LEFT JOIN ${MATERIAL_FROM} AS m ON ${likeTextExpr('m', 'code', 100)} = ${likeTextExpr('l', 'kcaa05', 100)}
      LEFT JOIN ${CURRENCY_FROM} AS saleCurrency ON ${likeTextExpr('saleCurrency', 'code', 100)} = ${likeTextExpr('l', 'kcaa34', 100)}
      LEFT JOIN ${CURRENCY_FROM} AS costCurrency ON ${likeTextExpr('costCurrency', 'code', 100)} = ${likeTextExpr('l', 'kcaa35', 100)}
      ${whereSql}
    ) AS src
    WHERE src.rn BETWEEN @startRow AND @endRow
    ORDER BY src.rn ASC
  `)
  return { ok: true, page: q.page, pageSize: q.pageSize, total: Number(countResult.recordset?.[0]?.total ?? 0), list: listResult.recordset ?? [] }
}
