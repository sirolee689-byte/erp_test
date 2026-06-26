/**
 * 生产领料（出库类型 4）关联派工单选派弹窗 — 选主单（非明细选材）。
 * 主表 UB_ERP_Dispatch_order；全部显示时展开 UB_ERP_Dispatch_order_list（scak02=GUID）。
 * 排序 scaj01 倒序；关联出库单号来自 UB_ERP_Stocks_out（kcap04=派工单号）。
 */
import { sql } from './db.js'
import { nvarcharTextExpr, safeDecimalExpr } from './buyOrderSqlSafe.js'

const DISPATCH_HEADER_FROM = 'dbo.[UB_ERP_Dispatch_order]'
const DISPATCH_LINE_FROM = 'dbo.[UB_ERP_Dispatch_order_list]'
const STOCK_OUT_FROM = 'dbo.[UB_ERP_Stocks_out]'
const WORKSHOP_FROM = 'dbo.[UB_ERP_Stocks_workshop]'

export const PRODUCTION_DISPATCH_SOURCE_DEFAULT_PAGE_SIZE = 10

function text(v) {
  return String(v ?? '').trim()
}

function parsePage(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1)
  const rawPageSize = Number.parseInt(query.pageSize, 10) || PRODUCTION_DISPATCH_SOURCE_DEFAULT_PAGE_SIZE
  const pageSize = Math.min(200, Math.max(5, rawPageSize))
  return { page, pageSize, startRow: (page - 1) * pageSize + 1, endRow: page * pageSize }
}

function isFullMode(query = {}) {
  return text(query.displayMode).toLowerCase() === 'full'
}

