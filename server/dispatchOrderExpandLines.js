import { sql } from './db.js'
import { ERP_MAX_PAGE_SIZE } from './erpPagination.js'
import {
  DISPATCH_ORDER_HEADER_TABLE,
} from './dispatchOrderListQuery.js'
import { bindIntInList, bindNVarCharInList, groupRowsByKey, normalizeIntIds } from './sqlInListHelpers.js'

const HEADER_FROM = `dbo.[${DISPATCH_ORDER_HEADER_TABLE}]`
const LINE_FROM = 'dbo.[UB_ERP_Dispatch_order_list]'
const COLOR_FROM = 'dbo.[UB_ERP_Stocks_colorcode]'

function text(v) {
  return String(v ?? '').trim()
}

function serializeRow(row) {
  const out = {}
  for (const [k, v] of Object.entries(row ?? {})) out[k] = v instanceof Date ? v.toISOString() : v
  if (out.id != null) out.id = Number(out.id)
  return out
}

function buildDispatchExpandLinesSql(whereClause) {
  return `
    SELECT
      l.*,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.[name], N'')))) AS colorName,
      CAST(0 AS decimal(18, 4)) AS stockProcessDispatchedQty,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[scak01], N'')))) AS orderNo
    FROM ${LINE_FROM} AS l
    LEFT JOIN ${COLOR_FROM} AS c
      ON LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(c.[code], N'')))) = LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(l.[kcaa11], N''))))
     AND (ISNULL(c.[del], N'') = N'' OR c.[del] = N'0')
    WHERE ${whereClause}
    ORDER BY LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[scak01], N'')))), ISNULL(l.[seq], l.[id]), l.[id]
  `
}

export async function fetchDispatchOrderExpandLinesBatch(pool, rawIds) {
  const parsed = normalizeIntIds(rawIds)
  if (!parsed.ok) {
    return { ok: false, status: parsed.status, msg: `一次最多查询 ${ERP_MAX_PAGE_SIZE} 条派工单展开明细` }
  }
  const ids = parsed.ids
  if (!ids.length) return { ok: true, data: {} }

  const headerReq = pool.request()
  const idIn = bindIntInList(headerReq, 'id', ids)
  const headerR = await headerReq.query(`
    SELECT [id], LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([scaj01], N'')))) AS orderNo
    FROM ${HEADER_FROM}
    WHERE [id] IN (${idIn.inSql})
  `)
  const headers = headerR.recordset ?? []
  if (!headers.length) return { ok: true, data: {} }

  const orderNos = headers.map((row) => text(row.orderNo)).filter(Boolean)
  if (!orderNos.length) return { ok: true, data: {} }

  const lineReq = pool.request()
  const orderIn = bindNVarCharInList(lineReq, 'ono', orderNos, 200)
  const lineR = await lineReq.query(buildDispatchExpandLinesSql(
    `LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[scak01], N'')))) IN (${orderIn.inSql})`,
  ))
  const lineGroups = groupRowsByKey(lineR.recordset ?? [], (row) => row.orderNo)

  const data = {}
  for (const header of headers) {
    const orderNo = text(header.orderNo)
    data[String(header.id)] = {
      lines: (lineGroups.get(orderNo) ?? []).map(serializeRow),
    }
  }
  return { ok: true, data }
}

export async function queryDispatchOrderExpandLines(pool, orderNo) {
  const no = text(orderNo)
  if (!no) return []
  const r = await pool.request().input('orderNo', sql.NVarChar(200), no).query(
    buildDispatchExpandLinesSql(`LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[scak01], N'')))) = @orderNo`),
  )
  return (r.recordset ?? []).map(serializeRow)
}
