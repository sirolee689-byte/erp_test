/**
 * 出入库统计表 API：按日期合并已审核入库、出库明细，不写入中间表。
 */
import { sql } from './db.js'
import { safeDecimalExpr } from './buyOrderSqlSafe.js'
import { assertUserHasAction } from './apiPermissionGate.js'
import { resolveSysUserIsAdminByUserId } from './sysUsersDb.js'
import { fetchStockStatsPrintHeader } from './stockStatsPrintHeader.js'

const WAREHOUSE_FROM = 'dbo.[UB_ERP_Stocks_Warehouse]'
const MATERIAL_CATEGORY_FROM = 'dbo.[New_UB_ERP_Stocks_material]'
const BOM_FROM = 'dbo.[UB_ERP_Bom_000]'
const COLOR_FROM = 'dbo.[UB_ERP_Stocks_colorcode]'
const STOCK_IN_HEADER_FROM = 'dbo.[UB_ERP_Stocks_Storage]'
const STOCK_IN_LINE_FROM = 'dbo.[UB_ERP_Stocks_Storage_list]'
const STOCK_OUT_HEADER_FROM = 'dbo.[UB_ERP_Stocks_out]'
const STOCK_OUT_LINE_FROM = 'dbo.[UB_ERP_Stocks_out_list]'
const MENU_PATH = 'inventory/analysis/stock-movement-stats'
const ALL_WAREHOUSE = '__ALL__'

function text(value) {
  return String(value ?? '').trim()
}

function likePattern(value) {
  return `%${text(value).replace(/[\\%_]/g, '\\$&')}%`
}

function normalizeDate(value) {
  const v = text(value)
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : ''
}

function parseList(value, max = 30) {
  const source = Array.isArray(value) ? value : String(value ?? '').split(',')
  const seen = new Set()
  return source.map(text).filter((item) => item && !seen.has(item) && seen.add(item)).slice(0, max)
}

function parseMovementTypes(value) {
  return parseList(value).filter((item) => /^(in|out):\d+$/.test(item))
}

function parseReportQuery(query = {}) {
  return {
    startDate: normalizeDate(query.startDate),
    endDate: normalizeDate(query.endDate),
    warehouseCode: text(query.warehouseCode),
    allWarehouse: text(query.warehouseCode) === ALL_WAREHOUSE,
    materialCode: text(query.materialCode),
    materialSystemcode: text(query.materialSystemcode),
    movementTypes: parseMovementTypes(query.movementTypes),
    materialCategories: parseList(query.materialCategories),
  }
}

function typeValues(q, direction) {
  return q.movementTypes
    .filter((item) => item.startsWith(`${direction}:`))
    .map((item) => item.slice(direction.length + 1))
}

function bindReportParams(req, q) {
  req.input('startDate', sql.DateTime, new Date(`${q.startDate}T00:00:00`))
  req.input('endDateExclusive', sql.DateTime, new Date(`${q.endDate}T00:00:00`))
  req.input('warehouseCode', sql.NVarChar(200), q.warehouseCode)
  req.input('allWarehouse', sql.Bit, q.allWarehouse)
  if (q.materialCode && !q.materialSystemcode) req.input('materialCode', sql.NVarChar(200), q.materialCode)
  if (q.materialSystemcode) req.input('materialSystemcode', sql.NVarChar(200), q.materialSystemcode)
  q.materialCategories.forEach((value, index) => req.input(`category${index}`, sql.NVarChar(200), value))
  typeValues(q, 'in').forEach((value, index) => req.input(`inType${index}`, sql.NVarChar(20), value))
  typeValues(q, 'out').forEach((value, index) => req.input(`outType${index}`, sql.NVarChar(20), value))
}

function inList(values, prefix) {
  return values.length ? ` IN (${values.map((_, index) => `@${prefix}${index}`).join(', ')})` : ''
}

