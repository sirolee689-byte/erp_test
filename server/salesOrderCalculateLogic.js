/**
 * 销售订单一键运算：纯函数（运算范围、入参校验）
 */
import { normKcaa01 } from './salesOrderSaveLogic.js'

/**
 * @param {unknown} raw
 */
export function isSalesOrderCalculated(raw) {
  return String(raw ?? '').trim() === '1'
}

/**
 * @param {unknown} syncedRaw
 * @returns {{ ok: true, list: string[] } | { ok: false, msg: string }}
 */
export function parseSyncedKcaa01List(syncedRaw) {
  if (syncedRaw == null) return { ok: true, list: [] }
  if (!Array.isArray(syncedRaw)) return { ok: false, msg: '参数错误：syncedKcaa01 须为数组' }
  const list = []
  const seen = new Set()
  for (const item of syncedRaw) {
    const code = normKcaa01(item)
    if (!code) continue
    if (seen.has(code)) continue
    seen.add(code)
    list.push(code)
  }
  return { ok: true, list }
}

/**
 * 运算范围：默认未运算整单；若库中仍有上次 pi_cost 且 body 带 syncedKcaa01 → 仅重算同步款
 * （同步 BOM 后主表会标未运算，但旧物料单行保留直至运算覆盖）
 * @param {{
 *   calcFlag: string,
 *   orderLineCodes: string[],
 *   syncedKcaa01: string[],
 *   hasExistingPiCost?: boolean,
 * }} opts
 * @returns {{ ok: true, mode: 'full' | 'partial', products: string[] } | { ok: false, msg: string }}
 */
export function resolveMaterialBillCalculateScope(opts) {
  const lines = [...new Set((opts.orderLineCodes ?? []).map(normKcaa01).filter(Boolean))]
  if (!lines.length) return { ok: false, msg: '订单无明细，无法运算' }

  const synced = [...new Set((opts.syncedKcaa01 ?? []).map(normKcaa01).filter(Boolean))]
  const hasExisting = Boolean(opts.hasExistingPiCost)

  if (synced.length > 0 && hasExisting) {
    const missing = synced.filter((c) => !lines.includes(c))
    if (missing.length) {
      return { ok: false, msg: `货品 ${missing.join('、')} 不在当前订单明细中` }
    }
    return { ok: true, mode: 'partial', products: synced }
  }

  return { ok: true, mode: 'full', products: lines }
}

/**
 * 订单是否允许运算（在册；已审未审均可运算）
 * @param {{ pass?: string, del?: string }} header
 */
export function validateCalculateOrderState(header) {
  if (!header) return '记录不存在'
  if (String(header.del ?? '').trim() === '1') return '回收站中的订单不可运算'
  return null
}
