/**
 * 库存统计：物料编码排除规则（与旧系统口径一致，供普通统计/后续材料分类/扣数表共用）
 */

/** 旧系统明确排除的成品/半成品/裁片等编码前缀 */
export const STOCK_STATS_EXCLUDED_PREFIXES = [
  'PQ-',
  'BAG-',
  'CUT-',
  'ATG-',
  'TAG-',
  'KEY-',
  'STRAP-',
  'SP-',
  'SS-',
  'GS-',
  'HD-',
  'PS-',
  'CP-',
  'RP-PQ',
  'RCP-',
  'HL-',
  'CH-',
  'REM-',
  'MAK-',
  'RA-',
  'PEN-',
  'CRAD-',
  'RAIN-',
  'SA-',
  'BELT-',
]

/**
 * @param {string} alias 明细表别名，如 l
 * @returns {string} T-SQL WHERE 片段（不含 WHERE 关键字）
 */
export function buildStockStatsMaterialExcludeSql(alias = 'l') {
  const col = `LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(${alias}.[kcaa01], N''))))`
  const prefixParts = STOCK_STATS_EXCLUDED_PREFIXES.map(
    (p) => `${col} NOT LIKE N'${p.replace(/'/g, "''")}%'`,
  )
  // %-OUT% 默认排除，但 kt-%、kc-% 例外保留
  const outExclude = `NOT (${col} LIKE N'%-OUT%' AND ${col} NOT LIKE N'kt-%' AND ${col} NOT LIKE N'kc-%')`
  return [...prefixParts, outExclude].map((x) => `(${x})`).join(' AND ')
}

/**
 * @param {string} code
 * @returns {boolean}
 */
export function isStockStatsMaterialExcluded(code) {
  const c = String(code ?? '').trim()
  if (!c) return true
  for (const p of STOCK_STATS_EXCLUDED_PREFIXES) {
    if (c.startsWith(p)) return true
  }
  if (c.includes('-OUT') && !c.startsWith('kt-') && !c.startsWith('kc-')) return true
  return false
}
