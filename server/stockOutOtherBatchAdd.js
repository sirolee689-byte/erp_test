/**
 * 其他出库批量选材：按仓库 + 物料编码 kcaa01 汇总库存，分页展示可出物料。
 * SQL Server 2008 R2 兼容（ROW_NUMBER 分页）。
 * 性能：JOIN/WHERE 直比字段；数值/展示列仍用 safeDecimal / nvarcharTextExpr。
 */
import { sql } from './db.js'
import { nvarcharTextExpr, safeDecimalExpr } from './buyOrderSqlSafe.js'

const STOCK_IN_FROM = 'dbo.[UB_ERP_Stocks_Storage]'
const STOCK_IN_LINE_FROM = 'dbo.[UB_ERP_Stocks_Storage_list]'
const STOCK_OUT_FROM = 'dbo.[UB_ERP_Stocks_out]'
const STOCK_OUT_LINE_FROM = 'dbo.[UB_ERP_Stocks_out_list]'
const BOM_FROM = 'dbo.[UB_ERP_Bom_000]'
const MATERIAL_CAT_FROM = 'dbo.[UB_ERP_Stocks_material]'
const CURRENCY_FROM = 'dbo.[UB_ERP_Finance_currency]'

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

/** 旧表 del：空或 0 视为有效 */
function delActiveSql(alias) {
  return `ISNULL(${alias}.[del], N'0') IN (N'', N'0')`
}

/** 主表已审核 */
function passApprovedSql(alias) {
  return `${alias}.[pass] = N'1'`
}

export function calcOtherBatchStockQty({ approvedInQty, approvedOutQty, pendingOutQty }) {
  const bookQty = round(toNumber(approvedInQty) - toNumber(approvedOutQty), 4)
  const actualQty = round(bookQty - toNumber(pendingOutQty), 4)
  return {
    approvedInQty: round(toNumber(approvedInQty), 4),
    approvedOutQty: round(toNumber(approvedOutQty), 4),
    pendingOutQty: round(toNumber(pendingOutQty), 4),
    bookQty,
    actualQty,
    displayActualQty: actualQty > 0 ? actualQty : 0,
    selectable: actualQty > 0,
  }
}

export function formatMaterialPassLabel(pass) {
  const p = text(pass)
  if (p === '1') return '已审核'
  if (p === '0') return '未审核'
  if (p === '2') return '审核不通过'
  return '有效'
}

export function formatPurchaseDirection(kcaa27) {
  return text(kcaa27) === '1' ? '使用->采购' : '采购->使用'
}

export function formatQuoteDirection(kcaa31) {
  return text(kcaa31) === '1' ? '报价->使用' : '使用->报价'
}

export function formatCustomerSupplyLabel(value) {
  const n = Number(value)
  if (n === 1) return '是'
  if (n === 2) return '否'
  return text(value) || '-'
}

export function parseOtherBatchPage(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1)
  const rawPageSize = Number.parseInt(query.pageSize, 10) || 5
  const pageSize = Math.min(200, Math.max(1, rawPageSize))
  return { page, pageSize, startRow: (page - 1) * pageSize + 1, endRow: page * pageSize }
}

export function buildOtherBatchKeywordWhere(keyword, { bomAlias = 'bom' } = {}) {
  const kw = text(keyword)
  if (!kw) return ''
  const parts = [
    `sc.[materialCode] LIKE @keyword`,
    `${nvarcharTextExpr(bomAlias, 'systemcode', 200)} LIKE @keyword`,
    `${nvarcharTextExpr(bomAlias, 'location', 200)} LIKE @keyword`,
    `${nvarcharTextExpr(bomAlias, 'kcaa02_en', 500)} LIKE @keyword`,
    `${nvarcharTextExpr(bomAlias, 'kpname', 500)} LIKE @keyword`,
  ]
  for (const col of KCAA_COLS) {
    parts.push(`${nvarcharTextExpr(bomAlias, col, 500)} LIKE @keyword`)
  }
  return `AND (${parts.join(' OR ')})`
}

