/**
 * 纸格 CUT：长/宽/单位用量解析后规范为固定小数位（四舍五入，与落库/预览同源）
 */

/** CUT 长、宽、单位用量小数位数 */
export const PAPER_PATTERN_CUT_METRIC_DECIMALS = 4

/**
 * @param {unknown} raw 自 Excel 读出的单元格字符串（宜为 cell.v 真实值）
 * @param {number} [decimals=4]
 * @returns {string} 空或非数字原样 trim 返回；数字为固定小数位字符串
 */
export function normalizePaperPatternCutMetricDigits(raw, decimals = PAPER_PATTERN_CUT_METRIC_DECIMALS) {
  const places = Number.isFinite(decimals) && decimals >= 0 ? Math.min(20, Math.floor(decimals)) : 4
  const s = String(raw ?? '')
    .replace(/,/g, '')
    .replace(/\s+/g, '')
    .trim()
  if (!s) return ''
  const n = Number(s)
  if (!Number.isFinite(n)) return s
  const factor = 10 ** places
  return (Math.round(n * factor) / factor).toFixed(places)
}

/** @param {unknown} raw */
export function normalizePaperPatternCutMetric4Digits(raw) {
  return normalizePaperPatternCutMetricDigits(raw, PAPER_PATTERN_CUT_METRIC_DECIMALS)
}
