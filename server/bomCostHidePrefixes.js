/**
 * BOM 成本用量表 / PI 物料单运算：隐藏前缀（与 inv/bom 列表内置配置一致）
 */

/** @type {readonly string[]} */
export const BOM_COST_BUILTIN_HIDE_PREFIXES = [
  'CUT-',
  'PQ-',
  'BAG-',
  'OUT',
  'TAG-',
  'ATG-',
  'KEY-',
  'STRAP-',
  'SP-',
  'SS-',
  'GS-',
  'HD-',
  'PS-',
  'CP-',
  // Keep normal RP- material rows; hide only RP-PQ structure rows.
  'RP-PQ',
  'RMP-',
  'RCP-',
  'HL-',
  'CH-',
  'REM-',
  'MAK-',
  'RA-',
  'PEN-',
  'CRAD-',
  'RAIN-',
  'SA-',
  'BELT-',
  'ARH-',
  'SSB-',
  'PB-',
  'DS-',
  'ASB-',
]

const BOM_COST_HIDE_PREFIX_CAP = 50
const BOM_COST_HIDE_PREFIX_LEN = 80

/** @param {unknown[]} [list] */
export function normalizeBomCostHidePrefixes(list) {
  const arr = Array.isArray(list) ? list : BOM_COST_BUILTIN_HIDE_PREFIXES
  const seen = new Set()
  /** @type {string[]} */
  const out = []
  for (const item of arr) {
    const t = String(item ?? '').trim().slice(0, BOM_COST_HIDE_PREFIX_LEN)
    if (!t) continue
    const k = t.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(t)
    if (out.length >= BOM_COST_HIDE_PREFIX_CAP) break
  }
  return out
}

/** 销售订单 / BOM 资料一键运算默认隐藏前缀 */
export function getDefaultBomCostHidePrefixes() {
  return normalizeBomCostHidePrefixes(BOM_COST_BUILTIN_HIDE_PREFIXES)
}
