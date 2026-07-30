import { sql } from './db.js'
import { safeDecimalExpr } from './buyOrderSqlSafe.js'
import { coerceScalarValue } from './stockOutExpandLines.js'

const STOCK_IN_FROM = 'dbo.[UB_ERP_Stocks_Storage]'
const STOCK_IN_LINE_FROM = 'dbo.[UB_ERP_Stocks_Storage_list]'
const STOCK_OUT_FROM = 'dbo.[UB_ERP_Stocks_out]'
const STOCK_OUT_LINE_FROM = 'dbo.[UB_ERP_Stocks_out_list]'
const BOM_FROM = 'dbo.[UB_ERP_Bom_000]'
const COLOR_FROM = 'dbo.[UB_ERP_Stocks_colorcode]'
const MATERIAL_CAT_FROM = 'dbo.[New_UB_ERP_Stocks_material]'
const BUY_FROM = 'dbo.[UB_ERP_Buy_order]'
const BUY_LINE_FROM = 'dbo.[UB_ERP_Buy_order_list]'

function text(value) {
  return String(coerceScalarValue(value) ?? '').trim()
}

function number(value) {
  const n = Number(coerceScalarValue(value))
  return Number.isFinite(n) ? n : 0
}

function serializeValue(value) {
  return value instanceof Date ? value.toISOString() : coerceScalarValue(value)
}

function formatDate(value) {
  const v = serializeValue(value)
  if (!v) return ''
  return text(v).replace('T', ' ').replace(/\.\d{3}Z?$/, '')
}

function formatDateOnly(value) {
  const v = formatDate(value)
  return v ? v.slice(0, 10) : ''
}

function trimZeros(value, maxDecimals = 4) {
  if (value === null || value === undefined || value === '') return ''
  const n = number(value)
  const fixed = n.toFixed(maxDecimals)
  return fixed.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '')
}

function activeDelSql(alias) {
  return `(ISNULL(${alias}.[del], N'') = N'' OR ${alias}.[del] = N'0')`
}

function approvedSql(alias) {
  return `LTRIM(RTRIM(ISNULL(${alias}.[pass], N''))) = N'1'`
}

function nvarcharExpr(alias, col, size = 500) {
  return `LTRIM(RTRIM(CONVERT(nvarchar(${size}), ISNULL(${alias}.[${col}], N''))))`
}

export function parseStockInMaterialQrQuery(query = {}) {
  return {
    action: text(query.action).toLowerCase(),
    materialCode: text(query.kcaa01),
    receiptNo: text(query.kcao01),
  }
}

export function validateStockInMaterialQrQuery(parsed) {
  if (parsed.action !== 'stocks') return '二维码类型不正确'
  if (!parsed.materialCode || !parsed.receiptNo) return '二维码参数不完整'
  return ''
}

export function buildStockInMaterialQrBaseSql() {
  return `
    SELECT TOP 1
      h.[kcan01] AS receiptNo,
      h.[kcan02] AS inboundTime,
      h.[kcan04] AS sourceOrderNo,
      h.[kcan07] AS handlerName,
      l.[id] AS lineId,
      l.[reference] AS reference,
      ${safeDecimalExpr('l', 'kcao03')} AS inboundQty,
      ${nvarcharExpr('l', 'kcaa01', 300)} AS materialCode,
      ${nvarcharExpr('l', 'kcaa02', 500)} AS chineseName,
      ${nvarcharExpr('l', 'kcaa02_en', 500)} AS englishName,
      ${nvarcharExpr('l', 'kcaa03', 500)} AS spec,
      ${nvarcharExpr('l', 'kcaa04', 100)} AS unit,
      ${nvarcharExpr('l', 'kcaa05', 200)} AS categoryCode,
      ${nvarcharExpr('l', 'kcaa10', 300)} AS groupName,
      ${nvarcharExpr('l', 'kcaa11', 200)} AS colorCode,
      ${nvarcharExpr('l', 'location', 300)} AS origin,
      ${nvarcharExpr('l', 'Describe', 800)} AS lineRemark,
      ${nvarcharExpr('bom', 'kcaa02', 500)} AS bomChineseName,
      ${nvarcharExpr('bom', 'kcaa02_en', 500)} AS bomEnglishName,
      ${nvarcharExpr('bom', 'kcaa03', 500)} AS bomSpec,
      ${nvarcharExpr('bom', 'kcaa04', 100)} AS bomUnit,
      ${nvarcharExpr('bom', 'kcaa05', 200)} AS bomCategoryCode,
      ${nvarcharExpr('bom', 'kcaa10', 300)} AS bomGroupName,
      ${nvarcharExpr('bom', 'kcaa11', 200)} AS bomColorCode,
      ${nvarcharExpr('bom', 'location', 300)} AS bomOrigin,
      ${nvarcharExpr('bom', 'remark', 800)} AS bomRemark,
      ${nvarcharExpr('cat', 'name', 500)} AS categoryName,
      ${nvarcharExpr('color', 'name', 300)} AS colorName
    FROM ${STOCK_IN_FROM} AS h
    INNER JOIN ${STOCK_IN_LINE_FROM} AS l
      ON l.[kcao01] = h.[kcan01]
    LEFT JOIN ${BOM_FROM} AS bom
      ON bom.[kcaa01] = l.[kcaa01]
     AND ${activeDelSql('bom')}
    LEFT JOIN ${MATERIAL_CAT_FROM} AS cat
      ON cat.[code] = ISNULL(NULLIF(l.[kcaa05], N''), bom.[kcaa05])
     AND ${activeDelSql('cat')}
    LEFT JOIN ${COLOR_FROM} AS color
      ON color.[code] = ISNULL(NULLIF(l.[kcaa11], N''), bom.[kcaa11])
     AND ${activeDelSql('color')}
     AND ${approvedSql('color')}
    WHERE ${activeDelSql('h')}
      AND ${activeDelSql('l')}
      AND h.[kcan01] = @receiptNo
      AND l.[kcaa01] = @materialCode
    ORDER BY ISNULL(l.[seq], l.[id]), l.[id]
  `
}

