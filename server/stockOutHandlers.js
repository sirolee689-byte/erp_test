import { sql } from './db.js'
import { getActorAuditTripletFromReq } from './businessAuditFields.js'
import { getRequestIp } from './operationAuditMiddleware.js'
import { resolveSysUserIsAdminByUserId } from './sysUsersDb.js'
import {
  buildStockOutListPagedSql,
  buildStockOutListWhereSql,
  parseStockOutListQuery,
} from './stockOutListQuery.js'
import { suggestStockOutNo, createStockOut, updateStockOut } from './stockOutSaveService.js'
import { applyStockOutLifecycleAction } from './stockOutLifecycle.js'
import { buildStockOutAvailabilitySql } from './stockOutAvailability.js'
import { queryStockOutSourceLines } from './stockOutSourceLines.js'
import { queryStockOutExpandLines } from './stockOutExpandLines.js'
import {
  fetchStockOutOtherBatchLines,
  fetchStockOutOtherBatchPrices,
} from './stockOutOtherBatchAdd.js'
import { fetchStockOutPurchaseReturnBatchLines } from './stockOutPurchaseReturnBatchAdd.js'
import { fetchStockOutFinishedGoodsBatchLines } from './stockOutFinishedGoodsBatchAdd.js'
import { fetchStockOutAssistIssueBatchLines } from './stockOutAssistIssueBatchAdd.js'
import { fetchStockOutProductionDispatchSourcePage } from './stockOutProductionDispatchSourcePage.js'
import { fetchStockOutFinishedGoodsSourcePage } from './stockOutFinishedGoodsSourcePage.js'
import { fetchStockOutProductionIssueBatchLines } from './stockOutProductionIssueBatchAdd.js'
import { fetchCuttingIssueConfig, updateCuttingIssueConfig } from './stockOutCuttingIssueConfig.js'
import { safeDecimalExpr } from './buyOrderSqlSafe.js'

const HEADER_FROM = 'dbo.[UB_ERP_Stocks_out]'
const WAREHOUSE_FROM = 'dbo.[UB_ERP_Stocks_Warehouse]'
const SUPPLIER_FROM = 'dbo.[UB_ERP_System_supplier]'
const WORKSHOP_FROM = 'dbo.[UB_ERP_Stocks_workshop]'
const CUSTOMER_FROM = 'dbo.[UB_ERP_Customer]'
const SALES_CUSTOMER_FROM = 'dbo.[UB_ERP_System_sales_customer]'
const BUY_ORDER_FROM = 'dbo.[UB_ERP_Buy_order]'
const BUY_ORDER_LINE_FROM = 'dbo.[UB_ERP_Buy_order_list]'
const ASSIST_ORDER_FROM = 'dbo.[UB_ERP_assist_order]'
const ASSIST_ORDER_LINE_FROM = 'dbo.[UB_ERP_assist_order_list]'
const CURRENCY_FROM = 'dbo.[UB_ERP_Finance_currency]'
const STOCK_IN_FROM = 'dbo.[UB_ERP_Stocks_Storage]'
const STOCK_IN_LINE_FROM = 'dbo.[UB_ERP_Stocks_Storage_list]'

function text(v) {
  return String(v ?? '').trim()
}

function normalizeId(v) {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : 0
}

function bindListParams(req, params) {
  for (const [key, value] of Object.entries(params ?? {})) req.input(key, sql.NVarChar(500), value)
}

function serializeRow(row = {}) {
  return { ...row }
}

function parsePageParams(query = {}, { defaultPageSize = 10, maxPageSize = 200 } = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1)
  const pageSize = Math.min(maxPageSize, Math.max(1, Number.parseInt(query.pageSize, 10) || defaultPageSize))
  return { page, pageSize, startRow: (page - 1) * pageSize + 1, endRow: page * pageSize }
}

async function getActor(pool, req) {
  const triplet = await getActorAuditTripletFromReq(pool, req)
  const base = { ...(req.user ?? req.session?.user ?? {}), ...triplet }
  // 彻底删除等门禁读 UB_ERP_User.is_admin；登录令牌未必带该字段，按主键实时查库
  const uid = triplet.uidInt ?? base.userId ?? base.UserID
  const isAdmin = await resolveSysUserIsAdminByUserId(pool, uid)
  return { ...base, is_admin: isAdmin ? 1 : 0, isAdmin }
}

function sendSave(res, result, fallback = '保存成功') {
  if (!result.ok) {
    res.status(result.status ?? 400).json({ code: result.status ?? 400, msg: result.msg, data: null })
    return
  }
  res.json({ code: 200, msg: result.msg || fallback, data: result })
}

/** 采购退货选单：供应商筛选（主表 h） */
function buildPurchaseReturnSourceSupplierWhere(hasSupplier) {
  if (!hasSupplier) return ''
  return `AND (
    LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcaj05], N'')))) LIKE @supplier
    OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[kehu], N'')))) LIKE @supplier
  )`
}

