/**
 * 进销存统计报表 API。
 * 只读期间汇总：按仓库 + 物料统计上期、本期入库/出库/补数/盈亏和结存，不写月结成本。
 */
import { sql } from './db.js'
import { safeDecimalExpr, nvarcharTextExpr } from './buyOrderSqlSafe.js'
import { assertUserHasAction } from './apiPermissionGate.js'
import { resolveSysUserIsAdminByUserId } from './sysUsersDb.js'
import { fetchStockStatsPrintHeader } from './stockStatsPrintHeader.js'

const WAREHOUSE_FROM = 'dbo.[UB_ERP_Stocks_Warehouse]'
const MATERIAL_CATEGORY_FROM = 'dbo.[UB_ERP_Stocks_material]'
const COLOR_FROM = 'dbo.[UB_ERP_Stocks_colorcode]'
const BOM_FROM = 'dbo.[UB_ERP_Bom_000]'
const STOCK_IN_HEADER_FROM = 'dbo.[UB_ERP_Stocks_Storage]'
const STOCK_IN_LINE_FROM = 'dbo.[UB_ERP_Stocks_Storage_list]'
const STOCK_OUT_HEADER_FROM = 'dbo.[UB_ERP_Stocks_out]'
const STOCK_OUT_LINE_FROM = 'dbo.[UB_ERP_Stocks_out_list]'
const MENU_PATH = 'inventory/analysis/stock-io-stats'
const ALL_WAREHOUSE = '__ALL__'

const IN_QTY = safeDecimalExpr('l', 'kcao03', 0)
const IN_AMOUNT = safeDecimalExpr('l', 'kcao05', 0)
const IN_PRICE = safeDecimalExpr('l', 'kcao04', 0)
const OUT_QTY = safeDecimalExpr('l', 'kcaq03', 0)
const OUT_AMOUNT = safeDecimalExpr('l', 'kcaq05', 0)

function text(v) {
  return String(v ?? '').trim()
}

function likePattern(v) {
  return `%${text(v).replace(/[\\%_]/g, '\\$&')}%`
}

function normalizeDate(value) {
  const s = text(value)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''
}

function parseCategoryList(value) {
  const raw = Array.isArray(value) ? value : String(value ?? '').split(',')
  const out = []
  const seen = new Set()
  for (const item of raw) {
    const v = text(item)
    if (!v || seen.has(v)) continue
    seen.add(v)
    out.push(v)
    if (out.length >= 20) break
  }
  return out
}

function parseReportQuery(query = {}) {
  return {
    startDate: normalizeDate(query.startDate),
    endDate: normalizeDate(query.endDate),
    warehouseCode: text(query.warehouseCode),
    materialCode: text(query.materialCode ?? query.materialSystemcode),
    materialName: text(query.materialName),
    materialSpec: text(query.materialSpec),
    materialCategories: parseCategoryList(query.materialCategories ?? query.materialCategory),
  }
}

function validateReportQuery(q) {
  if (!q.startDate) return '统计开始日期不能为空'
  if (!q.endDate) return '统计结束日期不能为空'
  if (!q.warehouseCode) return '仓库不能为空'
  if (q.warehouseCode === ALL_WAREHOUSE) return '第一期仅支持选择具体仓库'
  return ''
}

function addOneDay(dateText) {
  const d = new Date(`${dateText}T00:00:00`)
  d.setDate(d.getDate() + 1)
  return d
}

function bindReportParams(req, q) {
  req.input('startDate', sql.DateTime, new Date(`${q.startDate}T00:00:00`))
  req.input('endDateExclusive', sql.DateTime, addOneDay(q.endDate))
  req.input('warehouseCode', sql.NVarChar(200), q.warehouseCode)
  if (q.materialCode) req.input('materialCode', sql.NVarChar(200), q.materialCode)
  if (q.materialName) req.input('materialName', sql.NVarChar(400), likePattern(q.materialName))
  if (q.materialSpec) req.input('materialSpec', sql.NVarChar(400), likePattern(q.materialSpec))
  q.materialCategories.forEach((code, index) => req.input(`category${index}`, sql.NVarChar(200), code))
}

function buildCategoryWhereSql(categories) {
  if (!categories.length) return ''
  const tokens = categories.map((_, index) => `@category${index}`).join(', ')
  return `${nvarcharTextExpr('l', 'kcaa05', 200)} IN (${tokens})`
}

