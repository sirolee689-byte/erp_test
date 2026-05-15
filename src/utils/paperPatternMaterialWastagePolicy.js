import { normalizeErpCodeDisplay } from './paperPatternErpCodeNormalize.js'

/**
 * 主料损耗比例是否允许在导入预览中人工调整（仅 LA-/LB-/LC- 前缀，大小写不敏感）
 * @param {unknown} materialCodeRaw
 */
export function canEditPaperPatternMaterialWastage(materialCodeRaw) {
  const d = normalizeErpCodeDisplay(materialCodeRaw)
  if (!d) return false
  const u = d.toUpperCase()
  return u.startsWith('LA-') || u.startsWith('LB-') || u.startsWith('LC-')
}
