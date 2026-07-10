/**
 * 历史价格查询 API。
 * 只读报表：按物料查询报价单和采购订单里的历史价格，不写入任何业务表。
 */
import { sql } from './db.js'
import { safeDecimalExpr, nvarcharTextExpr } from './buyOrderSqlSafe.js'
import { fetchStockStatsPrintHeader } from './stockStatsPrintHeader.js'

const MENU_PATH = 'supply-chain/analysis/price-query'
const BOM_FROM = 'dbo.[UB_ERP_Bom_000]'
const SUPPLIER_FROM = 'dbo.[UB_ERP_System_supplier]'
const OFFER_HEADER_FROM = 'dbo.[UB_ERP_Buy_offer]'
const OFFER_LINE_FROM = 'dbo.[UB_ERP_Buy_offer_list]'
const BUY_HEADER_FROM = 'dbo.[UB_ERP_Buy_order]'
const BUY_LINE_FROM = 'dbo.[UB_ERP_Buy_order_list]'

function text(value) {
  return String(value ?? '').trim()
}

function likePattern(value) {
  return `%${text(value).replace(/[\\%_]/g, '\\$&')}%`
}

function normalizeDate(value) {
  const s = text(value)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''
}

function addOneDay(dateText) {
  const d = new Date(`${dateText}T00:00:00`)
  d.setDate(d.getDate() + 1)
  return d
}

function parseBooleanFlag(value, defaultValue = false) {
  const s = text(value).toLowerCase()
  if (!s) return defaultValue
  return ['1', 'true', 'yes', 'y', '是'].includes(s)
}

function parseReportQuery(query = {}) {
  return {
    startDate: normalizeDate(query.startDate),
    endDate: normalizeDate(query.endDate),
    supplierCode: text(query.supplierCode),
    materialCode: text(query.materialCode),
    materialName: text(query.materialName),
    materialSpec: text(query.materialSpec),
    onlyWithPrice: parseBooleanFlag(query.onlyWithPrice, true),
  }
}

function validateReportQuery(q) {
  if (!q.startDate) return '开始日期不能为空'
  if (!q.endDate) return '结束日期不能为空'
  if (q.startDate > q.endDate) return '开始日期不能大于结束日期'
  if (!q.materialCode) return '物料编码不能为空'
  return ''
}

function bindReportParams(req, q) {
  req.input('startDate', sql.DateTime, new Date(`${q.startDate}T00:00:00`))
  req.input('endDateExclusive', sql.DateTime, addOneDay(q.endDate))
  req.input('materialCode', sql.NVarChar(400), likePattern(q.materialCode))
  if (q.supplierCode) req.input('supplierCode', sql.NVarChar(200), q.supplierCode)
  if (q.materialName) req.input('materialName', sql.NVarChar(400), likePattern(q.materialName))
  if (q.materialSpec) req.input('materialSpec', sql.NVarChar(400), likePattern(q.materialSpec))
}

function taxRateExpr(alias) {
  const raw = safeDecimalExpr(alias, 'Tax', 0)
  return `CASE WHEN ${raw} > 1 THEN ${raw} / 100 ELSE ${raw} END`
}

function buildMaterialWhereSql(q) {
  const parts = [
    `${nvarcharTextExpr('b', 'del', 20)} IN (N'', N'0')`,
    `${nvarcharTextExpr('b', 'pass', 20)} = N'1'`,
    `${nvarcharTextExpr('b', 'kcaa01', 200)} <> N''`,
    `${nvarcharTextExpr('b', 'kcaa01', 200)} LIKE @materialCode ESCAPE '\\'`,
  ]
  if (q.materialName) parts.push(`${nvarcharTextExpr('b', 'kcaa02', 500)} LIKE @materialName ESCAPE '\\'`)
  if (q.materialSpec) parts.push(`${nvarcharTextExpr('b', 'kcaa03', 500)} LIKE @materialSpec ESCAPE '\\'`)
  return `WHERE ${parts.join('\n        AND ')}`
}

