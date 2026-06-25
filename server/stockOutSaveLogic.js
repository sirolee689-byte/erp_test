import crypto from 'node:crypto'

function text(v) {
  return String(v ?? '').trim()
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

function dateParts(value) {
  const d = value instanceof Date ? value : new Date(String(value ?? ''))
  if (Number.isNaN(d.getTime())) throw new Error('保存日期无效，无法生成出库单号')
  return `${pad2(d.getFullYear() % 100)}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`
}

function numberValue(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function round(n, digits = 4) {
  const m = 10 ** digits
  return Math.round((Number(n) + Number.EPSILON) * m) / m
}

export function buildStockOutNoForDate(saveDate, seq) {
  const n = Number(seq)
  if (!Number.isInteger(n) || n <= 0) throw new Error('出库单流水号无效')
  return `C${dateParts(saveDate)}${n < 100 ? pad2(n) : String(n)}`
}

export function buildNextStockOutNo(opts = {}) {
  const saveDate = opts.saveDate ?? new Date()
  const prefix = `C${dateParts(saveDate)}`
  let maxSeq = 0
  for (const raw of opts.existingOutboundNos ?? []) {
    const code = text(raw)
    if (!code.startsWith(prefix)) continue
    const n = Number(code.slice(prefix.length))
    if (Number.isInteger(n) && n > maxSeq) maxSeq = n
  }
  return buildStockOutNoForDate(saveDate, maxSeq + 1)
}

export function buildStockOutSystemCode(actor = {}, saveDate = new Date()) {
  const uid = text(actor.uid ?? actor.userId ?? actor.UserID)
  const rand = crypto.createHash('md5').update(`${Date.now()}-${Math.random()}`).digest('hex').toUpperCase()
  return `C-${dateParts(saveDate)}${rand}${uid}`
}

export function normalizeOutboundType(v) {
  const s = text(v)
  if (/^(?:[0-9]|10)$/.test(s)) return s
  return ''
}

export function isLinkedOutboundType(type) {
  return ['1', '2', '3', '4', '5', '6'].includes(text(type))
}

export function normalizeStockOutHeader(input = {}) {
  const outboundType = normalizeOutboundType(input.outboundType ?? input.kcap03)
  const isAssistIssue = outboundType === '2'
  return {
    systemCode: text(input.systemCode ?? input.systemcode),
    outboundNo: text(input.outboundNo ?? input.kcap01),
    outboundDate: text(input.outboundDate ?? input.kcap02),
    outboundType,
    sourceOrderNo: text(input.sourceOrderNo ?? input.kcap04),
    relatedPartyCode: text(input.relatedPartyCode ?? input.kcap05),
    relatedPartyName: text(input.relatedPartyName ?? input.kehu),
    warehouseCode: text(input.warehouseCode ?? input.kcap06),
    warehouseName: text(input.warehouseName ?? input.ck),
    handlerName: text(input.handlerName ?? input.kcap07),
    // 外协领料：kcap08 存 PI；其他类型：纸质单号
    paperNo: isAssistIssue ? '' : text(input.paperNo ?? input.kcap08 ?? input.referenceNo),
    piNo: isAssistIssue ? text(input.piNo ?? input.kcap08 ?? input.referenceNo) : '',
    reserveNo: text(input.reserveNo ?? input.kcap09),
    postProcessAssist: Boolean(input.postProcessAssist ?? text(input.cj ?? input.workshopCode)),
    workshopCode: text(input.workshopCode ?? input.cj),
    workshopName: text(input.workshopName ?? input.cjname),
    inTax: text(input.inTax ?? input.in_tax) === '2' ? '2' : '1',
    remark: text(input.remark),
    pass: '0',
    del: '0',
    closed: '0',
  }
}

export function calcStockOutAmounts({ qty, priceExTax, priceInTax, tax }) {
  const q = numberValue(qty)
  const t = numberValue(tax)
  let ex = numberValue(priceExTax)
  let inc = numberValue(priceInTax)
  if (inc > 0 && ex <= 0) ex = t === 0 ? inc : inc / (1 + t)
  if (inc <= 0) inc = ex * (1 + t)
  return {
    kcaq04: round(ex, 4),
    kcaq041: round(inc, 4),
    kcaq05: round(q * ex, 2),
    kcaq051: round(q * inc, 2),
  }
}

export function normalizeStockOutLine(line = {}, seq = 1, header = {}) {
  const qty = numberValue(line.kcaq03 ?? line.qty)
  const tax = numberValue(line.tax ?? line.Tax)
  const amounts = calcStockOutAmounts({
    qty,
    priceExTax: line.kcaq04 ?? line.priceExTax,
    priceInTax: line.kcaq041 ?? line.priceInTax,
    tax,
  })
  return {
    ...line,
    kcaq01: text(line.kcaq01 ?? header.outboundNo),
    kcap04: text(line.kcap04 ?? header.sourceOrderNo),
    kcaq02: text(line.kcaq02 ?? line.sourceLineCode),
    kcaq03: qty,
    ...amounts,
    tax,
    reference: text(line.reference ?? line.Reference),
    Describe: text(line.Describe ?? line.info ?? line.remark),
    kcaa01: text(line.kcaa01),
    kcaa02: text(line.kcaa02),
    kcaa03: text(line.kcaa03),
    kcaa04: text(line.kcaa04),
    kcaa11: text(line.kcaa11),
    location: text(line.location),
    version: text(line.version),
    seq: Number.isInteger(Number(line.seq)) ? Number(line.seq) : seq,
    systemcode: text(line.systemcode) || crypto.randomUUID?.() || crypto.createHash('md5').update(`${Date.now()}-${Math.random()}`).digest('hex'),
    type: text(line.type) || text(header.outboundType),
  }
}

export function validateStockOutPayload(payload = {}) {
  const header = normalizeStockOutHeader(payload.header ?? payload)
  if (!header.outboundType) return '请先选择出库类型。'
  if (!text(payload.header?.inTax ?? payload.header?.in_tax ?? payload.inTax ?? payload.in_tax)) return '请先选择是否含税。'
  if (!header.warehouseCode) return '请先选择仓库。'
  if (['1', '2', '3', '6'].includes(header.outboundType) && !header.relatedPartyCode) return '关联方不能为空'
  if (['4', '5'].includes(header.outboundType) && !header.relatedPartyCode) return '生产车间不能为空'
  if (isLinkedOutboundType(header.outboundType) && !header.sourceOrderNo) return '关联单号不能为空'
  if (header.outboundType === '2' && header.postProcessAssist && !header.workshopCode) {
    return '加工后外协须选择本厂加工车间'
  }

  const rawLines = payload.rawLines ?? payload.lines ?? []
  const lines = (payload.lines ?? []).map((line, idx) => normalizeStockOutLine(line, idx + 1, header))
  if (!lines.length) return '出库单至少需要一条明细'
  const linked = isLinkedOutboundType(header.outboundType)
  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = rawLines[i] ?? {}
    const line = lines[i]
    if (!line.kcaa01) return `第 ${i + 1} 行材料编码不能为空`
    if (line.kcaq03 <= 0) return `第 ${i + 1} 行出库数量必须大于 0`
    if (payload.isEdit && text(rawLine.tax ?? rawLine.Tax) === '') return `第 ${i + 1} 行税点不能为空，如无税点，则可以填写0。`
    if (header.inTax === '2' && line.tax > 0) return '不含税模式下税点只能为 0'
    if (linked && !line.kcaq02) return `第 ${i + 1} 行明细必须来自关联单据`
    const availableQty = numberValue(line.availableQty)
    const sourceAvailableQty = numberValue(line.sourceAvailableQty)
    const cap = linked ? Math.min(availableQty || Infinity, sourceAvailableQty || Infinity) : availableQty
    if (Number.isFinite(cap) && cap > 0 && line.kcaq03 > cap) return `第 ${i + 1} 行出库数量不能大于可出库数量 ${cap}`
  }
  return null
}