/** 采购退货选单：关键字（主表 h + 明细 l，须在 JOIN 后使用） */
function buildPurchaseReturnSourceKeywordWhere(hasKeyword) {
  if (!hasKeyword) return ''
  return `AND (
    LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcaj01], N'')))) LIKE @keyword
    OR LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcaj02], N'')))) LIKE @keyword
    OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[kcaj03], N'')))) LIKE @keyword
    OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[kcaj04], N'')))) LIKE @keyword
    OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[kcaj05], N'')))) LIKE @keyword
    OR LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(h.[kcaj06], N'')))) LIKE @keyword
    OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[kcaj08], N'')))) LIKE @keyword
    OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[rmb], N'')))) LIKE @keyword
    OR LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) LIKE @keyword
    OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa02], N'')))) LIKE @keyword
    OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa03], N'')))) LIKE @keyword
  )`
}

/** 采购退货选单：主从合并 CTE（COUNT 与列表共用，保证 total 与分页行数一致） */
function buildPurchaseReturnSourceCteSql(supplierWhere = '', keywordWhere = '') {
  return `
    WITH source AS (
      SELECT
        h.[id] AS headerId,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcaj01], N'')))) AS sourceOrderNo,
        h.[kcaj02] AS buyDate,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcaj05], N'')))) AS supplierCode,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[kehu], N'')))) AS supplierName,
        LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(h.[kcaj06], N'')))) AS taxIncluded,
        LTRIM(RTRIM(CONVERT(nvarchar(1000), ISNULL(h.[remark], N'')))) AS remark,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[systemcode], N'')))) AS sourceSystemcode,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[rmb], N'')))) AS currencyName,
        ISNULL(NULLIF(LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(h.[rmb_hl], N'')))), N''), N'1') AS exchangeRate,
        l.[id] AS lineId,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcak02], ISNULL(l.[systemcode], N'')))) ) AS sourceLineCode,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) AS kcaa01,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa02], N'')))) AS kcaa02,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa03], N'')))) AS kcaa03,
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(l.[kcaa04], N'')))) AS kcaa04,
        ${safeDecimalExpr('l', 'kcak03')} AS orderQty,
        ${safeDecimalExpr('l', 'kcak04')} AS kcak04,
        ${safeDecimalExpr('l', 'kcak041')} AS kcak041,
        ${safeDecimalExpr('l', 'kcak05')} AS kcak05,
        ${safeDecimalExpr('l', 'kcak051')} AS kcak051,
        ${safeDecimalExpr('l', 'tax')} AS tax,
        ISNULL(${safeDecimalExpr('l', 'kcak07')}, 0) AS outQty,
        CASE WHEN ISNULL(${safeDecimalExpr('l', 'kcak03')}, 0) - ISNULL(${safeDecimalExpr('l', 'kcak07')}, 0) > 0 THEN N'有' ELSE N'无' END AS hasConvertData,
        ROW_NUMBER() OVER (PARTITION BY h.[kcaj01] ORDER BY ISNULL(l.[seq], 0), l.[id]) AS groupRowNo,
        ROW_NUMBER() OVER (
          ORDER BY
            CASE WHEN ISNULL(LTRIM(RTRIM(CONVERT(nvarchar(50), h.[addtime]))), N'') = N'' THEN 1 ELSE 0 END ASC,
            LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(h.[addtime], N'')))) DESC,
            h.[id] DESC,
            ISNULL(l.[seq], 0),
            l.[id]
        ) AS rn
      FROM ${BUY_ORDER_FROM} AS h
      INNER JOIN ${BUY_ORDER_LINE_FROM} AS l
        ON LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcak01], N''))))
         = LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcaj01], N''))))
      WHERE (ISNULL(h.[del], N'') = N'' OR h.[del] = N'0')
        AND LTRIM(RTRIM(ISNULL(h.[pass], N''))) = N'1'
        AND LTRIM(RTRIM(ISNULL(h.[closed], N'0'))) = N'0'
        AND (ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')
        AND LTRIM(RTRIM(ISNULL(l.[pass], N''))) = N'1'
        ${supplierWhere}
        ${keywordWhere}
    )
  `
}

function buildPurchaseReturnSourceCountSql(supplierWhere = '', keywordWhere = '') {
  return `${buildPurchaseReturnSourceCteSql(supplierWhere, keywordWhere)}
    SELECT COUNT(1) AS total
    FROM source
  `
}

function buildPurchaseReturnSourceListSql(supplierWhere = '', keywordWhere = '') {
  return `${buildPurchaseReturnSourceCteSql(supplierWhere, keywordWhere)}
    SELECT *
    FROM source
    WHERE rn BETWEEN @startRow AND @endRow
    ORDER BY rn ASC
  `
}

export function __buildPurchaseReturnSourceCountSqlForTest(supplierWhere, keywordWhere) {
  return buildPurchaseReturnSourceCountSql(supplierWhere, keywordWhere)
}

export function __buildPurchaseReturnSourceListSqlForTest(supplierWhere, keywordWhere) {
  return buildPurchaseReturnSourceListSql(supplierWhere, keywordWhere)
}

