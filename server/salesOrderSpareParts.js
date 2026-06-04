/**
 * 销售订单散件判定：Bom_code（copen=1、flag5 非空）为「排除前缀」；
 * 明细 kcaa01 不命中任一排除前缀 → 散件行；订单含散件 → 显示「增加散件单用量」。
 */
import sql from 'mssql'
import { INV_BOM_CODE_FROM } from './bomTables.js'
import { normKcaa01 } from './salesOrderSaveLogic.js'

const SALES_ORDER_LINE_FROM = 'dbo.[UB_ERP_Sales_order_list]'

/**
 * 读取 Bom_code 全部生效排除前缀（2A：含 CUT/OUT，不排除 id）
 * @param {import('mssql').ConnectionPool | import('mssql').Transaction} db
 * @returns {Promise<string[]>}
 */
export async function fetchBomCodeExcludePrefixes(db) {
  const r = await new sql.Request(db).query(`
    SELECT
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(bc.[flag5], N'')))) AS flag5
    FROM ${INV_BOM_CODE_FROM} AS bc
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(bc.[copen], N'')))) = N'1'
      AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(bc.[flag5], N'')))) <> N''
    ORDER BY LEN(LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(bc.[flag5], N''))))) DESC
  `)
  /** @type {string[]} */
  const out = []
  const seen = new Set()
  for (const row of r.recordset ?? []) {
    const f5 = String(row.flag5 ?? '').trim().toUpperCase()
    if (!f5 || seen.has(f5)) continue
    seen.add(f5)
    out.push(f5)
  }
  return out
}

/**
 * kcaa01 是否命中 Bom_code 排除前缀（与 is_need_calc 同口径：flag5 + '%'）
 * @param {unknown} kcaa01
 * @param {string[]} excludePrefixes 建议已按长度降序
 */
export function kcaa01MatchesBomCodeExcludePrefix(kcaa01, excludePrefixes) {
  const code = String(kcaa01 ?? '').trim().toUpperCase()
  if (!code || !excludePrefixes?.length) return false
  for (let i = 0; i < excludePrefixes.length; i++) {
    const f = String(excludePrefixes[i] ?? '').trim().toUpperCase()
    if (f && code.startsWith(f)) return true
  }
  return false
}

/**
 * 是否散件编码（不命中任一 Bom_code 排除前缀）
 * @param {unknown} kcaa01
 * @param {string[]} excludePrefixes
 */
export function isSparePartKcaa01(kcaa01, excludePrefixes) {
  const code = normKcaa01(kcaa01)
  if (!code) return false
  return !kcaa01MatchesBomCodeExcludePrefix(code, excludePrefixes)
}

/**
 * @param {{ kcaa01?: unknown }[]} lines
 * @param {string[]} excludePrefixes
 */
export function filterSparePartOrderLines(lines, excludePrefixes) {
  return (lines ?? []).filter((line) => isSparePartKcaa01(line?.kcaa01, excludePrefixes))
}

/**
 * @param {{ kcaa01?: unknown }[]} lines
 * @param {string[]} excludePrefixes
 */
export function orderLinesHaveSpareParts(lines, excludePrefixes) {
  return filterSparePartOrderLines(lines, excludePrefixes).length > 0
}

/**
 * 整款明细（命中 Bom_code 排除前缀）
 * @param {{ kcaa01?: unknown }[]} lines
 * @param {string[]} excludePrefixes
 */
export function filterWholeProductOrderLines(lines, excludePrefixes) {
  return (lines ?? []).filter((line) =>
    kcaa01MatchesBomCodeExcludePrefix(line?.kcaa01, excludePrefixes),
  )
}

/**
 * 混单：同时含散件行与整款行
 * @param {{ kcaa01?: unknown }[]} lines
 * @param {string[]} excludePrefixes
 */
export function orderLinesIsMixed(lines, excludePrefixes) {
  return (
    orderLinesHaveSpareParts(lines, excludePrefixes) &&
    filterWholeProductOrderLines(lines, excludePrefixes).length > 0
  )
}

/**
 * 纯散件单：含散件且无任何整款行
 * @param {{ kcaa01?: unknown }[]} lines
 * @param {string[]} excludePrefixes
 */
export function orderLinesIsPureSpare(lines, excludePrefixes) {
  return (
    orderLinesHaveSpareParts(lines, excludePrefixes) &&
    filterWholeProductOrderLines(lines, excludePrefixes).length === 0
  )
}

/**
 * 是否允许点「增加散件单用量」
 * @param {{ kcaa01?: unknown }[]} lines
 * @param {string[]} excludePrefixes
 * @param {Set<string>} piCostPqSet 已覆盖 pq（normKcaa01）
 */