export function buildStockInMaterialQrInventorySql() {
  return `
    WITH inAgg AS (
      SELECT
        CASE
          WHEN ih.[ck] LIKE N'%板房%' OR ih.[kcan06] LIKE N'%板房%' THEN N'板房'
          WHEN ih.[ck] LIKE N'%货仓%' OR ih.[kcan06] LIKE N'%货仓%' THEN N'货仓'
          ELSE N''
        END AS warehouseGroup,
        SUM(${safeDecimalExpr('il', 'kcao03')}) AS qty
      FROM ${STOCK_IN_FROM} AS ih
      INNER JOIN ${STOCK_IN_LINE_FROM} AS il ON il.[kcao01] = ih.[kcan01]
      WHERE ${activeDelSql('ih')}
        AND ${activeDelSql('il')}
        AND ${approvedSql('ih')}
        AND il.[kcaa01] = @materialCode
      GROUP BY
        CASE
          WHEN ih.[ck] LIKE N'%板房%' OR ih.[kcan06] LIKE N'%板房%' THEN N'板房'
          WHEN ih.[ck] LIKE N'%货仓%' OR ih.[kcan06] LIKE N'%货仓%' THEN N'货仓'
          ELSE N''
        END
    ),
    outAgg AS (
      SELECT
        CASE
          WHEN oh.[ck] LIKE N'%板房%' OR oh.[kcap06] LIKE N'%板房%' THEN N'板房'
          WHEN oh.[ck] LIKE N'%货仓%' OR oh.[kcap06] LIKE N'%货仓%' THEN N'货仓'
          ELSE N''
        END AS warehouseGroup,
        SUM(${safeDecimalExpr('ol', 'kcaq03')}) AS qty
      FROM ${STOCK_OUT_FROM} AS oh
      INNER JOIN ${STOCK_OUT_LINE_FROM} AS ol ON ol.[kcaq01] = oh.[kcap01]
      WHERE ${activeDelSql('oh')}
        AND ${activeDelSql('ol')}
        AND ${approvedSql('oh')}
        AND ol.[kcaa01] = @materialCode
      GROUP BY
        CASE
          WHEN oh.[ck] LIKE N'%板房%' OR oh.[kcap06] LIKE N'%板房%' THEN N'板房'
          WHEN oh.[ck] LIKE N'%货仓%' OR oh.[kcap06] LIKE N'%货仓%' THEN N'货仓'
          ELSE N''
        END
    )
    SELECT x.[warehouseGroup], ISNULL(i.[qty], 0) - ISNULL(o.[qty], 0) AS qty
    FROM (
      SELECT N'货仓' AS warehouseGroup
      UNION ALL
      SELECT N'板房' AS warehouseGroup
    ) AS x
    LEFT JOIN inAgg AS i ON i.[warehouseGroup] = x.[warehouseGroup]
    LEFT JOIN outAgg AS o ON o.[warehouseGroup] = x.[warehouseGroup]
  `
}

export function buildStockInMaterialQrRecentPurchaseSql() {
  return `
    SELECT TOP 10
      h.[kcaj01] AS purchaseNo,
      h.[kcaj02] AS purchaseDate,
      SUM(${safeDecimalExpr('l', 'kcak03')}) AS qty
    FROM ${BUY_FROM} AS h
    INNER JOIN ${BUY_LINE_FROM} AS l ON l.[kcak01] = h.[kcaj01]
    WHERE ${activeDelSql('h')}
      AND ${activeDelSql('l')}
      AND l.[kcaa01] = @materialCode
    GROUP BY h.[kcaj01], h.[kcaj02]
    ORDER BY h.[kcaj02] DESC, h.[kcaj01] DESC
  `
}

