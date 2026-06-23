import { sql } from './db.js'
import {
  STOCK_IN_HEADER_TABLE,
  STOCK_IN_LINE_TABLE,
  buildStockInListPagedSql,
  buildStockInListWhereSql,
  parseStockInListQuery,
} from './stockInListQuery.js'
import {
  createStockIn,
  fetchStockInInventorySummary,
  suggestStockInNo,
  updateStockIn,
} from './stockInSaveService.js'
import { applyStockInLifecycleAction } from './stockInLifecycle.js'
import { resolveActorAuditTripletFromReq } from './businessAuditFields.js'
import { resolveSysUserIsAdminByUserId } from './sysUsersDb.js'
import { fetchStockInPurchaseBatchLines } from './stockInPurchaseBatchAdd.js'
import { fetchStockInAssistBatchLines } from './stockInAssistBatchAdd.js'
import { fetchStockInProductionBatchLines } from './stockInProductionBatchAdd.js'
import { fetchStockInProductionDispatchPickPage } from './stockInProductionDispatchPick.js'
import {
  fetchStockInAssistReturnBatchLines,
  fetchStockInAssistReturnBomParts,
} from './stockInAssistReturnBatchAdd.js'

const HEADER_FROM = `dbo.[${STOCK_IN_HEADER_TABLE}]`
const LINE_FROM = `dbo.[${STOCK_IN_LINE_TABLE}]`
const WAREHOUSE_FROM = 'dbo.[UB_ERP_Stocks_Warehouse]'
const BOM_FROM = 'dbo.[UB_ERP_Bom_000]'
const SUPPLIER_FROM = 'dbo.[UB_ERP_System_supplier]'
const WORKSHOP_FROM = 'dbo.[UB_ERP_Stocks_workshop]'
const CUSTOMER_FROM = 'dbo.[UB_ERP_Customer]'

function bindListParams(req, params) {
  for (const [key, value] of Object.entries(params ?? {})) req.input(key, sql.NVarChar(500), value)
}

function serializeRow(row) {
  const out = {}
  for (const [k, v] of Object.entries(row ?? {})) out[k] = v instanceof Date ? v.toISOString() : v
  if (out.id != null) out.id = Number(out.id)
  return out
}

/** 入库明细：物理列 Tax 统一映射为前端小写 tax */
function serializeStockInLineRow(row) {
  const out = serializeRow(row)
  if (out.tax == null && out.Tax != null) out.tax = out.Tax
  if (Object.prototype.hasOwnProperty.call(out, 'Tax')) delete out.Tax
  return out
}

function normalizeId(raw) {
  const id = Number(raw)
  return Number.isInteger(id) && id > 0 ? id : null
}

function text(v) {
  return String(v ?? '').trim()
}

async function getActor(pool, req) {
  const auditActor = await resolveActorAuditTripletFromReq(pool, req)
  const base = { ...(req.user ?? req.session?.user ?? {}), ...auditActor }
  // 彻底删除等门禁读 UB_ERP_User.is_admin；登录令牌未必带该字段，按主键实时查库
  const uid = auditActor.uidInt ?? base.userId ?? base.UserID
  const isAdmin = await resolveSysUserIsAdminByUserId(pool, uid)
  return { ...base, is_admin: isAdmin ? 1 : 0, isAdmin }
}

function sendSave(res, result, msg) {
  if (!result?.ok) {
    res.status(result?.status ?? 400).json({ code: result?.status ?? 400, msg: result?.msg || '保存失败', data: null })
    return
  }
  res.json({ code: 200, msg, data: result })
}

function sourceMeta(type) {
  const t = text(type)
  // 采购入库：采购单真实字段是 kcaj01/kcaj05，明细关联口径是 kcak02(BOM systemcode)。
  if (t === '1') return { header: 'dbo.[UB_ERP_Buy_order]', line: 'dbo.[UB_ERP_Buy_order_list]', noCol: 'kcaj01', partyCol: 'kcaj05', lineOrderCol: 'kcak01', qtyCol: 'kcak03', priceCol: 'kcak04', detailKeyCol: 'kcak02', taxIncludedPriceCol: 'kcak041', taxCol: 'tax' }
  if (t === '2' || t === '3' || t === '8') return { header: 'dbo.[UB_ERP_assist_order]', line: 'dbo.[UB_ERP_assist_order_list]', noCol: 'wxaj01', partyCol: 'wxaj05', lineOrderCol: 'wxak01', qtyCol: 'wxak03', priceCol: 'wxak04' }
  if (t === '4' || t === '5') return { header: 'dbo.[UB_ERP_Dispatch_order]', line: 'dbo.[UB_ERP_Dispatch_order_list]', noCol: 'scaj01', partyCol: 'scaj05', lineOrderCol: 'scak01', qtyCol: 'scak03', priceCol: 'cost_price' }
  if (t === '6') return { header: 'dbo.[UB_ERP_Sales_order]', line: 'dbo.[UB_ERP_Sales_order_list]', noCol: 'xsaj01', partyCol: 'xsaj04', lineOrderCol: 'xsak01', qtyCol: 'xsak03', priceCol: 'sale_price' }
  return null
}

export function __stockInSourceMetaForTest(type) {
  return sourceMeta(type)
}