function supplierFilterSql(alias, col, q) {
  return q.supplierCode ? `AND ${nvarcharTextExpr(alias, col, 200)} = @supplierCode` : ''
}

function buildReportSql(q) {
  const materialWhereSql = buildMaterialWhereSql(q)
  const offerTax = taxRateExpr('l')
  const buyTax = taxRateExpr('l')
  return `
    WITH materials AS (
      SELECT
        ${nvarcharTextExpr('b', 'kcaa01', 200)} AS materialCode,
        MAX(${nvarcharTextExpr('b', 'kcaa02', 500)}) AS materialName,
        MAX(${nvarcharTextExpr('b', 'kcaa03', 500)}) AS materialSpec,
        MAX(${nvarcharTextExpr('b', 'kcaa29', 100)}) AS bomUnit,
        MAX(${safeDecimalExpr('b', 'sale_price', 0)}) AS bomPrice,
        MAX(${nvarcharTextExpr('b', 'kcaa25', 100)}) AS purchaseUnit,
        MAX(b.[id]) AS sortId
      FROM ${BOM_FROM} AS b
      ${materialWhereSql}
      GROUP BY ${nvarcharTextExpr('b', 'kcaa01', 200)}
    ),
    price_records AS (
      SELECT
        m.materialCode,
        h.[cgaa02] AS priceDate,
        ${nvarcharTextExpr('h', 'rmb', 100)} AS currencyName,
        ${safeDecimalExpr('l', 'cgab04', 0)} AS price,
        ${safeDecimalExpr('l', 'cgab04', 0)} * (1 + ${offerTax}) AS priceWithTax,
        ${nvarcharTextExpr('h', 'cgaa04', 200)} AS supplierCode,
        ${nvarcharTextExpr('h', 'kehu', 500)} AS supplierName,
        N'报价' AS sourceType,
        ${nvarcharTextExpr('h', 'cgaa01', 200)} AS sourceNo
      FROM materials AS m
      INNER JOIN ${OFFER_LINE_FROM} AS l
        ON ${nvarcharTextExpr('l', 'kcaa01', 200)} = m.materialCode
      INNER JOIN ${OFFER_HEADER_FROM} AS h
        ON ${nvarcharTextExpr('h', 'cgaa01', 200)} = ${nvarcharTextExpr('l', 'cgab01', 200)}
      WHERE ${nvarcharTextExpr('h', 'del', 20)} IN (N'', N'0')
        AND ${nvarcharTextExpr('h', 'pass', 20)} = N'1'
        AND ${nvarcharTextExpr('l', 'del', 20)} IN (N'', N'0')
        AND h.[cgaa02] >= @startDate
        AND h.[cgaa02] < @endDateExclusive
        ${supplierFilterSql('h', 'cgaa04', q)}

      UNION ALL

      SELECT
        m.materialCode,
        h.[kcaj02] AS priceDate,
        ${nvarcharTextExpr('h', 'rmb', 100)} AS currencyName,
        ${safeDecimalExpr('l', 'kcak04', 0)} AS price,
        ${safeDecimalExpr('l', 'kcak04', 0)} * (1 + ${buyTax}) AS priceWithTax,
        ${nvarcharTextExpr('h', 'kcaj05', 200)} AS supplierCode,
        ${nvarcharTextExpr('h', 'kehu', 500)} AS supplierName,
        N'采购' AS sourceType,
        ${nvarcharTextExpr('h', 'kcaj01', 200)} AS sourceNo
      FROM materials AS m
      INNER JOIN ${BUY_LINE_FROM} AS l
        ON ${nvarcharTextExpr('l', 'kcaa01', 200)} = m.materialCode
      INNER JOIN ${BUY_HEADER_FROM} AS h
        ON ${nvarcharTextExpr('h', 'kcaj01', 200)} = ${nvarcharTextExpr('l', 'kcak01', 200)}
      WHERE ${nvarcharTextExpr('h', 'del', 20)} IN (N'', N'0')
        AND ${nvarcharTextExpr('h', 'pass', 20)} = N'1'
        AND ${nvarcharTextExpr('l', 'del', 20)} IN (N'', N'0')
        AND h.[kcaj02] >= @startDate
        AND h.[kcaj02] < @endDateExclusive
        ${supplierFilterSql('h', 'kcaj05', q)}
    ),
    material_counts AS (
      SELECT materialCode, COUNT(1) AS priceCount
      FROM price_records
      GROUP BY materialCode
    )
    SELECT
      m.materialCode,
      m.materialName,
      m.materialSpec,
      m.bomUnit,
      m.bomPrice,
      m.purchaseUnit,
      ISNULL(c.priceCount, 0) AS priceCount,
      p.priceDate,
      p.currencyName,
      p.price,
      p.priceWithTax,
      p.supplierCode,
      p.supplierName,
      p.sourceType,
      p.sourceNo
    FROM materials AS m
    LEFT JOIN material_counts AS c
      ON c.materialCode = m.materialCode
    LEFT JOIN price_records AS p
      ON p.materialCode = m.materialCode
    ${q.onlyWithPrice ? 'WHERE ISNULL(c.priceCount, 0) > 0' : ''}
    ORDER BY m.materialCode ASC, p.priceDate DESC, p.sourceType ASC, p.sourceNo ASC
  `
}

