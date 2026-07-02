/**
 * 入库单标签打印数据。
 * SQL Server 2008 R2 兼容。
 */
import { sql } from './db.js'
import { coerceScalarValue } from './stockOutExpandLines.js'

const HEADER_FROM = 'dbo.[UB_ERP_Stocks_Storage]'
const LINE_FROM = 'dbo.[UB_ERP_Stocks_Storage_list]'
const COLOR_FROM = 'dbo.[UB_ERP_Stocks_colorcode]'

function text(value) {
  return String(value ?? '').trim()
}

function number(value) {
  const n = Number(coerceScalarValue(value))
  return Number.isFinite(n) ? n : 0
}

function serializeValue(value) {
  return value instanceof Date ? value.toISOString() : coerceScalarValue(value)
}

function serializeRow(row = {}) {
  const out = {}
  for (const [key, value] of Object.entries(row)) out[key] = serializeValue(value)
  return out
}

export function parseStockInLabelReceiptNos(value) {
  return String(value ?? '')
    .split(',')
    .map((item) => text(item))
    .filter(Boolean)
}

export function buildStockInLabelHeaderSql() {
  return `
    SELECT TOP 1 *
    FROM ${HEADER_FROM}
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([kcan01], N'')))) = @receiptNo
      AND LTRIM(RTRIM(ISNULL([pass], N''))) = N'1'
      AND (ISNULL([del], N'') = N'' OR [del] = N'0')
  `
}

export function buildStockInLabelLinesSql() {
  return `
    SELECT
      l.*,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.[name], N'')))) AS colorName
    FROM ${LINE_FROM} AS l
    LEFT JOIN ${COLOR_FROM} AS c
      ON LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(c.[code], N'')))) =
         LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(l.[kcaa11], N''))))
     AND LTRIM(RTRIM(ISNULL(c.[pass], N''))) = N'1'
     AND (ISNULL(c.[del], N'') = N'' OR c.[del] = N'0')
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcao01], N'')))) = @receiptNo
      AND (ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')
    ORDER BY ISNULL(l.[seq], l.[id]), l.[id]
  `
}

function normalizeColorText(line = {}) {
  const code = text(line.kcaa11)
  const name = text(line.colorName)
  if (code && name) return `${name}/${code}`
  if (code) return `${code}/${code}`
  return name
}

function normalizeQtyText(value) {
  const n = number(value)
  return Number.isInteger(n) ? String(n) : String(n).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
}

function normalizeInboundTime(header = {}) {
  const raw = header.kcan02 ?? header.inboundDate
  if (!raw) return ''
  if (raw instanceof Date) {
    const y = raw.getFullYear()
    const m = String(raw.getMonth() + 1).padStart(2, '0')
    const d = String(raw.getDate()).padStart(2, '0')
    const hh = String(raw.getHours()).padStart(2, '0')
    const mm = String(raw.getMinutes()).padStart(2, '0')
    const ss = String(raw.getSeconds()).padStart(2, '0')
    return `${y}-${m}-${d} ${hh}:${mm}:${ss}`
  }
  return text(raw).replace('T', ' ').replace(/\.\d{3}Z?$/, '')
}

export function buildStockInLabelItems({ header, lines } = {}) {
  const h = serializeRow(header)
  return (Array.isArray(lines) ? lines : []).map((rawLine, index) => {
    const line = serializeRow(rawLine)
    const receiptNo = text(h.kcan01)
    const materialCode = text(line.kcaa01)
    const qrParams = `action=stocks&kcaa01=${encodeURIComponent(materialCode)}&kcao01=${encodeURIComponent(receiptNo)}`
    const qrContent = `/view.asp?${qrParams}`
    const englishName = text(line.kcaa02_en)
    return {
      key: `${receiptNo}|${line.id ?? index}|${materialCode}`,
      receiptNo,
      materialCode,
      chineseName: text(line.kcaa02),
      englishName,
      nameLabel: englishName ? `Name: ${englishName}` : `${receiptNo} ${text(line.kcaa02)}`.trim(),
      colorText: normalizeColorText(line),
      quantityText: normalizeQtyText(line.kcao03),
      inboundTime: normalizeInboundTime(h),
      sourceOrderNo: text(line.kcan04),
      handlerName: text(h.kcan07),
      qrContent,
      legacyQrContent: `view.asp?${qrParams}`,
      seq: index + 1,
    }
  })
}

export async function fetchStockInLabelPrintDocuments(pool, { pSumbq } = {}) {
  const receiptNos = parseStockInLabelReceiptNos(pSumbq)
  if (!receiptNos.length) {
    return { ok: false, status: 400, code: 'EMPTY_P_SUMBQ', msg: 'Error,Code:208' }
  }

  const docs = []
  for (const receiptNo of receiptNos) {
    const headerR = await pool.request().input('receiptNo', sql.NVarChar(200), receiptNo).query(buildStockInLabelHeaderSql())
    const header = headerR.recordset?.[0]
    if (!header) {
      return { ok: false, status: 404, code: 'MISSING_DOCUMENT', msg: '数据不存在，请返回检查！' }
    }
    const linesR = await pool.request().input('receiptNo', sql.NVarChar(200), receiptNo).query(buildStockInLabelLinesSql())
    docs.push({
      header: serializeRow(header),
      labels: buildStockInLabelItems({ header, lines: linesR.recordset ?? [] }),
    })
  }

  return {
    ok: true,
    list: docs,
    labels: docs.flatMap((doc) => doc.labels),
  }
}
