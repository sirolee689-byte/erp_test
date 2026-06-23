import crypto from 'node:crypto'

function text(v) {
  return String(v ?? '').trim()
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

function dateParts(value) {
  const d = value instanceof Date ? value : new Date(String(value ?? ''))
  if (Number.isNaN(d.getTime())) throw new Error('保存日期无效，无法生成入库单号')
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

export function buildStockInNoForDate(saveDate, seq) {
  const n = Number(seq)
  if (!Number.isInteger(n) || n <= 0) throw new Error('入库单流水号无效')
  return `R${dateParts(saveDate)}${n < 100 ? pad2(n) : String(n)}`
}

export function buildNextStockInNo(opts = {}) {
  const saveDate = opts.saveDate ?? new Date()
  const prefix = `R${dateParts(saveDate)}`
  let maxSeq = 0
  for (const raw of opts.existingReceiptNos ?? []) {
    const code = text(raw)
    if (!code.startsWith(prefix)) continue
    const n = Number(code.slice(prefix.length))
    if (Number.isInteger(n) && n > maxSeq) maxSeq = n
  }
  return buildStockInNoForDate(saveDate, maxSeq + 1)
}

export function buildStockInSystemCode(actor = {}, saveDate = new Date()) {
  const uid = text(actor.uid ?? actor.userId ?? actor.UserID)
  const rand = crypto.createHash('md5').update(`${Date.now()}-${Math.random()}`).digest('hex').toUpperCase()
  return `R-${dateParts(saveDate)}${rand}${uid}`
}

export function normalizeInboundType(v) {
  const s = text(v)
  if (/^[0-8]$/.test(s)) return s
  return '0'
}

export function isLinkedInboundType(type, sourceOrderNo = '') {
  const t = normalizeInboundType(type)
  if (t === '5' && !text(sourceOrderNo)) return false
  return ['1', '2', '3', '4', '5', '6'].includes(t)
}

/** 客供展示：物理列 Customer_supply（1=是，0/2=否） */
export function customerSupplyLabel(v) {
  const s = text(v)
  if (s === '1' || s.toLowerCase() === 'y' || s === '是') return '是'
  if (s === '2' || s === '0' || s.toLowerCase() === 'n' || s === '否') return '否'
  return ''
}

/** 入库明细保存：Customer_supply 为整型，兼容界面「是/否」与 0/1/2 */
export function normalizeCustomerSupplyInt(v) {
  const s = text(v)
  if (!s || s === '-') return null
  if (s === '是' || s.toLowerCase() === 'y') return 1
  if (s === '否' || s.toLowerCase() === 'n') return 2
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return Math.trunc(n)
}

export function normalizeStockInHeader(input = {}) {
  const inboundType = normalizeInboundType(input.inboundType ?? input.kcan03)
  return {
    systemCode: text(input.systemCode ?? input.systemcode),
    receiptNo: text(input.receiptNo ?? input.kcan01),
    inboundDate: text(input.inboundDate ?? input.kcan02),
    inboundType,
    sourceOrderNo: text(input.sourceOrderNo ?? input.kcan04),
    relatedPartyCode: text(input.relatedPartyCode ?? input.kcan05),
    relatedPartyName: text(input.relatedPartyName ?? input.kehu),
    warehouseCode: text(input.warehouseCode ?? input.kcan06),
    warehouseName: text(input.warehouseName ?? input.ck),
    handlerName: text(input.handlerName ?? input.kcan07),
    paperNo: text(input.paperNo ?? input.kcan08),
    inTax: text(input.inTax ?? input.in_tax) === '2' ? '2' : '1',
    remark: text(input.remark),
  }
}

export function calcStockInAmounts({ qty, priceExTax, priceInTax, tax }) {
  const q = numberValue(qty)
  const t = numberValue(tax)
  let ex = numberValue(priceExTax)
  let inc = numberValue(priceInTax)
  if (inc > 0 && ex <= 0) ex = t === 0 ? inc : inc / (1 + t)
  if (inc <= 0) inc = ex * (1 + t)
  return {
    kcao04: round(ex, 4),
    kcao041: round(inc, 4),
    kcao05: round(q * ex, 2),
    kcao051: round(q * inc, 2),
  }
}

export function normalizeStockInLine(line = {}, seq = 1, header = {}) {
  const qty = numberValue(line.kcao03 ?? line.qty)
  const tax = numberValue(line.tax ?? line.Tax)
  const amounts = calcStockInAmounts({
    qty,
    priceExTax: line.kcao04 ?? line.priceExTax,
    priceInTax: line.kcao041 ?? line.priceInTax,
    tax,
  })
  const sourceOrderNo = text(line.kcan04 ?? header.sourceOrderNo)
  return {
    ...line,
    kcao01: text(line.kcao01 ?? header.receiptNo),
    kcao02: text(line.kcao02 ?? line.sourceLineCode),
    kcan04: sourceOrderNo,
    kcao03: qty,
    kcao031: numberValue(line.kcao031 ?? qty),
    ...amounts,
    tax,
    reference: text(line.reference),
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
    type: text(line.type) || '1',
    Customer_supply: normalizeCustomerSupplyInt(line.Customer_supply),
  }
}

export function validateStockInPayload(payload = {}) {
  const header = normalizeStockInHeader(payload.header ?? payload)
  if (header.inboundType === '8') return '加工入库第一版只读，不允许新增或编辑'
  if (!header.warehouseCode) return '仓库不能为空'
  if (!header.inboundDate && payload.requireInboundDate) return '入库日期不能为空'
  // 外协退料（类型 3）来货单号 kcan08 允许为空
  if (!header.paperNo && header.inboundType !== '3') return '来货单号不能为空'
  if (['1', '2', '3', '6'].includes(header.inboundType) && !header.relatedPartyCode) return '关联方不能为空'
  if (header.inboundType === '4' && !header.relatedPartyCode) return '生产入库必须选择生产车间'
  if (['1', '2', '3', '6'].includes(header.inboundType) && !header.sourceOrderNo) return '关联单号不能为空'
  if (header.inboundType === '4' && !header.sourceOrderNo) return '生产入库必须选择派工单'

  const rawLines = payload.rawLines ?? payload.lines ?? []
  const lines = (payload.lines ?? []).map((line, idx) => normalizeStockInLine(line, idx + 1, header))
  if (!lines.length) return '入库单至少需要一条明细'
  const linked = isLinkedInboundType(header.inboundType, header.sourceOrderNo)
  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = rawLines[i] ?? {}
    const line = lines[i]
    if (!line.kcaa01) return `第 ${i + 1} 行材料编码不能为空`
    if (line.kcao03 <= 0) return `第 ${i + 1} 行入库数量必须大于 0`
    if (payload.isEdit && text(rawLine.tax ?? rawLine.Tax) === '') return `第 ${i + 1} 行税点不能为空，如无税点，则可以填写0。`
    if (header.inTax === '2' && line.tax > 0) return '不含税模式下税点只能为 0'
    if (linked && !line.kcao02) return `第 ${i + 1} 行明细必须来自关联单据`
    // 外协退料：kcao031=100000，只校验数量>0，不按可退数量卡上限
    if (linked && header.inboundType !== '3') {
      const overflowCap = numberValue(line.kcao031)
      const needQty = numberValue(line.availableQty ?? line.tempx ?? line.needQty)
      const maxAllowed = overflowCap > 0 ? overflowCap : needQty
      if (maxAllowed > 0 && line.kcao03 > maxAllowed) {
        return `第 ${i + 1} 行入库数量不能大于可入库上限 ${maxAllowed}`
      }
      if (maxAllowed <= 0 && line.kcao03 > 0 && overflowCap <= 0 && needQty <= 0) {
        return `第 ${i + 1} 行可入库数量已满，请检查采购单入库进度`
      }
    }
  }
  return null
}