function buildBomTextExistsSql(columnName, paramName) {
  return `EXISTS (
        SELECT 1
        FROM ${BOM_FROM} AS bf
        WHERE (ISNULL(bf.[del], N'') = N'' OR bf.[del] = N'0')
          AND ${nvarcharTextExpr('bf', 'kcaa01', 200)} = ${nvarcharTextExpr('l', 'kcaa01', 200)}
          AND ${nvarcharTextExpr('bf', columnName, 500)} LIKE @${paramName} ESCAPE '\\'
      )`
}

function buildInboundBaseWhereSql(q, { beforeStart = false } = {}) {
  const parts = [
    "(ISNULL(h.[del], N'') = N'' OR h.[del] = N'0')",
    "(ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')",
    "LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), h.[pass]), N''))) = N'1'",
    beforeStart ? 'h.[kcan02] < @startDate' : 'h.[kcan02] < @endDateExclusive',
    `${nvarcharTextExpr('h', 'kcan06', 200)} = @warehouseCode`,
    `${nvarcharTextExpr('l', 'kcaa01', 200)} <> N''`,
  ]
  if (q.materialCode) parts.push(`${nvarcharTextExpr('l', 'kcaa01', 200)} = @materialCode`)
  if (q.materialName) {
    parts.push(`(${nvarcharTextExpr('l', 'kcaa02', 500)} LIKE @materialName ESCAPE '\\' OR ${buildBomTextExistsSql('kcaa02', 'materialName')})`)
  }
  if (q.materialSpec) {
    parts.push(`(${nvarcharTextExpr('l', 'kcaa03', 500)} LIKE @materialSpec ESCAPE '\\' OR ${buildBomTextExistsSql('kcaa03', 'materialSpec')})`)
  }
  const categoryWhere = buildCategoryWhereSql(q.materialCategories)
  if (categoryWhere) parts.push(categoryWhere)
  return parts.join('\n      AND ')
}

function buildOutboundBaseWhereSql(q, { beforeStart = false } = {}) {
  const parts = [
    "(ISNULL(h.[del], N'') = N'' OR h.[del] = N'0')",
    "(ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')",
    "LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), h.[pass]), N''))) = N'1'",
    beforeStart ? 'h.[kcap02] < @startDate' : 'h.[kcap02] < @endDateExclusive',
    `${nvarcharTextExpr('h', 'kcap06', 200)} = @warehouseCode`,
    `${nvarcharTextExpr('l', 'kcaa01', 200)} <> N''`,
  ]
  if (q.materialCode) parts.push(`${nvarcharTextExpr('l', 'kcaa01', 200)} = @materialCode`)
  if (q.materialName) {
    parts.push(`(${nvarcharTextExpr('l', 'kcaa02', 500)} LIKE @materialName ESCAPE '\\' OR ${buildBomTextExistsSql('kcaa02', 'materialName')})`)
  }
  if (q.materialSpec) {
    parts.push(`(${nvarcharTextExpr('l', 'kcaa03', 500)} LIKE @materialSpec ESCAPE '\\' OR ${buildBomTextExistsSql('kcaa03', 'materialSpec')})`)
  }
  const categoryWhere = buildCategoryWhereSql(q.materialCategories)
  if (categoryWhere) parts.push(categoryWhere)
  return parts.join('\n      AND ')
}

