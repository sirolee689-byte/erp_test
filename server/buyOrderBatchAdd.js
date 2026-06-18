import { sql } from './db.js'

const PI_COST_FROM = 'dbo.[UB_ERP_Bom_pi_cost]'
const BUY_ORDER_FROM = 'dbo.[UB_ERP_Buy_order]'
const BUY_ORDER_LINE_FROM = 'dbo.[UB_ERP_Buy_order_list]'
const BUY_OFFER_FROM = 'dbo.[UB_ERP_Buy_offer]'
const BUY_OFFER_LINE_FROM = 'dbo.[UB_ERP_Buy_offer_list]'
const STOCK_IN_FROM = 'dbo.[UB_ERP_Stocks_Storage]'
const STOCK_IN_LINE_FROM = 'dbo.[UB_ERP_Stocks_Storage_list]'

const KCAA_FIELDS = Array.from({ length: 35 }, (_, i) => `kcaa${String(i + 1).padStart(2, '0')}`)
// pi_cost 与报价/采购/入库明细表共享 kcaa 字段名；数值列若在外层 SELECT 中落成 nvarchar，
// SQL Server 在 OUTER APPLY 关联时会把内外层同名列混用，触发 nvarchar→numeric 转换错误。
const KCAA_DECIMAL_FIELDS = new Set([
  'kcaa07',
  'kcaa08',
  'kcaa19',
  'kcaa22',
  'kcaa23',
  'kcaa24',
  'kcaa26',
  'kcaa30',
  'kcaa32',
  'kcaa33',
])

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
  return `MAX(CASE WHEN ISNUMERIC(LTRIM(RTRIM(CONVERT(nvarchar(100), c.[${col}])))) = 1 THEN CONVERT(decimal(18, 6), LTRIM(RTRIM(CONVERT(nvarchar(100), c.[${col}])))) ELSE 0 END) AS [${asName}]`
}

function sqlMaxKcaa(col) {
  return KCAA_DECIMAL_FIELDS.has(col) ? sqlMaxDec(col) : sqlMaxText(col)
}

function tempExpr() {
  return `CASE
    WHEN c.[temp] IS NULL THEN 1
    WHEN LTRIM(RTRIM(CONVERT(nvarchar(100), c.[temp]))) = N'' THEN 1
    WHEN ISNUMERIC(LTRIM(RTRIM(CONVERT(nvarchar(100), c.[temp])))) = 1
      THEN CONVERT(decimal(18, 6), LTRIM(RTRIM(CONVERT(nvarchar(100), c.[temp]))))
    ELSE 1
  END`
}

function buildSearchSql(keyword) {
  if (!keyword) return ''
  const cols = ['top_kcaa01', 'GUID', 'kcaa02_en', ...KCAA_FIELDS]
  const parts = cols.map((col) => `LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(c.[${col}], N'')))) LIKE @kw`)
  return `AND (${parts.join(' OR ')})`
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
  }
  for (const col of KCAA_FIELDS) out[col] = row[col]
  return out
}

