/**
 * 销售订单列表查询：纯 SQL 拼装（SQL Server 2008 R2，ROW_NUMBER 分页）
 */

export const SALES_ORDER_HEADER_TABLE = 'UB_ERP_Sales_order'
const HEADER_FROM = `dbo.[${SALES_ORDER_HEADER_TABLE}]`

/**
 * 在册 / 回收站 del 条件
 * @param {{ recycled: boolean }} opts
 */
export function escapeSalesOrderSqlLikePattern(s) {
  return String(s ?? '')
    .replace(/\[/g, '[[]')
    .replace(/%/g, '[%]')
    .replace(/_/g, '[_]')
}

/**
 * @param {Record<string, unknown>} query
 */
export function parseSalesOrderListQuery(query) {
  const page = Math.max(1, Number(query?.page ?? 1) || 1)
  const pageSizeRaw = Number(query?.pageSize ?? 20) || 20
  const pageSize = Math.min(100, Math.max(1, pageSizeRaw))
  const recycledRaw = String(query?.recycled ?? '').trim().toLowerCase()
  const recycled = recycledRaw === '1' || recycledRaw === 'true' || recycledRaw === 'yes'
  return {
    page,
    pageSize,
    recycled,
    piNo: String(query?.piNo ?? query?.xsaj01 ?? '').trim(),
    systemCode: String(query?.systemCode ?? query?.syscode ?? '').trim(),
    customer: String(query?.customer ?? query?.kehu ?? '').trim(),
    salesDateFrom: String(query?.salesDateFrom ?? '').trim(),
    salesDateTo: String(query?.salesDateTo ?? '').trim(),
  }
}

/**
 * @param {{
 *   recycled: boolean,
 *   piNo?: string,
 *   systemCode?: string,
 *   customer?: string,
 *   salesDateFrom?: string,
 *   salesDateTo?: string,
 * }} opts
 */
export function buildSalesOrderListWhereSql(opts) {
  const recycled = Boolean(opts?.recycled)
  let whereSql = ''
  if (recycled) {
    whereSql += ` AND LTRIM(RTRIM(ISNULL(h.[del], N''))) = N'1' `
  } else {
    whereSql += ` AND (ISNULL(h.[del], N'') = N'' OR h.[del] = N'0') `
  }
  if (opts?.piNo) {
    whereSql += ` AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[xsaj01], N'')))) = @piNo `
  }
  if (opts?.systemCode) {
    whereSql += ` AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[syscode], N'')))) LIKE @systemCode `
  }
  if (opts?.customer) {
    whereSql += ` AND LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[kehu], N'')))) LIKE @customer `
  }
  if (opts?.salesDateFrom) {
    whereSql += ` AND h.[xsaj02] >= @salesDateFrom `
  }
  if (opts?.salesDateTo) {
    whereSql += ` AND h.[xsaj02] < DATEADD(day, 1, @salesDateTo) `
  }
  return { whereSql }
}

/** 运算状态列探测顺序（与 CONTEXT 一致：优先 isok） */
export function pickSalesOrderCalcStatusColumn(colNames) {
  const lower = new Set((colNames ?? []).map((c) => String(c).toLowerCase()))
  if (lower.has('isok')) return 'isok'
  if (lower.has('is_pur')) return 'is_pur'
  if (lower.has('sign')) return 'sign'
  return 'is_pur'
}

/** @param {string} col */
export function buildSalesOrderCalcStatusExpr(col) {
  const c = String(col ?? 'is_pur').replace(/[^a-zA-Z0-9_]/g, '')
  return `CASE WHEN LTRIM(RTRIM(ISNULL(h.[${c}], N''))) = N'1' THEN N'已运算' ELSE N'未运算' END`
}

/**
 * 列表分页 SQL（禁止 OFFSET-FETCH）
 * @param {{ whereSql: string, calcStatusExpr: string }} opts
 */
export function buildSalesOrderListPagedSql(opts) {
  const whereSql = String(opts?.whereSql ?? '')
  const calcStatusExpr = String(opts?.calcStatusExpr ?? `N'未运算'`)

  const sqlText = `
        SELECT x.*
        FROM (
          SELECT
            h.[id],
            LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[xsaj01], N'')))) AS piNo,
            LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[syscode], N'')))) AS systemCode,
            LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[kehu], N'')))) AS customerName,
            LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(h.[rmb], N'')))) AS currencyName,
            h.[xsaj02] AS salesDate,
            h.[xsaj08] AS deliveryDate,
            LTRIM(RTRIM(ISNULL(h.[pass], N''))) AS pass,
            LTRIM(RTRIM(ISNULL(h.[del], N''))) AS del,
            ${calcStatusExpr} AS calcStatus,
            ROW_NUMBER() OVER (ORDER BY h.[id] DESC) AS rn
          FROM ${HEADER_FROM} AS h
          WHERE 1 = 1
          ${whereSql}
        ) AS x
        WHERE x.rn BETWEEN @startRow AND @endRow
        ORDER BY x.rn
      `

  return { sql: sqlText }
}
