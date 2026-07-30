import { clampErpPageSize, ERP_MAX_PAGE_SIZE } from './erpPagination.js'
/**
 * 盘盈入库批量选材：从物料主档选材，不按当前库存正数限制。
 * SQL Server 2008 R2 兼容（ROW_NUMBER 分页）。
 */
import { sql } from './db.js'
import { nvarcharTextExpr, safeDecimalExpr } from './buyOrderSqlSafe.js'

const BOM_FROM = 'dbo.[UB_ERP_Bom_000]'
const MATERIAL_CAT_FROM = 'dbo.[New_UB_ERP_Stocks_material]'
const STOCK_IN_FROM = 'dbo.[UB_ERP_Stocks_Storage]'
const STOCK_IN_LINE_FROM = 'dbo.[UB_ERP_Stocks_Storage_list]'

const KCAA_COLS = Array.from({ length: 35 }, (_, i) => `kcaa${String(i + 1).padStart(2, '0')}`)

function text(v) {
  return String(v ?? '').trim()
}

function toNumber(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function round(n, p = 4) {
  const m = 10 ** p
  return Math.round((toNumber(n) + Number.EPSILON) * m) / m
}

function delActiveSql(alias) {
  return `ISNULL(${alias}.[del], N'0') IN (N'', N'0')`
}

export function parseSurplusBatchPage(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1)
  const rawPageSize = Number.parseInt(query.pageSize, 10) || 10
  const pageSize = clampErpPageSize(rawPageSize, 10)
  return { page, pageSize, startRow: (page - 1) * pageSize + 1, endRow: page * pageSize }
}

function bomSelectList() {
  const cols = [
    'GUID',
    'systemcode',
    'location',
    'sale_price',
    'cost_price',
    'Customer_supply',
    'Customer_Name',
    'remark',
    'kpname',
    'kcaa02_en',
    ...KCAA_COLS,
  ]
  return cols.map((col) => `${nvarcharTextExpr('bom', col, 500)} AS [${col}]`).join(',\n        ')
}

export function buildSurplusBatchKeywordWhere(keyword) {
  if (!text(keyword)) return ''
  // 批量添加搜索仅材料编码 kcaa01 模糊（盘盈/其他入库共用）
  return `AND (${nvarcharTextExpr('bom', 'kcaa01', 300)} LIKE @keyword)`
}

export function buildSurplusBatchListSql({ keyword = '' } = {}) {
  const keywordWhere = buildSurplusBatchKeywordWhere(keyword)
  return `
    WITH source AS (
      SELECT
        ${bomSelectList()},
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(cat.[name], N'')))) AS categoryName
      FROM ${BOM_FROM} AS bom
      LEFT JOIN ${MATERIAL_CAT_FROM} AS cat
        ON cat.[code] = bom.[kcaa05]
        AND ${delActiveSql('cat')}
      WHERE ${delActiveSql('bom')}
        AND ${nvarcharTextExpr('bom', 'kcaa01', 300)} <> N''
        ${keywordWhere}
    ),
    numbered AS (
      SELECT
        ROW_NUMBER() OVER (ORDER BY [kcaa01] ASC, [systemcode] ASC) AS rn,
        COUNT(1) OVER () AS totalCount,
        *
      FROM source
    )
    SELECT *
    FROM numbered
    WHERE rn BETWEEN @startRow AND @endRow
    ORDER BY rn ASC
  `
}

export function buildSurplusBatchPricesSql(codeCount) {
  const n = Math.max(0, Math.floor(Number(codeCount) || 0))
  if (n <= 0) return ''
  const inList = Array.from({ length: n }, (_, i) => `@code${i}`).join(', ')
  return `
    WITH priced AS (
      SELECT
        l.[kcaa01] AS materialCode,
        ${safeDecimalExpr('l', 'kcao04')} AS kcao04,
        ${safeDecimalExpr('l', 'kcao041')} AS kcao041,
        ${safeDecimalExpr('l', 'tax', 0)} AS tax,
        ROW_NUMBER() OVER (PARTITION BY l.[kcaa01] ORDER BY h.[id] DESC, l.[id] DESC) AS rn
      FROM ${STOCK_IN_FROM} AS h
      INNER JOIN ${STOCK_IN_LINE_FROM} AS l
        ON l.[kcao01] = h.[kcan01]
      WHERE ${delActiveSql('h')}
        AND ${delActiveSql('l')}
        AND LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(h.[pass], N'')))) = N'1'
        AND LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(h.[sp_flag], N'')))) = N'1'
        AND h.[kcan06] = @warehouseCode
        AND l.[kcaa01] IN (${inList})
    )
    SELECT materialCode, kcao04, kcao041, tax
    FROM priced
    WHERE rn = 1
  `
}