export function __buildSourceOrderKeywordSqlForTest(inboundType, meta) {
  return buildSourceOrderKeywordSql(inboundType, meta)
}

export function __buildSourceOrderListSqlForTest(inboundType, meta, baseWhere = sourceOrderBaseWhereSql(), hasKeyword = false) {
  return buildSourceOrderListSql(inboundType, meta, baseWhere, hasKeyword)
}

export function __buildSourceOrderCountSqlForTest(inboundType, meta, keywordSql = '', hasKeyword = false, partyFilterSql = '') {
  return buildSourceOrderCountSql(inboundType, meta, keywordSql, hasKeyword, partyFilterSql)
}

export function __buildSourceOrderPartyFilterSqlForTest(meta) {
  return buildSourceOrderPartyFilterSql(meta)
}

function sourceOrderPageParams(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1)
  const rawPageSize = Number.parseInt(query.pageSize, 10) || 10
  const pageSize = Math.min(100, Math.max(1, rawPageSize))
  return { page, pageSize, startRow: (page - 1) * pageSize + 1, endRow: page * pageSize }
}

/** 头表列安全转 nvarchar，供关联单分页 SQL 复用（SQL Server 2008 R2） */
function trimHeaderCol(alias, col, size = 200) {
  return `LTRIM(RTRIM(CONVERT(nvarchar(${size}), ISNULL(${alias}.[${col}], N''))))`
}

function sourceOrderBaseWhereSql(extraKeywordSql = '') {
  return `
    WHERE (ISNULL(h.[del], N'') = N'' OR h.[del] = N'0')
      AND LTRIM(RTRIM(ISNULL(h.[pass], N''))) = N'1'
      AND LTRIM(RTRIM(ISNULL(h.[closed], N'0'))) = N'0'
      ${extraKeywordSql}
  `
}

/**
 * 关联单搜索：派工/生产退料类型用头表字段 + LEFT JOIN 明细 PI（禁止 PI 标量子查询进 WHERE OR）。
 * 有 keyword 时须配合 buildDispatchSourceOrderKeywordJoinSql 使用。
 */
function buildSourceOrderKeywordSql(inboundType, meta) {
  const t = text(inboundType)
  if (['4', '5'].includes(t)) {
    return `
      AND (
        ${trimHeaderCol('h', meta.noCol)} LIKE @kw
        OR ${trimHeaderCol('h', meta.partyCol)} LIKE @kw
        OR ${trimHeaderCol('h', 'scaj04')} LIKE @kw
        OR lk.[id] IS NOT NULL
      )
    `
  }
  let extra = ''
  if (['2', '3', '8'].includes(t)) {
    extra = `OR ${trimHeaderCol('h', 'wxaj04')} LIKE @kw`
  }
  return `
    AND (
      ${trimHeaderCol('h', meta.noCol)} LIKE @kw
      OR ${trimHeaderCol('h', meta.partyCol)} LIKE @kw
      ${extra}
    )
  `
}

/** 派工类型带 keyword 时：LEFT JOIN 明细 PI，避免 EXISTS + ROW_NUMBER 触发全表嵌套扫描 */
function buildDispatchSourceOrderKeywordJoinSql(meta) {
  return `
    LEFT JOIN ${meta.line} AS lk
      ON ${trimHeaderCol('lk', meta.lineOrderCol)} = ${trimHeaderCol('h', meta.noCol)}
     AND (ISNULL(lk.[del], N'') = N'' OR lk.[del] = N'0')
     AND ${trimHeaderCol('lk', 'pi')} LIKE @kw
  `
}

function isDispatchInboundType(inboundType) {
  return ['4', '5'].includes(text(inboundType))
}

/** 生产入库/退料：按生产车间 scaj05 过滤派工单，避免全表扫描 */
function buildSourceOrderPartyFilterSql(meta) {
  return ` AND ${trimHeaderCol('h', meta.partyCol)} = @relatedPartyCode `
}

function buildSourceOrderCountSql(inboundType, meta, keywordSql, hasKeyword, partyFilterSql = '') {
  const t = text(inboundType)
  const baseWhere = sourceOrderBaseWhereSql(`${partyFilterSql}${keywordSql}`)
  if (hasKeyword && isDispatchInboundType(t)) {
    return `
      SELECT COUNT(DISTINCT h.[id]) AS total
      FROM ${meta.header} AS h
      ${buildDispatchSourceOrderKeywordJoinSql(meta)}
      ${baseWhere}
    `
  }
  return `
    SELECT COUNT(1) AS total
    FROM ${meta.header} AS h
    ${baseWhere}
  `
}

