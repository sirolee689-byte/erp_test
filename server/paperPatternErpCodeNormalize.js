/**
 * 纸格 ERP 物料编码：前后端一致的展示归一与库内比对键（大小写不敏感）
 */

/**
 * 展示用：首尾空白去掉，连续空白压成单空格
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeErpCodeDisplay(raw) {
  return String(raw ?? '')
    .replace(/\uFEFF/g, '')
    // Excel 常见全角斜杠，与库内 ASCII「/」统一，避免 kcaa01 肉眼一致但比对失败
    .replace(/\uFF0F/g, '/')
    .replace(/\u2215/g, '/')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 与 Bom_000.kcaa01 比对用键（小写，基于 normalizeErpCodeDisplay 结果）
 * @param {string} display
 * @returns {string}
 */
export function erpCodeLookupKey(display) {
  const d = normalizeErpCodeDisplay(display)
  if (!d) return ''
  return d.toLowerCase()
}
