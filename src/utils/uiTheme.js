/**

 * 界面皮肤（配色主题），与 data-ui 密度开关相互独立。

 * 只换「面色」（背景/卡片/表格/边框），不动按钮语义色（蓝/绿/红）。

 * 暗黑皮肤会同步调浅文字色以保证可读性。

 * 与 html[data-theme] 联动，具体色值见 styles/element-override.scss。

 */



/** localStorage 键：界面皮肤 */

export const UI_THEME_STORAGE_KEY = 'erp_ui_theme'



/** 全白（默认）：冷灰白底 + 纯白卡片，接近 Element Plus 原始配色 */

export const UI_THEME_LIGHT = 'light'



/** 暖色护眼（米黄/纸色）：暖白底，长时间看表格不刺眼 */

export const UI_THEME_WARM = 'warm'



/** 暗黑：深灰底 + 浅字，适合弱光环境 */

export const UI_THEME_DARK = 'dark'



/** 豆沙绿：淡绿护眼底，经典护眼绿调 */

export const UI_THEME_BEANGREEN = 'beangreen'

/** 淡蓝：浅蓝底 + 深蓝侧栏，清爽低刺激 */
export const UI_THEME_LIGHTBLUE = 'lightblue'



export const UI_THEME_DEFAULT = UI_THEME_LIGHT



/** 允许的皮肤取值（新增皮肤时在这里登记即可） */

const UI_THEME_VALUES = [
  UI_THEME_LIGHT,
  UI_THEME_WARM,
  UI_THEME_DARK,
  UI_THEME_BEANGREEN,
  UI_THEME_LIGHTBLUE,
]



/**

 * @param {string | null | undefined} value

 * @returns {'light' | 'warm' | 'dark' | 'beangreen' | 'lightblue'}

 */

export function normalizeUiTheme(value) {

  return UI_THEME_VALUES.includes(value) ? value : UI_THEME_DEFAULT

}



/**

 * @returns {'light' | 'warm' | 'dark' | 'beangreen' | 'lightblue'}

 */

export function getStoredUiTheme() {

  try {

    return normalizeUiTheme(localStorage.getItem(UI_THEME_STORAGE_KEY))

  } catch {

    return UI_THEME_DEFAULT

  }

}



/**

 * 同步到 documentElement，供全局 CSS 选择器（html[data-theme]）使用

 * @param {'light' | 'warm' | 'dark' | 'beangreen' | 'lightblue'} theme

 */

export function applyUiThemeToDocument(theme) {

  const t = normalizeUiTheme(theme)

  document.documentElement.setAttribute('data-theme', t)

  return t

}



/** 应用启动时从本地存储恢复 data-theme */

export function initUiThemeOnBoot() {

  return applyUiThemeToDocument(getStoredUiTheme())

}



/**

 * @param {'light' | 'warm' | 'dark' | 'beangreen' | 'lightblue'} theme

 */

export function persistUiTheme(theme) {

  const t = normalizeUiTheme(theme)

  try {

    localStorage.setItem(UI_THEME_STORAGE_KEY, t)

  } catch {

    /* 隐私模式等场景忽略 */

  }

  return t

}