export function buildStockInMaterialQrRecentInboundSql() {
  return `
    SELECT TOP 5
      h.[kcan01] AS receiptNo,
      h.[kcan02] AS inboundTime,
      h.[kcan04] AS sourceOrderNo,
      SUM(${safeDecimalExpr('l', 'kcao03')}) AS qty
    FROM ${STOCK_IN_FROM} AS h
    INNER JOIN ${STOCK_IN_LINE_FROM} AS l ON l.[kcao01] = h.[kcan01]
    WHERE ${activeDelSql('h')}
      AND ${activeDelSql('l')}
      AND ${approvedSql('h')}
      AND l.[kcaa01] = @materialCode
    GROUP BY h.[kcan01], h.[kcan02], h.[kcan04]
    ORDER BY h.[kcan02] DESC, h.[kcan01] DESC
  `
}

function firstText(...values) {
  for (const value of values) {
    const t = text(value)
    if (t) return t
  }
  return ''
}

function mapInventory(rows = []) {
  const out = { warehouseQty: '0', sampleRoomQty: '0' }
  for (const row of rows) {
    const key = text(row.warehouseGroup)
    const qty = trimZeros(row.qty, 4) || '0'
    if (key === '货仓') out.warehouseQty = qty
    if (key === '板房') out.sampleRoomQty = qty
  }
  return out
}

function mapBase(row) {
  const colorCode = firstText(row.colorCode, row.bomColorCode)
  const colorName = text(row.colorName)
  return {
    receiptNo: text(row.receiptNo),
    sourceOrderNo: text(row.sourceOrderNo),
    inboundQty: trimZeros(row.inboundQty, 4),
    piNo: text(row.reference),
    materialCode: text(row.materialCode),
    chineseName: firstText(row.chineseName, row.bomChineseName),
    englishName: firstText(row.englishName, row.bomEnglishName),
    spec: firstText(row.spec, row.bomSpec),
    color: colorName && colorCode ? `${colorName}/${colorCode}` : colorCode,
    unit: firstText(row.unit, row.bomUnit),
    category: firstText(row.categoryName, row.categoryCode, row.bomCategoryCode),
    groupName: firstText(row.groupName, row.bomGroupName),
    origin: firstText(row.origin, row.bomOrigin),
    remark: firstText(row.lineRemark, row.bomRemark),
    inboundTime: formatDate(row.inboundTime),
    handlerName: text(row.handlerName),
  }
}

function mapRecentPurchase(row) {
  return {
    purchaseNo: text(row.purchaseNo),
    date: formatDateOnly(row.purchaseDate),
    qty: trimZeros(row.qty, 4),
  }
}

function mapRecentInbound(row) {
  return {
    receiptNo: text(row.receiptNo),
    time: formatDate(row.inboundTime),
    sourceOrderNo: text(row.sourceOrderNo),
    qty: trimZeros(row.qty, 4),
  }
}

export async function fetchStockInMaterialQrInfo(pool, query = {}) {
  const parsed = parseStockInMaterialQrQuery(query)
  const err = validateStockInMaterialQrQuery(parsed)
  if (err) return { ok: false, status: 400, msg: err }

  const baseReq = pool.request()
    .input('receiptNo', sql.NVarChar(200), parsed.receiptNo)
    .input('materialCode', sql.NVarChar(300), parsed.materialCode)
  const baseResult = await baseReq.query(buildStockInMaterialQrBaseSql())
  const baseRow = baseResult.recordset?.[0]
  if (!baseRow) return { ok: false, status: 404, msg: '数据不存在，请返回检查！' }

  const invReq = pool.request().input('materialCode', sql.NVarChar(300), parsed.materialCode)
  const purchaseReq = pool.request().input('materialCode', sql.NVarChar(300), parsed.materialCode)
  const inboundReq = pool.request().input('materialCode', sql.NVarChar(300), parsed.materialCode)

  const [inventoryResult, purchaseResult, inboundResult] = await Promise.all([
    invReq.query(buildStockInMaterialQrInventorySql()),
    purchaseReq.query(buildStockInMaterialQrRecentPurchaseSql()),
    inboundReq.query(buildStockInMaterialQrRecentInboundSql()),
  ])

  return {
    ok: true,
    info: {
      ...mapBase(baseRow),
      inventory: mapInventory(inventoryResult.recordset ?? []),
      recentPurchases: (purchaseResult.recordset ?? []).map(mapRecentPurchase),
      recentInbounds: (inboundResult.recordset ?? []).map(mapRecentInbound),
      updateDate: new Date().toISOString().slice(0, 10),
      developerName: '廖越锋',
    },
  }
}