function buildBranchWhereSql(q, direction) {
  const isIn = direction === 'in'
  const dateField = isIn ? 'h.[kcan02]' : 'h.[kcap02]'
  const warehouseField = isIn ? 'h.[kcan06]' : 'h.[kcap06]'
  const typeField = isIn ? 'h.[kcan03]' : 'h.[kcap03]'
  const types = typeValues(q, direction)
  const parts = [
    "(ISNULL(h.[del], N'') = N'' OR h.[del] = N'0')",
    "(ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')",
    "LTRIM(RTRIM(ISNULL(h.[pass], N''))) = N'1'",
    `${dateField} >= @startDate`,
    `${dateField} < DATEADD(day, 1, @endDateExclusive)`,
    `(@allWarehouse = 1 OR LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(${warehouseField}, N'')))) = @warehouseCode)`,
  ]
  if (q.materialSystemcode) parts.push("LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[systemcode], N'')))) = @materialSystemcode")
  else if (q.materialCode) parts.push("LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) = @materialCode")
  if (q.materialCategories.length) parts.push(`LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa05], N''))))${inList(q.materialCategories, 'category')}`)
  if (types.length) parts.push(`LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(${typeField}, N''))))${inList(types, isIn ? 'inType' : 'outType')}`)
  return parts.join('\n      AND ')
}

function buildStockMovementStatsReportSql(q) {
  const inboundWhere = buildBranchWhereSql(q, 'in')
  const outboundWhere = buildBranchWhereSql(q, 'out')
  return `
    WITH movement AS (
      SELECT
        h.[kcan02] AS movementDate,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan01], N'')))) AS documentNo,
        N'入库' AS direction,
        LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(h.[kcan03], N'')))) AS movementType,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan04], N'')))) AS sourceOrderNo,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan06], N'')))) AS warehouseCode,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[ck], N'')))) AS warehouseName,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[systemcode], N'')))) AS materialSystemcode,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) AS materialCode,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa02], N'')))) AS materialName,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa02_en], N'')))) AS materialNameEn,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa03], N'')))) AS materialSpec,
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(l.[kcaa11], N'')))) AS colorCode,
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(l.[kcaa04], N'')))) AS unit,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa05], N'')))) AS materialCategory,
        ${safeDecimalExpr('l', 'kcao03', 0)} AS quantity,
        ${safeDecimalExpr('l', 'kcao04', 0)} AS unitPrice,
        ${safeDecimalExpr('l', 'kcao041', 0)} AS unitPriceTax,
        ${safeDecimalExpr('l', 'kcao05', 0)} AS amount,
        ${safeDecimalExpr('l', 'kcao051', 0)} AS amountTax,
        LTRIM(RTRIM(CONVERT(nvarchar(1000), ISNULL(l.[Reference], N'')))) AS poPi,
        LTRIM(RTRIM(COALESCE(NULLIF(CONVERT(nvarchar(1000), l.[remark]), N''), NULLIF(CONVERT(nvarchar(1000), h.[remark]), N''), N''))) AS remark,
        l.[id] AS lineId,
        1 AS directionSort
      FROM ${STOCK_IN_HEADER_FROM} AS h
      INNER JOIN ${STOCK_IN_LINE_FROM} AS l ON LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcao01], N'')))) = LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan01], N''))))
      WHERE ${inboundWhere}

      UNION ALL

      SELECT
        h.[kcap02], LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcap01], N'')))), N'出库',
        LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(h.[kcap03], N'')))),
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcap04], N'')))),
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcap06], N'')))),
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[ck], N'')))),
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[systemcode], N'')))),
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))),
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa02], N'')))),
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa02_en], N'')))),
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa03], N'')))),
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(l.[kcaa11], N'')))),
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(l.[kcaa04], N'')))),
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa05], N'')))),
        ${safeDecimalExpr('l', 'kcaq03', 0)}, ${safeDecimalExpr('l', 'kcaq04', 0)}, ${safeDecimalExpr('l', 'kcaq041', 0)}, ${safeDecimalExpr('l', 'kcaq05', 0)}, ${safeDecimalExpr('l', 'kcaq051', 0)},
        LTRIM(RTRIM(CONVERT(nvarchar(1000), ISNULL(h.[kcap08], N'')))),
        LTRIM(RTRIM(COALESCE(NULLIF(CONVERT(nvarchar(1000), l.[Describe]), N''), NULLIF(CONVERT(nvarchar(1000), h.[remark]), N''), N''))),
        l.[id], 2
      FROM ${STOCK_OUT_HEADER_FROM} AS h
      INNER JOIN ${STOCK_OUT_LINE_FROM} AS l ON LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaq01], N'')))) = LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcap01], N''))))
      WHERE ${outboundWhere}
    )
    SELECT m.*, ISNULL(color.[name], N'') AS colorName, ISNULL(category.[name], N'') AS materialCategoryName
    FROM movement AS m
    LEFT JOIN ${COLOR_FROM} AS color ON LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(color.[code], N'')))) = m.colorCode
    LEFT JOIN ${MATERIAL_CATEGORY_FROM} AS category ON LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(category.[code], N'')))) = m.materialCategory
    ORDER BY m.movementDate ASC, m.directionSort ASC, m.documentNo ASC, m.lineId ASC
  `
}

