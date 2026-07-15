import { clampErpPageSize, ERP_MAX_PAGE_SIZE } from './erpPagination.js'
/**
 * 生产入库/生产退料（类型 4/5）选派工单明细弹窗 — 对齐旧系统 s_search4.asp。
 * 主表 UB_ERP_Dispatch_order + 明细 UB_ERP_Dispatch_order_list；
 * 余量过滤：scak03 - scak04 + scak05 > 0（快照字段）；搜索仅头表字段。
 * 分页单位：派工单头表（每页 N 张单，展开其全部有效明细行）；排序 addtime 新→旧。
 * 性能：明细驱动 qual_lines CTE；有搜索时 kw_headers 先筛头表再 JOIN qual_lines；
 * 列表 COUNT(1) OVER() 合并总数（省独立 COUNT）；生产入库(type4)不跑 returned_lines。
 */
import { sql } from './db.js'
import { nvarcharTextExpr, safeDecimalExpr } from './buyOrderSqlSafe.js'

const DISPATCH_HEADER_FROM = 'dbo.[UB_ERP_Dispatch_order]'
const DISPATCH_LINE_FROM = 'dbo.[UB_ERP_Dispatch_order_list]'
const WORKSHOP_FROM = 'dbo.[UB_ERP_Stocks_workshop]'
const STOCK_IN_FROM = 'dbo.[UB_ERP_Stocks_Storage]'
const STOCK_IN_LINE_FROM = 'dbo.[UB_ERP_Stocks_Storage_list]'

/** 默认每页派工单张数（与前端生产入库选派弹窗一致） */
export const PRODUCTION_DISPATCH_PICK_DEFAULT_PAGE_SIZE = 10

function text(v) {
  return String(v ?? '').trim()
}

function parsePage(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1)
  const rawPageSize = Number.parseInt(query.pageSize, 10) || PRODUCTION_DISPATCH_PICK_DEFAULT_PAGE_SIZE
  const pageSize = clampErpPageSize(rawPageSize, 10)
  return { page, pageSize, startRow: (page - 1) * pageSize + 1, endRow: page * pageSize }
}

function normalizePickInboundType(v) {
  return text(v) === '5' ? '5' : '4'
}

/** 头表 addtime 为 nvarchar(yyyy-MM-dd HH:mm:ss)，空值排后 */
export function buildProductionDispatchPickHeaderOrderSql(alias = 'h') {
  const addtimeExpr = `LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(50), ${alias}.[addtime]), N'')))`
  return `
    CASE WHEN ${addtimeExpr} = N'' THEN 0 ELSE 1 END DESC,
    ${addtimeExpr} DESC,
    ${alias}.[id] DESC
  `
}

/** 明细行 scak02 须与 GUID 一致（旧系统有效行口径） */
function lineScak02MatchesGuidSql() {
  return `
    AND ${nvarcharTextExpr('l', 'scak02', 200)} = ${nvarcharTextExpr('l', 'GUID', 200)}
    AND ${nvarcharTextExpr('l', 'scak02', 200)} <> N''
  `
}

/** 旧系统余量：派工数量 - 已入库 + 返修 */
function remainingQtySql() {
  return `(
    ${safeDecimalExpr('l', 'scak03')}
    - ${safeDecimalExpr('l', 'scak04')}
    + ${safeDecimalExpr('l', 'scak05')}
  )`
}

function buildHeaderBaseWhereSql(extraSql = '') {
  return `
    ${nvarcharTextExpr('h', 'del', 20)} IN (N'', N'0')
    AND LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), h.[pass]), N''))) = N'1'
    AND LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), h.[closed]), N'0'))) = N'0'
    AND ${nvarcharTextExpr('h', 'scaj05', 200)} = @workshopCode
    ${extraSql}
  `
}

function buildLineBaseWhereSql(inboundType = '4') {
  const qtySql = normalizePickInboundType(inboundType) === '5' ? '' : `AND ${remainingQtySql()} > 0`
  return `
    ${nvarcharTextExpr('l', 'del', 20)} IN (N'', N'0')
    ${lineScak02MatchesGuidSql()}
    ${qtySql}
  `
}