function buildMovementSql(q) {
  const inWhere = buildInboundBaseWhereSql(q)
  const outWhere = buildOutboundBaseWhereSql(q)
  return `
    SELECT
      N'in' AS direction,
      h.[kcan02] AS docDate,
      ${nvarcharTextExpr('h', 'kcan06', 200)} AS warehouseCode,
      ${nvarcharTextExpr('h', 'ck', 500)} AS warehouseName,
      ${nvarcharTextExpr('h', 'kcan03', 20)} AS typeCode,
      ${nvarcharTextExpr('l', 'kcaa01', 200)} AS materialCode,
      ${nvarcharTextExpr('l', 'kcaa02', 500)} AS snapshotName,
      ${nvarcharTextExpr('l', 'kcaa03', 500)} AS snapshotSpec,
      ${nvarcharTextExpr('l', 'kcaa04', 100)} AS snapshotUnit,
      ${nvarcharTextExpr('l', 'kcaa05', 200)} AS snapshotCategoryCode,
      ${nvarcharTextExpr('l', 'kcaa11', 100)} AS snapshotColorCode,
      ${IN_QTY} AS quantity,
      ${IN_AMOUNT} AS amount
    FROM ${STOCK_IN_HEADER_FROM} AS h
    INNER JOIN ${STOCK_IN_LINE_FROM} AS l
      ON ${nvarcharTextExpr('l', 'kcao01', 200)} = ${nvarcharTextExpr('h', 'kcan01', 200)}
    WHERE ${inWhere}

    UNION ALL

    SELECT
      N'out' AS direction,
      h.[kcap02] AS docDate,
      ${nvarcharTextExpr('h', 'kcap06', 200)} AS warehouseCode,
      ${nvarcharTextExpr('h', 'ck', 500)} AS warehouseName,
      ${nvarcharTextExpr('h', 'kcap03', 20)} AS typeCode,
      ${nvarcharTextExpr('l', 'kcaa01', 200)} AS materialCode,
      ${nvarcharTextExpr('l', 'kcaa02', 500)} AS snapshotName,
      ${nvarcharTextExpr('l', 'kcaa03', 500)} AS snapshotSpec,
      ${nvarcharTextExpr('l', 'kcaa04', 100)} AS snapshotUnit,
      ${nvarcharTextExpr('l', 'kcaa05', 200)} AS snapshotCategoryCode,
      ${nvarcharTextExpr('l', 'kcaa11', 100)} AS snapshotColorCode,
      ${OUT_QTY} AS quantity,
      ${OUT_AMOUNT} AS amount
    FROM ${STOCK_OUT_HEADER_FROM} AS h
    INNER JOIN ${STOCK_OUT_LINE_FROM} AS l
      ON ${nvarcharTextExpr('l', 'kcaq01', 200)} = ${nvarcharTextExpr('h', 'kcap01', 200)}
    WHERE ${outWhere}
  `
}

