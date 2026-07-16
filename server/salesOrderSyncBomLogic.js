/**
 * 销售订单按行同步 BOM：纯校验
 */
import { normKcaa01 } from './salesOrderSaveLogic.js'

/**
 * @param {unknown} kcaa01
 */
export function parseSyncBomKcaa01(kcaa01) {
  const code = normKcaa01(kcaa01)
  if (!code) return { ok: false, msg: '请指定要同步的货品编码' }
  return { ok: true, kcaa01: code }
}

/**
 * 批量同步：去空、去重（保留首次出现顺序）
 * @param {unknown} input
 * @returns {{ ok: true, list: string[] } | { ok: false, msg: string }}
 */
export function parseSyncBomKcaa01List(input) {
  if (!Array.isArray(input)) return { ok: false, msg: '请指定要同步的货品编码列表' }
  /** @type {string[]} */
  const list = []
  const seen = new Set()
  for (const raw of input) {
    const code = normKcaa01(raw)
    if (!code) continue
    const key = code.toLocaleLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    list.push(code)
  }
  if (!list.length) return { ok: false, msg: '请指定要同步的货品编码' }
  return { ok: true, list }
}

/**
 * @param {{ pass?: string, del?: string }} header
 */
export function validateSyncBomOrderState(header) {
  if (!header) return '记录不存在'
  if (String(header.del ?? '').trim() === '1') return '回收站订单不可同步 BOM'
  if (String(header.pass ?? '').trim() === '1') return '已审核订单不可同步 BOM，请先反审'
  return null
}

/**
 * @param {string} kcaa01
 * @param {Iterable<string>} lineKcaa01Set
 */
export function validateSyncBomLineOnOrder(kcaa01, lineKcaa01Set) {
  const code = normKcaa01(kcaa01)
  const set = new Set([...lineKcaa01Set].map((x) => normKcaa01(x)).filter(Boolean))
  if (!set.has(code)) return `货品「${code}」不在当前订单明细中`
  return null
}
