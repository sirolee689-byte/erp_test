/**
 * ERP 界面数值展示（单源）
 *
 * 规则：先按 maxDecimals 四舍五入，再去掉末尾无意义的 0。
 * 适用于 1~4 位小数（及更多位）的**展示**，不改变落库/计算原值。
 *
 * 示例（maxDecimals=3）：
 * - 80.000 → 80
 * - 54.540 → 54.54
 * - 0.000 → 0
 */

/** 列表/表格空值占位 */
export const ERP_NUMBER_DISPLAY_EMPTY = '-'

function normalizeDecimalPlaces(maxDecimals) {
  const p = Number(maxDecimals)
  if (!Number.isFinite(p) || p < 0) return 3
  return Math.min(20, Math.floor(p))
}

/**
 * 四舍五入到指定位小数（展示/校验对齐用，不追加末尾 0）
 * @param {unknown} value
 * @param {number} [maxDecimals=3]
 * @returns {number}
 */
export function roundErpDecimal(value, maxDecimals = 3) {
  const n = Number(value)
  if (!Number.isFinite(n)) return NaN
  const places = normalizeDecimalPlaces(maxDecimals)
  const factor = 10 ** places
  const rounded = Math.round(n * factor) / factor
  return Object.is(rounded, -0) ? 0 : rounded
}

/**
 * ERP 数值展示：四舍五入 + 去末尾 0
 * @param {unknown} value
 * @param {{ maxDecimals?: number, empty?: string|null }} [options]
 * @returns {string}
 */
export function formatErpTrimDecimal(value, options = {}) {
  const { maxDecimals = 3, empty = ERP_NUMBER_DISPLAY_EMPTY } = options
  if (value === null || value === undefined || value === '') {
    return empty ?? ''
  }
  const n = Number(value)
  if (!Number.isFinite(n)) {
    return empty ?? ''
  }
  const places = normalizeDecimalPlaces(maxDecimals)
  const fixed = roundErpDecimal(n, places).toFixed(places)
  return fixed.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '')
}

/** 数量：最多三位小数，整数不补零 */
export function formatErpQtyDisplay(value, empty = ERP_NUMBER_DISPLAY_EMPTY) {
  return formatErpTrimDecimal(value, { maxDecimals: 3, empty })
}

/** 金额：最多两位小数，整数不补零 */
export function formatErpMoneyDisplay(value, empty = ERP_NUMBER_DISPLAY_EMPTY) {
  return formatErpTrimDecimal(value, { maxDecimals: 2, empty })
}

/** 单价：最多四位小数，整数不补零 */
export function formatErpPriceDisplay(value, empty = ERP_NUMBER_DISPLAY_EMPTY) {
  return formatErpTrimDecimal(value, { maxDecimals: 4, empty })
}
