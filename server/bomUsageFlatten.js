/**
 * BOM 用量平铺与汇总合并（UB_ERP_Bom_cost / pi_cost 共用）
 */
import {
  bomCostMaterialStartsWithCutPrefix,
  bomCostUsageMatchesHidePrefix,
  resolveBomCostTopFields,
} from './bomUsageYl.js'

function flattenBomPartsCostUsageFlatCore(
  treeNodes,
  parentYl,
  acc,
  cutSelfMultipliesChildren,
  parentTopKcaa01 = '',
  parentTopKcaa02 = '',
) {
  const out = acc ?? []
  if (!Array.isArray(treeNodes) || !treeNodes.length) return out
  const isRootLevel = parentYl == null || parentYl === undefined
  const parentFactor = isRootLevel ? 1 : Number(parentYl)
  const safeParentFactor = Number.isFinite(parentFactor) ? parentFactor : 1
  for (let i = 0; i < treeNodes.length; i++) {
    const node = treeNodes[i]
    const selfCode = node?.kcaa01 != null ? String(node.kcaa01) : ''
    const selfName = node?.kcaa02 != null ? String(node.kcaa02) : ''
    const topFields = resolveBomCostTopFields(
      isRootLevel,
      selfCode,
      selfName,
      parentTopKcaa01,
      parentTopKcaa02,
    )
    const kcac04 = Number(node?.kcac04 ?? 0)
    const yl = safeParentFactor * kcac04
    const kcac05 = Number(node?.kcac05 ?? 0)
    const kcaa33 = Number(node?.kcaa33 ?? 0)
    let loss_rate = 0
    if (kcac05 > 0) loss_rate = kcac05
    else if (kcaa33 > 0) loss_rate = kcaa33
    const total_qty = yl * (1 + loss_rate)
    const lv = node?.level != null && Number.isFinite(Number(node.level)) ? Number(node.level) : 1
    const describeVal = String(node?.Describe ?? node?.describe ?? '')
    const seqRaw = node?.Seq != null ? node.Seq : node?.seq
    const seqNum =
      seqRaw != null && seqRaw !== '' && Number.isFinite(Number(seqRaw)) ? Number(seqRaw) : null
    out.push({
      sourceRowId: node?.sourceRowId ?? node?.bomSourceId ?? node?.id ?? null,
      kcaa01: selfCode,
      kcaa02: selfName,
      top_kcaa01: topFields.top_kcaa01,
      top_kcaa02: topFields.top_kcaa02,
      kcaa03: node?.kcaa03 != null ? String(node.kcaa03) : '',
      kcaa04: node?.kcaa04 != null ? String(node.kcaa04) : '',
      Describe: describeVal,
      yl,
      loss_rate,
      total_qty,
      level: lv,
      Seq: seqNum,
    })
    const ch = node?.children
    const thisIsCut = bomCostMaterialStartsWithCutPrefix(node?.kcaa01)
    const nextParentFactor = thisIsCut && !cutSelfMultipliesChildren ? safeParentFactor : yl
    if (Array.isArray(ch) && ch.length) {
      flattenBomPartsCostUsageFlatCore(
        ch,
        nextParentFactor,
        out,
        cutSelfMultipliesChildren,
        selfCode,
        selfName,
      )
    }
  }
  return out
}

/**
 * 历史展示平铺（CUT 自身用量不继续放大下层）；API/写库已统一用 flattenBomPartsCostUsageFlatForBomCost。
 * @param {any[]} treeNodes
 * @param {number|null|undefined} parentYl
 * @param {any[]} [acc]
 * @param {boolean} [parentIsCut]
 * @param {string} [parentTopKcaa01]
 * @param {string} [parentTopKcaa02]
 */
export function flattenBomPartsCostUsageFlat(
  treeNodes,
  parentYl,
  acc,
  parentIsCut = false,
  parentTopKcaa01 = '',
  parentTopKcaa02 = '',
) {
  void parentIsCut
  return flattenBomPartsCostUsageFlatCore(
    treeNodes,
    parentYl,
    acc,
    false,
    parentTopKcaa01,
    parentTopKcaa02,
  )
}

/**
 * UB_ERP_Bom_cost 写库专用平铺：CUT 自身用量要继续放大下层材料。
 * @param {any[]} treeNodes
 * @param {number|null|undefined} parentYl
 * @param {any[]} [acc]
 */
export function flattenBomPartsCostUsageFlatForBomCost(
  treeNodes,
  parentYl,
  acc,
  parentTopKcaa01 = '',
  parentTopKcaa02 = '',
) {
  return flattenBomPartsCostUsageFlatCore(
    treeNodes,
    parentYl,
    acc,
    true,
    parentTopKcaa01,
    parentTopKcaa02,
  )
}

/**
 * 按子件编码 + 备注合并（pi_consumption / Bom_consumption）
 * @param {Record<string, unknown>[]} flatRows
 * @param {string[]} hidePrefixes
 */
export function aggregateBomConsumptionFromFlat(flatRows, hidePrefixes = []) {
  if (!Array.isArray(flatRows) || !flatRows.length) return []
  /** @type {Map<string, { kcaa01: string, kcaa02: string, kcaa03: string, kcaa04: string, Describe: string, sumay: number, sumby: number }>} */
  const map = new Map()
  /** @type {string[]} */
  const order = []
  for (let i = 0; i < flatRows.length; i++) {
    const r = flatRows[i]
    const code = String(r?.kcaa01 ?? '').trim()
    if (!code || bomCostUsageMatchesHidePrefix(code, hidePrefixes)) continue
    const remark = String(r?.Describe ?? '').trim()
    const mergeKey = `${code}\u0000${remark}`
    const yl = Number(r?.yl ?? 0)
    const loss = Number(r?.loss_rate ?? 0)
    const rowTotal = Number.isFinite(Number(r?.total_qty)) ? Number(r.total_qty) : yl * (1 + loss)
    let g = map.get(mergeKey)
    if (!g) {
      g = {
        kcaa01: code,
        kcaa02: r?.kcaa02 != null ? String(r.kcaa02) : '',
        kcaa03: r?.kcaa03 != null ? String(r.kcaa03) : '',
        kcaa04: r?.kcaa04 != null ? String(r.kcaa04) : '',
        Describe: remark,
        sumay: 0,
        sumby: 0,
      }
      map.set(mergeKey, g)
      order.push(mergeKey)
    } else {
      if (!g.kcaa02 && r?.kcaa02) g.kcaa02 = String(r.kcaa02)
      if (!g.kcaa03 && r?.kcaa03) g.kcaa03 = String(r.kcaa03)
      if (!g.kcaa04 && r?.kcaa04) g.kcaa04 = String(r.kcaa04)
    }
    g.sumay += yl
    g.sumby += rowTotal
  }
  /** @type {{ kcaa01: string, kcaa02: string, kcaa03: string, kcaa04: string, Describe: string, sumay: number, sumby: number, kcac05: number }[]} */
  const out = []
  for (let j = 0; j < order.length; j++) {
    const g = map.get(order[j])
    if (!g) continue
    const sumay = g.sumay
    const sumby = g.sumby
    const kcac05 = sumay > 0 ? (sumby - sumay) / sumay : 0
    out.push({
      kcaa01: g.kcaa01,
      kcaa02: g.kcaa02,
      kcaa03: g.kcaa03,
      kcaa04: g.kcaa04,
      Describe: g.Describe,
      sumay,
      sumby,
      kcac05,
    })
  }
  return out
}
