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

/** @param {unknown} wastageFraction */
export function isMaterialWastageFractionFilled(wastageFraction) {
  if (wastageFraction === null || wastageFraction === undefined) return false
  if (typeof wastageFraction === 'string' && wastageFraction.trim() === '') return false
  return Number.isFinite(Number(wastageFraction))
}

/**
 * 可编辑损耗行中未填写损耗的 Material（LA-/LB-/LC-）
 * @param {Array<{ wastageEditable?: boolean, wastageFraction?: number | null, groupNo?: unknown, materialName?: unknown, materialCode?: unknown }>} previewRows
 * @returns {Array<{ groupNo: string, materialName: string, materialCode: string }>}
 */
export function collectMissingEditableMaterialWastage(previewRows) {
  if (!Array.isArray(previewRows)) return []
  /** @type {Array<{ groupNo: string, materialName: string, materialCode: string }>} */
  const missing = []
  for (const row of previewRows) {
    if (!row?.wastageEditable) continue
    if (isMaterialWastageFractionFilled(row.wastageFraction)) continue
    missing.push({
      groupNo: String(row.groupNo ?? '').trim(),
      materialName: String(row.materialName ?? '').trim(),
      materialCode: String(row.materialCode ?? '').trim(),
    })
  }
  return missing
}

/**
 * @param {Array<{ groupNo: string, materialName: string, materialCode: string }>} missing
 * @param {number} [maxLines]
 */
export function formatMissingEditableMaterialWastageAlertMessage(missing, maxLines = 12) {
  if (!Array.isArray(missing) || missing.length === 0) return ''
  const cap = Math.max(1, maxLines)
  const lines = missing.slice(0, cap).map((m, i) => {
    const g = m.groupNo ? `分组 ${m.groupNo}` : '分组 —'
    const name = m.materialName || '—'
    const code = m.materialCode || '—'
    return `${i + 1}. ${g}｜${name}｜${code}`
  })
  let body = lines.join('\n')
  if (missing.length > cap) {
    body += `\n…另有 ${missing.length - cap} 条未列出`
  }
  body += `\n\n请在 Material 列表为上述 LA-/LB-/LC- 物料填写损耗比例（可填 0 表示 0%）。`
  return body
}
