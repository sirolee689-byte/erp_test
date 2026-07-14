/** 采购报价 Excel 导入的纯前端校验：不依赖页面或 ExcelJS，便于覆盖业务边界。 */
function text(value) { return String(value ?? '').trim() }
function codeKey(value) { return text(value).toLocaleLowerCase() }

function isBlank(value) { return value === undefined || value === null || text(value) === '' }

function numberValue(value) {
  if (typeof value === 'number') return value
  const source = text(value)
  return source === '' ? Number.NaN : Number(source)
}

/**
 * @param {{ rowNo: number, serial: unknown, code: unknown, tax: unknown, inclusivePrice: unknown }[]} rows
 * @param {Set<string>} existingCodes 已转小写的当前页面物料编码
 */
export function validatePurchaseQuoteExcelRows(rows, existingCodes = new Set()) {
  const source = Array.isArray(rows) ? rows : []
  const codeCount = new Map()
  for (const row of source) {
    const key = codeKey(row?.code)
    if (key) codeCount.set(key, (codeCount.get(key) ?? 0) + 1)
  }

  const valid = []
  const failed = []
  for (const row of source) {
    const code = text(row?.code)
    const key = codeKey(code)
    const reasons = []
    const taxBlank = isBlank(row?.tax)
    const priceBlank = isBlank(row?.inclusivePrice)
    const tax = numberValue(row?.tax)
    const inclusivePrice = numberValue(row?.inclusivePrice)
    if (!code) reasons.push('编码为空')
    else if ((codeCount.get(key) ?? 0) > 1) reasons.push('Excel 内编码重复')
    else if (existingCodes.has(key)) reasons.push('当前报价明细已存在该编码')
    if (taxBlank) reasons.push('税点为空')
    else if (!Number.isFinite(tax)) reasons.push('税点不是有效数字')
    else if (tax < 0 || tax >= 1) reasons.push('税点必须为 0 到 1 之间的小数，例如 0.03')
    if (priceBlank) reasons.push('含税价为空')
    else if (!Number.isFinite(inclusivePrice)) reasons.push('含税价不是有效数字')
    else if (inclusivePrice < 0) reasons.push('含税价不能小于 0')

    const normalized = {
      rowNo: Number(row?.rowNo) || 0,
      serial: row?.serial,
      code,
      tax,
      inclusivePrice,
    }
    if (reasons.length) failed.push({ ...normalized, reason: reasons.join('；') })
    else valid.push(normalized)
  }
  valid.sort((a, b) => {
    const aOrder = text(a.serial) === '' ? Number.NaN : Number(a.serial)
    const bOrder = text(b.serial) === '' ? Number.NaN : Number(b.serial)
    const aKey = Number.isFinite(aOrder) ? aOrder : a.rowNo
    const bKey = Number.isFinite(bOrder) ? bOrder : b.rowNo
    return aKey - bKey || a.rowNo - b.rowNo
  })
  return { valid, failed }
}

export function groupPurchaseQuoteExcelResultsByCode(list) {
  const map = new Map()
  for (const item of Array.isArray(list) ? list : []) map.set(codeKey(item?.code), item)
  return map
}

export function normalizePurchaseQuoteExcelCell(value) {
  if (value && typeof value === 'object' && 'result' in value) return value.result ?? ''
  if (value && typeof value === 'object' && 'text' in value) return value.text ?? ''
  return value ?? ''
}
