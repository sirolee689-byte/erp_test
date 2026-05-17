/**
 * 纸格：CUT 预览「搭配」由 Material 同分组备注推导；辅料 L 列另读
 */

/**
 * CUT 序号主段，如 4-2 → 4
 * @param {string} cutSeq
 */
export function cutSeqMajorForMaterialGroup(cutSeq) {
  const s = String(cutSeq ?? '').trim()
  const i = s.indexOf('-')
  if (i <= 0) return ''
  return s.slice(0, i)
}

/**
 * 分组号 → 该组内首条非空备注（Material 表第 12 列）
 * @param {Array<{ groupNo?: string|number, remark?: string }>} materials
 * @returns {Map<string, string>}
 */
export function buildGroupMatchingMapFromMaterialRemarks(materials) {
  /** @type {Map<string, string>} */
  const map = new Map()
  if (!Array.isArray(materials)) return map
  for (const m of materials) {
    const g = String(m?.groupNo ?? '').trim()
    if (!g) continue
    const r = String(m?.remark ?? '').trim()
    if (!r) continue
    if (!map.has(g)) map.set(g, r)
  }
  return map
}