export async function fetchBuyOrderBatchAddLines(pool, opts = {}) {
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
    ? `ISNULL(price.[cgab04], 0) AS cgab04,
      ISNULL(price.[cgab05], 0) AS cgab05,
      ISNULL(price.[tax], 0) AS tax,`
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
        ${sqlMaxDec('sale_price')},
        ${sqlMaxDec('cost_price')},
        SUM(CAST(ISNULL(c.[kcac06], 0) AS decimal(18, 6)) * ${tempExpr()}) AS kcac06,
        MIN(CASE
          WHEN c.[px] IS NULL THEN 2147483647
          WHEN ISNUMERIC(LTRIM(RTRIM(CONVERT(nvarchar(100), c.[px])))) = 1
            THEN CONVERT(int, LTRIM(RTRIM(CONVERT(nvarchar(100), c.[px]))))
          ELSE 2147483647
        END) AS px
      FROM ${PI_COST_FROM} AS c
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.[sid], N'')))) = @pi
        AND ISNULL(c.[kcaa12], 0) = 1
        AND ISNULL(c.[isok], 1) = 1
        ${searchSql}
      GROUP BY LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(c.[kcaa01], N''))))
    ),
    enriched AS (
      SELECT
        g.*,
        lastBuy.[gkcaa02],
        ${priceColumns}
        ISNULL(buyAgg.[buys], 0) AS buys,
        ISNULL(inAgg.[buysum], 0) AS buysum,
        CAST(0 AS decimal(18, 6)) AS stockQty,
        CAST(0 AS decimal(18, 6)) AS stockAfterDeduct
      FROM grouped AS g
      OUTER APPLY (
        SELECT TOP 1 ${sqlText('l', 'gkcaa02', 'gkcaa02')}
        FROM ${BUY_ORDER_LINE_FROM} AS l
        INNER JOIN ${BUY_ORDER_FROM} AS h
          ON LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcaj01], N'')))) = LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcak01], N''))))
        WHERE LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa01], N'')))) = LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(g.[kcaa01], N''))))
          AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcaj05], N'')))) = @supplierCode
          AND (ISNULL(h.[del], N'') = N'' OR h.[del] = N'0')
        ORDER BY l.[id] DESC
      ) AS lastBuy
      OUTER APPLY (
        SELECT TOP 1
          CAST(ISNULL(l.[cgab04], 0) AS decimal(18, 6)) AS cgab04,
          CAST(ISNULL(l.[cgab05], 0) AS decimal(18, 6)) AS cgab05,
          CAST(ISNULL(l.[tax], 0) AS decimal(18, 6)) AS tax
        FROM ${BUY_OFFER_LINE_FROM} AS l
        INNER JOIN ${BUY_OFFER_FROM} AS h
          ON LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[cgaa01], N'')))) = LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[cgab01], N''))))
        WHERE LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa01], N'')))) = LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(g.[kcaa01], N''))))
          AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[cgaa04], N'')))) = @supplierCode
          AND LTRIM(RTRIM(ISNULL(h.[pass], N''))) = N'1'
          AND (ISNULL(h.[del], N'') = N'' OR h.[del] = N'0')
        ORDER BY l.[id] DESC
      ) AS price
      OUTER APPLY (
        SELECT SUM(ISNULL(l.[kcak03], 0)) AS buys
        FROM ${BUY_ORDER_LINE_FROM} AS l
        INNER JOIN ${BUY_ORDER_FROM} AS h
          ON LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcaj01], N'')))) = LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcak01], N''))))
        WHERE LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[kcaj04], N'')))) = @pi
          AND LTRIM(RTRIM(ISNULL(h.[pass], N''))) = N'1'
          AND (ISNULL(h.[del], N'') = N'' OR h.[del] = N'0')
          AND (ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')
          AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa01], N'')))) = LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(g.[kcaa01], N''))))
      ) AS buyAgg
      OUTER APPLY (
        SELECT SUM(ISNULL(sl.[kcao031], ISNULL(sl.[kcao03], 0))) AS buysum
        FROM ${STOCK_IN_FROM} AS sh
        INNER JOIN ${STOCK_IN_LINE_FROM} AS sl
          ON LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(sl.[kcao01], N'')))) = LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(sh.[kcan01], N''))))
        INNER JOIN ${BUY_ORDER_FROM} AS bh
          ON LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(bh.[kcaj01], N'')))) = LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(sh.[kcan04], N''))))
        WHERE LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(bh.[kcaj04], N'')))) = @pi
          AND LTRIM(RTRIM(ISNULL(sh.[pass], N''))) = N'1'
          AND (ISNULL(sh.[del], N'') = N'' OR sh.[del] = N'0')
          AND (ISNULL(sl.[del], N'') = N'' OR sl.[del] = N'0')
          AND LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(sl.[kcao02], N'')))) = LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(g.[systemcode], N''))))
      ) AS inAgg
    )
    SELECT *
    FROM (
      SELECT
        e.*,
        COUNT(1) OVER() AS totalRows,
        ROW_NUMBER() OVER (
          ORDER BY CASE WHEN e.[px] = 2147483647 THEN 1 ELSE 0 END ASC, e.[px] ASC, e.[kcaa01] ASC
        ) AS rn
      FROM enriched AS e
    ) AS paged
    WHERE paged.[rn] BETWEEN @startRow AND @endRow
    ORDER BY paged.[rn] ASC
  `)

  const recordset = result.recordset ?? []
  const total = recordset.length > 0 ? Number(recordset[0].totalRows ?? 0) : 0
  const list = recordset.map((row) => {
    const { totalRows, rn, ...rest } = row
    return mapRow(rest, hasPricePermission)
  })

  return {
    ok: true,
    piNo,
    list,
    total,
    page,
    pageSize,
  }
}