/** 明细驱动：先从明细表筛出有余量的派工单号，再与头表 JOIN（包装部实测较 EXISTS 快约 14 秒） */
export function buildProductionDispatchPickQualLinesCteSql(inboundType = '4') {
  return `
    qual_lines AS (
      SELECT DISTINCT ${nvarcharTextExpr('l', 'scak01', 200)} AS scak01
      FROM ${DISPATCH_LINE_FROM} AS l
      WHERE ${buildLineBaseWhereSql(inboundType)}
    )
  `
}

function buildHeaderJoinQualLinesSql() {
  return `
    INNER JOIN qual_lines AS q
      ON ${nvarcharTextExpr('h', 'scaj01', 200)} = q.[scak01]
  `
}

/** 关键字仅搜头表，禁止明细 pi LIKE（性能） */
export function buildProductionDispatchPickKeywordSql(inboundType = '4') {
  if (normalizePickInboundType(inboundType) === '4') {
    return `
    AND (
      ${nvarcharTextExpr('h', 'scaj01', 200)} LIKE @keyword
      OR ${nvarcharTextExpr('h', 'scaj04', 200)} LIKE @keyword
    )
  `
  }
  return `
    AND (
      ${nvarcharTextExpr('h', 'scaj01', 200)} LIKE @keyword
      OR ${nvarcharTextExpr('h', 'scaj03', 200)} LIKE @keyword
      OR ${nvarcharTextExpr('h', 'scaj04', 200)} LIKE @keyword
      OR ${nvarcharTextExpr('h', 'scaj05', 200)} LIKE @keyword
      OR CONVERT(nvarchar(30), h.[scaj02], 120) LIKE @keyword
      OR ${nvarcharTextExpr('h', 'scaj06', 200)} LIKE @keyword
      OR ${nvarcharTextExpr('h', 'remark', 200)} LIKE @keyword
      OR ${nvarcharTextExpr('h', 'rmb', 200)} LIKE @keyword
    )
  `
}

/** 有搜索时先按关键字+车间筛头表，再与 qual_lines 求交（较 qual_lines 全量后再 LIKE 更快） */
export function buildProductionDispatchPickKwHeadersCteSql(inboundType = '4') {
  const keywordSql = buildProductionDispatchPickKeywordSql(inboundType)
  return `
    kw_headers AS (
      SELECT
        ${nvarcharTextExpr('h', 'scaj01', 200)} AS scak01,
        h.[id] AS headerId
      FROM ${DISPATCH_HEADER_FROM} AS h
      WHERE ${buildHeaderBaseWhereSql(keywordSql)}
    )
  `
}

function buildProductionDispatchPickEligibleCteSql(hasKeyword, inboundType = '4') {
  if (hasKeyword) {
    return `
    eligible AS (
      SELECT kh.headerId, kh.scak01
      FROM kw_headers AS kh
      INNER JOIN qual_lines AS q ON kh.scak01 = q.[scak01]
    )
    `
  }
  return `
    eligible AS (
      SELECT
        h.[id] AS headerId,
        ${nvarcharTextExpr('h', 'scaj01', 200)} AS scak01
      FROM ${DISPATCH_HEADER_FROM} AS h
      ${buildHeaderJoinQualLinesSql()}
      WHERE ${buildHeaderBaseWhereSql('')}
    )
  `
}

function buildProductionDispatchPickHeaderPageCteSql(hasKeyword, inboundType = '4') {
  const headerAlias = hasKeyword ? 'hd' : 'h'
  const headerOrder = buildProductionDispatchPickHeaderOrderSql(headerAlias)
  if (hasKeyword) {
    return `
    header_page AS (
      SELECT
        e.headerId,
        ROW_NUMBER() OVER (ORDER BY ${headerOrder}) AS hdr_rn,
        COUNT(1) OVER() AS totalHeaders
      FROM eligible AS e
      INNER JOIN ${DISPATCH_HEADER_FROM} AS hd ON hd.[id] = e.headerId
    )
    `
  }
  return `
    header_page AS (
      SELECT
        h.[id] AS headerId,
        ROW_NUMBER() OVER (ORDER BY ${headerOrder}) AS hdr_rn,
        COUNT(1) OVER() AS totalHeaders
      FROM eligible AS e
      INNER JOIN ${DISPATCH_HEADER_FROM} AS h ON h.[id] = e.headerId
    )
  `
}

