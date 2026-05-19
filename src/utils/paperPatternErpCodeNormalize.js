/**
 * 纸格 ERP 物料编码归一（与 server/paperPatternErpCodeNormalize.js 保持规则一致）
 */

/**
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeErpCodeDisplay(raw) {
  return String(raw ?? '')
    .replace(/\uFEFF/g, '')
    .replace(/\uFF0F/g, '/')
    .replace(/\u2215/g, '/')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * @param {string} display
 * @returns {string}
 */
export function erpCodeLookupKey(display) {
  const d = normalizeErpCodeDisplay(display)
  if (!d) return ''
  return d.toLowerCase()
}

/**
 * Material 预览：N 列电脑编码 → ERP 基码（与 server/paperPatternErpCodeNormalize.js 一致）
 * @param {unknown} raw
 * @returns {string}
 */
export function materialErpBaseFromExcelCell(raw) {
  const full = normalizeErpCodeDisplay(raw)
  if (!full) return ''
  const slash = full.indexOf('/')
  if (slash < 0) return full
  return full.slice(0, slash).trim()
}