/** 关联单列表：先 ROW_NUMBER 分页，再对当前页 JOIN/APPLY 补车间名与 PI，避免对全量头表跑关联子查询 */
function buildSourceOrderListSql(inboundType, meta, baseWhere, hasKeyword = false) {
  const t = text(inboundType)
  const pageAlias = 'page'
  const orderNoExpr = trimHeaderCol('h', meta.noCol)
  const partyCodeExpr = trimHeaderCol('h', meta.partyCol)
  const innerExtraCols = []
  if (['2', '3', '8'].includes(t)) {
    innerExtraCols.push(`${trimHeaderCol('h', 'wxaj04')} AS referenceNo`)
  } else if (['4', '5'].includes(t)) {
    innerExtraCols.push(`${trimHeaderCol('h', 'scaj04')} AS headerPi`)
  } else if (t === '6') {
    innerExtraCols.push(`${orderNoExpr} AS referenceNo`)
  }
  const innerExtraSelect = innerExtraCols.length ? `,\n            ${innerExtraCols.join(',\n            ')}` : ''
  const srcPassThroughCols = []
  if (['4', '5'].includes(t)) srcPassThroughCols.push('src.headerPi')
  if (['2', '3', '8', '6'].includes(t)) srcPassThroughCols.push('src.referenceNo')
  const srcPassThroughSelect = srcPassThroughCols.length ? `,\n             ${srcPassThroughCols.join(',\n             ')}` : ''

  let outerSelect = `N'' AS relatedPartyName`
  let outerJoin = ''
  let referenceSelect = `N''`

  if (['1', '2', '3', '8'].includes(t)) {
    outerSelect = `
      ISNULL(LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(NULLIF(s.[s_name], N''), s.[name])))), N'') AS relatedPartyName
    `
    outerJoin = `
      LEFT JOIN ${SUPPLIER_FROM} AS s
        ON ${trimHeaderCol('s', 's_code')} = ${pageAlias}.relatedPartyCode
    `
    if (['2', '3', '8'].includes(t)) {
      referenceSelect = `${pageAlias}.referenceNo`
    }
  } else if (['4', '5'].includes(t)) {
    outerSelect = `
      ISNULL(LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(w.[name], N'')))), N'') AS relatedPartyName
    `
    outerJoin = `
      LEFT JOIN ${WORKSHOP_FROM} AS w
        ON ${trimHeaderCol('w', 'code')} = ${pageAlias}.relatedPartyCode
      OUTER APPLY (
        SELECT TOP 1 ${trimHeaderCol('lk2', 'pi')} AS [pi]
        FROM ${meta.line} AS lk2
        WHERE ${trimHeaderCol('lk2', meta.lineOrderCol)} = ${pageAlias}.sourceOrderNo
          AND (ISNULL(lk2.[del], N'') = N'' OR lk2.[del] = N'0')
          AND ${trimHeaderCol('lk2', 'pi')} <> N''
        ORDER BY ISNULL(lk2.[seq], lk2.[id]), lk2.[id]
      ) AS piRef
    `
    referenceSelect = `ISNULL(NULLIF(piRef.[pi], N''), ${pageAlias}.headerPi)`
  } else if (t === '6') {
    outerSelect = `
      ISNULL(LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(c.[khaa02], N'')))), N'') AS relatedPartyName
    `
    outerJoin = `
      LEFT JOIN ${CUSTOMER_FROM} AS c
        ON ${trimHeaderCol('c', 'khaa01')} = ${pageAlias}.relatedPartyCode
    `
    referenceSelect = `${pageAlias}.referenceNo`
  }

  const keywordJoinSql = hasKeyword && isDispatchInboundType(t)
    ? buildDispatchSourceOrderKeywordJoinSql(meta)
    : ''

  const matchedSourceSql = hasKeyword && isDispatchInboundType(t)
    ? `
        SELECT DISTINCT
               h.[id] AS id,
               ${orderNoExpr} AS sourceOrderNo,
               ${partyCodeExpr} AS relatedPartyCode,
               LTRIM(RTRIM(ISNULL(h.[pass], N'0'))) AS pass
               ${innerExtraSelect}
        FROM ${meta.header} AS h
        ${keywordJoinSql}
        ${baseWhere}
      `
    : `
        SELECT ROW_NUMBER() OVER (ORDER BY h.[id] DESC) AS rn,
               h.[id] AS id,
               ${orderNoExpr} AS sourceOrderNo,
               ${partyCodeExpr} AS relatedPartyCode,
               LTRIM(RTRIM(ISNULL(h.[pass], N'0'))) AS pass
               ${innerExtraSelect}
        FROM ${meta.header} AS h
        ${baseWhere}
      `

  const numberedSourceSql = hasKeyword && isDispatchInboundType(t)
    ? `
        SELECT ROW_NUMBER() OVER (ORDER BY matched.[id] DESC) AS rn,
               matched.id,
               matched.sourceOrderNo,
               matched.relatedPartyCode,
               matched.pass
               ${['4', '5'].includes(t) ? ', matched.headerPi' : ''}
               ${['2', '3', '8', '6'].includes(t) ? ', matched.referenceNo' : ''}
        FROM (${matchedSourceSql}) AS matched
      `
    : matchedSourceSql

  return `
    SELECT
      ${pageAlias}.rn,
      ${pageAlias}.id,
      ${pageAlias}.sourceOrderNo,
      ${pageAlias}.relatedPartyCode,
      ${outerSelect},
      ${referenceSelect} AS referenceNo,
      ${pageAlias}.pass
    FROM (
      SELECT src.rn,
             src.id,
             src.sourceOrderNo,
             src.relatedPartyCode,
             src.pass
             ${srcPassThroughSelect}
      FROM (
        ${numberedSourceSql}
      ) AS src
      WHERE src.rn BETWEEN @startRow AND @endRow
    ) AS ${pageAlias}
    ${outerJoin}
    ORDER BY ${pageAlias}.rn ASC
  `
}

