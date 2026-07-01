import { sql } from './db.js'
import { coerceScalarValue } from './stockOutExpandLines.js'
import { fetchSystemPrintLogoConfig } from './systemPrintLogo.js'

const HEADER_FROM = 'dbo.[UB_ERP_Stocks_out]'
const LINE_FROM = 'dbo.[UB_ERP_Stocks_out_list]'
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

function lineColorText(line = {}) {
  const code = text(line.kcaa11)
  const name = text(line.colorName)
  if (code && name) return `(${code}) ${name}`
  if (code) return `(${code})`
  return name
}

export function parseStockOutPrintSystemcodes(value) {
  return String(value ?? '')
    .split(',')
    .map((item) => text(item))
    .filter(Boolean)
}

export function normalizeStockOutPrintMode(value) {
  return text(value) === '1' ? '1' : '2'
}

export function buildStockOutPrintDetailLinesSql() {
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
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaq01], N'')))) = @outboundNo
      AND (ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')
    ORDER BY ISNULL(l.[seq], l.[id]), l.[id]
  `
}

export function buildStockOutPrintSummaryLinesSql() {
  return `
    SELECT
      LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa01], N'')))) AS kcaa01,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa02], N'')))) AS kcaa02,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa03], N'')))) AS kcaa03,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(l.[kcaa11], N'')))) AS kcaa11,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(l.[kcaa04], N'')))) AS kcaa04,
      SUM(ISNULL(l.[kcaq03], 0)) AS kcaq03,
      MAX(LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.[name], N''))))) AS colorName
    FROM ${LINE_FROM} AS l
    LEFT JOIN ${COLOR_FROM} AS c
      ON LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(c.[code], N'')))) =
         LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(l.[kcaa11], N''))))
     AND LTRIM(RTRIM(ISNULL(c.[pass], N''))) = N'1'
     AND (ISNULL(c.[del], N'') = N'' OR c.[del] = N'0')
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaq01], N'')))) = @outboundNo
      AND (ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')
    GROUP BY
      LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa01], N'')))),
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa02], N'')))),
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa03], N'')))),
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(l.[kcaa11], N'')))),
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(l.[kcaa04], N''))))
    ORDER BY kcaa01, kcaa02, kcaa03, kcaa11, kcaa04
  `
}

export function normalizeStockOutPrintLine(row = {}, index = 0) {
  const line = serializeRow(row)
  const qty = number(line.kcaq03)
  line.seq = index + 1
  line.kcaq03 = qty
  line.quantityText = qty.toFixed(2)
  line.colorText = lineColorText(line)
  line.reference = text(line.reference ?? line.Reference)
  line.Describe = text(line.Describe ?? line.describe)
  return line
}

export function buildStockOutPrintDocument({ header, lines, printMode, index, total, makerName }) {
  const normalizedLines = (Array.isArray(lines) ? lines : []).map(normalizeStockOutPrintLine)
  const totalQty = normalizedLines.reduce((sum, line) => sum + number(line.kcaq03), 0)
  return {
    header: serializeRow(header),
    lines: normalizedLines,
    printMode: normalizeStockOutPrintMode(printMode),
    pageIndex: index,
    pageTotal: total,
    totalQty,
    totalQtyText: totalQty.toFixed(2),
    makerName: text(makerName),
  }
}

export async function fetchStockOutPrintDocuments(pool, { pSum, printMode = '2', actor = {} } = {}) {
  const systemcodes = parseStockOutPrintSystemcodes(pSum)
  if (!systemcodes.length) {
    return { ok: false, status: 400, code: 'EMPTY_P_SUM', msg: 'Error,Code:208' }
  }

  const mode = normalizeStockOutPrintMode(printMode)
  const printConfig = await fetchSystemPrintLogoConfig(pool)
  const docs = []
  for (let i = 0; i < systemcodes.length; i += 1) {
    const systemcode = systemcodes[i]
    const headerR = await pool.request().input('systemcode', sql.NVarChar(200), systemcode).query(`
      SELECT TOP 1 *
      FROM ${HEADER_FROM}
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([systemcode], N'')))) = @systemcode
        AND (ISNULL([del], N'') = N'' OR [del] = N'0')
    `)
    const header = headerR.recordset?.[0]
    if (!header) {
      return { ok: false, status: 404, code: 'MISSING_DOCUMENT', msg: `其中第【${i + 1}】张单数据不存在，请返回检测！` }
    }

    const outboundNo = text(header.kcap01)
    const sqlText = mode === '1' ? buildStockOutPrintDetailLinesSql() : buildStockOutPrintSummaryLinesSql()
    const linesR = await pool.request().input('outboundNo', sql.NVarChar(200), outboundNo).query(sqlText)
    docs.push(buildStockOutPrintDocument({
      header,
      lines: linesR.recordset ?? [],
      printMode: mode,
      index: i + 1,
      total: systemcodes.length,
      makerName: actor?.trueName ?? actor?.utruename ?? actor?.truename ?? actor?.name,
    }))
  }

  return { ok: true, list: docs, printMode: mode, printConfig }
}