/** 外协领料选单：关键字只搜 PI、外协商、外协单号 */
function buildAssistIssueSourceKeywordWhere(hasKeyword) {
  if (!hasKeyword) return ''
  return `AND (
    LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[wxaj01], N'')))) LIKE @keyword
    OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[wxaj04], N'')))) LIKE @keyword
    OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[wxaj05], N'')))) LIKE @keyword
    OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[kehu], N'')))) LIKE @keyword
  )`
}

/** 外协明细换算后剩余量 SQL 片段（用于过滤可出明细） */
function assistLineRemainExpr() {
  const qty = safeDecimalExpr('l', 'wxak03')
  const used = safeDecimalExpr('l', 'wxak08')
  const adjust = safeDecimalExpr('l', 'wxak07')
  const ratio = safeDecimalExpr('l', 'kcaa26')
  const dir = `LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(l.[kcaa27], N''))))`
  const ksum = `
    CASE
      WHEN ${ratio} > 0 AND ${dir} = N'1' THEN ${qty} / ${ratio}
      WHEN ${ratio} > 0 AND ${dir} = N'0' THEN ${qty} * ${ratio}
      ELSE ${qty}
    END`
  return `(${ksum}) - ${used} + ISNULL(${adjust}, 0)`
}

/** 外协入库数量预聚合：替代逐行关联子查询，选单列表与 COUNT 兜底共用 */
function buildAssistIssueInboundAggCteSql() {
  return `
    inbound_agg AS (
      SELECT
        sh.[kcan04] AS sourceOrderNo,
        sl.[kcao02] AS sourceLineCode,
        SUM(${safeDecimalExpr('sl', 'kcao03')}) AS inboundQty
      FROM ${STOCK_IN_FROM} AS sh
      INNER JOIN ${STOCK_IN_LINE_FROM} AS sl
        ON sl.[kcao01] = sh.[kcan01]
      WHERE (ISNULL(sh.[del], N'') = N'' OR sh.[del] = N'0')
        AND (ISNULL(sl.[del], N'') = N'' OR sl.[del] = N'0')
        AND LTRIM(RTRIM(ISNULL(sh.[pass], N''))) = N'1'
        AND LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(sh.[kcan03], N'')))) = N'2'
      GROUP BY sh.[kcan04], sl.[kcao02]
    )`
}

function buildAssistIssueSourceCteSql(supplierWhere = '', keywordWhere = '') {
  const remainExpr = assistLineRemainExpr()
  return `
    WITH ${buildAssistIssueInboundAggCteSql()},
    source AS (
      SELECT
        h.[id] AS headerId,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[wxaj01], N'')))) AS sourceOrderNo,
        h.[wxaj02] AS assistDate,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[wxaj04], N'')))) AS referenceNo,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[wxaj05], N'')))) AS supplierCode,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[kehu], N'')))) AS supplierName,
        LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(h.[wxaj06], N'')))) AS taxIncluded,
        LTRIM(RTRIM(CONVERT(nvarchar(1000), ISNULL(h.[remark], N'')))) AS remark,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[systemcode], N'')))) AS sourceSystemcode,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[rmb], N'')))) AS currencyName,
        ISNULL(NULLIF(LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(c.[rate], ISNULL(h.[rmb_hl], N''))))), N''), N'1') AS exchangeRate,
        l.[id] AS lineId,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[wxak02], ISNULL(l.[systemcode], N''))))) AS sourceLineCode,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) AS kcaa01,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa02], N'')))) AS kcaa02,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa03], N'')))) AS kcaa03,
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(l.[kcaa04], N'')))) AS kcaa04,
        ${safeDecimalExpr('l', 'wxak03')} AS orderQty,
        ${safeDecimalExpr('l', 'wxak04')} AS wxak04,
        ${safeDecimalExpr('l', 'wxak041')} AS wxak041,
        ${safeDecimalExpr('l', 'wxak05')} AS wxak05,
        ${safeDecimalExpr('l', 'wxak051')} AS wxak051,
        ${safeDecimalExpr('l', 'Tax')} AS tax,
        ISNULL(${safeDecimalExpr('l', 'wxak08')}, 0) AS outQty,
        ISNULL(inb.[inboundQty], 0) AS inboundQty,
        CASE
          WHEN LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa25], N'')))) <> N''
            AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa25], N'')))) <> LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa04], N''))))
          THEN N'有'
          ELSE N'无'
        END AS hasConvertData,
        ROW_NUMBER() OVER (PARTITION BY h.[wxaj01] ORDER BY ISNULL(l.[seq], 0), l.[id]) AS groupRowNo,
        ROW_NUMBER() OVER (
          ORDER BY
            CASE WHEN ISNULL(LTRIM(RTRIM(CONVERT(nvarchar(50), h.[addtime]))), N'') = N'' THEN 1 ELSE 0 END ASC,
            LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(h.[addtime], N'')))) DESC,
            h.[id] DESC,
            ISNULL(l.[seq], 0),
            l.[id]
        ) AS rn
      FROM ${ASSIST_ORDER_FROM} AS h
      INNER JOIN ${ASSIST_ORDER_LINE_FROM} AS l
        ON l.[wxak01] = h.[wxaj01]
      LEFT JOIN inbound_agg AS inb
        ON inb.[sourceOrderNo] = h.[wxaj01]
       AND inb.[sourceLineCode] = ISNULL(l.[wxak02], l.[systemcode])
      LEFT JOIN ${CURRENCY_FROM} AS c
        ON c.[code] = h.[wxaj07]
      WHERE (ISNULL(h.[del], N'') = N'' OR h.[del] = N'0')
        AND LTRIM(RTRIM(ISNULL(h.[pass], N''))) = N'1'
        AND LTRIM(RTRIM(ISNULL(h.[closed], N'0'))) = N'0'
        AND (ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')
        AND LTRIM(RTRIM(ISNULL(l.[pass], N''))) = N'1'
        AND ${remainExpr} > 0
        ${supplierWhere}
        ${keywordWhere}
    )
  `
}

