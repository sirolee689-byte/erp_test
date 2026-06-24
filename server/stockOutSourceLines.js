import { sql } from './db.js'

const SOURCE_CONFIGS = {
  1: { tableName: 'UB_ERP_Buy_order_list', orderCol: 'kcak01', qtyCol: 'kcak03', usedCol: 'kcak07' },
  2: { tableName: 'UB_ERP_assist_order_list', orderCol: 'wxak01', qtyCol: 'wxak03', usedCol: 'wxak08' },
  3: { tableName: 'UB_ERP_assist_order_list', orderCol: 'wxak01', qtyCol: 'wxak03', usedCol: 'wxak08' },
  4: { tableName: 'UB_ERP_Dispatch_order_list', orderCol: 'scak01', qtyCol: 'scak03', usedCol: 'scak04' },
  5: { tableName: 'UB_ERP_Dispatch_order_list', orderCol: 'scak01', qtyCol: 'scak03', usedCol: 'scak05' },
  6: { tableName: 'UB_ERP_Sales_order_list', orderCol: 'xsak01', qtyCol: 'xsak03', usedCol: 'xsak06' },
}

function has(cols, col) {
  return cols instanceof Set && cols.has(String(col ?? '').toLowerCase())
}

function text(v) {
  return String(v ?? '').trim()
}

function colExpr(cols, candidates, fallback = "N''") {
  for (const col of candidates) {
    if (has(cols, col)) return `[${col}]`
  }
  return fallback
}

function numberExpr(cols, col) {
  return has(cols, col) ? `ISNULL([${col}], 0)` : '0'
}

export function resolveStockOutSourceConfig(outboundType) {
  return SOURCE_CONFIGS[String(outboundType ?? '').trim()] ?? null
}

export function buildStockOutSourceLinesSql({ config, cols, hasKeyword = false }) {
  const sourceCodeExpr = colExpr(cols, ['systemcode', 'GUID', 'id'])
  const materialCodeExpr = colExpr(cols, ['kcaa01'])
  const materialNameExpr = colExpr(cols, ['kcaa02', 'kcaa03', 'kpname'])
  const specExpr = colExpr(cols, ['kcaa03', 'kcaa04'])
  const colorExpr = colExpr(cols, ['kcaa04', 'kcaa05', 'color'])
  const unitExpr = colExpr(cols, ['kcaa05', 'unit'])
  const qtyExpr = numberExpr(cols, config.qtyCol)
  const usedExpr = numberExpr(cols, config.usedCol)
  const rateExpr = numberExpr(cols, 'kcaa26')
  const directionExpr = colExpr(cols, ['kcaa27'], "N''")
  const orderFilter = has(cols, config.orderCol)
    ? `AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([${config.orderCol}], N'')))) = @sourceOrderNo`
    : ''
  const keywordFilter = hasKeyword
    ? `AND (
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(${materialCodeExpr}, N'')))) LIKE @keyword
        OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(${materialNameExpr}, N'')))) LIKE @keyword
        OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(${specExpr}, N'')))) LIKE @keyword
      )`
    : ''
  return `
    SELECT TOP 200
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(${sourceCodeExpr}, N'')))) AS sourceLineCode,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(${materialCodeExpr}, N'')))) AS materialCode,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(${materialNameExpr}, N'')))) AS materialName,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(${specExpr}, N'')))) AS spec,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(${colorExpr}, N'')))) AS color,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(${unitExpr}, N'')))) AS unit,
      ${qtyExpr} AS sourceQty,
      ${usedExpr} AS usedQty,
      CASE WHEN ${qtyExpr} - ${usedExpr} < 0 THEN 0 ELSE ${qtyExpr} - ${usedExpr} END AS remainingQty,
      ${rateExpr} AS unitRate,
      LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(${directionExpr}, N'')))) AS unitDirection
    FROM dbo.[${config.tableName}]
    WHERE (ISNULL([del], N'') = N'' OR [del] = N'0')
      ${has(cols, 'pass') ? "AND (ISNULL([pass], N'') = N'' OR [pass] = N'1')" : ''}
      ${orderFilter}
      ${keywordFilter}
    ORDER BY [id] ASC
  `
}

async function fetchColumnSet(pool, tableName) {
  const r = await pool.request().input('tableName', sql.NVarChar(128), tableName).query(`
    SELECT LOWER([name]) AS name
    FROM sys.columns
    WHERE [object_id] = OBJECT_ID(N'dbo.[${tableName}]')
  `)
  return new Set((r.recordset ?? []).map((row) => String(row.name ?? '').toLowerCase()))
}

export async function queryStockOutSourceLines(pool, { outboundType, sourceOrderNo, keyword }) {
  const config = resolveStockOutSourceConfig(outboundType)
  if (!config || !text(sourceOrderNo)) return []
  const cols = await fetchColumnSet(pool, config.tableName)
  const req = pool.request().input('sourceOrderNo', sql.NVarChar(200), text(sourceOrderNo))
  const kw = text(keyword)
  if (kw) req.input('keyword', sql.NVarChar(500), `%${kw}%`)
  const result = await req.query(buildStockOutSourceLinesSql({ config, cols, hasKeyword: Boolean(kw) }))
  return (result.recordset ?? []).filter((row) => Number(row.remainingQty ?? 0) > 0)
}
