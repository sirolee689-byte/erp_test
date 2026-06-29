/**
 * 成品出库（类型 6）关联销售订单选单。
 * 一行一 PI（销售订单主表），仅返回关联选择所需字段；有可出明细的订单用 EXISTS 过滤。
 * 分页 SQL 兼容 SQL Server 2008 R2。
 */
import { sql } from './db.js'
import { nvarcharTextExpr, safeDecimalExpr } from './buyOrderSqlSafe.js'

const SALES_HEADER_FROM = 'dbo.[UB_ERP_Sales_order]'
const SALES_LINE_FROM = 'dbo.[UB_ERP_Sales_order_list]'

export const FINISHED_GOODS_SOURCE_DEFAULT_PAGE_SIZE = 10

function text(v) {
  return String(v ?? '').trim()
}

function parsePage(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1)
  const rawPageSize = Number.parseInt(query.pageSize, 10) || FINISHED_GOODS_SOURCE_DEFAULT_PAGE_SIZE
  const pageSize = Math.min(200, Math.max(1, rawPageSize))
  return { page, pageSize, startRow: (page - 1) * pageSize + 1, endRow: page * pageSize }
}

function buildCustomerWhere(hasCustomerName = false, hasCustomerCode = false) {
  if (!hasCustomerName && !hasCustomerCode) return ''
  const parts = []
  if (hasCustomerName) parts.push(`${nvarcharTextExpr('h', 'kehu', 500)} = @customerName`)
  if (hasCustomerCode) parts.push(`${nvarcharTextExpr('h', 'xsaj05', 200)} = @customerCode`)
  return `AND (${parts.join(' OR ')})`
}

export function buildStockOutFinishedGoodsKeywordWhere(hasKeyword = false) {
  if (!hasKeyword) return ''
  return `
    AND (
      ${nvarcharTextExpr('h', 'xsaj01', 200)} LIKE @keyword
      OR CONVERT(nvarchar(30), h.[xsaj02], 120) LIKE @keyword
      OR ${nvarcharTextExpr('h', 'xsaj03', 500)} LIKE @keyword
      OR ${nvarcharTextExpr('h', 'xsaj04', 500)} LIKE @keyword
      OR ${nvarcharTextExpr('h', 'xsaj05', 500)} LIKE @keyword
      OR ${nvarcharTextExpr('h', 'xsaj06', 500)} LIKE @keyword
      OR ${nvarcharTextExpr('h', 'xsaj08', 500)} LIKE @keyword
      OR ${nvarcharTextExpr('h', 'rmb', 200)} LIKE @keyword
    )
  `
}

/** 明细仍有可出数量（xsak03-xsak06>0）且 xsak02=GUID */
export function buildStockOutFinishedGoodsShippableLineExistsSql() {
  const remainingExpr = `ISNULL(${safeDecimalExpr('l', 'xsak03')}, 0) - ISNULL(${safeDecimalExpr('l', 'xsak06')}, 0)`
  // xsak01/xsaj01 均为 PI 号 nvarchar，直比可走索引；勿用 nvarcharTextExpr 包列（相关子查询会全表扫）
  return `
    EXISTS (
      SELECT 1
      FROM ${SALES_LINE_FROM} AS l
      WHERE l.[xsak01] = h.[xsaj01]
        AND (ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')
        AND LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), l.[pass]), N''))) = N'1'
        AND ${nvarcharTextExpr('l', 'xsak02', 200)} = ${nvarcharTextExpr('l', 'GUID', 200)}
        AND ${nvarcharTextExpr('l', 'xsak02', 200)} <> N''
        AND ${remainingExpr} > 0
    )
  `
}

function buildHeaderBaseWhereSql({
  hasKeyword = false,
  hasCustomerName = false,
  hasCustomerCode = false,
} = {}) {
  const keywordWhere = buildStockOutFinishedGoodsKeywordWhere(hasKeyword)
  const customerWhere = buildCustomerWhere(hasCustomerName, hasCustomerCode)
  const shippableExists = buildStockOutFinishedGoodsShippableLineExistsSql()
  return `
    ${nvarcharTextExpr('h', 'del', 20)} IN (N'', N'0')
    AND LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), h.[pass]), N''))) = N'1'
    AND LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), h.[closed]), N'0'))) = N'0'
    AND ${shippableExists}
    ${customerWhere}
    ${keywordWhere}
  `
}