/** 派工单号倒序（出库选派工口径） */
export function buildStockOutProductionDispatchHeaderOrderSql(alias = 'h') {
  return `${nvarcharTextExpr(alias, 'scaj01', 200)} DESC, ${alias}.[id] DESC`
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

/** 明细有效行：scak02 与 GUID 一致 */
function lineScak02MatchesGuidSql(alias = 'l') {
  return `
    AND ${nvarcharTextExpr(alias, 'scak02', 200)} = ${nvarcharTextExpr(alias, 'GUID', 200)}
    AND ${nvarcharTextExpr(alias, 'scak02', 200)} <> N''
  `
}

/** 明细过滤；首条须带 AND，便于拼在头表 WHERE 之后 */
function buildLineBaseWhereSql(alias = 'l') {
  return `
    AND ${nvarcharTextExpr(alias, 'del', 20)} IN (N'', N'0')
    ${lineScak02MatchesGuidSql(alias)}
  `
}

/** 关联出库单号：已审优先，否则未审，否则未出单 */
export function buildRelatedOutboundAggCteSql() {
  const dispatchNoExpr = `LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(o.[kcap04], N''))))`
  return `
    outbound_ranked AS (
      SELECT
        ${dispatchNoExpr} AS dispatchNo,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(o.[kcap01], N'')))) AS outboundNo,
        LTRIM(RTRIM(ISNULL(o.[pass], N''))) AS passFlag,
        o.[id],
        ROW_NUMBER() OVER (
          PARTITION BY ${dispatchNoExpr}
          ORDER BY
            CASE WHEN LTRIM(RTRIM(ISNULL(o.[pass], N''))) = N'1' THEN 0 ELSE 1 END ASC,
            o.[id] DESC
        ) AS pick_rn
      FROM ${STOCK_OUT_FROM} AS o
      WHERE ${nvarcharTextExpr('o', 'del', 20)} IN (N'', N'0')
        AND ${dispatchNoExpr} <> N''
    ),
    outbound_pick AS (
      SELECT dispatchNo, outboundNo, passFlag
      FROM outbound_ranked
      WHERE pick_rn = 1
    )
  `
}

export function buildRelatedOutboundNoExpr(dispatchNoExpr = `${nvarcharTextExpr('h', 'scaj01', 200)}`) {
  return `
    CASE
      WHEN ob.[passFlag] = N'1' THEN ob.[outboundNo]
      WHEN ob.[passFlag] = N'0' AND ob.[outboundNo] <> N'' THEN N'未审：' + ob.[outboundNo]
      ELSE N'未出单'
    END
  `
}

function buildHeaderKeywordSql() {
  return `
    AND (
      ${nvarcharTextExpr('h', 'scaj01', 200)} LIKE @keyword
      OR ${nvarcharTextExpr('h', 'scaj04', 200)} LIKE @keyword
      OR CONVERT(nvarchar(30), h.[scaj02], 120) LIKE @keyword
      OR ${nvarcharTextExpr('h', 'scaj06', 200)} LIKE @keyword
      OR LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(50), h.[addtime]), N''))) LIKE @keyword
      OR ${nvarcharTextExpr('h', 'remark', 200)} LIKE @keyword
    )
  `
}

function buildFullKeywordSql() {
  return `
    AND (
      ${nvarcharTextExpr('h', 'scaj01', 200)} LIKE @keyword
      OR ${nvarcharTextExpr('h', 'scaj04', 200)} LIKE @keyword
      OR CONVERT(nvarchar(30), h.[scaj02], 120) LIKE @keyword
      OR ${nvarcharTextExpr('h', 'scaj06', 200)} LIKE @keyword
      OR LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(50), h.[addtime]), N''))) LIKE @keyword
      OR ${nvarcharTextExpr('h', 'remark', 200)} LIKE @keyword
      OR ${nvarcharTextExpr('l', 'kcaa01', 500)} LIKE @keyword
      OR ${nvarcharTextExpr('l', 'kcaa02', 500)} LIKE @keyword
      OR ${nvarcharTextExpr('l', 'kcaa03', 500)} LIKE @keyword
      OR ${nvarcharTextExpr('l', 'kcaa04', 500)} LIKE @keyword
      OR CONVERT(nvarchar(50), ${safeDecimalExpr('l', 'scak03')}) LIKE @keyword
      OR CONVERT(nvarchar(50), ${safeDecimalExpr('l', 'scak04')}) LIKE @keyword
      OR CONVERT(nvarchar(50), ${safeDecimalExpr('l', 'scak05')}) LIKE @keyword
    )
  `
}

function buildHeaderSelectFields() {
  const relatedExpr = buildRelatedOutboundNoExpr()
  return `
    h.[id] AS headerId,
    ${relatedExpr} AS relatedOutboundNo,
    ${nvarcharTextExpr('h', 'scaj01', 200)} AS dispatchNo,
    ${nvarcharTextExpr('h', 'scaj04', 200)} AS piNo,
    h.[scaj02] AS dispatchDate,
    ${nvarcharTextExpr('h', 'scaj06', 200)} AS deliveryDate,
    LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(50), h.[addtime]), N''))) AS addtime,
    ${nvarcharTextExpr('h', 'scaj05', 200)} AS workshopCode,
    ${nvarcharTextExpr('h', 'cj', 200)} AS workshopName,
    ${nvarcharTextExpr('h', 'systemcode', 200)} AS sourceSystemcode,
    CAST(1 AS int) AS groupRowNo
  `
}

export function buildStockOutProductionDispatchHeaderCountSql(hasKeyword = false) {
  const keywordSql = hasKeyword ? buildHeaderKeywordSql() : ''
  return `
    WITH ${buildRelatedOutboundAggCteSql()}
    SELECT COUNT(1) AS total
    FROM ${DISPATCH_HEADER_FROM} AS h
    LEFT JOIN outbound_pick AS ob
      ON ob.[dispatchNo] = ${nvarcharTextExpr('h', 'scaj01', 200)}
    WHERE ${buildHeaderBaseWhereSql(keywordSql)}
  `
}

export function buildStockOutProductionDispatchHeaderListSql(hasKeyword = false) {
  const keywordSql = hasKeyword ? buildHeaderKeywordSql() : ''
  const headerOrder = buildStockOutProductionDispatchHeaderOrderSql('h')
  const selectFields = buildHeaderSelectFields()
  return `
    WITH ${buildRelatedOutboundAggCteSql()},
    source AS (
      SELECT
        ${selectFields},
        ROW_NUMBER() OVER (ORDER BY ${headerOrder}) AS rn
      FROM ${DISPATCH_HEADER_FROM} AS h
      LEFT JOIN outbound_pick AS ob
        ON ob.[dispatchNo] = ${nvarcharTextExpr('h', 'scaj01', 200)}
      WHERE ${buildHeaderBaseWhereSql(keywordSql)}
    )
    SELECT *
    FROM source
    WHERE rn BETWEEN @startRow AND @endRow
    ORDER BY rn ASC
  `
}

export function buildStockOutProductionDispatchFullCteSql(hasKeyword = false) {
  const keywordSql = hasKeyword ? buildFullKeywordSql() : ''
  const headerOrder = buildStockOutProductionDispatchHeaderOrderSql('h')
  const relatedExpr = buildRelatedOutboundNoExpr()
  return `
    WITH ${buildRelatedOutboundAggCteSql()},
    source AS (
      SELECT
        h.[id] AS headerId,
        l.[id] AS lineId,
        ${relatedExpr} AS relatedOutboundNo,
        ${nvarcharTextExpr('h', 'scaj01', 200)} AS dispatchNo,
        ${nvarcharTextExpr('h', 'scaj04', 200)} AS piNo,
        h.[scaj02] AS dispatchDate,
        ${nvarcharTextExpr('h', 'scaj06', 200)} AS deliveryDate,
        LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(50), h.[addtime]), N''))) AS addtime,
        ${nvarcharTextExpr('h', 'scaj05', 200)} AS workshopCode,
        ${nvarcharTextExpr('h', 'cj', 200)} AS workshopName,
        ${nvarcharTextExpr('h', 'systemcode', 200)} AS sourceSystemcode,
        ${nvarcharTextExpr('l', 'kcaa01', 500)} AS kcaa01,
        ${nvarcharTextExpr('l', 'kcaa02', 500)} AS kcaa02,
        ${nvarcharTextExpr('l', 'kcaa03', 500)} AS kcaa03,
        ${nvarcharTextExpr('l', 'kcaa04', 500)} AS kcaa04,
        ${safeDecimalExpr('l', 'scak03')} AS dispatchQty,
        ${safeDecimalExpr('l', 'scak04')} AS inboundQty,
        ${safeDecimalExpr('l', 'scak05')} AS repairQty,
        ROW_NUMBER() OVER (
          PARTITION BY ${nvarcharTextExpr('h', 'scaj01', 200)}
          ORDER BY ISNULL(l.[seq], l.[id]), l.[id]
        ) AS groupRowNo,
        ROW_NUMBER() OVER (
          ORDER BY
            ${headerOrder},
            ISNULL(l.[seq], l.[id]),
            l.[id]
        ) AS rn
      FROM ${DISPATCH_HEADER_FROM} AS h
      INNER JOIN ${DISPATCH_LINE_FROM} AS l
        ON ${nvarcharTextExpr('h', 'scaj01', 200)} = ${nvarcharTextExpr('l', 'scak01', 200)}
      LEFT JOIN outbound_pick AS ob
        ON ob.[dispatchNo] = ${nvarcharTextExpr('h', 'scaj01', 200)}
      WHERE ${buildHeaderBaseWhereSql('')}
        ${buildLineBaseWhereSql('l')}
        ${keywordSql}
    )
  `
}

export function buildStockOutProductionDispatchFullCountSql(hasKeyword = false) {
  return `${buildStockOutProductionDispatchFullCteSql(hasKeyword)}
    SELECT COUNT(1) AS total
    FROM source
  `
}

export function buildStockOutProductionDispatchFullListSql(hasKeyword = false) {
  return `${buildStockOutProductionDispatchFullCteSql(hasKeyword)}
    SELECT *
    FROM source
    WHERE rn BETWEEN @startRow AND @endRow
    ORDER BY rn ASC
  `
}

/** 解析车间入参；支持 code 或「编码,名称,」格式 */
export function parseWorkshopInput(workshopCode, workshopName = '') {
  let code = text(workshopCode)
  let name = text(workshopName)
  if (code.includes(',')) {
    const parts = code.split(',')
    const head = parts[0]?.trim()
    const tail = parts.slice(1).join(',').replace(/,+$/, '').trim()
    if (!head || parts.length < 2 || !tail) {
      return { ok: false, status: 400, msg: '生产车间选择错误,请重新选择!' }
    }
    code = head
    name = tail
  }
  if (!code) {
    return { ok: false, status: 400, msg: '请先选择生产车间!' }
  }
  return { ok: true, code, name }
}

export async function validateStockOutProductionDispatchWorkshop(pool, workshopCode, workshopName = '') {
  const parsed = parseWorkshopInput(workshopCode, workshopName)
  if (!parsed.ok) return parsed

  const r = await pool.request()
    .input('workshopCode', sql.NVarChar(200), parsed.code)
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
  const dbName = text(row.name)
  if (parsed.name && dbName && parsed.name !== dbName) {
    return { ok: false, status: 400, msg: '生产车间选择错误,请重新选择!' }
  }
  return { ok: true, code: text(row.code), name: dbName }
}

function serializeRow(row) {
  const out = {}
  for (const [k, v] of Object.entries(row ?? {})) {
    if (k === 'rn') continue
    if (v instanceof Date) {
      out[k] = v.toISOString().replace('T', ' ').slice(0, 19)
    } else {
      out[k] = v
    }
  }
  if (out.headerId != null) out.headerId = Number(out.headerId)
  if (out.lineId != null) out.lineId = Number(out.lineId)
  if (out.groupRowNo != null) out.groupRowNo = Number(out.groupRowNo)
  return out
}

export async function fetchStockOutProductionDispatchSourcePage(pool, query = {}) {
  const workshopCheck = await validateStockOutProductionDispatchWorkshop(
    pool,
    query.workshopCode,
    query.workshopName,
  )
  if (!workshopCheck.ok) {
    return { ok: false, status: workshopCheck.status ?? 400, msg: workshopCheck.msg }
  }

  const keyword = text(query.keyword)
  const hasKeyword = Boolean(keyword)
  const full = isFullMode(query)
  const { page, pageSize, startRow, endRow } = parsePage(query)

  const countSql = full
    ? buildStockOutProductionDispatchFullCountSql(hasKeyword)
    : buildStockOutProductionDispatchHeaderCountSql(hasKeyword)
  const listSql = full
    ? buildStockOutProductionDispatchFullListSql(hasKeyword)
    : buildStockOutProductionDispatchHeaderListSql(hasKeyword)

  const countReq = pool.request().input('workshopCode', sql.NVarChar(200), workshopCheck.code)
  if (hasKeyword) countReq.input('keyword', sql.NVarChar(400), `%${keyword}%`)
  const countR = await countReq.query(countSql)
  const total = Number(countR.recordset?.[0]?.total ?? 0)

  const listReq = pool.request()
    .input('workshopCode', sql.NVarChar(200), workshopCheck.code)
    .input('startRow', sql.Int, startRow)
    .input('endRow', sql.Int, endRow)
  if (hasKeyword) listReq.input('keyword', sql.NVarChar(400), `%${keyword}%`)
  const listR = await listReq.query(listSql)

  return {
    ok: true,
    page,
    pageSize,
    total,
    workshopName: workshopCheck.name,
    list: (listR.recordset ?? []).map(serializeRow),
  }
}
