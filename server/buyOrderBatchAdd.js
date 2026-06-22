import { sql } from './db.js'
import {
  BUY_KCAA_DECIMAL_FIELDS,
  flagIsOneExpr,
  likeTextExpr,
  safeDecimalExpr,
  safeIntExpr,
} from './buyOrderSqlSafe.js'

const PI_COST_FROM = 'dbo.[UB_ERP_Bom_pi_cost]'
const BOM_000_FROM = 'dbo.[UB_ERP_Bom_000]'
const SALES_LIST_FROM = 'dbo.[UB_ERP_Bom_Sales_list]'
const BOM_CODE_FROM = 'dbo.[UB_ERP_Bom_code]'
const BUY_ORDER_FROM = 'dbo.[UB_ERP_Buy_order]'
const BUY_ORDER_LINE_FROM = 'dbo.[UB_ERP_Buy_order_list]'
const BUY_OFFER_FROM = 'dbo.[UB_ERP_Buy_offer]'
const BUY_OFFER_LINE_FROM = 'dbo.[UB_ERP_Buy_offer_list]'
const STOCK_IN_FROM = 'dbo.[UB_ERP_Stocks_Storage]'
const STOCK_IN_LINE_FROM = 'dbo.[UB_ERP_Stocks_Storage_list]'
const MATERIAL_CATEGORY_FROM = 'dbo.[UB_ERP_Stocks_material]'
const CURRENCY_FROM = 'dbo.[UB_ERP_Finance_currency]'

const KCAA_FIELDS = Array.from({ length: 35 }, (_, i) => `kcaa${String(i + 1).padStart(2, '0')}`)
const KCAA_DECIMAL_FIELDS = BUY_KCAA_DECIMAL_FIELDS
function text(value) {
  return String(value ?? '').trim()
}