function numberValue(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function serializeDate(value) {
  if (value instanceof Date) return value.toISOString()
  return value ?? ''
}

function serializeReportRows(rows = []) {
  const map = new Map()
  for (const row of rows) {
    const materialCode = text(row.materialCode)
    if (!materialCode) continue
    let item = map.get(materialCode)
    if (!item) {
      item = {
        rowKey: `material-${materialCode}`,
        materialCode,
        materialName: text(row.materialName),
        materialSpec: text(row.materialSpec),
        bomUnit: text(row.bomUnit),
        bomPrice: numberValue(row.bomPrice),
        purchaseUnit: text(row.purchaseUnit),
        priceCount: numberValue(row.priceCount),
        prices: [],
      }
      map.set(materialCode, item)
    }
    if (row.priceDate || text(row.sourceNo)) {
      item.prices.push({
        rowKey: `price-${materialCode}-${item.prices.length}`,
        date: serializeDate(row.priceDate),
        currencyName: text(row.currencyName),
        price: numberValue(row.price),
        priceWithTax: numberValue(row.priceWithTax),
        supplierCode: text(row.supplierCode),
        supplierName: text(row.supplierName),
        supplier: [text(row.supplierCode), text(row.supplierName)].filter(Boolean).join(' '),
        sourceType: text(row.sourceType),
        sourceNo: text(row.sourceNo),
        status: item.prices.length === 0 ? '最近价格' : '历史价格',
      })
    }
  }
  return [...map.values()]
}

async function fetchSupplierOptions(pool, keyword = '') {
  const req = pool.request()
  let keywordSql = ''
  if (keyword) {
    req.input('kw', sql.NVarChar(400), likePattern(keyword))
    keywordSql = `AND (
      ${nvarcharTextExpr('s', 's_code', 200)} LIKE @kw ESCAPE '\\'
      OR ${nvarcharTextExpr('s', 's_name', 500)} LIKE @kw ESCAPE '\\'
      OR ${nvarcharTextExpr('s', 'name', 500)} LIKE @kw ESCAPE '\\'
    )`
  }
  const result = await req.query(`
    SELECT TOP 100
      ${nvarcharTextExpr('s', 's_code', 200)} AS code,
      LTRIM(RTRIM(ISNULL(NULLIF(CONVERT(nvarchar(500), s.[s_name]), N''), ISNULL(CONVERT(nvarchar(500), s.[name]), N'')))) AS name
    FROM ${SUPPLIER_FROM} AS s
    WHERE ${nvarcharTextExpr('s', 'pass', 20)} = N'1'
      AND ${nvarcharTextExpr('s', 'del', 20)} IN (N'', N'0')
      ${keywordSql}
    ORDER BY s.[s_code] ASC
  `)
  return result.recordset ?? []
}

async function fetchMaterialOptions(pool, keyword = '') {
  const req = pool.request()
  let keywordSql = ''
  if (keyword) {
    req.input('kw', sql.NVarChar(400), likePattern(keyword))
    keywordSql = `AND ${nvarcharTextExpr('b', 'kcaa01', 200)} LIKE @kw ESCAPE '\\'`
  }
  const result = await req.query(`
    SELECT TOP 100
      ${nvarcharTextExpr('b', 'kcaa01', 200)} AS code,
      MAX(${nvarcharTextExpr('b', 'kcaa02', 500)}) AS name,
      MAX(${nvarcharTextExpr('b', 'kcaa03', 500)}) AS spec,
      MAX(${nvarcharTextExpr('b', 'kcaa25', 100)}) AS purchaseUnit,
      MAX(${nvarcharTextExpr('b', 'kcaa29', 100)}) AS bomUnit
    FROM ${BOM_FROM} AS b
    WHERE ${nvarcharTextExpr('b', 'del', 20)} IN (N'', N'0')
      AND ${nvarcharTextExpr('b', 'pass', 20)} = N'1'
      AND ${nvarcharTextExpr('b', 'kcaa01', 200)} <> N''
      ${keywordSql}
    GROUP BY ${nvarcharTextExpr('b', 'kcaa01', 200)}
    ORDER BY ${nvarcharTextExpr('b', 'kcaa01', 200)} ASC
  `)
  return result.recordset ?? []
}

function sendError(res, err, prefix) {
  res.status(500).json({ code: 500, msg: `${prefix}：${String(err?.message ?? err)}`, data: null })
}

export function registerHistoryPriceQueryRoutes(app, { getPool }) {
  app.get('/api/history-price-query/print-header', async (_req, res) => {
    try {
      const pool = await getPool()
      res.json({ code: 200, msg: 'success', data: await fetchStockStatsPrintHeader(pool) })
    } catch (err) {
      sendError(res, err, '读取历史价格查询打印抬头失败')
    }
  })

  app.get('/api/history-price-query/supplier-options', async (req, res) => {
    try {
      const pool = await getPool()
      res.json({ code: 200, msg: 'success', data: { list: await fetchSupplierOptions(pool, text(req.query?.keyword)) } })
    } catch (err) {
      sendError(res, err, '读取历史价格查询供应商候选失败')
    }
  })

  app.get('/api/history-price-query/material-options', async (req, res) => {
    try {
      const pool = await getPool()
      res.json({ code: 200, msg: 'success', data: { list: await fetchMaterialOptions(pool, text(req.query?.keyword)) } })
    } catch (err) {
      sendError(res, err, '读取历史价格查询物料候选失败')
    }
  })

  app.get('/api/history-price-query/report', async (req, res) => {
    try {
      const q = parseReportQuery(req.query ?? {})
      const errMsg = validateReportQuery(q)
      if (errMsg) {
        res.status(400).json({ code: 400, msg: errMsg, data: null })
        return
      }
      const pool = await getPool()
      const dbReq = pool.request()
      bindReportParams(dbReq, q)
      const result = await dbReq.query(buildReportSql(q))
      const list = serializeReportRows(result.recordset ?? [])
      res.json({
        code: 200,
        msg: 'success',
        data: {
          list,
          total: list.length,
          startDate: q.startDate,
          endDate: q.endDate,
          supplierCode: q.supplierCode,
          materialCode: q.materialCode,
          materialName: q.materialName,
          materialSpec: q.materialSpec,
          onlyWithPrice: q.onlyWithPrice,
        },
      })
    } catch (err) {
      sendError(res, err, '读取历史价格查询报表失败')
    }
  })
}

export const __historyPriceQueryForTest = {
  MENU_PATH,
  parseReportQuery,
  validateReportQuery,
  buildMaterialWhereSql,
  buildReportSql,
  serializeReportRows,
}
