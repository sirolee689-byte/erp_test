/**
 * BOM 用量运算：父级传递用量（yl）计算
 * CUT- 裁片父行 kcac04 为「数量」，不参与乘算；其子件用量直接取自身 kcac04 后按编码+备注合并相加。
 */

/** @param {string} kcaa01 */
export function bomCostMaterialStartsWithCutPrefix(kcaa01) {
  const code = String(kcaa01 ?? '').trim().toLowerCase()
  return code.startsWith('cut-')
}

/**
 * @param {number} kcac04 当前行用量/数量
 * @param {number|null|undefined} parentYl 父级已算 yl
 * @param {boolean} parentIsCut 父级是否为 CUT- 裁片行
 */
export function computeBomUsageYlFromParent(kcac04, parentYl, parentIsCut) {
  const qty = Number(kcac04 ?? 0)
  if (parentYl == null || parentYl === undefined) return qty
  if (parentIsCut) return qty
  const p = Number(parentYl)
  return Number.isFinite(p) ? p * qty : qty
}

/** @param {string} kcaa01 @param {string[]} hidePrefixes */
export function bomCostUsageMatchesHidePrefix(kcaa01, hidePrefixes) {
  if (!hidePrefixes || !hidePrefixes.length) return false
  const code = String(kcaa01 ?? '').trim().toLowerCase()
  if (!code) return false
  for (let i = 0; i < hidePrefixes.length; i++) {
    const pre = String(hidePrefixes[i] ?? '').trim().toLowerCase()
    if (pre && code.startsWith(pre)) return true
  }
  return false
}

/**
 * bom_cost 落库：DFS 平铺明细，不做编码+备注合并；剔除与成本用量表展示相同的隐藏前缀（CUT-/BAG- 等）
 * @param {Array<{ kcaa01?: string, kcaa02?: string, kcaa03?: string, kcaa04?: string, Describe?: string, yl?: number, loss_rate?: number, total_qty?: number }>} flatRows flattenBomPartsCostUsageFlat 结果
 * @param {string[]} hidePrefixes 展示隐藏前缀（CUT-/BAG- 等父编码不写库）
 * @param {string} [excludeRootKcaa01] 主 BOM 成品编码（pq），树根行不落 bom_cost
 */
export function buildBomCostInsertPayloadFromFlatUsage(
  flatRows,
  hidePrefixes = [],
  excludeRootKcaa01 = '',
) {
  if (!Array.isArray(flatRows) || !flatRows.length) return []
  const rootCode = String(excludeRootKcaa01 ?? '').trim().toLowerCase()
  /** @type {Array<{ kcaa01: string, kcaa02: string, kcaa03: string, kcaa04: string, Describe: string, kcac04: number, kcac05: number, kcac06: number, kcac07: null, kcac08: null }>} */
  const out = []
  for (let i = 0; i < flatRows.length; i++) {
    const r = flatRows[i]
    const code = String(r?.kcaa01 ?? '').trim()
    if (!code || bomCostUsageMatchesHidePrefix(code, hidePrefixes)) continue
    if (rootCode && code.toLowerCase() === rootCode) continue
    const yl = Number(r?.yl ?? 0)
    const loss = Number(r?.loss_rate ?? 0)
    const total = Number.isFinite(Number(r?.total_qty)) ? Number(r.total_qty) : yl * (1 + loss)
    out.push({
      kcaa01: code,
      kcaa02: r?.kcaa02 != null ? String(r.kcaa02) : '',
      kcaa03: r?.kcaa03 != null ? String(r.kcaa03) : '',
      kcaa04: r?.kcaa04 != null ? String(r.kcaa04) : '',
      Describe: String(r?.Describe ?? '').trim(),
      kcac04: Number.isFinite(yl) ? yl : 0,
      kcac05: Number.isFinite(loss) ? loss : 0,
      kcac06: Number.isFinite(total) ? total : 0,
      kcac07: null,
      kcac08: null,
    })
  }
  return out
}