function parsePositiveInt(value) {
  const n = Number.parseInt(String(value ?? '').trim(), 10)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function toNumber(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function round(value, places = 6) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  const p = 10 ** places
  return Math.round(n * p) / p
}

function sqlText(alias, col, asName = col) {
  return `LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(${alias}.[${col}], N'')))) AS [${asName}]`
}

function sqlMaxText(col, asName = col) {
  return `MAX(LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(c.[${col}], N''))))) AS [${asName}]`
}

function sqlMaxDec(col, asName = col) {
  return `MAX(${safeDecimalExpr('c', col)}) AS [${asName}]`
}

function sqlMaxKcaa(col) {
  return KCAA_DECIMAL_FIELDS.has(col) ? sqlMaxDec(col) : sqlMaxText(col)
}

function sqlMaxKcaaFrom(alias, col) {
  return KCAA_DECIMAL_FIELDS.has(col)
    ? `MAX(${safeDecimalExpr(alias, col)}) AS [${col}]`
    : `MAX(LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(${alias}.[${col}], N''))))) AS [${col}]`
}

function tempExpr() {
  return safeDecimalExpr('c', 'temp', 1)
}

function cutExcludeSql(alias = 'b') {
  return `AND UPPER(LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(${alias}.[kcaa01], N''))))) NOT LIKE N'%CUT-%'`
}

function buildSearchSql(keyword) {
  if (!keyword) return ''
  const cols = ['top_kcaa01', 'GUID', 'kcaa02_en', ...KCAA_FIELDS]
  const parts = cols.map((col) => `${likeTextExpr('c', col)} LIKE @kw`)
  return `AND (${parts.join(' OR ')})`
}

function buildRequisitionSearchSql(alias, keyword) {
  if (!keyword) return ''
  return `AND ${likeTextExpr(alias, 'kcaa01')} LIKE @kw`
}

function buildBomCodeFilterSql(alias, bomCodeId) {
  if (!bomCodeId) return ''
  return `AND EXISTS (
    SELECT 1
    FROM ${BOM_CODE_FROM} AS bc_f
    WHERE bc_f.[id] = @bomCodeId
      AND (
        (
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(bc_f.[flag5], N'')))) <> N''
          AND UPPER(LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(${alias}.[kcaa01], N'')))))
            LIKE UPPER(LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(bc_f.[flag5], N''))))) + N'%'
        )
        OR (
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(bc_f.[flag5], N'')))) = N''
          AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(${alias}.[kcaa05], N''))))
            = LTRIM(RTRIM(CONVERT(nvarchar(50), bc_f.[id])))
        )
      )
  )`
}

function parsePiList(referenceNo) {
  return String(referenceNo ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function bindPiListInputs(req, piList) {
  const params = []
  piList.forEach((pi, index) => {
    const key = `pi${index}`
    req.input(key, sql.NVarChar(200), pi)
    params.push(`@${key}`)
  })
  return params.join(', ')
}

function buildKcaaSelect(alias) {
  return KCAA_FIELDS.map((col) => {
    if (KCAA_DECIMAL_FIELDS.has(col)) {
      return `${safeDecimalExpr(alias, col)} AS [${col}]`
    }
    return `${likeTextExpr(alias, col)} AS [${col}]`
  }).join(',\n        ')
}

function buildEnrichmentJoins(alias = 'p', includePrice = true) {
  return `
      OUTER APPLY (
        SELECT TOP 1 m.[name]
        FROM ${MATERIAL_CATEGORY_FROM} AS m
        WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(m.[code], N'')))) = LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(${alias}.[kcaa05], N''))))
      ) AS category
      OUTER APPLY (
        SELECT TOP 1 c.[name]
        FROM ${CURRENCY_FROM} AS c
        WHERE LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(c.[code], N'')))) = LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(${alias}.[kcaa34], N''))))
      ) AS quoteCurrency
      OUTER APPLY (
        SELECT TOP 1 c.[name]
        FROM ${CURRENCY_FROM} AS c
        WHERE LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(c.[code], N'')))) = LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(${alias}.[kcaa35], N''))))
      ) AS purchaseCurrency
      ${includePrice ? `
      OUTER APPLY (
        SELECT TOP 1
          ${safeDecimalExpr('l', 'cgab04')} AS cgab04,
          ${safeDecimalExpr('l', 'cgab05')} AS cgab05,
          ${safeDecimalExpr('l', 'tax')} AS tax
        FROM ${BUY_OFFER_LINE_FROM} AS l
        INNER JOIN ${BUY_OFFER_FROM} AS h
          ON LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[cgaa01], N'')))) = LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[cgab01], N''))))
        WHERE LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa01], N'')))) = LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(${alias}.[kcaa01], N''))))
          AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[cgaa04], N'')))) = @supplierCode
          AND LTRIM(RTRIM(ISNULL(h.[pass], N''))) = N'1'
          AND (ISNULL(h.[del], N'') = N'' OR h.[del] = N'0')
        ORDER BY l.[id] DESC
      ) AS price` : ''}`
}

function normalizeTax(row) {
  const tax = toNumber(row?.tax, 0)
  return tax > 1 ? tax / 100 : tax
}

function mapRow(row, hasPricePermission) {
  const baseQty = toNumber(row.kcac06, 0)
  const rate = toNumber(row.kcaa26, 1) || 1
  const direction = text(row.kcaa27)
  const sbuy = direction === '0' ? round(baseQty / rate, 6) : round(baseQty * rate, 6)
  const buys = round(row.buys, 6)
  const availableQty = round(sbuy - buys, 6)
  const taxIncludedPrice = hasPricePermission ? round(row.cgab05, 6) : 0
  const taxExcludedPrice = hasPricePermission ? round(row.cgab04, 6) : 0
  const tax = hasPricePermission ? normalizeTax(row) : 0
  const out = {
    piNo: text(row.piNo),
    lineKey: `${text(row.piNo).toLowerCase()}|${text(row.kcaa01).toLowerCase()}`,
    systemcode: text(row.systemcode || row.GUID),
    bomSystemCode: text(row.systemcode || row.GUID),
    GUID: text(row.GUID || row.systemcode),
    topKcaa01: text(row.top_kcaa01),
    gkcaa02: text(row.gkcaa02),
    kcac06: baseQty,
    sbuy,
    buys,
    availableQty,
    maxQty: round(availableQty + 10, 6),
    buysum: round(row.buysum, 6),
    stockQty: round(row.stockQty, 6),
    stockAfterDeduct: round(row.stockAfterDeduct, 6),
    purchaseUnit: text(row.kcaa25),
    cgab04: taxExcludedPrice,
    cgab05: taxIncludedPrice,
    tax,
    version: 100,
    location: text(row.location),
    sale_price: toNumber(row.sale_price, 0),
    cost_price: toNumber(row.cost_price, 0),
    Customer_Name: text(row.Customer_Name),
    Customer_supply: text(row.Customer_supply),
    remark: text(row.remark),
    kpname: text(row.kpname),
    content: text(row.content),
    kcaa02_en: text(row.kcaa02_en),
    categoryName: text(row.categoryName),
    quoteCurrencyName: text(row.quoteCurrencyName),
    purchaseCurrencyName: text(row.purchaseCurrencyName),
    pass: text(row.pass),
  }
  for (const col of KCAA_FIELDS) out[col] = row[col]
  return out
}