function inboundTypeLabel(value) {
  return ({ 0: '其他入库', 1: '采购入库', 2: '外协入库', 3: '外协退料', 4: '生产入库', 5: '生产退料', 6: '成品退货', 7: '盘盈入库', 8: '加工入库', 9: '其他入库' })[text(value)] || `${text(value)} 未知类别`
}

function outboundTypeLabel(value) {
  return ({ 1: '采购退货', 2: '外协出库', 3: '外协退货', 4: '生产领料', 6: '销售出库', 7: '生产领料', 8: '报损', 9: '盘亏' })[text(value)] || `${text(value)} 未知类别`
}

function numberValue(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function serializeReportRow(row, canViewPrice) {
  const direction = text(row.direction)
  const out = {
    rowKey: `${direction}-${text(row.documentNo)}-${Number(row.lineId ?? 0)}`,
    movementDate: row.movementDate instanceof Date ? row.movementDate.toISOString() : row.movementDate ?? '',
    documentNo: text(row.documentNo), direction, movementType: text(row.movementType),
    movementTypeLabel: direction === '入库' ? inboundTypeLabel(row.movementType) : outboundTypeLabel(row.movementType),
    sourceOrderNo: text(row.sourceOrderNo), materialCode: text(row.materialCode), materialName: text(row.materialName),
    materialNameEn: text(row.materialNameEn), materialSpec: text(row.materialSpec), colorCode: text(row.colorCode),
    colorName: text(row.colorName), color: [text(row.colorCode), text(row.colorName)].filter(Boolean).join(' '),
    unit: text(row.unit), quantity: numberValue(row.quantity), warehouse: [text(row.warehouseCode), text(row.warehouseName)].filter(Boolean).join(' '),
    materialCategory: [text(row.materialCategory), text(row.materialCategoryName)].filter(Boolean).join(' '),
    poPi: text(row.poPi), remark: text(row.remark),
  }
  if (canViewPrice) Object.assign(out, { unitPrice: numberValue(row.unitPrice), unitPriceTax: numberValue(row.unitPriceTax), amount: numberValue(row.amount), amountTax: numberValue(row.amountTax) })
  return out
}

async function canViewPriceColumns(pool, req) {
  const user = req.user ?? {}
  const uid = user.userId ?? user.UserID ?? user.id ?? user.uid
  if (await resolveSysUserIsAdminByUserId(pool, uid)) return true
  return uid ? assertUserHasAction(pool, uid, MENU_PATH, 'price') : false
}

async function fetchOptions(pool, from, keyword, fields) {
  const req = pool.request()
  const where = keyword ? `AND (${fields.map((field) => `LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([${field}], N'')))) LIKE @kw ESCAPE '\\'`).join(' OR ')})` : ''
  if (keyword) req.input('kw', sql.NVarChar(400), likePattern(keyword))
  const result = await req.query(`SELECT TOP 100 LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([code], N'')))) AS code, LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([name], N'')))) AS name FROM ${from} WHERE (ISNULL([del], N'') = N'' OR [del] = N'0') AND LTRIM(RTRIM(ISNULL([pass], N''))) = N'1' ${where} ORDER BY [code] ASC`)
  return result.recordset ?? []
}