export function buildOtherBatchStockCoreSql({ excludeOutboundNo = '' } = {}) {
  const excludeSql = text(excludeOutboundNo)
    ? `AND oh.[kcap01] <> @excludeOutboundNo`
    : ''
  return `
    WITH materialBase AS (
      SELECT DISTINCT il.[kcaa01] AS materialCode
      FROM ${STOCK_IN_FROM} AS ih
      INNER JOIN ${STOCK_IN_LINE_FROM} AS il
        ON il.[kcao01] = ih.[kcan01]
      WHERE ${delActiveSql('ih')}
        AND ${passApprovedSql('ih')}
        AND ${delActiveSql('il')}
        AND ih.[kcan06] = @warehouseCode
        AND il.[kcaa01] IS NOT NULL
        AND il.[kcaa01] <> N''
    ),
    inAgg AS (
      SELECT
        il.[kcaa01] AS materialCode,
        SUM(${safeDecimalExpr('il', 'kcao03')}) AS approvedInQty
      FROM ${STOCK_IN_FROM} AS ih
      INNER JOIN ${STOCK_IN_LINE_FROM} AS il
        ON il.[kcao01] = ih.[kcan01]
      WHERE ${delActiveSql('ih')}
        AND ${passApprovedSql('ih')}
        AND ${delActiveSql('il')}
        AND ih.[kcan06] = @warehouseCode
      GROUP BY il.[kcaa01]
    ),
    outAgg AS (
      SELECT
        ol.[kcaa01] AS materialCode,
        SUM(CASE WHEN oh.[pass] = N'1' THEN ${safeDecimalExpr('ol', 'kcaq03')} ELSE 0 END) AS approvedOutQty,
        SUM(CASE WHEN ISNULL(oh.[pass], N'0') <> N'1' THEN ${safeDecimalExpr('ol', 'kcaq03')} ELSE 0 END) AS pendingOutQty
      FROM ${STOCK_OUT_FROM} AS oh
      INNER JOIN ${STOCK_OUT_LINE_FROM} AS ol
        ON ol.[kcaq01] = oh.[kcap01]
      WHERE ${delActiveSql('oh')}
        AND ${delActiveSql('ol')}
        AND oh.[kcap06] = @warehouseCode
        ${excludeSql}
      GROUP BY ol.[kcaa01]
    ),
    stockCore AS (
      SELECT
        b.[materialCode],
        ISNULL(i.[approvedInQty], 0) AS approvedInQty,
        ISNULL(o.[approvedOutQty], 0) AS approvedOutQty,
        ISNULL(o.[pendingOutQty], 0) AS pendingOutQty,
        ISNULL(i.[approvedInQty], 0) - ISNULL(o.[approvedOutQty], 0) AS bookQty,
        ISNULL(i.[approvedInQty], 0) - ISNULL(o.[approvedOutQty], 0) - ISNULL(o.[pendingOutQty], 0) AS actualQty
      FROM materialBase AS b
      LEFT JOIN inAgg AS i ON i.[materialCode] = b.[materialCode]
      LEFT JOIN outAgg AS o ON o.[materialCode] = b.[materialCode]
    )
  `
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
    'pass',
    ...KCAA_COLS,
  ]
  return cols.map((col) => `${nvarcharTextExpr('bom', col, 500)} AS [${col}]`).join(',\n        ')
}

export function buildOtherBatchListSql({ keyword = '', excludeOutboundNo = '' } = {}) {
  const keywordWhere = buildOtherBatchKeywordWhere(keyword)
  const coreSql = buildOtherBatchStockCoreSql({ excludeOutboundNo })
  return `
    ${coreSql},
    joined AS (
      SELECT
        sc.[materialCode],
        sc.[approvedInQty],
        sc.[approvedOutQty],
        sc.[pendingOutQty],
        sc.[bookQty],
        sc.[actualQty],
        ${bomSelectList()},
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(cat.[name], N'')))) AS categoryName,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(cur35.[name], N'')))) AS purchaseCurrencyName,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(cur34.[name], N'')))) AS quoteCurrencyName
      FROM stockCore AS sc
      LEFT JOIN ${BOM_FROM} AS bom
        ON bom.[kcaa01] = sc.[materialCode]
        AND ${delActiveSql('bom')}
      LEFT JOIN ${MATERIAL_CAT_FROM} AS cat
        ON cat.[code] = bom.[kcaa05]
        AND ${delActiveSql('cat')}
      LEFT JOIN ${CURRENCY_FROM} AS cur35
        ON cur35.[code] = bom.[kcaa35]
      LEFT JOIN ${CURRENCY_FROM} AS cur34
        ON cur34.[code] = bom.[kcaa34]
      WHERE 1 = 1
        ${keywordWhere}
    ),
    numbered AS (
      SELECT
        ROW_NUMBER() OVER (ORDER BY [materialCode] ASC) AS rn,
        COUNT(1) OVER () AS totalCount,
        *
      FROM joined
    )
    SELECT *
    FROM numbered
    WHERE rn BETWEEN @startRow AND @endRow
    ORDER BY rn ASC
  `
}