function mapRequisitionRow(row, hasPricePermission, multiPi = false, buyType = '2') {
  const sid = text(row.sid)
  const kcaa01 = text(row.kcaa01)
  const lineKey = multiPi ? `${sid.toLowerCase()}|${kcaa01.toLowerCase()}` : `req|${kcaa01.toLowerCase()}`
  const taxIncludedPrice = 0
  const taxExcludedPrice = 0
  const tax = 0
  const out = {
    buyType: String(buyType) === '0' ? '0' : '2',
    piNo: sid,
    sid,
    lineKey,
    systemcode: text(row.systemcode || row.GUID),
    bomSystemCode: text(row.systemcode || row.GUID),
    GUID: text(row.GUID || row.systemcode),
    purchaseUnit: text(row.kcaa25),
    cgab04: taxExcludedPrice,
    cgab05: taxIncludedPrice,
    tax,
    location: text(row.location),
    sale_price: toNumber(row.sale_price, 0),
    cost_price: toNumber(row.cost_price, 0),
    Customer_Name: text(row.Customer_Name),
    Customer_supply: text(row.Customer_supply),
    remark: text(row.remark),
    kpname: text(row.kpname),
    content: text(row.content),
    kcaa02_en: text(row.kcaa02_en),
    categoryName: text(row.categoryName),
    quoteCurrencyName: text(row.quoteCurrencyName),
    purchaseCurrencyName: text(row.purchaseCurrencyName),
    pass: text(row.pass),
    quantity: 0,
  }
  for (const col of KCAA_FIELDS) out[col] = row[col]
  return out
}

export async function fetchBuyOrderBatchAddLines(pool, opts = {}) {
  const buyType = text(opts.buyType) || '1'
  if (buyType === '0' || buyType === '2') return fetchBuyOrderRequisitionBatchAddLines(pool, opts)
  return fetchBuyOrderPiBatchAddLines(pool, opts)
}

