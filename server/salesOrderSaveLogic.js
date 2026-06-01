/**
 * 销售订单保存：纯函数（合并明细、PI BOM 对齐计划、系统单号、未运算判定）
 */

/** @param {unknown} v */
export function normKcaa01(v) {
  return String(v ?? '').trim()
}

/**
 * @param {{ kcaa01?: unknown, orderQty?: unknown, unitPrice?: unknown, remark?: unknown }[]} lines
 * @returns {{ kcaa01: string, orderQty: number, unitPrice: number, remark: string }[]}
 */
export function mergeSalesOrderLinesByKcaa01(lines) {
  /** @type {Map<string, { kcaa01: string, orderQty: number, unitPrice: number, remark: string }>} */
  const map = new Map()
  for (const row of lines ?? []) {
    const code = normKcaa01(row?.kcaa01)
    if (!code) continue
    const qty = Number(row?.orderQty)
    const add = Number.isFinite(qty) && qty > 0 ? qty : 0
    const unitPrice = Number(row?.unitPrice)
    const normalizedUnitPrice = Number.isFinite(unitPrice) ? unitPrice : 0
    const remark = String(row?.remark ?? '').trim()
    const current = map.get(code)
    if (!current) {
      map.set(code, { kcaa01: code, orderQty: add, unitPrice: normalizedUnitPrice, remark })
      continue
    }
    current.orderQty += add
    current.unitPrice = normalizedUnitPrice
    if (remark) current.remark = remark
  }
  return [...map.values()]
}

/**
 * @param {{ detailKcaa01: string[], existingPiBomKcaa01: string[] }} opts
 */
export function planPiBomAlign(opts) {
  const detail = new Set((opts?.detailKcaa01 ?? []).map(normKcaa01).filter(Boolean))
  const existing = new Set((opts?.existingPiBomKcaa01 ?? []).map(normKcaa01).filter(Boolean))
  /** @type {string[]} */
  const toDelete = []
  /** @type {string[]} */
  const toCreate = []
  /** @type {string[]} */
  const toKeep = []
  for (const code of existing) {
    if (detail.has(code)) toKeep.push(code)
    else toDelete.push(code)
  }
  for (const code of detail) {
    if (!existing.has(code)) toCreate.push(code)
  }
  return { toDelete, toCreate, toKeep }
}

/**
 * @param {{ kcaa01?: unknown, orderQty?: unknown }[]} oldLines
 * @param {{ kcaa01?: unknown, orderQty?: unknown }[]} newLines
 */
export function shouldMarkSalesOrderUncalculated(oldLines, newLines) {
  const oldMap = new Map()
  for (const row of mergeSalesOrderLinesByKcaa01(oldLines ?? [])) {
    oldMap.set(row.kcaa01, row.orderQty)
  }
  const newMerged = mergeSalesOrderLinesByKcaa01(newLines ?? [])
  if (oldMap.size !== newMerged.length) return true
  for (const row of newMerged) {
    if (!oldMap.has(row.kcaa01)) return true
    if (Number(oldMap.get(row.kcaa01)) !== Number(row.orderQty)) return true
  }
  return false
}

/** @param {Date} d */
function ymdCompact(d) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
}

/**
 * @param {{ salesDate: Date | string, existingCodes?: string[] }} opts
 */
export function buildNextSalesOrderSystemCode(opts) {
  const raw = opts?.salesDate
  const d = raw instanceof Date ? raw : new Date(String(raw ?? ''))
  if (Number.isNaN(d.getTime())) {
    throw new Error('销售日期无效，无法生成系统单号')
  }
  const prefix = `PI-${ymdCompact(d)}-`
  let maxSeq = 0
  for (const code of opts?.existingCodes ?? []) {
    const s = String(code ?? '').trim()
    if (!s.startsWith(prefix)) continue
    const tail = s.slice(prefix.length)
    const n = Number(tail)
    if (Number.isFinite(n) && n > maxSeq) maxSeq = n
  }
  const next = maxSeq + 1
  if (next > 999) {
    throw new Error('当日系统单号已满 999，无法生成')
  }
  return `${prefix}${String(next).padStart(3, '0')}`
}

/**
 * @param {{
 *   piNo?: unknown,
 *   salesDate?: unknown,
 *   deliveryDate?: unknown,
 *   customerCode?: unknown,
 *   currencyCode?: unknown,
 *   lines?: { kcaa01?: unknown, orderQty?: unknown }[],
 * }} payload
 * @returns {string | null} 错误文案；通过返回 null
 */
export function validateSalesOrderSavePayload(payload) {
  const piNo = normKcaa01(payload?.piNo)
  if (!piNo) return 'PI 号不能为空'
  const salesDate = payload?.salesDate
  if (!salesDate || Number.isNaN(new Date(String(salesDate)).getTime())) {
    return '销售日期不能为空'
  }
  const delivery = payload?.deliveryDate
  if (delivery != null && String(delivery).trim() !== '') {
    const sd = new Date(String(salesDate))
    const dd = new Date(String(delivery))
    if (!Number.isNaN(dd.getTime()) && dd < sd) {
      return '交货日期不能早于销售日期'
    }
  }
  if (!normKcaa01(payload?.customerCode)) return '客户代码不能为空'
  if (!normKcaa01(payload?.currencyCode)) return '币别不能为空'
  const lines = Array.isArray(payload?.lines) ? payload.lines : []
  const merged = mergeSalesOrderLinesByKcaa01(lines)
  // 明细可为空；仅有占位行但无有效货品编码时仍拒绝
  if (lines.length > 0 && !merged.length) return '明细货品编码不能为空'
  for (const row of merged) {
    if (!row.kcaa01) return '明细货品编码不能为空'
    if (!(Number(row.orderQty) > 0)) return `货品 ${row.kcaa01} 订货数量须大于 0`
  }
  return null
}
