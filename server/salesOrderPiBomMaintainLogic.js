/**
 * 销售订单 PI BOM 维护：纯校验与树展平
 */
import { normKcaa01 } from './salesOrderSaveLogic.js'
import {
  parseSyncBomKcaa01,
  validateSyncBomLineOnOrder,
  validateSyncBomOrderState,
} from './salesOrderSyncBomLogic.js'

/** @param {unknown} raw */
export function roundDecimal6(raw) {
  const s = String(raw ?? '')
    .replace(/,/g, '')
    .trim()
  if (s === '') return 0
  const n = Number(s)
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 1e6) / 1e6
}

/**
 * @param {unknown} kcaa01
 */
export function parsePiBomMaintainKcaa01(kcaa01) {
  return parseSyncBomKcaa01(kcaa01)
}

/**
 * @param {{ pass?: string, del?: string }} header
 */
export function validatePiBomMaintainOrderState(header) {
  return validateSyncBomOrderState(header)
}

/**
 * @param {string} kcaa01
 * @param {Iterable<string>} lineKcaa01Set
 */
export function validatePiBomMaintainLineOnOrder(kcaa01, lineKcaa01Set) {
  return validateSyncBomLineOnOrder(kcaa01, lineKcaa01Set)
}

/**
 * @param {unknown} lines
 */
export function parsePiBomMaintainLines(lines) {
  if (!Array.isArray(lines) || !lines.length) {
    return { ok: false, msg: 'body.lines 不能为空' }
  }
  /** @type {{ id: number, kcac04: number, kcac05: number, Describe: string }[]} */
  const out = []
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const id = Number(raw?.id)
    if (!Number.isFinite(id) || id <= 0) {
      return { ok: false, msg: `第 ${i + 1} 行缺少有效 id` }
    }
    const kcac04 = roundDecimal6(raw?.kcac04)
    if (kcac04 < 0) return { ok: false, msg: `第 ${i + 1} 行用量不能为负` }
    const kcac05 = roundDecimal6(raw?.kcac05)
    if (kcac05 < 0) return { ok: false, msg: `第 ${i + 1} 行损耗不能为负` }
    out.push({
      id,
      kcac04,
      kcac05,
      Describe: String(raw?.Describe ?? raw?.describe ?? '').trim(),
    })
  }
  const seen = new Set()
  for (const row of out) {
    if (seen.has(row.id)) return { ok: false, msg: 'lines 中存在重复 id' }
    seen.add(row.id)
  }
  return { ok: true, lines: out }
}

/**
 * 用量树展平为可编辑行（含 id）
 * @param {any[]} nodes
 * @param {any[]} [out]
 */
export function flattenPiBomTreeForEdit(nodes, out = []) {
  for (const node of nodes ?? []) {
    if (node?.id != null && Number(node.id) > 0) {
      out.push({
        id: Number(node.id),
        kcaa01: String(node.kcaa01 ?? ''),
        kcac04: Number(node.kcac04 ?? 0),
        kcac05: Number(node.kcac05 ?? 0),
        Describe: String(node.Describe ?? ''),
        level: Number(node.level ?? 0),
        systemcode: String(node.systemcode ?? ''),
      })
    }
    const children = Array.isArray(node?.children) ? node.children : []
    if (children.length) flattenPiBomTreeForEdit(children, out)
  }
  return out
}

/**
 * @param {number[]} validIds
 * @param {{ id: number }[]} lines
 */
export function validatePiBomLineIdsBelongToProduct(validIds, lines) {
  const set = new Set(validIds.map((x) => Number(x)).filter((n) => n > 0))
  for (const row of lines) {
    if (!set.has(row.id)) {
      return `配件行 id=${row.id} 不属于当前款 PI BOM，请刷新后重试`
    }
  }
  return null
}

/**
 * @param {string} kcaa01
 */
export function normPiBomProductCode(kcaa01) {
  return normKcaa01(kcaa01)
}