/** 请购采购：BOM 物料库 / 多 PI 时销售清单 */
async function fetchBuyOrderRequisitionBatchAddLines(pool, opts = {}) {
  const requisitionLikeBuyType = text(opts.buyType) === '0' ? '0' : '2'
  const referenceNo = text(opts.piNo ?? opts.referenceNo)
  const supplierCode = text(opts.supplierCode)
  const keyword = text(opts.keyword)
  const bomCodeId = parsePositiveInt(opts?.bomCodeId)
  const hasPricePermission = opts.hasPricePermission !== false
  const page = Math.max(1, parsePositiveInt(opts?.page) || 1)
  const pageSizeRaw = parsePositiveInt(opts?.pageSize)
  const pageSize = Math.min(100, Math.max(1, pageSizeRaw || 10))
  const startRow = (page - 1) * pageSize + 1
  const endRow = page * pageSize

  if (!supplierCode) {
    return { ok: false, status: 400, msg: '请先选择供应商，才能批量添加并自动带出单价' }
  }

  const piList = parsePiList(referenceNo)
  const multiPi = piList.length > 1

  const req = pool.request()
    .input('supplierCode', sql.NVarChar(200), supplierCode)
    .input('startRow', sql.Int, startRow)
    .input('endRow', sql.Int, endRow)
  if (keyword) req.input('kw', sql.NVarChar(500), `%${keyword}%`)
  if (bomCodeId) req.input('bomCodeId', sql.Int, bomCodeId)

  const searchSql = buildRequisitionSearchSql(multiPi ? 's' : 'b', keyword)
  const bomCodeSql = buildBomCodeFilterSql(multiPi ? 's' : 'b', bomCodeId)
  const kcaaSelect = buildKcaaSelect(multiPi ? 'p' : 'p')
  const priceSelect = `CAST(0 AS decimal(18, 6)) AS cgab04,
        CAST(0 AS decimal(18, 6)) AS cgab05,
        CAST(0 AS decimal(18, 6)) AS tax`

  let sqlTextQuery = ''

  if (multiPi) {
    if (!piList.length) {
      return { ok: false, status: 400, msg: '请购采购多 PI 批量添加需要有效的关联单号' }
    }
    const piIn = bindPiListInputs(req, piList)
    const groupedKcaaSelect = KCAA_FIELDS.map((col) => sqlMaxKcaaFrom('s', col)).join(',\n          ')
    sqlTextQuery = `
      WITH filtered AS (
        SELECT s.*
        FROM ${SALES_LIST_FROM} AS s
        WHERE (ISNULL(s.[del], N'') = N'' OR s.[del] = N'0')
          AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(s.[sid], N'')))) IN (${piIn})
          ${cutExcludeSql('s')}
          ${bomCodeSql}
          ${searchSql}
      ),
      grouped AS (
        SELECT
          LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(s.[kcaa01], N'')))) AS kcaa01Key,
          MAX(LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(s.[systemcode], ISNULL(s.[GUID], N'')))))) AS systemcode,
          MAX(LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(s.[GUID], ISNULL(s.[systemcode], N'')))))) AS GUID,
          ${sqlMaxKcaaFrom('s', 'kcaa02_en')},
          ${sqlMaxKcaaFrom('s', 'location')},
          ${sqlMaxKcaaFrom('s', 'Customer_Name')},
          ${sqlMaxKcaaFrom('s', 'Customer_supply')},
          ${sqlMaxKcaaFrom('s', 'remark')},
          ${sqlMaxKcaaFrom('s', 'kpname')},
          ${sqlMaxKcaaFrom('s', 'content')},
          ${sqlMaxKcaaFrom('s', 'pass')},
          MAX(${safeDecimalExpr('s', 'sale_price')}) AS sale_price,
          MAX(${safeDecimalExpr('s', 'cost_price')}) AS cost_price,
          ${groupedKcaaSelect},
          MAX(s.[id]) AS sortId
        FROM filtered AS s
        GROUP BY LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(s.[kcaa01], N''))))
      ),
      numbered AS (
        SELECT
          g.*,
          COUNT(1) OVER() AS totalRows,
          ROW_NUMBER() OVER (ORDER BY g.[sortId] DESC) AS rn
        FROM grouped AS g
      ),
      page_rows AS (
        SELECT *
        FROM numbered
        WHERE [rn] BETWEEN @startRow AND @endRow
      ),
      enriched AS (
        SELECT
          N'' AS sid,
          p.[kcaa01Key],
          LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(p.[systemcode], ISNULL(p.[GUID], N''))))) AS systemcode,
          LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(p.[GUID], ISNULL(p.[systemcode], N''))))) AS GUID,
          ${sqlText('p', 'kcaa02_en')},
          ${sqlText('p', 'location')},
          ${sqlText('p', 'Customer_Name')},
          ${sqlText('p', 'Customer_supply')},
          ${sqlText('p', 'remark')},
          ${sqlText('p', 'kpname')},
          ${sqlText('p', 'content')},
          ${sqlText('p', 'pass')},
          ${safeDecimalExpr('p', 'sale_price')} AS sale_price,
          ${safeDecimalExpr('p', 'cost_price')} AS cost_price,
          ${kcaaSelect},
          p.[totalRows],
          p.[rn],
          LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(category.[name], N'')))) AS [categoryName],
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(quoteCurrency.[name], N'')))) AS [quoteCurrencyName],
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(purchaseCurrency.[name], N'')))) AS [purchaseCurrencyName],
          ${priceSelect}
        FROM page_rows AS p
        ${buildEnrichmentJoins('p', false)}
      )
      SELECT *
      FROM enriched
      ORDER BY [rn] ASC
;
      WITH filtered AS (
        SELECT s.*
        FROM ${SALES_LIST_FROM} AS s
        WHERE (ISNULL(s.[del], N'') = N'' OR s.[del] = N'0')
          AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(s.[sid], N'')))) IN (${piIn})
          ${cutExcludeSql('s')}
          ${bomCodeSql}
          ${searchSql}
      ),
      grouped AS (
        SELECT
          LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(s.[kcaa01], N'')))) AS kcaa01Key,
          MAX(s.[id]) AS sortId
        FROM filtered AS s
        GROUP BY LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(s.[kcaa01], N''))))
      ),
      numbered AS (
        SELECT
          g.*,
          ROW_NUMBER() OVER (ORDER BY g.[sortId] DESC) AS rn
        FROM grouped AS g
      ),
      page_keys AS (
        SELECT *
        FROM numbered
        WHERE [rn] BETWEEN @startRow AND @endRow
      )
      SELECT DISTINCT
        pk.[kcaa01Key],
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(s.[sid], N'')))) AS sid
      FROM page_keys AS pk
      INNER JOIN filtered AS s
        ON LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(s.[kcaa01], N'')))) = pk.[kcaa01Key]
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(s.[sid], N'')))) <> N''
      ORDER BY pk.[kcaa01Key] ASC, sid ASC
    `
  } else {
    sqlTextQuery = `
      WITH filtered AS (
        SELECT b.*
        FROM ${BOM_000_FROM} AS b
        WHERE (ISNULL(b.[del], N'') = N'' OR b.[del] = N'0')
          AND LTRIM(RTRIM(ISNULL(b.[pass], N''))) = N'1'
          ${cutExcludeSql('b')}
          ${bomCodeSql}
          ${searchSql}
      ),
      numbered AS (
        SELECT
          f.*,
          COUNT(1) OVER() AS totalRows,
          ROW_NUMBER() OVER (ORDER BY f.[id] DESC) AS rn
        FROM filtered AS f
      ),
      page_rows AS (
        SELECT *
        FROM numbered
        WHERE [rn] BETWEEN @startRow AND @endRow
      ),
      enriched AS (
        SELECT
          N'' AS sid,
          LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(p.[systemcode], ISNULL(p.[GUID], N''))))) AS systemcode,
          LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(p.[GUID], ISNULL(p.[systemcode], N''))))) AS GUID,
          ${sqlText('p', 'kcaa02_en')},
          ${sqlText('p', 'location')},
          ${sqlText('p', 'Customer_Name')},
          ${sqlText('p', 'Customer_supply')},
          ${sqlText('p', 'remark')},
          ${sqlText('p', 'kpname')},
          ${sqlText('p', 'content')},
          ${sqlText('p', 'pass')},
          ${safeDecimalExpr('p', 'sale_price')} AS sale_price,
          ${safeDecimalExpr('p', 'cost_price')} AS cost_price,
          ${kcaaSelect},
          p.[totalRows],
          p.[rn],
          LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(category.[name], N'')))) AS [categoryName],
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(quoteCurrency.[name], N'')))) AS [quoteCurrencyName],
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(purchaseCurrency.[name], N'')))) AS [purchaseCurrencyName],
          ${priceSelect}
        FROM page_rows AS p
        ${buildEnrichmentJoins('p', false)}
      )
      SELECT *
      FROM enriched
      ORDER BY [rn] ASC
    `
  }

  const result = await req.query(sqlTextQuery)
  const recordsets = Array.isArray(result.recordsets) ? result.recordsets : []
  const recordset = recordsets[0] ?? result.recordset ?? []
  const sidPairs = multiPi ? (recordsets[1] ?? []) : []
  const sidByKcaaKey = new Map()
  for (const pair of sidPairs) {
    const key = text(pair?.kcaa01Key).toLowerCase()
    const sid = text(pair?.sid)
    if (!key || !sid) continue
    if (!sidByKcaaKey.has(key)) sidByKcaaKey.set(key, [])
    const values = sidByKcaaKey.get(key)
    if (!values.includes(sid)) values.push(sid)
  }
  const total = recordset.length > 0 ? Number(recordset[0].totalRows ?? 0) : 0
  const list = recordset.map((row) => {
    const { totalRows, rn, kcaa01Key, ...rest } = row
    if (multiPi) {
      const key = text(kcaa01Key || rest.kcaa01).toLowerCase()
      rest.sid = (sidByKcaaKey.get(key) ?? []).join(',')
    }
    return mapRequisitionRow(rest, hasPricePermission, multiPi, requisitionLikeBuyType)
  })

  return {
    ok: true,
    buyType: requisitionLikeBuyType,
    piNo: referenceNo,
    multiPi,
    list,
    total,
    page,
    pageSize,
  }
}

