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
