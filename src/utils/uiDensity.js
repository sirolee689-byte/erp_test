/** localStorage 键：界面显示密度 */
export const UI_DENSITY_STORAGE_KEY = 'erp_ui_density'

/** 舒适模式（默认）：更大字号与控件，适合中老年用户 */
export const UI_DENSITY_COMFORTABLE = 'comfortable'

/** 标准模式：接近 Element Plus 默认密度 */
export const UI_DENSITY_STANDARD = 'standard'

export const UI_DENSITY_DEFAULT = UI_DENSITY_COMFORTABLE

/**
 * @param {string | null | undefined} value
 * @returns {'comfortable' | 'standard'}
 */
export function normalizeUiDensity(value) {
  return value === UI_DENSITY_STANDARD ? UI_DENSITY_STANDARD : UI_DENSITY_COMFORTABLE
}

/**
 * @returns {'comfortable' | 'standard'}
 */
export function getStoredUiDensity() {
  try {
    return normalizeUiDensity(localStorage.getItem(UI_DENSITY_STORAGE_KEY))
  } catch {
    return UI_DENSITY_DEFAULT
  }
}

/**
 * 同步到 documentElement，供全局 CSS 选择器使用
 * @param {'comfortable' | 'standard'} density
 */
export function applyUiDensityToDocument(density) {
  const d = normalizeUiDensity(density)
  document.documentElement.setAttribute('data-ui', d)
  return d
}

/**
 * @param {'comfortable' | 'standard'} density
 * @returns {'large' | 'default'}
 */
export function getElementPlusSizeForDensity(density) {
  return normalizeUiDensity(density) === UI_DENSITY_COMFORTABLE ? 'large' : 'default'
}

/**
 * 详情内密集表格：舒适用 default（≥15px 数据列），标准用 small
 * @param {'comfortable' | 'standard'} density
 * @returns {'default' | 'small'}
 */
export function getTableSizeForDensity(density) {
  return normalizeUiDensity(density) === UI_DENSITY_COMFORTABLE ? 'default' : 'small'
}

/** 应用启动时从本地存储恢复 data-ui */
export function initUiDensityOnBoot() {
  return applyUiDensityToDocument(getStoredUiDensity())
}

/**
 * @param {'comfortable' | 'standard'} density
 */
export function persistUiDensity(density) {
  const d = normalizeUiDensity(density)
  try {
    localStorage.setItem(UI_DENSITY_STORAGE_KEY, d)
  } catch {
    /* 隐私模式等场景忽略 */
  }
  return d
}