export async function enrichBuyOrderBatchAddPrices(pool, opts = {}) {
  const supplierCode = text(opts.supplierCode)
  const hasPricePermission = opts.hasPricePermission !== false
  const inputLines = Array.isArray(opts.lines) ? opts.lines : []
  const lines = inputLines.map((line) => ({ ...line }))
  const codes = Array.from(new Set(lines.map((line) => text(line.kcaa01)).filter(Boolean))).slice(0, 300)

  if (!supplierCode) {
    return { ok: false, status: 400, msg: '请先选择供应商，才能带出最新报价' }
  }
  if (!lines.length || !codes.length || !hasPricePermission) {
    return { ok: true, list: lines }
  }

  const req = pool.request().input('supplierCode', sql.NVarChar(200), supplierCode)
  const selects = codes.map((code, index) => {
    const key = `code${index}`
    req.input(key, sql.NVarChar(300), code)
    return `SELECT @${key} AS kcaa01`
  }).join('\n        UNION ALL\n        ')

  const result = await req.query(`
    WITH selected AS (
      ${selects}
    ),
    ranked AS (
      SELECT
        s.[kcaa01],
        ${safeDecimalExpr('l', 'cgab04')} AS cgab04,
        ${safeDecimalExpr('l', 'cgab05')} AS cgab05,
        ${safeDecimalExpr('l', 'tax')} AS tax,
        ROW_NUMBER() OVER (PARTITION BY s.[kcaa01] ORDER BY l.[id] DESC) AS rn
      FROM selected AS s
      INNER JOIN ${BUY_OFFER_LINE_FROM} AS l
        ON LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa01], N'')))) = s.[kcaa01]
      INNER JOIN ${BUY_OFFER_FROM} AS h
        ON LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[cgaa01], N'')))) = LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[cgab01], N''))))
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[cgaa04], N'')))) = @supplierCode
        AND LTRIM(RTRIM(ISNULL(h.[pass], N''))) = N'1'
        AND (ISNULL(h.[del], N'') = N'' OR h.[del] = N'0')
    )
    SELECT [kcaa01], [cgab04], [cgab05], [tax]
    FROM ranked
    WHERE [rn] = 1
  `)

  const priceMap = new Map()
  for (const row of result.recordset ?? []) {
    priceMap.set(text(row.kcaa01), {
      cgab04: round(row.cgab04, 6),
      cgab05: round(row.cgab05, 6),
      tax: normalizeTax(row),
    })
  }

  return {
    ok: true,
    list: lines.map((line) => {
      const price = priceMap.get(text(line.kcaa01))
      if (!price) return line
      return { ...line, ...price }
    }),
  }
}