/** 仅当分页超出范围且列表为空时作兜底 count */
export function buildOtherBatchCountSql({ keyword = '', excludeOutboundNo = '' } = {}) {
  const keywordWhere = buildOtherBatchKeywordWhere(keyword)
  const coreSql = buildOtherBatchStockCoreSql({ excludeOutboundNo })
  return `
    ${coreSql},
    joined AS (
      SELECT sc.[materialCode]
      FROM stockCore AS sc
      LEFT JOIN ${BOM_FROM} AS bom
        ON bom.[kcaa01] = sc.[materialCode]
        AND ${delActiveSql('bom')}
      WHERE 1 = 1
        ${keywordWhere}
    )
    SELECT COUNT(1) AS total FROM joined
  `
}

export function enrichOtherBatchRow(row = {}) {
  const stock = calcOtherBatchStockQty({
    approvedInQty: row.approvedInQty,
    approvedOutQty: row.approvedOutQty,
    pendingOutQty: row.pendingOutQty,
  })
  const alreadySelected = !!row.alreadySelected
  let selectLabel = '库存不足'
  let selectState = 'disabled_stock'
  let selectable = false
  if (alreadySelected) {
    selectLabel = '已选择'
    selectState = 'picked'
  } else if (stock.selectable) {
    selectLabel = '选择'
    selectState = 'select'
    selectable = true
  }
  return {
    ...row,
    lineKey: text(row.materialCode).toLowerCase(),
    materialCode: text(row.materialCode),
    kcaa01: text(row.materialCode),
    location: text(row.location),
    ...stock,
    selectLabel,
    selectState,
    selectable,
    categoryName: text(row.categoryName) || text(row.kcaa05),
    purchaseCurrencyName: text(row.purchaseCurrencyName),
    quoteCurrencyName: text(row.quoteCurrencyName),
    passLabel: formatMaterialPassLabel(row.pass),
    purchaseDirectionLabel: formatPurchaseDirection(row.kcaa27),
    quoteDirectionLabel: formatQuoteDirection(row.kcaa31),
    customerSupplyLabel: formatCustomerSupplyLabel(row.Customer_supply),
  }
}

/** 单物料取价 SQL（参数 @materialCode） */
export function buildOtherBatchPriceSql() {
  return `
    WITH priced AS (
      SELECT
        lp.[kcaa01] AS materialCode,
        ${safeDecimalExpr('lp', 'kcao04')} AS kcaq04,
        ${safeDecimalExpr('lp', 'kcao041')} AS kcaq041,
        ${safeDecimalExpr('lp', 'tax', 0)} AS tax,
        ROW_NUMBER() OVER (PARTITION BY lp.[kcaa01] ORDER BY lh.[id] DESC) AS rn
      FROM ${STOCK_IN_FROM} AS lh
      INNER JOIN ${STOCK_IN_LINE_FROM} AS lp
        ON lp.[kcao01] = lh.[kcan01]
      WHERE ${delActiveSql('lh')}
        AND ${passApprovedSql('lh')}
        AND ISNULL(lh.[sp_flag], N'') = N'1'
        AND ${delActiveSql('lp')}
        AND lh.[kcan06] = @warehouseCode
        AND lp.[kcaa01] = @materialCode
    )
    SELECT materialCode, kcaq04, kcaq041, tax
    FROM priced
    WHERE rn = 1
  `
}

/** 批量取最近复核入库价：每个物料编码一条（ROW_NUMBER） */
export function buildOtherBatchPricesSql(codeCount) {
  const n = Math.max(0, Math.floor(Number(codeCount) || 0))
  if (n <= 0) return ''
  const inList = Array.from({ length: n }, (_, i) => `@code${i}`).join(', ')
  return `
    WITH priced AS (
      SELECT
        lp.[kcaa01] AS materialCode,
        ${safeDecimalExpr('lp', 'kcao04')} AS kcaq04,
        ${safeDecimalExpr('lp', 'kcao041')} AS kcaq041,
        ${safeDecimalExpr('lp', 'tax', 0)} AS tax,
        ROW_NUMBER() OVER (PARTITION BY lp.[kcaa01] ORDER BY lh.[id] DESC) AS rn
      FROM ${STOCK_IN_FROM} AS lh
      INNER JOIN ${STOCK_IN_LINE_FROM} AS lp
        ON lp.[kcao01] = lh.[kcan01]
      WHERE ${delActiveSql('lh')}
        AND ${passApprovedSql('lh')}
        AND ISNULL(lh.[sp_flag], N'') = N'1'
        AND ${delActiveSql('lp')}
        AND lh.[kcan06] = @warehouseCode
        AND lp.[kcaa01] IN (${inList})
    )
    SELECT materialCode, kcaq04, kcaq041, tax
    FROM priced
    WHERE rn = 1
  `
}