/** 分页超出且无行时兜底 total（首屏正常走 list 内 totalCount） */
function buildAssistIssueSourceCountSql(supplierWhere = '', keywordWhere = '') {
  return `${buildAssistIssueSourceCteSql(supplierWhere, keywordWhere)}
    SELECT COUNT(1) AS total
    FROM source
  `
}

function buildAssistIssueSourceListSql(supplierWhere = '', keywordWhere = '') {
  return `${buildAssistIssueSourceCteSql(supplierWhere, keywordWhere)},
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

function stripAssistIssueSourceListRow(row = {}) {
  const { totalCount, ...rest } = row
  return serializeRow(rest)
}

export function __buildAssistIssueSourceCountSqlForTest(supplierWhere, keywordWhere) {
  return buildAssistIssueSourceCountSql(supplierWhere, keywordWhere)
}

export function __buildAssistIssueSourceListSqlForTest(supplierWhere, keywordWhere) {
  return buildAssistIssueSourceListSql(supplierWhere, keywordWhere)
}

export function __buildAssistIssueSourceKeywordWhereForTest(hasKeyword) {
  return buildAssistIssueSourceKeywordWhere(hasKeyword)
}

export function registerStockOutRoutes(app, deps) {
  const { getPool } = deps

  app.get('/api/stock-out/list', async (req, res) => {
    try {
      const pool = await getPool()
      const q = parseStockOutListQuery(req.query ?? {})
      const { whereSql, params } = buildStockOutListWhereSql(q)
      const countReq = pool.request()
      bindListParams(countReq, params)
      const totalRow = await countReq.query(`SELECT COUNT(1) AS total FROM ${HEADER_FROM} AS h WHERE 1=1 ${whereSql}`)
      const total = Number(totalRow.recordset?.[0]?.total ?? 0)
      const listReq = pool.request().input('startRow', sql.Int, (q.page - 1) * q.pageSize + 1).input('endRow', sql.Int, q.page * q.pageSize)
      bindListParams(listReq, params)
      const listResult = await listReq.query(buildStockOutListPagedSql({ whereSql }).sql)
      res.json({ code: 200, msg: 'success', data: { total, list: (listResult.recordset ?? []).map(serializeRow) } })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取出库单列表失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  app.get('/api/stock-out/suggest-doc-no', async (_req, res) => {
    try {
      const pool = await getPool()
      res.json({ code: 200, msg: 'success', data: { suggested: await suggestStockOutNo(pool, new Date()) } })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `获取出库单号失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  app.get('/api/stock-out/warehouse-options', async (req, res) => {
    try {
      const keyword = text(req.query?.keyword)
      const pool = await getPool()
      const dbReq = pool.request()
      if (keyword) dbReq.input('kw', sql.NVarChar(400), `%${keyword}%`)
      const r = await dbReq.query(`
        SELECT TOP 100 LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([code], N'')))) AS code,
               LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([name], N'')))) AS name
        FROM ${WAREHOUSE_FROM}
        WHERE (ISNULL([del], N'') = N'' OR [del] = N'0')
        ${keyword ? `AND (LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([code], N'')))) LIKE @kw OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([name], N'')))) LIKE @kw)` : ''}
        ORDER BY [code] ASC
      `)
      res.json({ code: 200, msg: 'success', data: { list: r.recordset ?? [] } })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取仓库失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  /** 列表筛选：供应商/外协商联想（点击可直接下拉，关键字可选） */
  app.get('/api/stock-out/list-related-party-options', async (req, res) => {
    try {
      const keyword = text(req.query?.keyword)
      const pool = await getPool()
      const dbReq = pool.request()
      if (keyword) dbReq.input('kw', sql.NVarChar(400), `%${keyword}%`)
      const r = await dbReq.query(`
        SELECT TOP 50
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([s_code], N'')))) AS code,
          LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(NULLIF([s_name], N''), [name])))) AS name
        FROM ${SUPPLIER_FROM}
        WHERE (ISNULL([del], N'') = N'' OR [del] = N'0')
          AND LTRIM(RTRIM(ISNULL([pass], N''))) = N'1'
          ${keyword
    ? `AND (
            LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([s_code], N'')))) LIKE @kw
            OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(NULLIF([s_name], N''), [name])))) LIKE @kw
          )`
    : ''}
        ORDER BY [s_code] ASC
      `)
      res.json({ code: 200, msg: 'success', data: { list: r.recordset ?? [] } })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取供应商候选失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  app.get('/api/stock-out/related-party-options', async (req, res) => {
    try {
      const pool = await getPool()
      const type = text(req.query?.outboundType)
      const keyword = text(req.query?.keyword)
      const dbReq = pool.request()
      if (keyword) dbReq.input('kw', sql.NVarChar(400), `%${keyword}%`)
      let sqlText = ''
      if (['1', '2', '3'].includes(type)) {
        const assistFilter = type === '2'
          ? `AND LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL([s_lb], N'')))) IN (N'外协', N'共用')`
          : ''
        sqlText = `
          SELECT TOP 100 LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([s_code], N'')))) AS code,
                 LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(NULLIF([s_name], N''), [name])))) AS name
          FROM ${SUPPLIER_FROM}
          WHERE (ISNULL([del], N'') = N'' OR [del] = N'0')
            AND LTRIM(RTRIM(ISNULL([pass], N''))) = N'1'
            ${assistFilter}
          ${keyword ? `AND (LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([s_code], N'')))) LIKE @kw OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(NULLIF([s_name], N''), [name])))) LIKE @kw)` : ''}
          ORDER BY [s_code] ASC
        `
      } else if (['4', '5', '7', '8'].includes(type)) {
        sqlText = `
          SELECT TOP 100 LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([code], N'')))) AS code,
                 LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([name], N'')))) AS name
          FROM ${WORKSHOP_FROM}
          WHERE (ISNULL([del], N'') = N'' OR [del] = N'0')
            AND LTRIM(RTRIM(ISNULL([pass], N''))) = N'1'
          ${keyword ? `AND (LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([code], N'')))) LIKE @kw OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([name], N'')))) LIKE @kw)` : ''}
          ORDER BY [code] ASC
        `
      } else if (type === '0' || type === '6') {
        // 其他出库：关联单位实际为销售客户（非供应商）
        sqlText = `
          SELECT TOP 100
            LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([s_code], N'')))) AS code,
            LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([s_name], N'')))) AS name
          FROM ${SALES_CUSTOMER_FROM}
          WHERE (ISNULL([del], N'') = N'' OR [del] = N'0')
            AND LTRIM(RTRIM(ISNULL([pass], N''))) = N'1'
          ${keyword
    ? `AND (
            LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([s_code], N'')))) LIKE @kw
            OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([s_name], N'')))) LIKE @kw
          )`
    : ''}
          ORDER BY [s_code] ASC
        `
      } else {
        sqlText = `
          SELECT TOP 100 LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([khaa01], ISNULL([code], N''))))) AS code,
                 LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([khaa02], ISNULL([name], N''))))) AS name
          FROM ${CUSTOMER_FROM}
          WHERE (ISNULL([del], N'') = N'' OR [del] = N'0')
          ${keyword ? `AND (LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([khaa01], ISNULL([code], N''))))) LIKE @kw OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([khaa02], ISNULL([name], N''))))) LIKE @kw)` : ''}
          ORDER BY [code] ASC
        `
      }
      const r = await dbReq.query(sqlText)
      res.json({ code: 200, msg: 'success', data: { list: r.recordset ?? [] } })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取关联方失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  app.get('/api/stock-out/material-options', async (req, res) => {
    try {
      const pool = await getPool()
      const dbReq = pool.request()
      const keyword = text(req.query?.keyword)
      const warehouseCode = text(req.query?.warehouseCode)
      if (keyword) dbReq.input('kw', sql.NVarChar(400), `%${keyword}%`)
      if (warehouseCode) dbReq.input('warehouseCode', sql.NVarChar(200), warehouseCode)
      const availabilitySql = buildStockOutAvailabilitySql({ excludeOutboundNo: text(req.query?.excludeOutboundNo) })
      const r = await dbReq.query(`
        SELECT TOP 100 *
        FROM (${availabilitySql}) AS s
        WHERE s.[availableQty] > 0
          ${warehouseCode ? `AND s.[warehouseCode] = @warehouseCode` : ''}
          ${keyword ? `AND (s.[materialCode] LIKE @kw)` : ''}
        ORDER BY s.[materialCode] ASC
      `)
      res.json({ code: 200, msg: 'success', data: { list: r.recordset ?? [] } })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取可出库存失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  /** 采购退货：关联采购单分页（主从同屏，单号首行显示“关联选择”） */
  app.get('/api/stock-out/purchase-return-source-page', async (req, res) => {
    try {
      const pool = await getPool()
      const supplier = text(req.query?.supplier)
      const keyword = text(req.query?.keyword)
      const { page, pageSize, startRow, endRow } = parsePageParams(req.query ?? {}, { defaultPageSize: 10, maxPageSize: 200 })
      const countReq = pool.request()
      const listReq = pool.request()
        .input('startRow', sql.Int, startRow)
        .input('endRow', sql.Int, endRow)
      const supplierWhere = buildPurchaseReturnSourceSupplierWhere(Boolean(supplier))
      const keywordWhere = buildPurchaseReturnSourceKeywordWhere(Boolean(keyword))
      if (supplier) {
        countReq.input('supplier', sql.NVarChar(400), `%${supplier}%`)
        listReq.input('supplier', sql.NVarChar(400), `%${supplier}%`)
      }
      if (keyword) {
        countReq.input('keyword', sql.NVarChar(400), `%${keyword}%`)
        listReq.input('keyword', sql.NVarChar(400), `%${keyword}%`)
      }

      const countResult = await countReq.query(buildPurchaseReturnSourceCountSql(supplierWhere, keywordWhere))
      const total = Number(countResult.recordset?.[0]?.total ?? 0)
      const listResult = await listReq.query(buildPurchaseReturnSourceListSql(supplierWhere, keywordWhere))
      res.json({ code: 200, msg: 'success', data: { page, pageSize, total, list: listResult.recordset ?? [] } })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取采购退货关联采购单失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  /** 采购退货批量添加：本仓入库/退货出库/仓库库存计算可退数量 */
  app.get('/api/stock-out/purchase-return-batch-lines', async (req, res) => {
    try {
      const pool = await getPool()
      const result = await fetchStockOutPurchaseReturnBatchLines(pool, req.query ?? {})
      if (!result.ok) {
        res.status(result.status ?? 400).json({ code: result.status ?? 400, msg: result.msg, data: null })
        return
      }
      res.json({
        code: 200,
        msg: 'success',
        data: {
          page: result.page,
          pageSize: result.pageSize,
          total: result.total,
          sourceOrderNo: result.sourceOrderNo,
          supplierCode: result.supplierCode,
          warehouseCode: result.warehouseCode,
          list: result.list ?? [],
        },
      })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取采购退货批量明细失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  /** 成品出库批量添加：销售订单明细 + 已出/未出占用计算可出货数量 */
  app.get('/api/stock-out/finished-goods-batch-lines', async (req, res) => {
    try {
      const pool = await getPool()
      const result = await fetchStockOutFinishedGoodsBatchLines(pool, req.query ?? {})
      if (!result.ok) {
        res.status(result.status ?? 400).json({ code: result.status ?? 400, msg: result.msg, data: null })
        return
      }
      res.json({
        code: 200,
        msg: 'success',
        data: {
          page: result.page,
          pageSize: result.pageSize,
          total: result.total,
          sourceOrderNo: result.sourceOrderNo,
          customerCode: result.customerCode,
          sourceSystemcodeId: result.sourceSystemcodeId,
          warehouseCode: result.warehouseCode,
          currencyName: result.currencyName,
          currencyRate: result.currencyRate,
          list: result.list ?? [],
        },
      })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取成品出库批量明细失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  /** 外协领料：关联外协单分页（主从同屏） */
  app.get('/api/stock-out/assist-issue-source-page', async (req, res) => {
    try {
      const pool = await getPool()
      const keyword = text(req.query?.keyword)
      const { page, pageSize, startRow, endRow } = parsePageParams(req.query ?? {}, { defaultPageSize: 10, maxPageSize: 200 })
      const keywordWhere = buildAssistIssueSourceKeywordWhere(Boolean(keyword))
      const listReq = pool.request()
        .input('startRow', sql.Int, startRow)
        .input('endRow', sql.Int, endRow)
      if (keyword) listReq.input('keyword', sql.NVarChar(400), `%${keyword}%`)

      const listResult = await listReq.query(buildAssistIssueSourceListSql('', keywordWhere))
      const rawRows = listResult.recordset ?? []

      let total = 0
      if (rawRows.length > 0) {
        total = Number(rawRows[0].totalCount ?? 0)
      } else if (page === 1) {
        total = 0
      } else {
        const countReq = pool.request()
        if (keyword) countReq.input('keyword', sql.NVarChar(400), `%${keyword}%`)
        const countResult = await countReq.query(buildAssistIssueSourceCountSql('', keywordWhere))
        total = Number(countResult.recordset?.[0]?.total ?? 0)
      }

      res.json({
        code: 200,
        msg: 'success',
        data: {
          page,
          pageSize,
          total,
          list: rawRows.map(stripAssistIssueSourceListRow),
        },
      })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取外协领料关联外协单失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  /** 生产领料：关联派工单选派（主单级） */
  app.get('/api/stock-out/production-dispatch-source-page', async (req, res) => {
    try {
      const pool = await getPool()
      const result = await fetchStockOutProductionDispatchSourcePage(pool, req.query ?? {})
      if (!result.ok) {
        res.status(result.status ?? 400).json({ code: result.status ?? 400, msg: result.msg, data: null })
        return
      }
      res.json({
        code: 200,
        msg: 'success',
        data: {
          page: result.page,
          pageSize: result.pageSize,
          total: result.total ?? 0,
          workshopName: result.workshopName ?? '',
          list: result.list ?? [],
        },
      })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取生产领料派工单列表失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  /** 生产领料批量添加：派工明细 PI 成本展开 + 库存/PI 上限 */
  /** 成品出库：关联销售订单分页（只显示还有可出货明细的销售订单） */
  app.get('/api/stock-out/finished-goods-source-page', async (req, res) => {
    try {
      const pool = await getPool()
      const result = await fetchStockOutFinishedGoodsSourcePage(pool, req.query ?? {})
      if (!result.ok) {
        res.status(result.status ?? 400).json({ code: result.status ?? 400, msg: result.msg, data: null })
        return
      }
      res.json({
        code: 200,
        msg: 'success',
        data: {
          page: result.page,
          pageSize: result.pageSize,
          total: result.total ?? 0,
          list: result.list ?? [],
        },
      })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取成品出库关联销售订单失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  /** 生产领料批量添加：派工明细 PI 成本展开 + 库存/PI 上限 */
  app.get('/api/stock-out/production-issue-batch-lines', async (req, res) => {
    try {
      const pool = await getPool()
      const result = await fetchStockOutProductionIssueBatchLines(pool, req.query ?? {})
      if (!result.ok) {
        res.status(result.status ?? 400).json({ code: result.status ?? 400, msg: result.msg, data: null })
        return
      }
      res.json({
        code: 200,
        msg: 'success',
        data: {
          page: result.page,
          pageSize: result.pageSize,
          total: result.total,
          sourceOrderNo: result.sourceOrderNo,
          workshopCode: result.workshopCode,
          warehouseCode: result.warehouseCode,
          piNo: result.piNo,
          piCostHint: result.piCostHint ?? '',
          batchMode: result.batchMode ?? 'dispatch',
          list: result.list ?? [],
        },
      })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取生产领料批量明细失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  /** 开料出库配置：读取材料分类 cutting_issue 开关 */
  app.get('/api/stock-out/cutting-issue-config', async (req, res) => {
    try {
      const pool = await getPool()
      const result = await fetchCuttingIssueConfig(pool)
      if (!result.ok) {
        res.status(result.status ?? 400).json({ code: result.status ?? 400, msg: result.msg, data: null })
        return
      }
      res.json({ code: 200, msg: 'success', data: { list: result.list ?? [] } })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取开料出库配置失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  /** 开料出库配置：超级管理员批量更新 cutting_issue */
  app.put('/api/stock-out/cutting-issue-config', async (req, res) => {
    try {
      const pool = await getPool()
      const actor = await getActor(pool, req)
      const uid = actor.uidInt ?? actor.userId ?? actor.UserID
      const isAdmin = await resolveSysUserIsAdminByUserId(pool, uid)
      if (!isAdmin) {
        res.status(403).json({ code: 403, msg: '只有超级管理员可以修改开料出库配置', data: null })
        return
      }
      const result = await updateCuttingIssueConfig(pool, req.body ?? {})
      if (!result.ok) {
        res.status(result.status ?? 400).json({ code: result.status ?? 400, msg: result.msg, data: null })
        return
      }
      res.json({ code: 200, msg: result.msg || '保存成功', data: { updated: result.updated ?? 0 } })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `保存开料出库配置失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  /** 外协领料批量添加：来源剩余 + 仓库库存计算可领数量 */
  app.get('/api/stock-out/assist-issue-batch-lines', async (req, res) => {
    try {
      const pool = await getPool()
      const result = await fetchStockOutAssistIssueBatchLines(pool, req.query ?? {})
      if (!result.ok) {
        res.status(result.status ?? 400).json({ code: result.status ?? 400, msg: result.msg, data: null })
        return
      }
      res.json({
        code: 200,
        msg: 'success',
        data: {
          page: result.page,
          pageSize: result.pageSize,
          total: result.total,
          sourceOrderNo: result.sourceOrderNo,
          supplierCode: result.supplierCode,
          warehouseCode: result.warehouseCode,
          piNo: result.piNo,
          list: result.list ?? [],
        },
      })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取外协领料批量明细失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  /** 其他出库批量选材：按仓库 + kcaa01 汇总库存分页 */
  app.get('/api/stock-out/other-batch-lines', async (req, res) => {
    try {
      const pool = await getPool()
      const result = await fetchStockOutOtherBatchLines(pool, req.query ?? {})
      if (!result.ok) {
        res.status(result.status ?? 400).json({ code: result.status ?? 400, msg: result.msg, data: null })
        return
      }
      res.json({
        code: 200,
        msg: 'success',
        data: {
          list: result.list ?? [],
          total: result.total ?? 0,
          page: result.page,
          pageSize: result.pageSize,
          warehouseCode: result.warehouseCode,
        },
      })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取其他出库批量选材失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  /** 其他出库批量选材：按物料取最近已审核且已复核入库价 */
  app.post('/api/stock-out/other-batch-prices', async (req, res) => {
    try {
      const pool = await getPool()
      const warehouseCode = text(req.body?.warehouseCode)
      const materialCodes = Array.isArray(req.body?.materialCodes) ? req.body.materialCodes : []
      const result = await fetchStockOutOtherBatchPrices(pool, { warehouseCode, materialCodes })
      if (!result.ok) {
        res.status(result.status ?? 400).json({ code: result.status ?? 400, msg: result.msg, data: null })
        return
      }
      res.json({ code: 200, msg: 'success', data: { priceMap: result.priceMap ?? {} } })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取批量选材价格失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  app.get('/api/stock-out/inventory-summary', async (req, res) => {
    try {
      const pool = await getPool()
      const dbReq = pool.request()
      const warehouseCode = text(req.query?.warehouseCode)
      if (warehouseCode) dbReq.input('warehouseCode', sql.NVarChar(200), warehouseCode)
      const r = await dbReq.query(`
        SELECT *
        FROM (${buildStockOutAvailabilitySql({ excludeOutboundNo: text(req.query?.excludeOutboundNo) })}) AS s
        WHERE 1=1 ${warehouseCode ? `AND s.[warehouseCode] = @warehouseCode` : ''}
        ORDER BY s.[materialCode] ASC
      `)
      res.json({ code: 200, msg: 'success', data: { list: r.recordset ?? [] } })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取出库库存统计失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  app.get('/api/stock-out/source-lines', async (req, res) => {
    try {
      const pool = await getPool()
      const list = await queryStockOutSourceLines(pool, {
        outboundType: req.query?.outboundType,
        sourceOrderNo: req.query?.sourceOrderNo,
        keyword: req.query?.keyword,
      })
      res.json({ code: 200, msg: 'success', data: { list } })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取出库来源明细失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  app.get('/api/stock-out/print-data', async (req, res) => {
    req.params = { id: req.query?.id }
    return detail(req, res, true)
  })

  async function detail(req, res, forPrint = false) {
    try {
      const id = normalizeId(req.params?.id)
      if (!id) return res.status(400).json({ code: 400, msg: '出库单参数无效', data: null })
      const pool = await getPool()
      const headerR = await pool.request().input('id', sql.Int, id).query(`SELECT TOP 1 * FROM ${HEADER_FROM} WHERE [id] = @id`)
      const header = headerR.recordset?.[0]
      if (!header) return res.status(404).json({ code: 404, msg: '出库单不存在', data: null })
      const outboundNo = text(header.kcap01)
      const lines = await queryStockOutExpandLines(pool, outboundNo)
      res.json({ code: 200, msg: 'success', data: { header: serializeRow(header), lines, forPrint } })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取出库单详情失败：${String(err?.message ?? err)}`, data: null })
    }
  }

  app.get('/api/stock-out/:id', detail)

  app.post('/api/stock-out', async (req, res) => {
    try {
      const pool = await getPool()
      const actor = await getActor(pool, req)
      sendSave(res, await createStockOut({ pool, body: req.body, req, actor }), '保存成功')
    } catch (err) {
      res.status(500).json({ code: 500, msg: `保存出库单失败：${String(err?.message ?? err?.originalError?.message ?? err)}`, data: null })
    }
  })

  app.put('/api/stock-out/:id', async (req, res) => {
    try {
      const id = normalizeId(req.params?.id)
      if (!id) return res.status(400).json({ code: 400, msg: '出库单参数无效', data: null })
      const pool = await getPool()
      const actor = await getActor(pool, req)
      sendSave(res, await updateStockOut({ pool, id, body: req.body, req, actor }), '保存成功')
    } catch (err) {
      res.status(500).json({ code: 500, msg: `保存出库单失败：${String(err?.message ?? err?.originalError?.message ?? err)}`, data: null })
    }
  })

  async function lifecycle(req, res, action) {
    try {
      const id = normalizeId(req.params?.id)
      if (!id) return res.status(400).json({ code: 400, msg: '出库单参数无效', data: null })
      const pool = await getPool()
      const actor = { ...(await getActor(pool, req)), ip: getRequestIp(req) }
      const result = await applyStockOutLifecycleAction({
        pool,
        id,
        action,
        actor,
        reason: text(req.body?.reason ?? req.body?.unauditReason ?? req.body?.remark),
      })
      if (!result.ok) return res.status(result.status ?? 400).json({ code: result.status ?? 400, msg: result.msg, data: null })
      res.json({ code: 200, msg: result.msg, data: result })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `出库单操作失败：${String(err?.message ?? err)}`, data: null })
    }
  }

  app.post('/api/stock-out/:id/audit', (req, res) => lifecycle(req, res, 'audit'))
  app.post('/api/stock-out/:id/unaudit', (req, res) => lifecycle(req, res, 'unaudit'))
  app.post('/api/stock-out/:id/restore', (req, res) => lifecycle(req, res, 'restore'))
  app.delete('/api/stock-out/:id', (req, res) => lifecycle(req, res, 'delete'))
  app.delete('/api/stock-out/:id/hard', (req, res) => lifecycle(req, res, 'hard-delete'))
}