/** 订单采购：PI 运算用料清单 */
async function fetchBuyOrderPiBatchAddLines(pool, opts = {}) {
  const piNo = text(opts.piNo)
  const supplierCode = text(opts.supplierCode)
  const keyword = text(opts.keyword)
  const hasPricePermission = opts.hasPricePermission !== false
  const page = Math.max(1, parsePositiveInt(opts?.page) || 1)
  const pageSizeRaw = parsePositiveInt(opts?.pageSize)
  const pageSize = Math.min(100, Math.max(1, pageSizeRaw || 10))
  const startRow = (page - 1) * pageSize + 1
  const endRow = page * pageSize
  if (!piNo) return { ok: false, status: 400, msg: '订单采购批量添加必须先填写 PI 号' }
  if (piNo.includes(',')) return { ok: false, status: 400, msg: '订单采购批量添加一次只能选择一个 PI 号' }
  if (!supplierCode) return { ok: false, status: 400, msg: '请先选择供应商，才能批量添加并自动带出单价' }

  const req = pool.request()
    .input('pi', sql.NVarChar(200), piNo)
    .input('supplierCode', sql.NVarChar(200), supplierCode)
    .input('startRow', sql.Int, startRow)
    .input('endRow', sql.Int, endRow)
  if (keyword) req.input('kw', sql.NVarChar(500), `%${keyword}%`)

  const kcaaSelect = KCAA_FIELDS.map((col) => sqlMaxKcaa(col)).join(',\n      ')
  const searchSql = buildSearchSql(keyword)
  const priceColumns = hasPricePermission
    ? `${safeDecimalExpr('price', 'cgab04')} AS cgab04,
      ${safeDecimalExpr('price', 'cgab05')} AS cgab05,
      ${safeDecimalExpr('price', 'tax')} AS tax,`
    : `CAST(0 AS decimal(18, 6)) AS cgab04,
      CAST(0 AS decimal(18, 6)) AS cgab05,
      CAST(0 AS decimal(18, 6)) AS tax,`

  const result = await req.query(`
    WITH grouped AS (
      SELECT
        @pi AS piNo,
        MAX(LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(c.[systemcode], ISNULL(c.[GUID], N'')))))) AS systemcode,
        MAX(LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(c.[GUID], ISNULL(c.[systemcode], N'')))))) AS GUID,
        ${sqlMaxText('top_kcaa01')},
        ${kcaaSelect},
        ${sqlMaxText('kcaa02_en')},
        ${sqlMaxText('location')},
        ${sqlMaxText('Customer_Name')},
        ${sqlMaxText('Customer_supply')},
        ${sqlMaxText('remark')},
        ${sqlMaxText('kpname')},
        ${sqlMaxText('content')},
        ${sqlMaxText('pass')},
        ${sqlMaxDec('sale_price')},
        ${sqlMaxDec('cost_price')},
        SUM(${safeDecimalExpr('c', 'kcac06')} * ${tempExpr()}) AS kcac06,
        MIN(${safeIntExpr('c', 'px')}) AS px
      FROM ${PI_COST_FROM} AS c
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.[sid], N'')))) = @pi
        AND ${flagIsOneExpr('c', 'kcaa12', '0')}
        AND ${flagIsOneExpr('c', 'isok', '1')}
        ${searchSql}
      GROUP BY LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(c.[kcaa01], N''))))
    ),
    numbered AS (
      SELECT
        g.*,
        COUNT(1) OVER() AS totalRows,
        ROW_NUMBER() OVER (
          ORDER BY CASE WHEN g.[px] = 2147483647 THEN 1 ELSE 0 END ASC, g.[px] ASC, g.[kcaa01] ASC
        ) AS rn
      FROM grouped AS g
    ),
    page_rows AS (
      SELECT *
      FROM numbered
      WHERE [rn] BETWEEN @startRow AND @endRow
    ),
    supplier_orders AS (
      SELECT LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcaj01], N'')))) AS kcaj01
      FROM ${BUY_ORDER_FROM} AS h
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcaj05], N'')))) = @supplierCode
        AND (ISNULL(h.[del], N'') = N'' OR h.[del] = N'0')
    ),
    last_buy_ids AS (
      SELECT
        LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa01], N'')))) AS kcaa01,
        MAX(l.[id]) AS lastLineId
      FROM ${BUY_ORDER_LINE_FROM} AS l
      INNER JOIN supplier_orders AS so
        ON LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcak01], N'')))) = so.[kcaj01]
      INNER JOIN page_rows AS p0
        ON LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa01], N'')))) = LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(p0.[kcaa01], N''))))
      GROUP BY LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa01], N''))))
    ),
    enriched AS (
      SELECT
        p.*,
        ${sqlText('lastBuy', 'gkcaa02', 'gkcaa02')},
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(category.[name], N'')))) AS [categoryName],
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(quoteCurrency.[name], N'')))) AS [quoteCurrencyName],
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(purchaseCurrency.[name], N'')))) AS [purchaseCurrencyName],
        ${priceColumns}
        ${safeDecimalExpr('buyAgg', 'buys')} AS buys,
        ${safeDecimalExpr('inAgg', 'buysum')} AS buysum,
        CAST(0 AS decimal(18, 6)) AS stockQty,
        CAST(0 AS decimal(18, 6)) AS stockAfterDeduct
      FROM page_rows AS p
      LEFT JOIN last_buy_ids AS lastBuyId
        ON lastBuyId.[kcaa01] = LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(p.[kcaa01], N''))))
      LEFT JOIN ${BUY_ORDER_LINE_FROM} AS lastBuy
        ON lastBuy.[id] = lastBuyId.[lastLineId]
      OUTER APPLY (
        SELECT TOP 1 m.[name]
        FROM ${MATERIAL_CATEGORY_FROM} AS m
        WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(m.[code], N'')))) = LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(p.[kcaa05], N''))))
      ) AS category
      OUTER APPLY (
        SELECT TOP 1 c.[name]
        FROM ${CURRENCY_FROM} AS c
        WHERE LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(c.[code], N'')))) = LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(p.[kcaa34], N''))))
      ) AS quoteCurrency
      OUTER APPLY (
        SELECT TOP 1 c.[name]
        FROM ${CURRENCY_FROM} AS c
        WHERE LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(c.[code], N'')))) = LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(p.[kcaa35], N''))))
      ) AS purchaseCurrency
      OUTER APPLY (
        SELECT TOP 1
          ${safeDecimalExpr('l', 'cgab04')} AS cgab04,
          ${safeDecimalExpr('l', 'cgab05')} AS cgab05,
          ${safeDecimalExpr('l', 'tax')} AS tax
        FROM ${BUY_OFFER_LINE_FROM} AS l
        INNER JOIN ${BUY_OFFER_FROM} AS h
          ON LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[cgaa01], N'')))) = LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[cgab01], N''))))
        WHERE LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa01], N'')))) = LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(p.[kcaa01], N''))))
          AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[cgaa04], N'')))) = @supplierCode
          AND LTRIM(RTRIM(ISNULL(h.[pass], N''))) = N'1'
          AND (ISNULL(h.[del], N'') = N'' OR h.[del] = N'0')
        ORDER BY l.[id] DESC
      ) AS price
      OUTER APPLY (
        SELECT SUM(${safeDecimalExpr('l', 'kcak03')}) AS buys
        FROM ${BUY_ORDER_LINE_FROM} AS l
        INNER JOIN ${BUY_ORDER_FROM} AS h
          ON LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcaj01], N'')))) = LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcak01], N''))))
          WHERE LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[kcaj04], N'')))) = @pi
          AND LTRIM(RTRIM(ISNULL(h.[pass], N''))) = N'1'
          AND (ISNULL(h.[del], N'') = N'' OR h.[del] = N'0')
          AND (ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')
          AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa01], N'')))) = LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(p.[kcaa01], N''))))
      ) AS buyAgg
      OUTER APPLY (
        SELECT SUM(CASE
          WHEN sl.[kcao031] IS NOT NULL AND LTRIM(RTRIM(CONVERT(nvarchar(100), sl.[kcao031]))) <> N'' THEN ${safeDecimalExpr('sl', 'kcao031')}
          ELSE ${safeDecimalExpr('sl', 'kcao03')}
        END) AS buysum
        FROM ${STOCK_IN_FROM} AS sh
        INNER JOIN ${STOCK_IN_LINE_FROM} AS sl
          ON LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(sl.[kcao01], N'')))) = LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(sh.[kcan01], N''))))
        INNER JOIN ${BUY_ORDER_FROM} AS bh
          ON LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(bh.[kcaj01], N'')))) = LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(sh.[kcan04], N''))))
        WHERE LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(bh.[kcaj04], N'')))) = @pi
          AND LTRIM(RTRIM(ISNULL(sh.[pass], N''))) = N'1'
          AND (ISNULL(sh.[del], N'') = N'' OR sh.[del] = N'0')
          AND (ISNULL(sl.[del], N'') = N'' OR sl.[del] = N'0')
          AND LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(sl.[kcao02], N'')))) = LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(p.[systemcode], N''))))
      ) AS inAgg
    )
    SELECT *
    FROM enriched
    ORDER BY [rn] ASC
  `)

  const recordset = result.recordset ?? []
  const total = recordset.length > 0 ? Number(recordset[0].totalRows ?? 0) : 0
  const list = recordset.map((row) => {
    const { totalRows, rn, ...rest } = row
    return mapRow(rest, hasPricePermission)
  })

  return {
    ok: true,
    buyType: '1',
    piNo,
    list,
    total,
    page,
    pageSize,
  }
}