function sourceOrderSelectExpressions(inboundType, meta) {
  let partyNameExpr = `N''`
  if (['1', '2', '3', '8'].includes(inboundType)) {
    partyNameExpr = `
      ISNULL((
        SELECT TOP 1 LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(NULLIF(s.[s_name], N''), s.[name]))))
        FROM ${SUPPLIER_FROM} AS s
        WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(s.[s_code], N''))))
          = LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[${meta.partyCol}], N''))))
      ), N'')
    `
  } else if (['4', '5'].includes(inboundType)) {
    partyNameExpr = `
      ISNULL((
        SELECT TOP 1 LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(w.[name], N''))))
        FROM ${WORKSHOP_FROM} AS w
        WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(w.[code], N''))))
          = LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[${meta.partyCol}], N''))))
      ), N'')
    `
  } else if (inboundType === '6') {
    partyNameExpr = `
      ISNULL((
        SELECT TOP 1 LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(c.[khaa02], N''))))
        FROM ${CUSTOMER_FROM} AS c
        WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.[khaa01], N''))))
          = LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[${meta.partyCol}], N''))))
      ), N'')
    `
  }
  let referenceExpr = `N''`
  if (['2', '3', '8'].includes(inboundType)) {
    referenceExpr = `LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[wxaj04], N''))))`
  } else if (['4', '5'].includes(inboundType)) {
    referenceExpr = `
      ISNULL(NULLIF((
        SELECT TOP 1 LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[pi], N''))))
        FROM ${meta.line} AS l
        WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[${meta.lineOrderCol}], N''))))
          = LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[${meta.noCol}], N''))))
          AND (ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')
          AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[pi], N'')))) <> N''
        ORDER BY ISNULL(l.[seq], l.[id]), l.[id]
      ), N''), LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[scaj04], N'')))))
    `
  } else if (inboundType === '6') {
    referenceExpr = `LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[${meta.noCol}], N''))))`
  }
  return { partyNameExpr, referenceExpr }
}

