/**

 * 销售订单 pi_cost 落库专用字段（top/t 层级、默认值；不影响 bom_cost 平铺用量）

 */

import { normKcaa01 } from './salesOrderSaveLogic.js'

import { kcaa01MatchesTopLevelFinishedBomCodePrefix } from './salesOrderPiBom.js'



/** 父行 Sales_list 字段 → pi_cost t_kcaa*（不含 t_kcaa01/02，由层级单独处理） */

export const PI_COST_PARENT_T_FIELD_KEYS = [

  'kcaa03',

  'kcaa04',

  'kcaa05',

  'kcaa06',

  'kcaa07',

  'kcaa08',

  'kcaa09',

  'kcaa10',

  'kcaa11',

  'kcaa14',

  'kcaa15',

  'kcaa25',

  'kcaa26',

  'kcaa27',

]



/**

 * @returns {Record<string, null>}

 */

export function buildEmptyPiCostParentTFields() {

  /** @type {Record<string, null>} */

  const out = {}

  for (let i = 0; i < PI_COST_PARENT_T_FIELD_KEYS.length; i++) {

    out[`t_${PI_COST_PARENT_T_FIELD_KEYS[i]}`] = null

  }

  return out

}



/**

 * 从 PI BOM 树父节点复制 Sales_list 扩展字段为 t_kcaa*

 * @param {Record<string, unknown> | null | undefined} parentNode

 */

export function extractPiCostParentTFieldsFromNode(parentNode) {

  if (!parentNode) return buildEmptyPiCostParentTFields()

  /** @type {Record<string, unknown>} */

  const out = {}

  for (let i = 0; i < PI_COST_PARENT_T_FIELD_KEYS.length; i++) {

    const k = PI_COST_PARENT_T_FIELD_KEYS[i]

    const tKey = `t_${k}`

    const raw = parentNode[k]

    if (k === 'kcaa14') {

      out[tKey] =

        raw != null && raw !== '' && Number.isFinite(Number(raw)) ? Math.trunc(Number(raw)) : null

    } else if (k === 'kcaa07' || k === 'kcaa08' || k === 'kcaa26') {

      out[tKey] =

        raw != null && raw !== '' && Number.isFinite(Number(raw)) ? Number(raw) : null

    } else {

      const s = raw != null ? String(raw).trim() : ''

      out[tKey] = s || null

    }

  }

  return out

}



/**

 * DFS 收集 PI BOM 树每行的 top/t 层级（按 list.id / sourceRowId 关联）

 * top 锚点仅在 PI BOM **第一层**（成品头直下、parent 为空）且命中 Bom_code flag5 时重置；

 * 深层材料（如裁片下 RP-*）只继承上层锚点。散件单第一层即散件本身时，top 可为自身。

 * t_kcaa03~ 等从树中直接父节点（Sales_list 行）复制，等价 sid+t_kcaa01 查父行。

 * @param {any[]} treeNodes

 * @param {string[]} topLevelFlag5Prefixes Bom_code flag5（排除 OUT/CUT）

 */

export function collectPiCostHierarchyMetaFromTree(treeNodes, topLevelFlag5Prefixes) {

  /** @type {Map<number, Record<string, unknown>>} */

  const bySourceId = new Map()



  /**

   * @param {any[]} nodes

   * @param {string} anchor01

   * @param {string} anchor02

   * @param {Record<string, unknown> | null} parentNode

   */

  function walk(nodes, anchor01, anchor02, parentNode) {

    if (!Array.isArray(nodes) || !nodes.length) return

    for (let i = 0; i < nodes.length; i++) {

      const node = nodes[i]

      const selfCode = String(node?.kcaa01 ?? '').trim()

      const selfName = String(node?.kcaa02 ?? '').trim()

      const parent01 = parentNode ? String(parentNode.kcaa01 ?? '').trim() : ''

      const parent02 = parentNode ? String(parentNode.kcaa02 ?? '').trim() : ''

      let nextAnchor01 = anchor01

      let nextAnchor02 = anchor02

      if (

        !parent01 &&

        kcaa01MatchesTopLevelFinishedBomCodePrefix(selfCode, topLevelFlag5Prefixes)

      ) {

        nextAnchor01 = selfCode

        nextAnchor02 = selfName

      }



      const sourceId = node?.id != null && Number.isFinite(Number(node.id)) ? Number(node.id) : null

      if (sourceId != null && sourceId > 0) {

        const parentNorm = normKcaa01(parent01)

        const anchorNorm = normKcaa01(nextAnchor01)

        const parentIsAnchor = Boolean(parentNorm && anchorNorm && parentNorm === anchorNorm)

        const omitParent = parentIsAnchor || !parent01

        bySourceId.set(sourceId, {

          top_kcaa01: nextAnchor01,

          top_kcaa02: nextAnchor02,

          t_kcaa01: omitParent ? null : parent01,

          t_kcaa02: omitParent ? null : parent02,

          ...(omitParent

            ? buildEmptyPiCostParentTFields()

            : extractPiCostParentTFieldsFromNode(parentNode)),

        })

      }



      const ch = node?.children

      if (Array.isArray(ch) && ch.length) {

        walk(ch, nextAnchor01, nextAnchor02, node)

      }

    }

  }



  walk(treeNodes, '', '', null)

  return bySourceId

}

