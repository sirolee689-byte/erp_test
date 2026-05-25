/**
 * 销售订单列表/详情展示辅助（纯函数，便于单测）
 */

/** @param {{ pass?: unknown }} row */
export function passIsAudited(row) {
  return String(row?.pass ?? '').trim() === '1'
}

/**
 * @param {{
 *   page: number,
 *   pageSize: number,
 *   filters: {
 *     piNo?: string,
 *     systemCode?: string,
 *     customer?: string,
 *     salesDateFrom?: string,
 *     salesDateTo?: string,
 *     showRecycle?: boolean,
 *   },
 * }} opts
 */
export function buildSalesOrderListQueryParams(opts) {
  const f = opts?.filters ?? {}
  return {
    page: opts.page,
    pageSize: opts.pageSize,
    recycled: f.showRecycle ? 1 : 0,
    piNo: String(f.piNo ?? '').trim() || undefined,
    systemCode: String(f.systemCode ?? '').trim() || undefined,
    customer: String(f.customer ?? '').trim() || undefined,
    salesDateFrom: String(f.salesDateFrom ?? '').trim() || undefined,
    salesDateTo: String(f.salesDateTo ?? '').trim() || undefined,
  }
}

/** @param {unknown} v */
export function formatSalesOrderDate(v) {
  const s = String(v ?? '').trim()
  if (!s) return '—'
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/)
  if (m) return m[1]
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const da = String(d.getDate()).padStart(2, '0')
  return `${y}-${mo}-${da}`
}

/** @param {unknown} v */
export function formatOrderQty(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return n
}

/** @param {unknown} v */
export function formatCell(v) {
  if (v === null || v === undefined || v === '') return '—'
  return String(v)
}
