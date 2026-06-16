import crypto from 'node:crypto'

function text(v) {
  return String(v ?? '').trim()
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

function dateParts(value) {
  const d = value instanceof Date ? value : new Date(String(value ?? ''))
  if (Number.isNaN(d.getTime())) throw new Error('派工日期无效，无法生成派工单号')
  return `${pad2(d.getFullYear() % 100)}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`
}

export function buildDispatchOrderNoForDate(dispatchDate, seq) {
  const n = Number(seq)
  if (!Number.isInteger(n) || n <= 0) throw new Error('派工单流水号无效')
  return `PG${dateParts(dispatchDate)}${n < 100 ? pad2(n) : String(n)}`
}

export function buildDispatchSystemCode(dispatchDate) {
  return `PG-${dateParts(dispatchDate)}${crypto.createHash('md5').update(`${Date.now()}-${Math.random()}`).digest('hex').slice(0, 8).toUpperCase()}`
}

export function buildNextDispatchOrderNo(opts) {
  const dispatchDate = opts?.dispatchDate ?? new Date()
  const prefix = `PG${dateParts(dispatchDate)}`
  let maxSeq = 0
  for (const raw of opts?.existingOrderNos ?? []) {
    const code = text(raw)
    if (!code.startsWith(prefix)) continue
    const n = Number(code.slice(prefix.length))
    if (Number.isInteger(n) && n > maxSeq) maxSeq = n
  }
  return buildDispatchOrderNoForDate(dispatchDate, maxSeq + 1)
}

export function normalizeDispatchOrderHeader(input) {
  const typeRaw = text(input?.dispatchType ?? input?.scaj03)
  const dispatchType = typeRaw === '1' || typeRaw === '2' ? typeRaw : '0'
  const supplierCode = text(input?.supplierCode ?? input?.kid)
  const referenceNo =
    dispatchType === '2'
      ? text(supplierCode || input?.referenceNo || input?.scaj04)
      : text(input?.referenceNo ?? input?.piNo ?? input?.scaj04)
  return {
    dispatchOrderNo: text(input?.dispatchOrderNo ?? input?.scaj01),
    dispatchDate: text(input?.dispatchDate ?? input?.scaj02),
    dispatchType,
    referenceNo,
    workshopCode: text(input?.workshopCode ?? input?.scaj05),
    workshopName: text(input?.workshopName ?? input?.cj),
    deliveryDate: text(input?.deliveryDate ?? input?.scaj06),
    remark: text(input?.remark),
    supplierCode: dispatchType === '2' ? referenceNo : '',
  }
}

function numberValue(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export function normalizeDispatchOrderLine(line, seq = 1) {
  const out = { ...line }
  out.scak03 = numberValue(line?.scak03 ?? line?.dispatchQty)
  out.scak04 = numberValue(line?.scak04 ?? line?.dispatchedQty)
  out.scak05 = numberValue(line?.scak05 ?? line?.repairQty)
  out.kcaa01 = text(line?.kcaa01)
  out.kcaa02 = text(line?.kcaa02)
  out.kcaa03 = text(line?.kcaa03)
  out.kcaa04 = text(line?.kcaa04)
  out.pi = text(line?.pi)
  out.seq = Number.isInteger(Number(line?.seq)) ? Number(line.seq) : seq
  return out
}

export function validateDispatchOrderPayload(payload) {
  const header = normalizeDispatchOrderHeader(payload?.header ?? {})
  if (!header.dispatchDate || Number.isNaN(new Date(header.dispatchDate).getTime())) return '派工日期不能为空'
  if (!header.dispatchType) return '派工类型不能为空'
  if (!header.workshopCode) return '生产车间不能为空'
  if (!header.referenceNo) return header.dispatchType === '2' ? '委外供应商不能为空' : '关联 PI 不能为空'
  const lines = (payload?.lines ?? []).map((line, idx) => normalizeDispatchOrderLine(line, idx + 1))
  if (!lines.length) return '派工单至少需要一条明细'
  const seenCodes = new Set()
  const seenPis = new Set()
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (!line.kcaa01) return `第 ${i + 1} 行货品编码不能为空`
    if (line.scak03 <= 0) return `第 ${i + 1} 行本次派工数量必须大于 0`
    if (seenCodes.has(line.kcaa01)) return `同一张派工单不能重复选择货品 ${line.kcaa01}`
    seenCodes.add(line.kcaa01)
    if (!line.pi) return `第 ${i + 1} 行 PI 不能为空`
    seenPis.add(line.pi)
  }
  if (seenPis.size > 1) return '一张派工单只能关联一个 PI'
  return null
}

export function validateDispatchOrderQuantities({ lines, availabilityByKey }) {
  for (const rawLine of lines ?? []) {
    const line = normalizeDispatchOrderLine(rawLine)
    const key = `${line.pi}\u0000${line.kcaa01}`
    const row = availabilityByKey?.get?.(key)
    if (!row) return `${line.kcaa02 || line.kcaa01} 无法计算可派工数量`
    const available = numberValue(row.availableQty)
    if (line.scak03 > available) {
      return `${line.kcaa02 || line.kcaa01} 本次派工数量 ${line.scak03} 超过可派工数量 ${available}`
    }
  }
  return null
}