/**
 * Sales_list.kcaa13 有值（含 0）时解析为整数；NULL/空则返回 null（不覆盖 bom_000）
 * @param {unknown} raw
 * @returns {number | null}
 */
export function parsePiCostSalesListKcaa13(raw) {
  if (raw == null || raw === '') return null
  if (!Number.isFinite(Number(raw))) return null
  return Math.trunc(Number(raw))
}

/**
 * DFS 收集 PI BOM 树每行 Sales_list.id → kcaa13（仅含 list 有值的行）
 * @param {any[]} treeNodes
 * @returns {Map<number, number>}
 */
export function collectPiCostKcaa13BySourceIdFromTree(treeNodes) {
  /** @type {Map<number, number>} */
  const bySourceId = new Map()

  /** @param {any[]} nodes */
  function walk(nodes) {
    if (!Array.isArray(nodes) || !nodes.length) return
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]
      const sourceId = node?.id != null && Number.isFinite(Number(node.id)) ? Number(node.id) : null
      if (sourceId != null && sourceId > 0) {
        const kcaa13 = parsePiCostSalesListKcaa13(node.kcaa13)
        if (kcaa13 != null) bySourceId.set(sourceId, kcaa13)
      }
      const ch = node?.children
      if (Array.isArray(ch) && ch.length) walk(ch)
    }
  }

  walk(treeNodes)
  return bySourceId
}

/**
 * pi_cost 落库：Sales_list 有 kcaa13 时覆盖 enrich 自 bom_000 的值（用量与其它 kcaa 不动）
 * @param {Array<Record<string, unknown>>} rows
 * @param {Map<number, number>} kcaa13BySourceId
 */
export function applyPiCostKcaa13FromSalesList(rows, kcaa13BySourceId) {
  if (!Array.isArray(rows) || !rows.length || !kcaa13BySourceId?.size) return rows ?? []
  return rows.map((row) => {
    const sourceId =
      row?.sourceRowId != null && Number.isFinite(Number(row.sourceRowId))
        ? Number(row.sourceRowId)
        : null
    if (sourceId == null) return row
    const kcaa13 = kcaa13BySourceId.get(sourceId)
    if (kcaa13 == null) return row
    return { ...row, kcaa13 }
  })
}

/**

 * 销售明细订货数量 → pi_cost.temp（nvarchar，与旧系统一致）

 * @param {unknown} orderQty UB_ERP_Sales_order_list.xsak03

 * @returns {string | null}

 */

export function formatPiCostTempFromOrderQty(orderQty) {

  if (orderQty == null || orderQty === '') return null

  const n = Number(orderQty)

  if (!Number.isFinite(n)) return null

  if (Math.trunc(n) === n) return String(Math.trunc(n))

  return String(n)

}



/**

 * 补 pi_cost 专用落库字段（仅覆盖定稿列；kcac04/05/06 等用量不动）

 * @param {Array<Record<string, unknown>>} rows buildPiCostInsertPayload + enrich 结果

 * @param {Map<number, Record<string, unknown>>} hierarchyBySourceId

 * @param {number | null | undefined} [orderQty] 该款销售明细 xsak03

 */

export function applyPiCostExtendedFieldsToRows(rows, hierarchyBySourceId, orderQty) {

  if (!Array.isArray(rows) || !rows.length) return []

  const emptyT = buildEmptyPiCostParentTFields()

  return rows.map((row) => {

    const sourceId =

      row?.sourceRowId != null && Number.isFinite(Number(row.sourceRowId))

        ? Number(row.sourceRowId)

        : null

    const meta = sourceId != null ? hierarchyBySourceId.get(sourceId) : undefined

    const kcac06 = Number.isFinite(Number(row?.kcac06)) ? Number(row.kcac06) : 0

    const kcac07 = 0

    /** @type {Record<string, unknown>} */

    const tFields = { ...emptyT }

    if (meta) {

      for (let i = 0; i < PI_COST_PARENT_T_FIELD_KEYS.length; i++) {

        const tKey = `t_${PI_COST_PARENT_T_FIELD_KEYS[i]}`

        tFields[tKey] = meta[tKey] ?? null

      }

    }

    return {

      ...row,

      top_kcaa01: meta?.top_kcaa01 != null ? String(meta.top_kcaa01) : String(row?.top_kcaa01 ?? ''),

      top_kcaa02: meta?.top_kcaa02 != null ? String(meta.top_kcaa02) : String(row?.top_kcaa02 ?? ''),

      t_kcaa01: meta ? meta.t_kcaa01 : null,

      t_kcaa02: meta ? meta.t_kcaa02 : null,

      ...tFields,

      kcac07,

      kcac08: kcac06 + kcac07,

      kcaa07: 0,

      kcaa08: 0,

      isok: 1,

      pass: '1',

      temp: formatPiCostTempFromOrderQty(orderQty),

    }

  })

}


