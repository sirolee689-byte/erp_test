/**
 * CUT 预览：数值三位小数；空为「-」（与后端解析字段展示一致）
 */

const DASH = '-'

/**
 * @param {unknown} raw
 * @returns {string}
 */
export function formatPaperPatternCutNumericDisplay(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return DASH
  const normalized = s.replace(/,/g, '').replace(/\s+/g, '')
  const n = Number(normalized)
  if (!Number.isFinite(n)) return s || DASH
  return n.toFixed(3)
}

/**
 * @param {unknown} raw
 * @returns {string}
 */
export function formatPaperPatternCutTextDisplay(raw) {
  const s = String(raw ?? '').replace(/\s+/g, ' ').trim()
  return s ? s : DASH
}
