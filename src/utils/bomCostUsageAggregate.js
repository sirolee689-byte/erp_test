/**
 * 成本 BOM 用量表：平铺行合并与排序（与 inv/bom 详情页一致）
 */

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

/** 成本表排序键：优先 UB_ERP_Bom_parts.Seq（纸格 Material 全局序），否则摊平下标 */
export function bomCostFlatRowSortKey(r, flatIndex) {
  const seqRaw = r?.Seq != null ? r.Seq : r?.seq
  if (seqRaw != null && seqRaw !== '' && Number.isFinite(Number(seqRaw))) {
    return Number(seqRaw)
  }
  const idx = Number(r?._flatIndex)
  if (Number.isFinite(idx) && idx >= 0) return 1_000_000 + idx
  return 1_000_000 + flatIndex
}

export function bomCostFlatRowPxSortKey(r) {
  const raw = r?.px
  if (raw == null || raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

/**
 * 剔除前缀行后按 kcaa01+Describe 合并；排序按最小 Seq / 首次摊平顺序（与纸格 Material 列表一致）
 * @param {Record<string, unknown>[]} flatRows
 * @param {string[]} hidePrefixes
 */
export function aggregateBomCostUsageFlatForDisplay(flatRows, hidePrefixes) {
  if (!Array.isArray(flatRows) || !flatRows.length) return []
  /** @type {Map<string, { kcaa01: string, kcaa02: string, kcaa03: string, kcaa04: string, Describe: string, sumYl: number, sumTotal: number, firstLoss: number, hasMixedLoss: boolean, minSort: number, minPx: number | null, firstFlatIndex: number }>} */
  const map = new Map()
  /** @type {string[]} */
  const order = []
  for (let i = 0; i < flatRows.length; i++) {
    const r = flatRows[i]
    const code = String(r?.kcaa01 ?? '').trim()
    if (!code || bomCostUsageMatchesHidePrefix(code, hidePrefixes)) continue
    const remark = String(r?.Describe ?? '').trim() || String(r?.binfo ?? '').trim()
    const key = `${code}\u0000${remark}`
    const sortKey = bomCostFlatRowSortKey(r, i)
    const pxSortKey = bomCostFlatRowPxSortKey(r)
    const yl = Number(r?.yl ?? 0)
    const loss = Number(r?.loss_rate ?? 0)
    const rowTotal = Number.isFinite(Number(r?.total_qty)) ? Number(r.total_qty) : yl * (1 + loss)
    let g = map.get(key)
    if (!g) {
      g = {
        kcaa01: code,
        kcaa02: r?.kcaa02 != null ? String(r.kcaa02) : '',
        kcaa03: r?.kcaa03 != null ? String(r.kcaa03) : '',
        kcaa04: r?.kcaa04 != null ? String(r.kcaa04) : '',
        Describe: remark,
        sumYl: 0,
        sumTotal: 0,
        firstLoss: Number.isFinite(loss) ? loss : 0,
        hasMixedLoss: false,
        minSort: sortKey,
        minPx: pxSortKey,
        firstFlatIndex: i,
      }
      map.set(key, g)
      order.push(key)
    } else {
      if (!g.kcaa02 && r?.kcaa02) g.kcaa02 = String(r.kcaa02)
      if (!g.kcaa03 && r?.kcaa03) g.kcaa03 = String(r.kcaa03)
      if (!g.kcaa04 && r?.kcaa04) g.kcaa04 = String(r.kcaa04)
      if (Math.abs((Number.isFinite(loss) ? loss : 0) - g.firstLoss) > 1e-9) {
        g.hasMixedLoss = true
      }
      if (sortKey < g.minSort) g.minSort = sortKey
      if (pxSortKey != null && (g.minPx == null || pxSortKey < g.minPx)) g.minPx = pxSortKey
    }
    g.sumYl += yl
    g.sumTotal += rowTotal
  }
  /** @type {Record<string, unknown>[]} */
  const out = []
  for (let j = 0; j < order.length; j++) {
    const g = map.get(order[j])
    if (!g) continue
    const sumYl = g.sumYl
    let loss_rate = g.hasMixedLoss ? 0 : g.firstLoss
    if (g.hasMixedLoss && sumYl > 0) loss_rate = g.sumTotal / sumYl - 1
    const total_qty = g.sumTotal
    out.push({
      kcaa01: g.kcaa01,
      kcaa02: g.kcaa02,
      kcaa03: g.kcaa03,
      kcaa04: g.kcaa04,
      Describe: g.Describe,
      yl: sumYl,
      loss_rate,
      total_qty,
      level: 1,
      _sortMin: g.minSort,
      _sortPx: g.minPx,
      _sortFirstFlat: g.firstFlatIndex,
    })
  }
  // 业务规则：同一编码（kcaa01）的所有行必须挨在一起（不管备注是主里/副里）。
  // 先按编码汇总「聚团键」，排序前几档只看编码级键，同编码内部再排备注；
  // 这样 px 优先不变，又保证同编码不会被别的编码从中间劈开。
  /** @type {Map<string, { px: number | null, minSort: number, minFlat: number }>} */
  const codeAgg = new Map()
  for (let j = 0; j < out.length; j++) {
    const g = out[j]
    const code = String(g.kcaa01)
    const px = g._sortPx == null ? null : Number(g._sortPx)
    const minSort = Number(g._sortMin)
    const minFlat = Number(g._sortFirstFlat)
    const a = codeAgg.get(code)
    if (!a) {
      codeAgg.set(code, { px, minSort, minFlat })
    } else {
      if (px != null && (a.px == null || px < a.px)) a.px = px
      if (minSort < a.minSort) a.minSort = minSort
      if (minFlat < a.minFlat) a.minFlat = minFlat
    }
  }
  out.sort((a, b) => {
    const ca = codeAgg.get(String(a.kcaa01))
    const cb = codeAgg.get(String(b.kcaa01))
    // ① 编码级 px（空值排后）
    const ap = ca?.px == null ? null : ca.px
    const bp = cb?.px == null ? null : cb.px
    if (ap != null || bp != null) {
      if (ap == null) return 1
      if (bp == null) return -1
      if (ap !== bp) return ap - bp
    }
    // ② 编码级最小排序键（Seq / 原顺序）
    const csa = Number(ca?.minSort)
    const csb = Number(cb?.minSort)
    if (csa !== csb) return csa - csb
    // ③ 编码级最小首次下标：天然唯一，保证同编码聚团、不同编码不交错
    const cfa = Number(ca?.minFlat)
    const cfb = Number(cb?.minFlat)
    if (cfa !== cfb) return cfa - cfb
    // 同编码内部：按本组备注的出现顺序排
    const sa = Number(a._sortMin)
    const sb = Number(b._sortMin)
    if (sa !== sb) return sa - sb
    const fa = Number(a._sortFirstFlat)
    const fb = Number(b._sortFirstFlat)
    if (fa !== fb) return fa - fb
    return String(a.Describe).localeCompare(String(b.Describe), 'zh-Hans-CN', { sensitivity: 'accent' })
  })
  return out.map(({ _sortMin, _sortPx, _sortFirstFlat, ...rest }) => rest)
}
