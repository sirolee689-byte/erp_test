import { clampErpPageSize, ERP_MAX_PAGE_SIZE } from './erpPagination.js'
/**
 * 成品出库（类型 6）关联销售订单选单。
 * 主从展开：一行 = 销售订单一条已审明细；PI 进列表仍须 EXISTS 至少一条可出明细。
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
  const pageSize = clampErpPageSize(rawPageSize, 10)
  return { page, pageSize, startRow: (page - 1) * pageSize + 1, endRow: page * pageSize }
}

function buildCustomerWhere(hasCustomerName = false, hasCustomerCode = false) {
  if (!hasCustomerName && !hasCustomerCode) return ''
  const parts = []
  if (hasCustomerName) parts.push(`${nvarcharTextExpr('h', 'kehu', 500)} = @customerName`)
  if (hasCustomerCode) parts.push(`${nvarcharTextExpr('h', 'xsaj05', 200)} = @customerCode`)
  return `AND (${parts.join(' OR ')})`
}

/** 关键字：主表 + 明细货品编码/名称/规格 */
export function buildStockOutFinishedGoodsKeywordWhere(hasKeyword = false) {
  if (!hasKeyword) return ''
  return `
    AND (
      h.[xsaj01] LIKE @keyword
      OR CONVERT(nvarchar(30), h.[xsaj02], 120) LIKE @keyword
      OR CONVERT(nvarchar(30), h.[xsaj08], 120) LIKE @keyword
      OR h.[xsaj03] LIKE @keyword
      OR h.[xsaj04] LIKE @keyword
      OR h.[xsaj05] LIKE @keyword
      OR h.[xsaj06] LIKE @keyword
      OR h.[xsaj08] LIKE @keyword
      OR CONVERT(nvarchar(200), h.[rmb]) LIKE @keyword
      OR l.[kcaa01] LIKE @keyword
      OR l.[kcaa02] LIKE @keyword
      OR l.[kcaa03] LIKE @keyword
    )
  `
}

/** 明细仍有可出数量（xsak03-xsak06>0）且 xsak02=GUID — 控制哪些 PI 出现在选派列表 */
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
  hasCustomerName = false,
  hasCustomerCode = false,
} = {}) {
  const customerWhere = buildCustomerWhere(hasCustomerName, hasCustomerCode)
  const shippableExists = buildStockOutFinishedGoodsShippableLineExistsSql()
  return `
    ${nvarcharTextExpr('h', 'del', 20)} IN (N'', N'0')
    AND LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), h.[pass]), N''))) = N'1'
    AND LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), h.[closed]), N'0'))) = N'0'
    AND ${shippableExists}
    ${customerWhere}
  `
}

/** 选派弹窗展示的明细行：已审未删且 xsak02=GUID（不要求 xsak03-xsak06>0） */
function buildLineBaseWhereSql(alias = 'l') {
  return `
    AND ${nvarcharTextExpr(alias, 'del', 20)} IN (N'', N'0')
    AND LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), ${alias}.[pass]), N''))) = N'1'
    AND ${nvarcharTextExpr(alias, 'xsak02', 200)} = ${nvarcharTextExpr(alias, 'GUID', 200)}
    AND ${nvarcharTextExpr(alias, 'xsak02', 200)} <> N''
  `
}

function buildHeaderOrderSql() {
  return `${nvarcharTextExpr('h', 'xsaj01', 200)} DESC, h.[id] DESC`
}

function buildSourceCteSql(options = {}) {
  const keywordWhere = buildStockOutFinishedGoodsKeywordWhere(options.hasKeyword)
  const headerOrder = buildHeaderOrderSql()
  return `
    WITH source AS (
      SELECT
        h.[id] AS headerId,
        l.[id] AS lineId,
        ${nvarcharTextExpr('h', 'xsaj01', 200)} AS sourceOrderNo,
        h.[xsaj02] AS orderDate,
        h.[xsaj08] AS deliveryDate,
        ${nvarcharTextExpr('h', 'xsaj05', 200)} AS customerCode,
        ${nvarcharTextExpr('h', 'kehu', 500)} AS customerName,
        ${nvarcharTextExpr('h', 'xsaj06', 500)} AS poNo,
        ${nvarcharTextExpr('h', 'systemcode', 200)} AS sourceSystemcode,
        ${nvarcharTextExpr('l', 'kcaa01', 500)} AS kcaa01,
        CASE
          WHEN ${nvarcharTextExpr('l', 'xsak03', 100)} <> N''
            THEN ${safeDecimalExpr('l', 'xsak03')}
          ELSE ${safeDecimalExpr('l', 'plan_quantity')}
        END AS orderQty,
        ${nvarcharTextExpr('l', 'kcaa06', 500)} AS customerStyleNo,
        ${nvarcharTextExpr('l', 'kcaa09', 500)} AS factoryStyleNo,
        COUNT(1) OVER() AS total,
        ROW_NUMBER() OVER (
          PARTITION BY ${nvarcharTextExpr('h', 'xsaj01', 200)}
          ORDER BY ISNULL(l.[seq], l.[id]), l.[id]
        ) AS groupRowNo,
        ROW_NUMBER() OVER (
          ORDER BY
            ${headerOrder},
            ISNULL(l.[seq], l.[id]),
            l.[id]
        ) AS rn
      FROM ${SALES_HEADER_FROM} AS h
      INNER JOIN ${SALES_LINE_FROM} AS l
        ON l.[xsak01] = h.[xsaj01]
      WHERE ${buildHeaderBaseWhereSql(options)}
        ${buildLineBaseWhereSql('l')}
        ${keywordWhere}
    )
  `
}

export function buildStockOutFinishedGoodsSourceCountSql(options = {}) {
  return `${buildSourceCteSql(options)}
    SELECT COUNT(1) AS total
    FROM source
  `
}

export function buildStockOutFinishedGoodsSourceListSql(options = {}) {
  return `${buildSourceCteSql(options)}
    SELECT source.*
    FROM source
    WHERE rn BETWEEN @startRow AND @endRow
    ORDER BY rn ASC
  `
}

function serializeRow(row = {}) {
  const out = {}
  for (const [key, value] of Object.entries(row)) {
    if (key === 'rn') continue
    out[key] = value instanceof Date ? value.toISOString().replace('T', ' ').slice(0, 19) : value
  }
  if (out.headerId != null) out.headerId = Number(out.headerId)
  if (out.lineId != null) out.lineId = Number(out.lineId)
  if (out.groupRowNo != null) out.groupRowNo = Number(out.groupRowNo)
  return out
}

function bindSourceQueryParams(req, { keyword, customerName, customerCode }) {
  if (keyword) req.input('keyword', sql.NVarChar(400), `%${keyword}%`)
  if (customerName) req.input('customerName', sql.NVarChar(500), customerName)
  if (customerCode && !customerName) req.input('customerCode', sql.NVarChar(200), customerCode)
  return req
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

  const listReq = bindSourceQueryParams(pool.request(), { keyword, customerName, customerCode })
    .input('startRow', sql.Int, startRow)
    .input('endRow', sql.Int, endRow)
  const listR = await listReq.query(buildStockOutFinishedGoodsSourceListSql(options))
  const total = Number(listR.recordset?.[0]?.total ?? 0)

  return {
    ok: true,
    page,
    pageSize,
    total,
    list: (listR.recordset ?? []).map(serializeRow),
  }
}
