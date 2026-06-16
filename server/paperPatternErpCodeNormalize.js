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
 * 与 UB_ERP_Bom_000.kcaa01 比对用键（小写，基于 normalizeErpCodeDisplay 结果）
 * @param {string} display
 * @returns {string}
 */
export function erpCodeLookupKey(display) {
  const d = normalizeErpCodeDisplay(display)
  if (!d) return ''
  return d.toLowerCase()
}

/**
 * Material 预览：Excel N 列「电脑编码」→ ERP 基码（第一个 / 之前；无 / 则整串）
 * @param {unknown} raw N 列单元格原文
 * @returns {string}
 */
export function materialErpBaseFromExcelCell(raw) {
  const full = normalizeErpCodeDisplay(raw)
  if (!full) return ''
  const slash = full.indexOf('/')
  if (slash < 0) return full
  return full.slice(0, slash).trim()
}
