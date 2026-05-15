/**
 * 损耗比例：用户按「百分比」输入（如 3、3.5、"3%"）→ 内部小数（0.03、0.035）
 * （导入页 Material 已改为直接小数输入；本函数仍可用于其它需解析「3%」文案的场景）
 * @param {unknown} raw
 * @returns {number | null} 小数；无法解析返回 null
 */
export function parsePercentUserInputToFraction(raw) {
  let s = String(raw ?? '').trim()
  if (!s) return null
  s = s.replace(/%/g, '').trim()
  if (!s) return null
  s = s.replace(/,/g, '.')
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return n / 100
}

/**
 * 小数 → 百分比展示（两位小数 + %）
 * @param {number | null | undefined} fraction
 */
export function formatFractionAsPercentText(fraction) {
  if (fraction === null || fraction === undefined || Number.isNaN(Number(fraction))) return ''
  const p = Number(fraction) * 100
  if (!Number.isFinite(p)) return ''
  return `${p.toFixed(2)}%`
}

/**
 * 小数（与 Bom_000.kcaa33 一致）→ 纯小数点展示，不带 %（如 0.06 表示 6%）
 * @param {number | null | undefined} fraction
 * @returns {string}
 */
export function formatFractionAsDecimalText(fraction) {
  if (fraction === null || fraction === undefined || Number.isNaN(Number(fraction))) return ''
  const n = Number(fraction)
  if (!Number.isFinite(n)) return ''
  return String(Number(n.toFixed(6)))
}