function buildProductionDispatchPickWithPrefix(hasKeyword, inboundType = '4') {
  const normalizedType = normalizePickInboundType(inboundType)
  const parts = []
  if (hasKeyword) parts.push(buildProductionDispatchPickKwHeadersCteSql(normalizedType))
  parts.push(buildProductionDispatchPickQualLinesCteSql(normalizedType))
  parts.push(buildProductionDispatchPickEligibleCteSql(hasKeyword, normalizedType))
  parts.push(buildProductionDispatchPickHeaderPageCteSql(hasKeyword, normalizedType))
  return parts.join(',\n')
}

/** 仅作列表无行时的 total 回退（如翻到空页）；正常搜索走列表 COUNT OVER */
export function buildProductionDispatchPickCountSql(hasKeyword = false, inboundType = '4') {
  return `
    WITH ${buildProductionDispatchPickWithPrefix(hasKeyword, inboundType)}
    SELECT COUNT(1) AS total FROM header_page
  `
}

export function buildProductionDispatchReturnAggCteSql() {
  return `
    returned_lines AS (
      SELECT
        ${nvarcharTextExpr('h', 'kcan04', 200)} AS dispatchNo,
        ${nvarcharTextExpr('l', 'kcao02', 200)} AS detailKey,
        SUM(${safeDecimalExpr('l', 'kcao03')}) AS returnedQty
      FROM ${STOCK_IN_FROM} AS h
      INNER JOIN ${STOCK_IN_LINE_FROM} AS l
        ON ${nvarcharTextExpr('l', 'kcao01', 200)} = ${nvarcharTextExpr('h', 'kcan01', 200)}
      WHERE ${nvarcharTextExpr('h', 'del', 20)} IN (N'', N'0')
        AND ${nvarcharTextExpr('l', 'del', 20)} IN (N'', N'0')
        AND ${nvarcharTextExpr('h', 'pass', 20)} = N'1'
        AND ${nvarcharTextExpr('h', 'kcan03', 20)} = N'5'
      GROUP BY ${nvarcharTextExpr('h', 'kcan04', 200)}, ${nvarcharTextExpr('l', 'kcao02', 200)}
    )
  `
}

export function buildProductionDispatchPickListSql(hasKeyword = false, inboundType = '4') {
  const normalizedType = normalizePickInboundType(inboundType)
  const includeReturnAgg = normalizedType === '5'
  const returnedQtySelect = includeReturnAgg
    ? 'ISNULL(r.[returnedQty], 0) AS returnedQty'
    : 'CAST(0 AS decimal(18, 4)) AS returnedQty'
  const returnAggCte = includeReturnAgg ? `,\n    ${buildProductionDispatchReturnAggCteSql()}` : ''
  const returnJoin = includeReturnAgg
    ? `
    LEFT JOIN returned_lines AS r
      ON r.[dispatchNo] = ${nvarcharTextExpr('h', 'scaj01', 200)}
     AND r.[detailKey] = ${nvarcharTextExpr('l', 'scak02', 200)}`
    : ''
  return `
    WITH ${buildProductionDispatchPickWithPrefix(hasKeyword, normalizedType)}${returnAggCte},
    picked AS (
      SELECT headerId, hdr_rn, totalHeaders
      FROM header_page
      WHERE hdr_rn BETWEEN @startRow AND @endRow
    )
    SELECT
      l.[id] AS lineId,
      ${nvarcharTextExpr('h', 'scaj01', 200)} AS dispatchNo,
      ${nvarcharTextExpr('h', 'scaj04', 200)} AS piNo,
      h.[scaj02] AS dispatchDate,
      ${nvarcharTextExpr('h', 'scaj06', 200)} AS deliveryDate,
      ${nvarcharTextExpr('l', 'kcaa01', 500)} AS kcaa01,
      ${nvarcharTextExpr('l', 'kcaa02', 500)} AS kcaa02,
      ${nvarcharTextExpr('l', 'kcaa03', 500)} AS kcaa03,
      ${nvarcharTextExpr('l', 'kcaa04', 500)} AS kcaa04,
      ${safeDecimalExpr('l', 'scak03')} AS dispatchQty,
      ${safeDecimalExpr('l', 'scak04')} AS inboundQty,
      ${safeDecimalExpr('l', 'scak05')} AS repairQty,
      ${returnedQtySelect},
      ${nvarcharTextExpr('h', 'scaj05', 200)} AS workshopCode,
      ${nvarcharTextExpr('h', 'cj', 200)} AS workshopName,
      ${nvarcharTextExpr('h', 'systemcode', 200)} AS dispatchSystemcode,
      p.[hdr_rn] AS hdr_rn,
      p.[totalHeaders] AS totalHeaders
    FROM picked AS p
    INNER JOIN ${DISPATCH_HEADER_FROM} AS h ON h.[id] = p.[headerId]
    INNER JOIN ${DISPATCH_LINE_FROM} AS l
      ON ${nvarcharTextExpr('h', 'scaj01', 200)} = ${nvarcharTextExpr('l', 'scak01', 200)}${returnJoin}
    WHERE ${buildLineBaseWhereSql(normalizedType)}
    ORDER BY p.[hdr_rn] ASC, ISNULL(l.[seq], l.[id]), l.[id]
  `
}

