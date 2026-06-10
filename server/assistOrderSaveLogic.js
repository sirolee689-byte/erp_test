import crypto from 'node:crypto'

function text(v) {
  return String(v ?? '').trim()
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

function assistDateParts(saveDate) {
  const d = saveDate instanceof Date ? saveDate : new Date(String(saveDate ?? ''))
  if (Number.isNaN(d.getTime())) throw new Error('保存日期无效，无法生成外协订单号')
  const yy = pad2(d.getFullYear() % 100)
  const mm = pad2(d.getMonth() + 1)
  const dd = pad2(d.getDate())
  return `${yy}${mm}${dd}`
}

export function buildAssistOrderNoForDate(saveDate, seq) {
  const n = Number(seq)
  if (!Number.isInteger(n) || n <= 0) throw new Error('外协订单流水号无效')
  const tail = n < 100 ? pad2(n) : String(n)
  return `WX${assistDateParts(saveDate)}${tail}`
}

/** @param {string | Date} assistDate */
export function buildAssistOrderGuid(assistDate) {
  const stamp = assistDateParts(assistDate)
  return `WX-${stamp}${crypto.randomBytes(17).toString('hex').toUpperCase()}`
}

export function buildNextAssistOrderNo(opts) {
  const saveDate = opts?.saveDate ?? new Date()
  const prefix = `WX${assistDateParts(saveDate)}`
  let maxSeq = 0
  for (const raw of opts?.existingOrderNos ?? []) {
    const code = text(raw)
    if (!code.startsWith(prefix)) continue
    const n = Number(code.slice(prefix.length))
    if (Number.isInteger(n) && n > maxSeq) maxSeq = n
  }
  return buildAssistOrderNoForDate(saveDate, maxSeq + 1)
}

export function normalizeAssistOrderHeader(input) {
  const assistTypeRaw = text(input?.assistType ?? input?.wxaj03)
  const assistType = assistTypeRaw === '1' || assistTypeRaw === '2' ? assistTypeRaw : '0'
  const taxRaw = text(input?.taxIncluded ?? input?.wxaj06)
  const taxIncluded = taxRaw === '2' ? '2' : '1'
  const decimalRaw = Number(input?.decimalPlaces ?? input?.decimal ?? 4)
  const decimalPlaces = Math.min(6, Math.max(0, Number.isFinite(decimalRaw) ? Math.trunc(decimalRaw) : 4))

  return {
    assistOrderNo: text(input?.assistOrderNo ?? input?.wxaj01),
    assistDate: text(input?.assistDate ?? input?.wxaj02),
    assistType,
    referenceNo: text(input?.referenceNo ?? input?.wxaj04),
    supplierCode: text(input?.supplierCode ?? input?.wxaj05),
    taxIncluded,
    currencyCode: text(input?.currencyCode ?? input?.wxaj07),
    deliveryDate: text(input?.deliveryDate ?? input?.wxaj08),
    remark: text(input?.remark),
    notes: text(input?.notes),
    decimalPlaces,
  }
}

export function validateAssistOrderHeader(header) {
  const h = normalizeAssistOrderHeader(header)
  if (!h.assistDate || Number.isNaN(new Date(h.assistDate).getTime())) return '外协日期不能为空'
  if ((h.assistType === '1' || h.assistType === '2') && !h.referenceNo) return '关联单号不能为空'
  if (!h.supplierCode) return '外协商不能为空'
  if (!h.currencyCode) return '币别不能为空'
  if (h.deliveryDate) {
    const assist = new Date(h.assistDate)
    const delivery = new Date(h.deliveryDate)
    if (!Number.isNaN(delivery.getTime()) && delivery < assist) {
      return '交货日期不能早于外协日期'
    }
  }
  return null
}

/** @param {unknown} value */
export function formatAssistOrderDeliveryDate(value) {
  const raw = text(value)
  if (!raw) return null
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]} 00:00:00`
  const d = value instanceof Date ? value : new Date(raw)
  if (Number.isNaN(d.getTime())) return null
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} 00:00:00`
}

/** @param {unknown} referenceNo */
export function resolveAssistOrderPiValue(referenceNo) {
  const ref = text(referenceNo)
  return ref || null
}