async function fetchMaterialOptions(pool, keyword) {
  const req = pool.request()
  if (keyword) req.input('kw', sql.NVarChar(400), likePattern(keyword))
  const result = await req.query(`SELECT TOP 100 LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([systemcode], N'')))) AS systemcode, LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([kcaa01], N'')))) AS code FROM ${BOM_FROM} WHERE (ISNULL([del], N'') = N'' OR [del] = N'0') AND LTRIM(RTRIM(ISNULL([pass], N''))) = N'1' AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([systemcode], N'')))) <> N'' ${keyword ? "AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([kcaa01], N'')))) LIKE @kw ESCAPE '\\'" : ''} ORDER BY [kcaa01] ASC, [id] DESC`)
  return result.recordset ?? []
}

function sendError(res, err, prefix) {
  res.status(500).json({ code: 500, msg: `${prefix}：${String(err?.message ?? err)}`, data: null })
}

export function registerStockMovementStatsRoutes(app, { getPool }) {
  app.get('/api/stock-movement-stats/print-header', async (_req, res) => {
    try { res.json({ code: 200, msg: 'success', data: await fetchStockStatsPrintHeader(await getPool()) }) } catch (err) { sendError(res, err, '读取出入库统计打印抬头失败') }
  })
  app.get('/api/stock-movement-stats/warehouse-options', async (req, res) => {
    try { res.json({ code: 200, msg: 'success', data: { list: await fetchOptions(await getPool(), WAREHOUSE_FROM, text(req.query?.keyword), ['code', 'name']) } }) } catch (err) { sendError(res, err, '读取出入库统计仓库候选失败') }
  })
  app.get('/api/stock-movement-stats/category-options', async (req, res) => {
    try { res.json({ code: 200, msg: 'success', data: { list: await fetchOptions(await getPool(), MATERIAL_CATEGORY_FROM, text(req.query?.keyword), ['code', 'name']) } }) } catch (err) { sendError(res, err, '读取出入库统计分类候选失败') }
  })
  app.get('/api/stock-movement-stats/material-options', async (req, res) => {
    try { res.json({ code: 200, msg: 'success', data: { list: await fetchMaterialOptions(await getPool(), text(req.query?.keyword)) } }) } catch (err) { sendError(res, err, '读取出入库统计物料候选失败') }
  })
  app.get('/api/stock-movement-stats/report', async (req, res) => {
    try {
      const q = parseReportQuery(req.query ?? {})
      if (!q.startDate || !q.endDate || !q.warehouseCode) { res.status(400).json({ code: 400, msg: '统计开始日期、结束日期和仓库不能为空', data: null }); return }
      if (q.startDate > q.endDate) { res.status(400).json({ code: 400, msg: '统计开始日期不能大于结束日期', data: null }); return }
      const pool = await getPool(); const canViewPrice = await canViewPriceColumns(pool, req); const dbReq = pool.request(); bindReportParams(dbReq, q)
      const result = await dbReq.query(buildStockMovementStatsReportSql(q))
      res.json({ code: 200, msg: 'success', data: { list: (result.recordset ?? []).map((row) => serializeReportRow(row, canViewPrice)), startDate: q.startDate, endDate: q.endDate, warehouseCode: q.warehouseCode, allWarehouse: q.allWarehouse, canViewPrice } })
    } catch (err) { sendError(res, err, '读取出入库统计表失败') }
  })
}

export const __stockMovementStatsForTest = { MENU_PATH, ALL_WAREHOUSE, parseReportQuery, buildBranchWhereSql, buildStockMovementStatsReportSql, serializeReportRow, inboundTypeLabel, outboundTypeLabel }
