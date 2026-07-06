import { sql } from './db.js'
import { fetchSystemPrintLogoConfig } from './systemPrintLogo.js'

const HEADER_FROM = 'dbo.[UB_ERP_Buy_order]'
const LINE_FROM = 'dbo.[UB_ERP_Buy_order_list]'
const FEE_FROM = 'dbo.[UB_ERP_Buy_order_money]'
const SUPPLIER_FROM = 'dbo.[UB_ERP_System_supplier]'
const COLOR_FROM = 'dbo.[UB_ERP_Stocks_colorcode]'

function text(value) {
  return String(value ?? '').trim()
}

function number(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function serializeValue(value) {
  return value instanceof Date ? value.toISOString() : value
}

function serializeRow(row = {}) {
  const out = {}
  for (const [key, value] of Object.entries(row ?? {})) out[key] = serializeValue(value)
  return out
}

function dateText(value) {
  if (!value) return ''
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return text(value).slice(0, 10)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function priceValue(value, decimals = 4) {
  return Number(number(value).toFixed(decimals))
}

function moneyValue(value) {
  return Number(number(value).toFixed(2))
}

function lineTaxValue(line = {}) {
  return line.tax ?? line.Tax
}

function colorText(line = {}) {
  const code = text(line.kcaa11)
  const name = text(line.colorName)
  if (code && name) return `(${code}) ${name}`
  return code || name
}

function materialName(line = {}, language = '1') {
  if (language === '2') return text(line.kcaa02_en) || text(line.kcaa02)
  return text(line.kcaa02)
}

export function parseBuyOrderPrintNos(value) {
  return String(value ?? '')
    .split(',')
    .map((item) => text(item))
    .filter(Boolean)
}

export function normalizeBuyOrderPrintMode(value) {
  return text(value) === '2' ? '2' : '1'
}

export function normalizeBuyOrderPrintLanguage(value) {
  return text(value) === '2' ? '2' : '1'
}

export function buildBuyOrderPrintDetailLinesSql() {
  return `
    SELECT
      l.*,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.[name], N'')))) AS colorName
    FROM ${LINE_FROM} AS l
    LEFT JOIN ${COLOR_FROM} AS c
      ON LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(c.[code], N'')))) =
         LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(l.[kcaa11], N''))))
     AND (ISNULL(c.[del], N'') = N'' OR c.[del] = N'0')
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcak01], N'')))) = @orderNo
      AND (ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')
    ORDER BY ISNULL(l.[seq], l.[id]), l.[id]
  `
}

export function buildBuyOrderPrintFeesSql() {
  return `
    SELECT *
    FROM ${FEE_FROM}
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([buy_code], N'')))) = @orderNo
    ORDER BY ISNULL([kid], [id]), [id]
  `
}

export function normalizeBuyOrderPrintLine(row = {}, index = 0, { hasPricePermission = true, language = '1' } = {}) {
  const line = serializeRow(row)
  const qty = moneyValue(line.kcak03)
  const out = {
    ...line,
    seq: index + 1,
    materialCode: text(line.kcaa01),
    materialName: materialName(line, language),
    materialNameCn: text(line.kcaa02),
    materialNameEn: text(line.kcaa02_en),
    spec: text(line.kcaa03),
    colorText: colorText(line),
    unit: text(line.kcaa25) || text(line.kcaa04),
    quantity: qty,
    quantityText: qty.toFixed(2),
    deliveryDateText: dateText(line.delivery_date),
    remarkText: text(line.info),
    referenceText: text(line.Reference),
    orderNoText: text(line.OrderNo),
  }
  if (hasPricePermission) {
    out.taxExcludedPrice = priceValue(line.kcak04, 4)
    out.taxIncludedPrice = priceValue(line.kcak041, 4)
    out.taxExcludedAmount = moneyValue(line.kcak05)
    out.taxIncludedAmount = moneyValue(line.kcak051)
    out.tax = priceValue(lineTaxValue(line), 4)
  }
  return out
}

function normalizeBuyOrderPrintFee(row = {}, index = 0, { hasPricePermission = true } = {}) {
  const fee = serializeRow(row)
  const out = {
    ...fee,
    seq: index + 1,
    feeCode: text(fee.kcaa01),
    feeName: text(fee.kcaa02 || fee.mtitle),
    spec: text(fee.kcaa03),
    remarkText: text(fee.remark),
  }
  if (hasPricePermission) {
    out.money = moneyValue(fee.money)
    out.tax = priceValue(lineTaxValue(fee), 4)
  }
  return out
}

function buildTotals(lines = [], fees = [], hasPricePermission = true) {
  const totalQty = lines.reduce((sum, line) => sum + number(line.quantity), 0)
  const totals = {
    quantity: moneyValue(totalQty),
    quantityText: moneyValue(totalQty).toFixed(2),
  }
  if (hasPricePermission) {
    const taxExcludedAmount = lines.reduce((sum, line) => sum + number(line.taxExcludedAmount), 0)
    const taxIncludedAmount = lines.reduce((sum, line) => sum + number(line.taxIncludedAmount), 0)
    const feeAmount = fees.reduce((sum, fee) => sum + number(fee.money), 0)
    totals.taxExcludedAmount = moneyValue(taxExcludedAmount)
    totals.taxIncludedAmount = moneyValue(taxIncludedAmount + feeAmount)
    totals.taxExcludedAmountText = totals.taxExcludedAmount.toFixed(2)
    totals.taxIncludedAmountText = totals.taxIncludedAmount.toFixed(2)
  }
  return totals
}

function supplierKey(header = {}) {
  return text(header.supplierCode) || text(header.supplierName)
}

function buildDetailDocument({ header, lines, fees, printMode, language, index, total, hasPricePermission, makerName }) {
  const normalizedLines = (Array.isArray(lines) ? lines : []).map((line, i) =>
    normalizeBuyOrderPrintLine(line, i, { hasPricePermission, language }))
  const normalizedFees = (Array.isArray(fees) ? fees : []).map((fee, i) =>
    normalizeBuyOrderPrintFee(fee, i, { hasPricePermission }))
  return {
    documentType: 'detail',
    header: serializeRow(header),
    lines: normalizedLines,
    fees: normalizedFees,
    printMode,
    language,
    hasPricePermission,
    pageIndex: index,
    pageTotal: total,
    totals: buildTotals(normalizedLines, normalizedFees, hasPricePermission),
    makerName: text(makerName),
  }
}

function summaryLineKey(line = {}) {
  return [
    text(line.kcaa01),
    text(line.kcaa02),
    text(line.kcaa02_en),
    text(line.kcaa03),
    text(line.kcaa25) || text(line.kcaa04),
    priceValue(line.kcak04, 4).toFixed(4),
    priceValue(line.kcak041, 4).toFixed(4),
    priceValue(lineTaxValue(line), 4).toFixed(4),
    dateText(line.delivery_date),
  ].join('\u001f')
}

function mergeSummaryLines(docs = [], { hasPricePermission = true, language = '1' } = {}) {
  const map = new Map()
  for (const doc of docs) {
    for (const raw of doc.rawLines ?? []) {
      const key = summaryLineKey(raw)
      if (!map.has(key)) {
        map.set(key, { ...serializeRow(raw), kcak03: 0, kcak05: 0, kcak051: 0, orderNos: [] })
      }
      const item = map.get(key)
      item.kcak03 += number(raw.kcak03)
      item.kcak05 += number(raw.kcak05)
      item.kcak051 += number(raw.kcak051)
      const orderNo = text(raw.kcak01)
      if (orderNo && !item.orderNos.includes(orderNo)) item.orderNos.push(orderNo)
    }
  }
  return Array.from(map.values()).map((line, i) =>
    normalizeBuyOrderPrintLine(line, i, { hasPricePermission, language }))
}

function mergeSummaryFees(docs = [], { hasPricePermission = true } = {}) {
  const map = new Map()
  for (const doc of docs) {
    for (const raw of doc.rawFees ?? []) {
      const key = [text(raw.kcaa01), text(raw.kcaa02 || raw.mtitle), text(raw.kcaa03), priceValue(lineTaxValue(raw), 4).toFixed(4)].join('\u001f')
      if (!map.has(key)) map.set(key, { ...serializeRow(raw), money: 0 })
      map.get(key).money += number(raw.money)
    }
  }
  return Array.from(map.values()).map((fee, i) => normalizeBuyOrderPrintFee(fee, i, { hasPricePermission }))
}

function buildSummaryDocument({ docs, printMode, language, hasPricePermission, makerName }) {
  const first = docs[0]?.header ?? {}
  const orderNos = docs.map((doc) => text(doc.header?.buyOrderNo)).filter(Boolean)
  const referenceNos = docs.map((doc) => text(doc.header?.referenceNo)).filter(Boolean)
  const header = {
    ...first,
    buyOrderNo: orderNos.join(','),
    sourceOrderNos: orderNos,
    referenceNo: referenceNos.join(','),
    summaryTitle: '多张采购单汇总',
  }
  const lines = mergeSummaryLines(docs, { hasPricePermission, language })
  const fees = mergeSummaryFees(docs, { hasPricePermission })
  return {
    documentType: 'summary',
    header,
    lines,
    fees,
    printMode,
    language,
    hasPricePermission,
    pageIndex: 1,
    pageTotal: 1,
    totals: buildTotals(lines, fees, hasPricePermission),
    makerName: text(makerName),
  }
}

async function fetchOneBuyOrderPrintDocument(pool, orderNo, opts = {}) {
  const headerR = await pool.request().input('orderNo', sql.NVarChar(200), orderNo).query(`
    SELECT TOP 1
      h.[id],
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcaj01], N'')))) AS buyOrderNo,
      h.[kcaj02] AS buyDate,
      LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(h.[kcaj03], N'')))) AS buyType,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[kcaj04], N'')))) AS referenceNo,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcaj05], N'')))) AS supplierCode,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[kehu], N'')))) AS supplierName,
      LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(h.[kcaj06], N'')))) AS taxIncluded,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(h.[kcaj07], N'')))) AS currencyCode,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[rmb], N'')))) AS currencyName,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[kcaj10], N'')))) AS paymentTerms,
      LTRIM(RTRIM(CONVERT(nvarchar(1000), ISNULL(h.[remark], N'')))) AS remark,
      LTRIM(RTRIM(ISNULL(h.[pass], N''))) AS pass,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(s.[s_sname], N'')))) AS supplierShortName,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(s.[s_payfor], N'')))) AS supplierPayFor,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(s.[s_address], N'')))) AS supplierAddress,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(s.[s_lxr], N'')))) AS supplierContact,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(s.[s_tel], N'')))) AS supplierTel
    FROM ${HEADER_FROM} AS h
    LEFT JOIN ${SUPPLIER_FROM} AS s
      ON LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(s.[s_code], N'')))) =
         LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcaj05], N''))))
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcaj01], N'')))) = @orderNo
      AND (ISNULL(h.[del], N'') = N'' OR h.[del] = N'0')
  `)
  const header = headerR.recordset?.[0]
  if (!header) return null

  const linesR = await pool.request().input('orderNo', sql.NVarChar(200), orderNo).query(buildBuyOrderPrintDetailLinesSql())
  const feesR = await pool.request().input('orderNo', sql.NVarChar(200), orderNo).query(buildBuyOrderPrintFeesSql())
  return {
    header: serializeRow(header),
    rawLines: linesR.recordset ?? [],
    rawFees: feesR.recordset ?? [],
    doc: buildDetailDocument({
      header,
      lines: linesR.recordset ?? [],
      fees: feesR.recordset ?? [],
      ...opts,
    }),
  }
}

export async function fetchBuyOrderPrintDocuments(pool, {
  pSum,
  printMode = '1',
  language = '1',
  actor = {},
  hasPricePermission = true,
} = {}) {
  const orderNos = parseBuyOrderPrintNos(pSum)
  if (!orderNos.length) return { ok: false, status: 400, code: 'EMPTY_P_SUM', msg: '请选择需要打印的单据' }

  const mode = normalizeBuyOrderPrintMode(printMode)
  const lang = normalizeBuyOrderPrintLanguage(language)
  const printConfig = await fetchSystemPrintLogoConfig(pool)
  const makerName = actor?.truename
  const docs = []
  for (let i = 0; i < orderNos.length; i += 1) {
    const found = await fetchOneBuyOrderPrintDocument(pool, orderNos[i], {
      printMode: mode,
      language: lang,
      index: i + 1,
      total: orderNos.length,
      hasPricePermission,
      makerName,
    })
    if (!found) return { ok: false, status: 404, code: 'MISSING_DOCUMENT', msg: `其中第【${i + 1}】张单数据不存在，请返回检测！` }
    docs.push(found)
  }

  if (mode === '2') {
    const supplierKeys = Array.from(new Set(docs.map((doc) => supplierKey(doc.header)).filter(Boolean)))
    if (supplierKeys.length > 1) return { ok: false, status: 400, code: 'SUPPLIER_MISMATCH', msg: '多张汇总打印，客户必须一致！' }
    return {
      ok: true,
      list: [buildSummaryDocument({ docs, printMode: mode, language: lang, hasPricePermission, makerName })],
      printMode: mode,
      language: lang,
      printConfig,
    }
  }

  return { ok: true, list: docs.map((item) => item.doc), printMode: mode, language: lang, printConfig }
}