function buildReportSql(q) {
  return `
    WITH movement AS (
      ${buildMovementSql(q)}
    ),
    aggregate_rows AS (
      SELECT
        warehouseCode,
        MAX(warehouseName) AS warehouseName,
        materialCode,
        MAX(snapshotName) AS snapshotName,
        MAX(snapshotSpec) AS snapshotSpec,
        MAX(snapshotUnit) AS snapshotUnit,
        MAX(snapshotCategoryCode) AS snapshotCategoryCode,
        MAX(snapshotColorCode) AS snapshotColorCode,
        SUM(CASE WHEN docDate < @startDate AND direction = N'in' THEN quantity ELSE 0 END)
          - SUM(CASE WHEN docDate < @startDate AND direction = N'out' THEN quantity ELSE 0 END) AS previousQty,
        SUM(CASE WHEN docDate >= @startDate AND direction = N'in' AND typeCode IN (N'1', N'2', N'0', N'5') THEN quantity ELSE 0 END)
          - SUM(CASE WHEN docDate >= @startDate AND direction = N'out' AND typeCode = N'1' THEN quantity ELSE 0 END) AS periodInQty,
        SUM(CASE WHEN docDate >= @startDate AND direction = N'in' AND typeCode IN (N'1', N'2', N'0', N'5') THEN amount ELSE 0 END)
          - SUM(CASE WHEN docDate >= @startDate AND direction = N'out' AND typeCode = N'1' THEN amount ELSE 0 END) AS periodInAmount,
        SUM(CASE WHEN docDate >= @startDate AND direction = N'out' AND typeCode IN (N'4', N'0', N'10', N'7', N'2') THEN quantity ELSE 0 END)
          - SUM(CASE WHEN docDate >= @startDate AND direction = N'in' AND typeCode IN (N'3', N'4') THEN quantity ELSE 0 END) AS periodOutQty,
        SUM(CASE WHEN docDate >= @startDate AND direction = N'out' AND typeCode = N'8' THEN quantity ELSE 0 END) AS periodSupplementQty,
        SUM(CASE WHEN docDate >= @startDate AND direction = N'in' AND typeCode = N'7' THEN quantity ELSE 0 END)
          - SUM(CASE WHEN docDate >= @startDate AND direction = N'out' AND typeCode = N'9' THEN quantity ELSE 0 END) AS periodProfitLossQty,
        SUM(CASE WHEN docDate >= @startDate AND direction = N'in' AND typeCode = N'7' THEN amount ELSE 0 END)
          - SUM(CASE WHEN docDate >= @startDate AND direction = N'out' AND typeCode = N'9' THEN amount ELSE 0 END) AS periodProfitLossAmount,
        MAX(CASE WHEN direction = N'in' THEN docDate ELSE NULL END) AS lastInboundAt,
        MAX(CASE WHEN direction = N'out' THEN docDate ELSE NULL END) AS lastOutboundAt
      FROM movement
      GROUP BY warehouseCode, materialCode
    )
    SELECT
      a.*,
      p.previousUnitPrice,
      b.materialId,
      b.materialName,
      b.materialNameEn,
      b.materialSpec,
      b.unit,
      b.categoryCode,
      b.colorCode,
      b.location,
      c.name AS categoryName,
      cc.name AS colorName
    FROM aggregate_rows AS a
    OUTER APPLY (
      SELECT TOP (1)
        ${IN_PRICE} AS previousUnitPrice
      FROM ${STOCK_IN_HEADER_FROM} AS h
      INNER JOIN ${STOCK_IN_LINE_FROM} AS l
        ON ${nvarcharTextExpr('l', 'kcao01', 200)} = ${nvarcharTextExpr('h', 'kcan01', 200)}
      WHERE (ISNULL(h.[del], N'') = N'' OR h.[del] = N'0')
        AND (ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')
        AND LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), h.[pass]), N''))) = N'1'
        AND h.[kcan02] < @startDate
        AND ${nvarcharTextExpr('h', 'kcan06', 200)} = a.warehouseCode
        AND ${nvarcharTextExpr('l', 'kcaa01', 200)} = a.materialCode
        AND ${IN_PRICE} > 0
      ORDER BY h.[kcan02] DESC, l.[id] DESC
    ) AS p
    OUTER APPLY (
      SELECT TOP (1)
        bom.[id] AS materialId,
        ${nvarcharTextExpr('bom', 'kcaa02', 500)} AS materialName,
        ${nvarcharTextExpr('bom', 'kcaa02_en', 500)} AS materialNameEn,
        ${nvarcharTextExpr('bom', 'kcaa03', 500)} AS materialSpec,
        ${nvarcharTextExpr('bom', 'kcaa04', 100)} AS unit,
        ${nvarcharTextExpr('bom', 'kcaa05', 200)} AS categoryCode,
        ${nvarcharTextExpr('bom', 'kcaa11', 100)} AS colorCode,
        ${nvarcharTextExpr('bom', 'location', 200)} AS location
      FROM ${BOM_FROM} AS bom
      WHERE (ISNULL(bom.[del], N'') = N'' OR bom.[del] = N'0')
        AND ${nvarcharTextExpr('bom', 'kcaa01', 200)} = a.materialCode
      ORDER BY bom.[id] DESC
    ) AS b
    LEFT JOIN ${MATERIAL_CATEGORY_FROM} AS c
      ON ${nvarcharTextExpr('c', 'code', 200)} = ISNULL(b.categoryCode, N'')
    LEFT JOIN ${COLOR_FROM} AS cc
      ON ${nvarcharTextExpr('cc', 'code', 100)} = ISNULL(b.colorCode, N'')
    ORDER BY a.warehouseCode ASC, ISNULL(b.categoryCode, a.snapshotCategoryCode) ASC, a.materialCode ASC
  `
}

