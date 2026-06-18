import crypto from 'node:crypto'

function text(v) {
  return String(v ?? '').trim()
}

function pad(n, width) {
  return String(n).padStart(width, '0')
}

function asDate(value) {
  const d = value instanceof Date ? value : new Date(String(value ?? ''))
  if (Number.isNaN(d.getTime())) throw new Error('采购日期无效')
  return d
}

function yearOf(value) {
  return String(asDate(value).getFullYear())
}

function tailNumber(code, prefix) {
  const raw = text(code)
  if (!raw.startsWith(prefix)) return 0
  const n = Number(raw.slice(prefix.length))
  return Number.isInteger(n) && n > 0 ? n : 0
}

export function resolveBuyOrderTypeOptions(numberType) {
  const raw = text(numberType)
  if (raw.toUpperCase() === 'ZY') return { defaultType: '1', allowedTypes: ['1', '2'] }
  if (raw.toUpperCase() === 'PO') return { defaultType: '2', allowedTypes: ['2'] }
  return { defaultType: '2', allowedTypes: ['0', '1', '2'] }
}

export function normalizeBuyOrderNumberType(numberType, saveDate = new Date()) {
  const raw = text(numberType)
  const upper = raw.toUpperCase()
  if (upper === 'ZY' || upper === 'PO') return upper
  return yearOf(saveDate)
}

export function buildNextBuyOrderNo(opts = {}) {
  const saveDate = opts.saveDate ?? new Date()
  const type = normalizeBuyOrderNumberType(opts.numberType, saveDate)
  const existing = opts.existingOrderNos ?? []
  const prefix = type === 'ZY' || type === 'PO' ? `${type}-` : yearOf(saveDate)
  let maxSeq = 0
  for (const code of existing) maxSeq = Math.max(maxSeq, tailNumber(code, prefix))
  const next = maxSeq + 1
  return type === 'ZY' || type === 'PO' ? `${prefix}${pad(next, 4)}` : `${prefix}${pad(next, 5)}`
}

export function buildBuyOrderGuid(buyDate = new Date()) {
  const d = asDate(buyDate)
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}`
  return `ZY-${stamp}${crypto.randomBytes(10).toString('hex').toUpperCase()}`
}

export function normalizeBuyOrderHeader(input = {}) {
  const buyTypeRaw = text(input.buyType ?? input.kcaj03)
  const buyType = buyTypeRaw === '0' || buyTypeRaw === '1' || buyTypeRaw === '2' ? buyTypeRaw : '1'
  const taxRaw = text(input.taxIncluded ?? input.kcaj06)
  const taxIncluded = taxRaw === '2' ? '2' : '1'
  const decimalRaw = Number(input.decimalPlaces ?? input.decimal ?? 4)
  const decimalPlaces = Math.min(6, Math.max(0, Number.isFinite(decimalRaw) ? Math.trunc(decimalRaw) : 4))
  return {
    buyOrderNo: text(input.buyOrderNo ?? input.kcaj01),
    buyDate: text(input.buyDate ?? input.kcaj02),
    buyType,
    referenceNo: text(input.referenceNo ?? input.kcaj04),
    supplierCode: text(input.supplierCode ?? input.kcaj05),
    taxIncluded,
    currencyCode: text(input.currencyCode ?? input.kcaj07),
    loadingPort: text(input.loadingPort ?? input.kcaj08),
    dischargePort: text(input.dischargePort ?? input.kcaj09),
    paymentTerms: text(input.paymentTerms ?? input.kcaj10),
    freight: input.freight ?? input.yf ?? null,
    remark: text(input.remark),
    decimalPlaces,
    numberType: text(input.numberType),
  }
}

export function validateBuyOrderHeader(header) {
  const h = normalizeBuyOrderHeader(header)
  if (!h.buyDate || Number.isNaN(new Date(h.buyDate).getTime())) return '采购日期不能为空'
  if ((h.buyType === '1' || h.buyType === '2') && !h.referenceNo) return '请选择或填写关联单号'
  if (!h.supplierCode) return '请选择供应商'
  if (!h.currencyCode) return '请选择币别'
  if (!h.taxIncluded) return '请选择是否含税'
  return null
}

function toNumber(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function round(value, places) {
  const n = toNumber(value)
  const m = 10 ** places
  return Math.round((n + Number.EPSILON) * m) / m
}

export function calculateBuyOrderAmount(opts = {}) {
  const qty = toNumber(opts.quantity)
  const taxIncludedPrice = round(opts.taxIncludedPrice, Number(opts.decimalPlaces ?? 4))
  const taxIncludedMode = text(opts.taxIncludedMode) === '2' ? '2' : '1'
  const tax = taxIncludedMode === '2' ? 0 : toNumber(opts.tax)
  if (tax < 0 || tax >= 1) throw new Error('税点必须大于等于0且小于1')
  const taxExcludedPrice = taxIncludedMode === '2'
    ? taxIncludedPrice
    : round(taxIncludedPrice / (1 + tax), Number(opts.decimalPlaces ?? 4))
  return {
    taxExcludedPrice,
    taxIncludedPrice,
    taxExcludedAmount: round(qty * taxExcludedPrice, 2),
    taxIncludedAmount: round(qty * taxIncludedPrice, 2),
    tax,
  }
}