function toNumber(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function round(n, p = 4) {
  const m = 10 ** p
  return Math.round((toNumber(n) + Number.EPSILON) * m) / m
}

function computeConvertedOrderQty(orderQty, unitRatio, unitDirection) {
  const qty = toNumber(orderQty)
  const ratio = toNumber(unitRatio)
  const dir = String(unitDirection ?? '').trim()
  if (!(ratio > 0)) return qty
  // kcaa27=1: 使用单位->采购单位，订单数需除以比例；kcaa27=0: 采购单位->使用单位，订单数需乘以比例
  if (dir === '1') return qty / ratio
  if (dir === '0') return qty * ratio
  return qty
}

async function getStockOutLinkColumn(pool) {
  const r = await pool.request().query(`
    SELECT
      CASE
        WHEN COL_LENGTH('dbo.UB_ERP_Stocks_out', 'kcap04') IS NOT NULL THEN N'kcap04'
        WHEN COL_LENGTH('dbo.UB_ERP_Stocks_out', 'kcan04') IS NOT NULL THEN N'kcan04'
        WHEN COL_LENGTH('dbo.UB_ERP_Stocks_out', 'sourceOrderNo') IS NOT NULL THEN N'sourceOrderNo'
        ELSE N''
      END AS linkCol
  `)
  return text(r.recordset?.[0]?.linkCol)
}

async function queryReturnedQtyBySourceAndMaterial(pool, sourceOrderNo, materialCode) {
  const sourceNo = text(sourceOrderNo)
  const mat = text(materialCode)
  if (!sourceNo || !mat) return 0
  try {
    const linkCol = await getStockOutLinkColumn(pool)
    if (!linkCol) return 0
    const r = await pool.request()
      .input('sourceNo', sql.NVarChar(200), sourceNo)
      .input('materialCode', sql.NVarChar(200), mat)
      .query(`
        SELECT SUM(ISNULL(l.[kcao03], 0)) AS returnedQty
        FROM dbo.[UB_ERP_Stocks_out] AS h
        INNER JOIN dbo.[UB_ERP_Stocks_out_list] AS l
          ON LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcao01], N''))))
            = LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcap01], N''))))
        WHERE (ISNULL(h.[del], N'') = N'' OR h.[del] = N'0')
          AND (ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')
          AND LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(h.[kcap03], N'')))) = N'1'
          AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[${linkCol}], N'')))) = @sourceNo
          AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) = @materialCode
      `)
    return toNumber(r.recordset?.[0]?.returnedQty)
  } catch {
    return 0
  }
}

async function queryLinkedOrderQty(pool, { inboundType, sourceOrderNo, materialCode }) {
  const t = text(inboundType)
  const sourceNo = text(sourceOrderNo)
  const mat = text(materialCode)
  if (!sourceNo || !mat || t === '0' || t === '7') return { found: false, orderQty: 0 }
  const meta = sourceMeta(t)
  if (!meta) return { found: false, orderQty: 0 }
  const materialCol = t === '1' ? 'kcak02' : 'kcaa01'
  const r = await pool.request()
    .input('sourceOrderNo', sql.NVarChar(200), sourceNo)
    .input('materialCode', sql.NVarChar(200), mat)
    .query(`
      SELECT TOP 1
        ISNULL(l.[${meta.qtyCol}], 0) AS orderQty
      FROM ${meta.line} AS l
      WHERE (ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')
        AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[${meta.lineOrderCol}], N'')))) = @sourceOrderNo
        AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[${materialCol}], N'')))) = @materialCode
      ORDER BY l.[id] DESC
    `)
  if (!r.recordset?.length) return { found: false, orderQty: 0 }
  return { found: true, orderQty: toNumber(r.recordset[0].orderQty) }
}

async function queryStockInSumQty(pool, sourceOrderNo, materialCode, inboundType) {
  const sourceNo = text(sourceOrderNo)
  const mat = text(materialCode)
  if (!sourceNo || !mat) return 0
  const materialCol = text(inboundType) === '1' ? 'kcao02' : 'kcaa01'
  const r = await pool.request()
    .input('sourceOrderNo', sql.NVarChar(200), sourceNo)
    .input('materialCode', sql.NVarChar(200), mat)
    .query(`
      SELECT SUM(ISNULL(l.[kcao03], 0)) AS inboundQty
      FROM ${HEADER_FROM} AS h
      INNER JOIN ${LINE_FROM} AS l
        ON LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcao01], N''))))
          = LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan01], N''))))
      WHERE (ISNULL(h.[del], N'') = N'' OR h.[del] = N'0')
        AND LTRIM(RTRIM(ISNULL(h.[pass], N''))) = N'1'
        AND (ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')
        AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan04], N'')))) = @sourceOrderNo
        AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[${materialCol}], N'')))) = @materialCode
    `)
  return toNumber(r.recordset?.[0]?.inboundQty)
}

async function enrichStockInLineRelationInfo(pool, inboundType, line) {
  const sourceOrderNo = text(line?.kcan04)
  const materialCode = text(inboundType) === '1' ? text(line?.kcao02) : text(line?.kcaa01)
  if (!sourceOrderNo || !materialCode) {
    return { relationFound: false, relationNoData: true, relationOrderQty: 0, relationInboundQty: 0, relationReturnedQty: 0, relationDiffQty: 0, relationOverflowQty: 0 }
  }
  const linked = await queryLinkedOrderQty(pool, { inboundType, sourceOrderNo, materialCode })
  if (!linked.found) {
    return { relationFound: false, relationNoData: true, relationOrderQty: 0, relationInboundQty: 0, relationReturnedQty: 0, relationDiffQty: 0, relationOverflowQty: 0 }
  }
  const orderQty = computeConvertedOrderQty(linked.orderQty, line?.kcaa26, line?.kcaa27)
  const inboundQty = await queryStockInSumQty(pool, sourceOrderNo, materialCode, inboundType)
  const returnedQty = await queryReturnedQtyBySourceAndMaterial(pool, sourceOrderNo, materialCode)
  const diffQty = round(orderQty - inboundQty, 4)
  const overflowQty = round(Math.max(0, inboundQty - orderQty - returnedQty), 4)
  return {
    relationFound: true,
    relationNoData: false,
    relationOrderQty: round(orderQty, 4),
    relationInboundQty: round(inboundQty, 4),
    relationReturnedQty: round(returnedQty, 4),
    relationDiffQty: diffQty > 0 ? diffQty : 0,
    relationOverflowQty: overflowQty,
  }
}

export function registerStockInRoutes(app, deps) {
  const { getPool } = deps

  app.get('/api/stock-in/list', async (req, res) => {
    try {
      const pool = await getPool()
      const q = parseStockInListQuery(req.query ?? {})
      const { whereSql, params } = buildStockInListWhereSql(q)
      const countReq = pool.request()
      bindListParams(countReq, params)
      const totalRow = await countReq.query(`SELECT COUNT(1) AS total FROM ${HEADER_FROM} AS h WHERE 1=1 ${whereSql}`)
      const total = Number(totalRow.recordset?.[0]?.total ?? 0)
      const listReq = pool.request().input('startRow', sql.Int, (q.page - 1) * q.pageSize + 1).input('endRow', sql.Int, q.page * q.pageSize)
      bindListParams(listReq, params)
      const listResult = await listReq.query(buildStockInListPagedSql({ whereSql }).sql)
      res.json({ code: 200, msg: 'success', data: { total, list: (listResult.recordset ?? []).map(serializeRow) } })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取入库单列表失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  app.get('/api/stock-in/suggest-doc-no', async (_req, res) => {
    try {
      const pool = await getPool()
      res.json({ code: 200, msg: 'success', data: { suggested: await suggestStockInNo(pool, new Date()) } })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `获取入库单号失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  app.get('/api/stock-in/warehouse-options', async (req, res) => {
    try {
      const pool = await getPool()
      const keyword = text(req.query?.keyword)
      const dbReq = pool.request()
      let kwSql = ''
      if (keyword) {
        dbReq.input('kw', sql.NVarChar(400), `%${keyword}%`)
        kwSql = `AND (LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([code], N'')))) LIKE @kw OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([name], N'')))) LIKE @kw)`
      }
      const r = await dbReq.query(`
        SELECT TOP 100 LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([code], N'')))) AS code,
               LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([name], N'')))) AS name
        FROM ${WAREHOUSE_FROM}
        WHERE (ISNULL([del], N'') = N'' OR [del] = N'0') ${kwSql}
        ORDER BY [code] ASC
      `)
      res.json({ code: 200, msg: 'success', data: { list: r.recordset ?? [] } })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取仓库失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  /** 列表筛选：供应商/外协商联想（点击可直接下拉，关键字可选） */
  app.get('/api/stock-in/list-related-party-options', async (req, res) => {
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

  app.get('/api/stock-in/related-party-options', async (req, res) => {
    try {
      const pool = await getPool()
      const type = text(req.query?.inboundType)
      const keyword = text(req.query?.keyword)
      const dbReq = pool.request()
      if (keyword) dbReq.input('kw', sql.NVarChar(400), `%${keyword}%`)
      const kw = keyword
        ? `AND (LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([code], N'')))) LIKE @kw OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([name], N'')))) LIKE @kw)`
        : ''
      let sqlText = ''
      if (['1', '2', '3'].includes(type)) {
        sqlText = `
          SELECT TOP 100 LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([s_code], N'')))) AS code,
                 LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(NULLIF([s_name], N''), [name])))) AS name
          FROM ${SUPPLIER_FROM}
          WHERE (ISNULL([del], N'') = N'' OR [del] = N'0')
            AND LTRIM(RTRIM(ISNULL([pass], N''))) = N'1'
          ${keyword ? `AND (LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([s_code], N'')))) LIKE @kw OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(NULLIF([s_name], N''), [name])))) LIKE @kw)` : ''}
          ORDER BY [s_code] ASC
        `
      } else if (['4', '5'].includes(type)) {
        sqlText = `
          SELECT TOP 100 LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([code], N'')))) AS code,
                 LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([name], N'')))) AS name
          FROM ${WORKSHOP_FROM}
          WHERE (ISNULL([del], N'') = N'' OR [del] = N'0') ${kw}
          ORDER BY [code] ASC
        `
      } else {
        sqlText = `
          SELECT TOP 100 LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([khaa01], N'')))) AS code,
                 LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([khaa02], N'')))) AS name
          FROM ${CUSTOMER_FROM}
          WHERE (ISNULL([del], N'') = N'' OR [del] = N'0')
          ${keyword ? `AND (LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([khaa01], N'')))) LIKE @kw OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([khaa02], N'')))) LIKE @kw)` : ''}
          ORDER BY [khaa01] ASC
        `
      }
      const r = await dbReq.query(sqlText)
      res.json({ code: 200, msg: 'success', data: { list: r.recordset ?? [] } })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取关联方失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  app.get('/api/stock-in/material-options', async (req, res) => {
    try {
      const pool = await getPool()
      const keyword = text(req.query?.keyword)
      const dbReq = pool.request()
      let kwSql = ''
      if (keyword) {
        dbReq.input('kw', sql.NVarChar(400), `%${keyword}%`)
        kwSql = `AND (LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([kcaa01], N'')))) LIKE @kw OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([kcaa02], N'')))) LIKE @kw)`
      }
      const r = await dbReq.query(`
        SELECT TOP 100 *
        FROM ${BOM_FROM}
        WHERE (ISNULL([del], N'') = N'' OR [del] = N'0') ${kwSql}
        ORDER BY [id] DESC
      `)
      res.json({ code: 200, msg: 'success', data: { list: r.recordset ?? [] } })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取物料失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  app.get('/api/stock-in/source-options', async (req, res) => {
    try {
      const pool = await getPool()
      const inboundType = text(req.query?.inboundType)
      const meta = sourceMeta(inboundType)
      if (!meta) return res.json({ code: 200, msg: 'success', data: { list: [] } })
      const partyCode = text(req.query?.relatedPartyCode)
      const keyword = text(req.query?.keyword)
      const dbReq = pool.request()
      let extra = ''
      if (partyCode) {
        dbReq.input('partyCode', sql.NVarChar(200), partyCode)
        extra += ` AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[${meta.partyCol}], N'')))) = @partyCode`
      }
      if (keyword) {
        dbReq.input('kw', sql.NVarChar(400), `%${keyword}%`)
        extra += ` AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[${meta.noCol}], N'')))) LIKE @kw`
      }
      const { partyNameExpr, referenceExpr } = sourceOrderSelectExpressions(inboundType, meta)
      const r = await dbReq.query(`
        SELECT TOP 100 LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[${meta.noCol}], N'')))) AS sourceOrderNo,
               LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[${meta.partyCol}], N'')))) AS relatedPartyCode,
               ${partyNameExpr} AS relatedPartyName,
               ${referenceExpr} AS referenceNo
        FROM ${meta.header} AS h
        WHERE (ISNULL(h.[del], N'') = N'' OR h.[del] = N'0')
          AND LTRIM(RTRIM(ISNULL(h.[pass], N''))) = N'1'
          AND LTRIM(RTRIM(ISNULL(h.[closed], N'0'))) = N'0'
          ${extra}
        ORDER BY h.[id] DESC
      `)
      res.json({ code: 200, msg: 'success', data: { list: r.recordset ?? [] } })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取关联单据失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  app.get('/api/stock-in/production-dispatch-pick-page', async (req, res) => {
    try {
      const pool = await getPool()
      const result = await fetchStockInProductionDispatchPickPage(pool, req.query ?? {})
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
          workshopName: result.workshopName ?? '',
        },
      })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取派工单明细失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  app.get('/api/stock-in/source-order-page', async (req, res) => {
    try {
      const pool = await getPool()
      const inboundType = text(req.query?.inboundType)
      const meta = sourceMeta(inboundType)
      if (!meta) return res.json({ code: 200, msg: 'success', data: { total: 0, list: [] } })
      const partyCode = text(req.query?.relatedPartyCode)
      if (isDispatchInboundType(inboundType) && !partyCode) {
        res.status(400).json({ code: 400, msg: '请先选择生产车间', data: null })
        return
      }
      const keyword = text(req.query?.keyword)
      const { page, pageSize, startRow, endRow } = sourceOrderPageParams(req.query ?? {})
      const countReq = pool.request()
      let keywordSql = ''
      let partyFilterSql = ''
      const hasKeyword = Boolean(keyword)
      if (hasKeyword) {
        countReq.input('kw', sql.NVarChar(400), `%${keyword}%`)
        keywordSql = buildSourceOrderKeywordSql(inboundType, meta)
      }
      if (partyCode && isDispatchInboundType(inboundType)) {
        countReq.input('relatedPartyCode', sql.NVarChar(200), partyCode)
        partyFilterSql = buildSourceOrderPartyFilterSql(meta)
      }
      const baseWhere = sourceOrderBaseWhereSql(`${partyFilterSql}${keywordSql}`)
      const totalRow = await countReq.query(buildSourceOrderCountSql(inboundType, meta, keywordSql, hasKeyword, partyFilterSql))
      const total = Number(totalRow.recordset?.[0]?.total ?? 0)
      const listReq = pool.request()
        .input('startRow', sql.Int, startRow)
        .input('endRow', sql.Int, endRow)
      if (hasKeyword) listReq.input('kw', sql.NVarChar(400), `%${keyword}%`)
      if (partyFilterSql) listReq.input('relatedPartyCode', sql.NVarChar(200), partyCode)
      const r = await listReq.query(buildSourceOrderListSql(inboundType, meta, baseWhere, hasKeyword))
      res.json({ code: 200, msg: 'success', data: { page, pageSize, total, list: r.recordset ?? [] } })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取关联单据分页失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  app.get('/api/stock-in/purchase-batch-lines', async (req, res) => {
    try {
      const pool = await getPool()
      const actor = await getActor(pool, req)
      const result = await fetchStockInPurchaseBatchLines(pool, req.query ?? {}, actor)
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
          isAdmin: result.isAdmin === true,
        },
      })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取采购入库批量明细失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  app.get('/api/stock-in/assist-batch-lines', async (req, res) => {
    try {
      const pool = await getPool()
      const query = { ...(req.query ?? {}), inboundType: '2' }
      const result = await fetchStockInAssistBatchLines(pool, query)
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
        },
      })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取外协入库批量明细失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  app.get('/api/stock-in/production-batch-lines', async (req, res) => {
    try {
      const pool = await getPool()
      const query = { ...(req.query ?? {}), inboundType: '4' }
      const result = await fetchStockInProductionBatchLines(pool, query)
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
        },
      })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取生产入库批量明细失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  app.get('/api/stock-in/assist-return-batch-lines', async (req, res) => {
    try {
      const pool = await getPool()
      const result = await fetchStockInAssistReturnBatchLines(pool, req.query ?? {})
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
        },
      })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取外协退料批量成品明细失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  app.get('/api/stock-in/assist-return-bom-parts', async (req, res) => {
    try {
      const pool = await getPool()
      const result = await fetchStockInAssistReturnBomParts(pool, req.query ?? {})
      if (!result.ok) {
        res.status(result.status ?? 400).json({ code: result.status ?? 400, msg: result.msg, data: null })
        return
      }
      res.json({
        code: 200,
        msg: result.msg || 'success',
        data: {
          list: result.list ?? [],
          productKcaa01: result.productKcaa01,
          bomMissing: result.bomMissing === true,
        },
      })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取外协退料 BOM 配件失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  app.get('/api/stock-in/source-lines', async (req, res) => {
    try {
      const pool = await getPool()
      const meta = sourceMeta(req.query?.inboundType)
      const sourceOrderNo = text(req.query?.sourceOrderNo)
      if (!meta || !sourceOrderNo) return res.json({ code: 200, msg: 'success', data: { list: [] } })
      const r = await pool.request().input('sourceOrderNo', sql.NVarChar(200), sourceOrderNo).query(`
        SELECT TOP 200
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[${meta.detailKeyCol || 'systemcode'}], ISNULL(l.[GUID], N''))))) AS kcao02,
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[${meta.lineOrderCol}], N'')))) AS kcan04,
          ISNULL(l.[${meta.qtyCol}], 0) AS availableQty,
          ISNULL(l.[${meta.priceCol}], 0) AS kcao04,
          ${meta.taxIncludedPriceCol ? `ISNULL(l.[${meta.taxIncludedPriceCol}], 0)` : `ISNULL(l.[${meta.priceCol}], 0)`} AS kcao041,
          ${meta.taxCol ? `ISNULL(l.[${meta.taxCol}], 0)` : `0`} AS tax,
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) AS kcaa01,
          LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa02], N'')))) AS kcaa02,
          LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa03], N'')))) AS kcaa03,
          LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(l.[kcaa04], N'')))) AS kcaa04,
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa11], N'')))) AS kcaa11,
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[version], N'')))) AS version,
          LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[location], N'')))) AS location
        FROM ${meta.line} AS l
        WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[${meta.lineOrderCol}], N'')))) = @sourceOrderNo
          AND (ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')
        ORDER BY ISNULL(l.[seq], l.[id]), l.[id]
      `)
      res.json({ code: 200, msg: 'success', data: { list: r.recordset ?? [] } })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取关联明细失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  app.get('/api/stock-in/inventory-summary', async (req, res) => {
    try {
      const pool = await getPool()
      res.json({ code: 200, msg: 'success', data: { list: await fetchStockInInventorySummary(pool, req.query ?? {}) } })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取入库库存统计失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  app.get('/api/stock-in/print-data', async (req, res) => {
    req.params = { id: req.query?.id }
    return detail(req, res, true)
  })

  async function detail(req, res, forPrint = false) {
    try {
      const id = normalizeId(req.params?.id)
      if (!id) return res.status(400).json({ code: 400, msg: '入库单参数无效', data: null })
      const pool = await getPool()
      const headerR = await pool.request().input('id', sql.Int, id).query(`SELECT TOP 1 * FROM ${HEADER_FROM} WHERE [id] = @id`)
      const header = headerR.recordset?.[0]
      if (!header) return res.status(404).json({ code: 404, msg: '入库单不存在', data: null })
      const receiptNo = text(header.kcan01)
      const lineR = await pool.request().input('receiptNo', sql.NVarChar(200), receiptNo).query(`
        SELECT *
        FROM ${LINE_FROM}
        WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([kcao01], N'')))) = @receiptNo
        ORDER BY ISNULL([seq], [id]), [id]
      `)
      const inboundType = text(header.kcan03)
      const rawLines = lineR.recordset ?? []
      const enrichedLines = []
      for (const row of rawLines) {
        const base = serializeStockInLineRow(row)
        const relation = await enrichStockInLineRelationInfo(pool, inboundType, base)
        enrichedLines.push({ ...base, ...relation })
      }
      res.json({ code: 200, msg: 'success', data: { header: serializeRow(header), lines: enrichedLines, forPrint } })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取入库单详情失败：${String(err?.message ?? err)}`, data: null })
    }
  }

  app.get('/api/stock-in/:id', detail)

  app.post('/api/stock-in', async (req, res) => {
    try {
      const pool = await getPool()
      const actor = await getActor(pool, req)
      sendSave(res, await createStockIn({ pool, body: req.body, req, actor }), '保存成功')
    } catch (err) {
      res.status(500).json({ code: 500, msg: `保存入库单失败：${String(err?.message ?? err?.originalError?.message ?? err)}`, data: null })
    }
  })

  app.put('/api/stock-in/:id', async (req, res) => {
    try {
      const id = normalizeId(req.params?.id)
      if (!id) return res.status(400).json({ code: 400, msg: '入库单参数无效', data: null })
      const pool = await getPool()
      const actor = await getActor(pool, req)
      sendSave(res, await updateStockIn({ pool, id, body: req.body, req, actor }), '保存成功')
    } catch (err) {
      res.status(500).json({ code: 500, msg: `保存入库单失败：${String(err?.message ?? err?.originalError?.message ?? err)}`, data: null })
    }
  })

  async function lifecycle(req, res, action) {
    try {
      const id = normalizeId(req.params?.id)
      if (!id) return res.status(400).json({ code: 400, msg: '入库单参数无效', data: null })
      const pool = await getPool()
      const actor = await getActor(pool, req)
      const result = await applyStockInLifecycleAction({ pool, id, action, actor })
      if (!result.ok) return res.status(result.status ?? 400).json({ code: result.status ?? 400, msg: result.msg, data: null })
      res.json({ code: 200, msg: result.msg, data: result })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `入库单操作失败：${String(err?.message ?? err)}`, data: null })
    }
  }

  app.post('/api/stock-in/:id/audit', (req, res) => lifecycle(req, res, 'audit'))
  app.post('/api/stock-in/:id/unaudit', (req, res) => lifecycle(req, res, 'unaudit'))
  app.post('/api/stock-in/:id/review', (req, res) => lifecycle(req, res, 'review'))
  app.post('/api/stock-in/:id/unreview', (req, res) => lifecycle(req, res, 'unreview'))
  app.post('/api/stock-in/:id/restore', (req, res) => lifecycle(req, res, 'restore'))
  app.delete('/api/stock-in/:id', (req, res) => lifecycle(req, res, 'delete'))
  app.delete('/api/stock-in/:id/hard', (req, res) => lifecycle(req, res, 'hard-delete'))
}