export function enrichSurplusBatchRow(row = {}, alreadySelected = false) {
  const lineKey = text(row.systemcode) || text(row.GUID) || text(row.kcaa01)
  return {
    ...row,
    lineKey: lineKey.toLowerCase(),
    selectable: !alreadySelected,
    selectLabel: alreadySelected ? '已选择' : '选择',
    selectState: alreadySelected ? 'picked' : 'select',
    materialCode: text(row.kcaa01),
    categoryName: text(row.categoryName) || text(row.kcaa05),
  }
}

export function enrichSurplusBatchLineWithPrice(row = {}, priceRow = null, { inTax = '1' } = {}) {
  const qty = 1
  const ex = round(priceRow?.kcao04, 4)
  const inc = round(priceRow?.kcao041, 4)
  const tax = text(inTax) === '2' ? 0 : round(priceRow?.tax ?? priceRow?.Tax, 4)
  return {
    ...row,
    kcao02: text(row.systemcode) || text(row.GUID) || '',
    kcan04: '',
    kcao03: qty,
    kcao031: qty,
    availableQty: qty,
    needQty: qty,
    kcao04: ex,
    kcao041: inc,
    tax,
    kcao05: round(qty * ex, 2),
    kcao051: round(qty * inc, 2),
    reference: '',
    Describe: '',
    info: '',
  }
}

export async function fetchStockInSurplusBatchLines(pool, query = {}) {
  const { page, pageSize, startRow, endRow } = parseSurplusBatchPage(query)
  const keyword = text(query.keyword)
  const selectedKeys = new Set(
    (Array.isArray(query.selectedKeys) ? query.selectedKeys : String(query.selectedKeys ?? '').split(','))
      .map((k) => text(k).toLowerCase())
      .filter(Boolean),
  )
  let req = pool.request()
    .input('startRow', sql.Int, startRow)
    .input('endRow', sql.Int, endRow)
  if (keyword) req = req.input('keyword', sql.NVarChar(400), `%${keyword}%`)
  const r = await req.query(buildSurplusBatchListSql({ keyword }))
  const rawRows = r.recordset ?? []
  const total = rawRows.length > 0 ? Number(rawRows[0].totalCount ?? 0) : 0
  const list = rawRows.map((row) => {
    const key = (text(row.systemcode) || text(row.GUID) || text(row.kcaa01)).toLowerCase()
    return enrichSurplusBatchRow(row, selectedKeys.has(key))
  })
  return { ok: true, list, total, page, pageSize }
}

export async function fetchStockInSurplusBatchPrices(pool, { warehouseCode, materialCodes = [] } = {}) {
  const wh = text(warehouseCode)
  if (!wh) return { ok: false, status: 400, msg: '请先选择仓库' }
  const codes = [...new Set((materialCodes ?? []).map((c) => text(c)).filter(Boolean))]
  const priceMap = Object.fromEntries(codes.map((c) => [c, null]))
  if (!codes.length) return { ok: true, priceMap }
  let req = pool.request().input('warehouseCode', sql.NVarChar(200), wh)
  codes.forEach((code, i) => {
    req = req.input(`code${i}`, sql.NVarChar(200), code)
  })
  const r = await req.query(buildSurplusBatchPricesSql(codes.length))
  for (const row of r.recordset ?? []) {
    const code = text(row.materialCode)
    if (code) priceMap[code] = row
  }
  return { ok: true, priceMap }
}