function numberValue(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function roundMoney(n) {
  return Math.round(numberValue(n) * 1000000) / 1000000
}

function serializeDate(value) {
  if (value instanceof Date) return value.toISOString()
  return value ?? ''
}

function addWarning(list, ok, textValue) {
  if (!ok) list.push(textValue)
}

function buildComputedMetrics(row) {
  const previousQty = roundMoney(row.previousQty)
  const previousUnitPrice = roundMoney(row.previousUnitPrice)
  const previousAmount = roundMoney(previousQty * previousUnitPrice)
  const periodInQty = roundMoney(row.periodInQty)
  const periodInAmount = roundMoney(row.periodInAmount)
  const periodInUnitPrice = periodInQty > 0 ? roundMoney(periodInAmount / periodInQty) : 0
  const periodOutQty = roundMoney(row.periodOutQty)
  const availableCostQty = roundMoney(previousQty + periodInQty)
  const availableCostAmount = roundMoney(previousAmount + periodInAmount)
  const periodOutUnitPriceRaw = availableCostQty > 0 ? availableCostAmount / availableCostQty : 0
  const periodOutUnitPrice = roundMoney(periodOutUnitPriceRaw)
  const periodOutAmount = roundMoney(periodOutQty * periodOutUnitPriceRaw)
  const supplementQty = roundMoney(row.periodSupplementQty)
  const supplementBaseQty = roundMoney(availableCostQty - periodOutQty)
  const supplementBaseAmount = roundMoney(availableCostAmount - periodOutAmount)
  const supplementUnitPriceRaw = supplementBaseQty > 0 ? supplementBaseAmount / supplementBaseQty : 0
  const supplementUnitPrice = roundMoney(supplementUnitPriceRaw)
  const supplementAmount = roundMoney(supplementQty * supplementUnitPriceRaw)
  const profitLossQty = roundMoney(row.periodProfitLossQty)
  const profitLossAmount = roundMoney(row.periodProfitLossAmount)
  const endingQtyRaw = roundMoney(previousQty + periodInQty - periodOutQty - supplementQty + profitLossQty)
  const endingAmountRaw = roundMoney(previousAmount + periodInAmount - periodOutAmount - supplementAmount + profitLossAmount)
  const endingQty = endingQtyRaw <= 0.01 ? 0 : endingQtyRaw
  const endingAmount = endingQtyRaw <= 0.01 ? 0 : endingAmountRaw
  const endingUnitPrice = endingQty > 0 ? roundMoney(endingAmount / endingQty) : 0
  return {
    previousQty,
    previousUnitPrice,
    previousAmount,
    periodInQty,
    periodInUnitPrice,
    periodInAmount,
    periodOutQty,
    periodOutUnitPrice,
    periodOutAmount,
    supplementQty,
    supplementUnitPrice,
    supplementAmount,
    profitLossQty,
    profitLossAmount,
    endingQty,
    endingUnitPrice,
    endingAmount,
    endingQtyRaw,
    endingAmountRaw,
    availableCostQty,
  }
}

function hasAnyQty(m) {
  return [
    m.previousQty,
    m.periodInQty,
    m.periodOutQty,
    m.supplementQty,
    m.profitLossQty,
    m.endingQty,
  ].some((v) => Math.abs(numberValue(v)) > 0.000001)
}

function buildWarnings(row, m) {
  const warnings = []
  addWarning(warnings, row.materialId != null, '缺少物料资料')
  addWarning(warnings, !row.categoryCode || text(row.categoryName), '缺少分类名称')
  addWarning(warnings, !row.colorCode || text(row.colorName), '缺少颜色名称')
  addWarning(warnings, !(m.previousQty !== 0 && m.previousUnitPrice <= 0), '缺少上期成本单价')
  addWarning(warnings, !(m.periodOutQty > m.availableCostQty), '本期出库数量大于可用成本数量')
  addWarning(warnings, !(m.endingQtyRaw < 0), '结存数量为负')
  addWarning(warnings, !(Math.abs(m.endingQtyRaw) <= 0.000001 && Math.abs(m.endingAmountRaw) > 0.000001), '结存数量为0但结存金额不为0')
  addWarning(warnings, !(Math.abs(m.periodInAmount) > 0.000001 && Math.abs(m.periodInQty) <= 0.000001), '本期入库金额存在但入库数量为0')
  addWarning(warnings, !(m.periodOutQty > 0 && m.availableCostQty <= 0), '本期出库数量存在但无法计算出库单价')
  addWarning(warnings, !(m.profitLossQty !== 0 && Math.abs(m.profitLossAmount) <= 0.000001), '盈亏金额缺失')
  return warnings.join('；')
}

function serializeReportRow(row, canViewPrice) {
  const metrics = buildComputedMetrics(row)
  if (!hasAnyQty(metrics)) return null
  const categoryCode = text(row.categoryCode) || text(row.snapshotCategoryCode)
  const colorCode = text(row.colorCode) || text(row.snapshotColorCode)
  const out = {
    rowKey: `${text(row.warehouseCode)}-${text(row.materialCode)}`,
    warehouseCode: text(row.warehouseCode),
    warehouseName: text(row.warehouseName) || text(row.warehouseCode),
    categoryName: text(row.categoryName),
    categoryCode,
    location: text(row.location),
    lastInboundAt: serializeDate(row.lastInboundAt),
    lastOutboundAt: serializeDate(row.lastOutboundAt),
    materialCode: text(row.materialCode),
    materialName: text(row.materialName),
    materialNameEn: text(row.materialNameEn),
    materialSpec: text(row.materialSpec),
    colorCode,
    colorName: text(row.colorName),
    unit: text(row.unit),
    previousQty: metrics.previousQty,
    periodInQty: metrics.periodInQty,
    periodOutQty: metrics.periodOutQty,
    supplementQty: metrics.supplementQty,
    profitLossQty: metrics.profitLossQty,
    endingQty: metrics.endingQty,
    warning: buildWarnings({ ...row, categoryCode, colorCode }, metrics),
  }
  if (canViewPrice) {
    out.previousUnitPrice = metrics.previousUnitPrice
    out.previousAmount = metrics.previousAmount
    out.periodInUnitPrice = metrics.periodInUnitPrice
    out.periodInAmount = metrics.periodInAmount
    out.periodOutUnitPrice = metrics.periodOutUnitPrice
    out.periodOutAmount = metrics.periodOutAmount
    out.supplementUnitPrice = metrics.supplementUnitPrice
    out.supplementAmount = metrics.supplementAmount
    out.profitLossAmount = metrics.profitLossAmount
    out.endingUnitPrice = metrics.endingUnitPrice
    out.endingAmount = metrics.endingAmount
  }
  return out
}

async function canViewPriceColumns(pool, req) {
  const user = req.user ?? {}
  const uid = user.userId ?? user.UserID ?? user.id ?? user.uid
  if (await resolveSysUserIsAdminByUserId(pool, uid)) return true
  if (!uid) return false
  return assertUserHasAction(pool, uid, MENU_PATH, 'price')
}

async function fetchWarehouseOptions(pool, keyword = '') {
  const req = pool.request()
  let kwSql = ''
  if (keyword) {
    req.input('kw', sql.NVarChar(400), likePattern(keyword))
    kwSql = `AND (${nvarcharTextExpr('', 'code', 200).replace('.[', '[')} LIKE @kw ESCAPE '\\'
      OR ${nvarcharTextExpr('', 'name', 500).replace('.[', '[')} LIKE @kw ESCAPE '\\')`
  }
  const r = await req.query(`
    SELECT TOP 100
      ${nvarcharTextExpr('', 'code', 200).replace('.[', '[')} AS code,
      ${nvarcharTextExpr('', 'name', 500).replace('.[', '[')} AS name
    FROM ${WAREHOUSE_FROM}
    WHERE (ISNULL([del], N'') = N'' OR [del] = N'0')
      AND LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), [pass]), N''))) = N'1'
      ${kwSql}
    ORDER BY [code] ASC
  `)
  return r.recordset ?? []
}

async function fetchMaterialOptions(pool, keyword = '') {
  const req = pool.request()
  let kwSql = ''
  if (keyword) {
    req.input('kw', sql.NVarChar(400), likePattern(keyword))
    kwSql = `AND ${nvarcharTextExpr('', 'kcaa01', 200).replace('.[', '[')} LIKE @kw ESCAPE '\\'`
  }
  const r = await req.query(`
    SELECT TOP 100
      ${nvarcharTextExpr('', 'kcaa01', 200).replace('.[', '[')} AS code,
      ${nvarcharTextExpr('', 'kcaa02', 500).replace('.[', '[')} AS name,
      ${nvarcharTextExpr('', 'kcaa03', 500).replace('.[', '[')} AS spec,
      ${nvarcharTextExpr('', 'kcaa04', 100).replace('.[', '[')} AS unit,
      ${nvarcharTextExpr('', 'kcaa05', 200).replace('.[', '[')} AS categoryCode
    FROM ${BOM_FROM}
    WHERE (ISNULL([del], N'') = N'' OR [del] = N'0')
      AND ${nvarcharTextExpr('', 'kcaa01', 200).replace('.[', '[')} <> N''
      ${kwSql}
    ORDER BY [kcaa01] ASC, [id] DESC
  `)
  return r.recordset ?? []
}

async function fetchCategoryOptions(pool, keyword = '') {
  const req = pool.request()
  let kwSql = ''
  if (keyword) {
    req.input('kw', sql.NVarChar(400), likePattern(keyword))
    kwSql = `AND (${nvarcharTextExpr('', 'code', 200).replace('.[', '[')} LIKE @kw ESCAPE '\\'
      OR ${nvarcharTextExpr('', 'name', 500).replace('.[', '[')} LIKE @kw ESCAPE '\\')`
  }
  const r = await req.query(`
    SELECT TOP 100
      ${nvarcharTextExpr('', 'code', 200).replace('.[', '[')} AS code,
      ${nvarcharTextExpr('', 'name', 500).replace('.[', '[')} AS name
    FROM ${MATERIAL_CATEGORY_FROM}
    WHERE (ISNULL([del], N'') = N'' OR [del] = N'0')
      AND LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), [pass]), N''))) = N'1'
      ${kwSql}
    ORDER BY [code] ASC
  `)
  return r.recordset ?? []
}

function sendError(res, err, prefix) {
  res.status(500).json({ code: 500, msg: `${prefix}：${String(err?.message ?? err)}`, data: null })
}

export function registerStockIoStatsRoutes(app, { getPool }) {
  app.get('/api/stock-io-stats/print-header', async (_req, res) => {
    try {
      const pool = await getPool()
      res.json({ code: 200, msg: 'success', data: await fetchStockStatsPrintHeader(pool) })
    } catch (err) {
      sendError(res, err, '读取进销存统计打印抬头失败')
    }
  })

  app.get('/api/stock-io-stats/warehouse-options', async (req, res) => {
    try {
      const pool = await getPool()
      res.json({ code: 200, msg: 'success', data: { list: await fetchWarehouseOptions(pool, text(req.query?.keyword)) } })
    } catch (err) {
      sendError(res, err, '读取进销存统计仓库候选失败')
    }
  })

  app.get('/api/stock-io-stats/material-options', async (req, res) => {
    try {
      const pool = await getPool()
      res.json({ code: 200, msg: 'success', data: { list: await fetchMaterialOptions(pool, text(req.query?.keyword)) } })
    } catch (err) {
      sendError(res, err, '读取进销存统计物料候选失败')
    }
  })

  app.get('/api/stock-io-stats/category-options', async (req, res) => {
    try {
      const pool = await getPool()
      res.json({ code: 200, msg: 'success', data: { list: await fetchCategoryOptions(pool, text(req.query?.keyword)) } })
    } catch (err) {
      sendError(res, err, '读取进销存统计材料分类失败')
    }
  })

  app.get('/api/stock-io-stats/report', async (req, res) => {
    try {
      const q = parseReportQuery(req.query ?? {})
      const errMsg = validateReportQuery(q)
      if (errMsg) {
        res.status(400).json({ code: 400, msg: errMsg, data: null })
        return
      }

      const pool = await getPool()
      const canViewPrice = await canViewPriceColumns(pool, req)
      const reportReq = pool.request()
      bindReportParams(reportReq, q)
      const result = await reportReq.query(buildReportSql(q))
      const list = (result.recordset ?? [])
        .map((row) => serializeReportRow(row, canViewPrice))
        .filter(Boolean)

      res.json({
        code: 200,
        msg: 'success',
        data: {
          list,
          total: list.length,
          startDate: q.startDate,
          endDate: q.endDate,
          warehouseCode: q.warehouseCode,
          materialCode: q.materialCode,
          materialName: q.materialName,
          materialSpec: q.materialSpec,
          materialCategories: q.materialCategories,
          canViewPrice,
        },
      })
    } catch (err) {
      sendError(res, err, '读取进销存统计报表失败')
    }
  })
}

export const __stockIoStatsForTest = {
  MENU_PATH,
  ALL_WAREHOUSE,
  parseReportQuery,
  validateReportQuery,
  bindReportParams,
  buildInboundBaseWhereSql,
  buildOutboundBaseWhereSql,
  buildMovementSql,
  buildReportSql,
  buildComputedMetrics,
  serializeReportRow,
}