export function resolveCanAddSpareUsage(lines, excludePrefixes, piCostPqSet) {
  if (!orderLinesHaveSpareParts(lines, excludePrefixes)) return false
  if (orderLinesIsPureSpare(lines, excludePrefixes)) return true
  const wholeLines = filterWholeProductOrderLines(lines, excludePrefixes)
  return wholeLines.every((line) => piCostPqSet.has(normKcaa01(line.kcaa01)))
}

/** SQL：明细 kcaa01 是否命中 Bom_code 排除前缀 */
function buildLineMatchesBomCodeExcludePrefixSqlExpr(lineKcaa01Expr) {
  const kc = String(lineKcaa01Expr ?? 'sl.[kcaa01]')
  return `
    EXISTS (
      SELECT 1
      FROM ${INV_BOM_CODE_FROM} AS bc
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(bc.[copen], N'')))) = N'1'
        AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(bc.[flag5], N'')))) <> N''
        AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(${kc}, N'')))) LIKE (
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(bc.[flag5], N'')))) + N'%'
        )
    )
  `
}

/**
 * 列表/详情 SQL：订单是否含整款明细（1/0）
 * @param {string} [headerAlias]
 */
export function buildSalesOrderHasWholeProductLinesSqlExpr(headerAlias = 'h') {
  const h = String(headerAlias ?? 'h').replace(/[^a-zA-Z0-9_]/g, '') || 'h'
  const matchWhole = buildLineMatchesBomCodeExcludePrefixSqlExpr('sl.[kcaa01]')
  return `
    CASE WHEN EXISTS (
      SELECT 1
      FROM ${SALES_ORDER_LINE_FROM} AS sl
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(sl.[xsak01], N'')))) =
            LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(${h}.[xsaj01], N''))))
        AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(sl.[kcaa01], N'')))) <> N''
        AND ${matchWhole}
    ) THEN 1 ELSE 0 END
  `
}

/**
 * 列表/详情 SQL：是否纯散件单（1/0）
 * @param {string} [headerAlias]
 */
export function buildSalesOrderIsPureSpareOrderSqlExpr(headerAlias = 'h') {
  const h = String(headerAlias ?? 'h').replace(/[^a-zA-Z0-9_]/g, '') || 'h'
  const hasSpare = buildSalesOrderHasSparePartsSqlExpr(h)
  const hasWhole = buildSalesOrderHasWholeProductLinesSqlExpr(h)
  return `CASE WHEN (${hasSpare}) = 1 AND (${hasWhole}) = 0 THEN 1 ELSE 0 END`
}

/**
 * 列表/详情 SQL：是否可点「增加散件单用量」（1/0）
 * @param {string} [headerAlias]
 */
export function buildSalesOrderCanAddSpareUsageSqlExpr(headerAlias = 'h') {
  const h = String(headerAlias ?? 'h').replace(/[^a-zA-Z0-9_]/g, '') || 'h'
  const hasSpare = buildSalesOrderHasSparePartsSqlExpr(h)
  const isPureSpare = buildSalesOrderIsPureSpareOrderSqlExpr(h)
  const matchWhole = buildLineMatchesBomCodeExcludePrefixSqlExpr('sl.[kcaa01]')
  return `
    CASE
      WHEN (${hasSpare}) = 0 THEN 0
      WHEN (${isPureSpare}) = 1 THEN 1
      WHEN NOT EXISTS (
        SELECT 1
        FROM ${SALES_ORDER_LINE_FROM} AS sl
        WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(sl.[xsak01], N'')))) =
              LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(${h}.[xsaj01], N''))))
          AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(sl.[kcaa01], N'')))) <> N''
          AND ${matchWhole}
          AND NOT EXISTS (
            SELECT 1
            FROM dbo.[UB_ERP_Bom_pi_cost] AS c
            WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.[sid], N'')))) =
                  LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(${h}.[xsaj01], N''))))
              AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(c.[pq], N'')))) =
                  LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(sl.[kcaa01], N''))))
          )
      ) THEN 1
      ELSE 0
    END
  `
}

/**
 * 列表/详情 SQL：订单是否含散件明细（1/0）
 * @param {string} [headerAlias]
 */
export function buildSalesOrderHasSparePartsSqlExpr(headerAlias = 'h') {
  const h = String(headerAlias ?? 'h').replace(/[^a-zA-Z0-9_]/g, '') || 'h'
  return `
    CASE WHEN EXISTS (
      SELECT 1
      FROM ${SALES_ORDER_LINE_FROM} AS sl
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(sl.[xsak01], N'')))) =
            LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(${h}.[xsaj01], N''))))
        AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(sl.[kcaa01], N'')))) <> N''
        AND NOT EXISTS (
          SELECT 1
          FROM ${INV_BOM_CODE_FROM} AS bc
          WHERE LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(bc.[copen], N'')))) = N'1'
            AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(bc.[flag5], N'')))) <> N''
            AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(sl.[kcaa01], N'')))) LIKE (
              LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(bc.[flag5], N'')))) + N'%'
            )
        )
    ) THEN 1 ELSE 0 END
  `
}