export async function validateProductionDispatchWorkshop(pool, workshopCode) {
  const code = text(workshopCode)
  if (!code) {
    return { ok: false, status: 400, msg: '请先选择生产车间' }
  }
  const r = await pool.request()
    .input('workshopCode', sql.NVarChar(200), code)
    .query(`
      SELECT TOP 1
        ${nvarcharTextExpr('w', 'code', 200)} AS code,
        LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(500), ISNULL(w.[name], N'')), N''))) AS name
      FROM ${WORKSHOP_FROM} AS w
      WHERE ${nvarcharTextExpr('w', 'code', 200)} = @workshopCode
        AND ${nvarcharTextExpr('w', 'del', 20)} IN (N'', N'0')
        AND LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), w.[pass]), N''))) = N'1'
    `)
  const row = r.recordset?.[0]
  if (!row) {
    return { ok: false, status: 400, msg: '此生产车间错误,请重新选择!' }
  }
  return { ok: true, code: text(row.code), name: text(row.name) }
}

function serializePickRow(row) {
  const out = {}
  for (const [k, v] of Object.entries(row ?? {})) {
    if (k === 'hdr_rn' || k === 'totalHeaders') continue
    out[k] = v instanceof Date ? v.toISOString().replace('T', ' ').slice(0, 19) : v
  }
  if (out.lineId != null) out.lineId = Number(out.lineId)
  return out
}

function pickTotalFromRows(rows = []) {
  if (!rows.length) return null
  const n = Number(rows[0]?.totalHeaders)
  return Number.isFinite(n) ? n : null
}

export async function fetchStockInProductionDispatchPickPage(pool, query = {}) {
  const workshopCode = text(query.workshopCode)
  const inboundType = normalizePickInboundType(query.inboundType)
  const workshopCheck = await validateProductionDispatchWorkshop(pool, workshopCode)
  if (!workshopCheck.ok) {
    return { ok: false, status: workshopCheck.status ?? 400, msg: workshopCheck.msg }
  }

  const keyword = text(query.keyword)
  const hasKeyword = Boolean(keyword)
  const { page, pageSize, startRow, endRow } = parsePage(query)

  // 生产入库/生产退料：无关键字默认不加载，由用户自行搜索
  if (['4', '5'].includes(inboundType) && !hasKeyword) {
    return {
      ok: true,
      inboundType,
      page,
      pageSize,
      total: 0,
      workshopName: workshopCheck.name,
      list: [],
    }
  }

  const listReq = pool.request()
    .input('workshopCode', sql.NVarChar(200), workshopCheck.code)
    .input('startRow', sql.Int, startRow)
    .input('endRow', sql.Int, endRow)
  if (hasKeyword) listReq.input('keyword', sql.NVarChar(400), `%${keyword}%`)
  const listR = await listReq.query(buildProductionDispatchPickListSql(hasKeyword, inboundType))
  const rawRows = listR.recordset ?? []

  let total = pickTotalFromRows(rawRows)
  if (total == null) {
    const countReq = pool.request().input('workshopCode', sql.NVarChar(200), workshopCheck.code)
    if (hasKeyword) countReq.input('keyword', sql.NVarChar(400), `%${keyword}%`)
    const countR = await countReq.query(buildProductionDispatchPickCountSql(hasKeyword, inboundType))
    total = Number(countR.recordset?.[0]?.total ?? 0)
  }

  return {
    ok: true,
    inboundType,
    page,
    pageSize,
    total,
    workshopName: workshopCheck.name,
    list: rawRows.map(serializePickRow),
  }
}