export function enrichOtherBatchLineWithPrice(row = {}, priceRow = null) {
  const qty = toNumber(row.actualQty)
  const ex = toNumber(priceRow?.kcaq04)
  const inc = toNumber(priceRow?.kcaq041)
  const tax = toNumber(priceRow?.tax ?? priceRow?.Tax)
  return {
    ...row,
    kcaq03: qty,
    kcaq031: qty,
    availableQty: qty,
    kcaq04: round(ex, 4),
    kcaq041: round(inc, 4),
    tax: round(tax, 4),
    kcaq05: round(qty * ex, 2),
    kcaq051: round(qty * inc, 2),
  }
}

function bindOtherBatchListInputs(req, { warehouseCode, keyword, excludeOutboundNo, startRow, endRow }) {
  let r = req.input('warehouseCode', sql.NVarChar(200), warehouseCode)
  if (startRow != null) r = r.input('startRow', sql.Int, startRow)
  if (endRow != null) r = r.input('endRow', sql.Int, endRow)
  if (keyword) r = r.input('keyword', sql.NVarChar(400), `%${keyword}%`)
  if (excludeOutboundNo) r = r.input('excludeOutboundNo', sql.NVarChar(200), excludeOutboundNo)
  return r
}

async function fetchOtherBatchTotalFallback(pool, { warehouseCode, keyword, excludeOutboundNo }) {
  const countReq = bindOtherBatchListInputs(pool.request(), { warehouseCode, keyword, excludeOutboundNo })
  const countResult = await countReq.query(buildOtherBatchCountSql({ keyword, excludeOutboundNo }))
  return Number(countResult.recordset?.[0]?.total ?? 0)
}

export async function fetchStockOutOtherBatchLines(pool, query = {}) {
  const warehouseCode = text(query.warehouseCode)
  if (!warehouseCode) {
    return { ok: false, status: 400, msg: '请先选择仓库' }
  }
  const { page, pageSize, startRow, endRow } = parseOtherBatchPage(query)
  const keyword = text(query.keyword)
  const excludeOutboundNo = text(query.excludeOutboundNo)
  const selectedKeys = new Set(
    (Array.isArray(query.selectedKeys) ? query.selectedKeys : String(query.selectedKeys ?? '').split(','))
      .map((k) => text(k).toLowerCase())
      .filter(Boolean),
  )

  const listReq = bindOtherBatchListInputs(pool.request(), {
    warehouseCode,
    keyword,
    excludeOutboundNo,
    startRow,
    endRow,
  })
  const listResult = await listReq.query(buildOtherBatchListSql({ keyword, excludeOutboundNo }))
  const rawRows = listResult.recordset ?? []

  let total = 0
  if (rawRows.length > 0) {
    total = Number(rawRows[0].totalCount ?? 0)
  } else if (page === 1) {
    total = 0
  } else {
    total = await fetchOtherBatchTotalFallback(pool, { warehouseCode, keyword, excludeOutboundNo })
  }

  const list = rawRows.map((row) => enrichOtherBatchRow({
    ...row,
    alreadySelected: selectedKeys.has(text(row.materialCode).toLowerCase()),
  }))
  return { ok: true, list, total, page, pageSize, warehouseCode }
}

export async function fetchStockOutOtherBatchPrices(pool, { warehouseCode, materialCodes = [] } = {}) {
  const wh = text(warehouseCode)
  if (!wh) return { ok: false, status: 400, msg: '请先选择仓库' }
  const codes = [...new Set((materialCodes ?? []).map((c) => text(c)).filter(Boolean))]
  const priceMap = Object.fromEntries(codes.map((c) => [c, null]))
  if (!codes.length) return { ok: true, priceMap }

  const priceSql = buildOtherBatchPricesSql(codes.length)
  let req = pool.request().input('warehouseCode', sql.NVarChar(200), wh)
  codes.forEach((code, i) => {
    req = req.input(`code${i}`, sql.NVarChar(200), code)
  })
  const r = await req.query(priceSql)
  for (const row of r.recordset ?? []) {
    const code = text(row.materialCode)
    if (code) priceMap[code] = row
  }
  return { ok: true, priceMap }
}
