/**
 * CUT 预览：数值按指定位数四舍五入；空为「-」（仅展示，不改解析/落库原值）
 */

const DASH = '-'

/**
 * @param {unknown} raw
 * @param {number} [decimals=3] 小数位数
 * @returns {string}
 */
export function formatPaperPatternCutNumericDisplay(raw, decimals = 3) {
  const places = Number.isFinite(decimals) && decimals >= 0 ? Math.min(20, Math.floor(decimals)) : 3
  const s = String(raw ?? '').trim()
  if (!s) return DASH
  const normalized = s.replace(/,/g, '').replace(/\s+/g, '')
  const n = Number(normalized)
  if (!Number.isFinite(n)) return s || DASH
  return n.toFixed(places)
}

/** CUT 预览：长/宽/单位用量，四位小数 */
export function formatPaperPatternCutMetric4Display(raw) {
  return formatPaperPatternCutNumericDisplay(raw, 4)
}

/**
 * @param {unknown} raw
 * @returns {string}
 */
export function formatPaperPatternCutTextDisplay(raw) {
  const s = String(raw ?? '').replace(/\s+/g, ' ').trim()
  return s ? s : DASH
}