function buildHeaderOrderSql() {
  return `${nvarcharTextExpr('h', 'xsaj01', 200)} DESC, h.[id] DESC`
}

function buildHeaderSelectFields() {
  return `
    h.[id] AS headerId,
    ${nvarcharTextExpr('h', 'xsaj01', 200)} AS sourceOrderNo,
    ${nvarcharTextExpr('h', 'xsaj05', 200)} AS customerCode,
    ${nvarcharTextExpr('h', 'kehu', 500)} AS customerName,
    ${nvarcharTextExpr('h', 'xsaj06', 500)} AS poNo,
    ${nvarcharTextExpr('h', 'systemcode', 200)} AS sourceSystemcode
  `
}

export function buildStockOutFinishedGoodsSourceCountSql(options = {}) {
  return `
    SELECT COUNT(1) AS total
    FROM ${SALES_HEADER_FROM} AS h
    WHERE ${buildHeaderBaseWhereSql(options)}
  `
}

export function buildStockOutFinishedGoodsSourceListSql(options = {}) {
  const headerOrder = buildHeaderOrderSql()
  return `
    WITH source AS (
      SELECT
        ${buildHeaderSelectFields()},
        ROW_NUMBER() OVER (ORDER BY ${headerOrder}) AS rn
      FROM ${SALES_HEADER_FROM} AS h
      WHERE ${buildHeaderBaseWhereSql(options)}
    ),
    numbered AS (
      SELECT
        *,
        COUNT(1) OVER () AS totalCount
      FROM source
    )
    SELECT *
    FROM numbered
    WHERE rn BETWEEN @startRow AND @endRow
    ORDER BY rn ASC
  `
}

function serializeRow(row = {}) {
  const out = {}
  for (const [key, value] of Object.entries(row)) {
    if (key === 'rn' || key === 'totalCount') continue
    out[key] = value instanceof Date ? value.toISOString().replace('T', ' ').slice(0, 19) : value
  }
  if (out.headerId != null) out.headerId = Number(out.headerId)
  return out
}

export async function fetchStockOutFinishedGoodsSourcePage(pool, query = {}) {
  const keyword = text(query.keyword)
  const customerName = text(query.customerName)
  const customerCode = text(query.customerCode)
  const { page, pageSize, startRow, endRow } = parsePage(query)
  const options = {
    hasKeyword: Boolean(keyword),
    hasCustomerName: Boolean(customerName),
    hasCustomerCode: Boolean(customerCode) && !customerName,
  }

  const listReq = pool.request()
    .input('startRow', sql.Int, startRow)
    .input('endRow', sql.Int, endRow)
  if (keyword) listReq.input('keyword', sql.NVarChar(400), `%${keyword}%`)
  if (customerName) listReq.input('customerName', sql.NVarChar(500), customerName)
  if (customerCode && !customerName) listReq.input('customerCode', sql.NVarChar(200), customerCode)

  const listR = await listReq.query(buildStockOutFinishedGoodsSourceListSql(options))
  const rows = listR.recordset ?? []
  let total = rows.length ? Number(rows[0].totalCount ?? 0) : 0
  if (!rows.length && page > 1) {
    const countReq = pool.request()
    if (keyword) countReq.input('keyword', sql.NVarChar(400), `%${keyword}%`)
    if (customerName) countReq.input('customerName', sql.NVarChar(500), customerName)
    if (customerCode && !customerName) countReq.input('customerCode', sql.NVarChar(200), customerCode)
    const countR = await countReq.query(buildStockOutFinishedGoodsSourceCountSql(options))
    total = Number(countR.recordset?.[0]?.total ?? 0)
  }

  return {
    ok: true,
    page,
    pageSize,
    total,
    list: rows.map(serializeRow),
  }
}
