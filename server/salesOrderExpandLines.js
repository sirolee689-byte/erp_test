import { sql } from './db.js'
import { ERP_MAX_PAGE_SIZE } from './erpPagination.js'
import { SALES_ORDER_HEADER_TABLE } from './salesOrderListQuery.js'
import { bindIntInList, bindNVarCharInList, groupRowsByKey, normalizeIntIds } from './sqlInListHelpers.js'

const HEADER_FROM = `dbo.[${SALES_ORDER_HEADER_TABLE}]`
const LINE_FROM = 'dbo.[UB_ERP_Sales_order_list]'
const PI_COST_FROM = 'dbo.[UB_ERP_Bom_pi_cost]'

function text(v) {
  return String(v ?? '').trim()
}

function serializeRow(row) {
  const o = {}
  for (const [k, v] of Object.entries(row ?? {})) {
    if (k === 'rn') continue
    if (v instanceof Date) o[k] = v.toISOString()
    else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(v)) o[k] = `[binary:${v.length}]`
    else o[k] = v
  }
  if (o.id != null) o.id = Number(o.id)
  return o
}

export function formatSalesOrderLineUsageCostText(row) {
  const count = Number(row?.piCostRowCount ?? 0)
  if (!Number.isFinite(count) || count <= 0) return '-'
  const sum4 = Number(row?.piCostKcac04Total ?? 0)
  const sum6 = Number(row?.piCostKcac06Total ?? 0)
  const s4 = Number.isFinite(sum4) ? sum4.toFixed(4) : '0.0000'
  const s6 = Number.isFinite(sum6) ? sum6.toFixed(4) : '0.0000'
  return `成本：${s4},${s6}`
}

function buildSalesExpandLineSelectSql() {
  return `
    SELECT
      l.[id],
      l.[seq],
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[xsak01], N'')))) AS piNo,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) AS kcaa01,
      CAST(ISNULL(l.[xsak03], l.[plan_quantity]) AS decimal(18, 4)) AS orderQty,
      CAST(ISNULL(l.[xsak04], 0) AS decimal(18, 6)) AS unitPrice,
      CAST(ISNULL(l.[xsak05], 0) AS decimal(18, 6)) AS amount,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa02], N'')))) AS materialNameCn,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa02], N'')))) AS productName,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa03], N'')))) AS spec,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(l.[kcaa04], N'')))) AS unit,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa06], N'')))) AS customerStyleNo,
      LTRIM(RTRIM(CONVERT(nvarchar(max), ISNULL(l.[remark], N'')))) AS remark,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa10], N'')))) AS groupName,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa09], N'')))) AS factoryStyleNo,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(l.[version], N'')))) AS version
    FROM ${LINE_FROM} AS l
  `
}

async function fetchSalesOrderPiCostUsageBatch(pool, piNos, pqValues) {
  const piList = [...new Set(piNos.map(text).filter(Boolean))]
  const pqList = [...new Set(pqValues.map(text).filter(Boolean))]
  const out = new Map()
  if (!piList.length || !pqList.length) return out

  const req = pool.request()
  const piIn = bindNVarCharInList(req, 'pi', piList, 200)
  const pqIn = bindNVarCharInList(req, 'pq', pqList, 300)
  const r = await req.query(`
    SELECT
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.[sid], N'')))) AS piNo,
      LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(c.[pq], N'')))) AS pq,
      COUNT_BIG(1) AS [rowCount],
      ISNULL(SUM(ISNULL(CONVERT(decimal(18, 6), c.[kcac04]), 0)), 0) AS totalKcac04,
      ISNULL(SUM(ISNULL(CONVERT(decimal(18, 6), c.[kcac06]), 0)), 0) AS totalKcac06
    FROM ${PI_COST_FROM} AS c
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.[sid], N'')))) IN (${piIn.inSql})
      AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(c.[pq], N'')))) IN (${pqIn.inSql})
      AND ISNULL(c.[isok], 0) = 1
    GROUP BY LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.[sid], N'')))),
             LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(c.[pq], N''))))
  `)
  for (const row of r.recordset ?? []) {
    out.set(`${text(row.piNo)}::${text(row.pq)}`, row)
  }
  return out
}

function enrichSalesExpandLines(lines, piNo, usageMap) {
  return lines.map((line) => {
    const usage = usageMap.get(`${text(piNo)}::${text(line.kcaa01)}`) ?? {}
    const enriched = { ...line }
    enriched.piCostRowCount = Number(usage.rowCount ?? 0)
    enriched.piCostKcac04Total = Number(usage.totalKcac04 ?? 0)
    enriched.piCostKcac06Total = Number(usage.totalKcac06 ?? 0)
    enriched.usageCostText = formatSalesOrderLineUsageCostText(enriched)
    return enriched
  })
}

export async function fetchSalesOrderExpandLinesBatch(pool, rawIds) {
  const parsed = normalizeIntIds(rawIds)
  if (!parsed.ok) {
    return { ok: false, status: parsed.status, msg: `一次最多查询 ${ERP_MAX_PAGE_SIZE} 条销售订单展开明细` }
  }
  const ids = parsed.ids
  if (!ids.length) return { ok: true, data: {} }

  const headerReq = pool.request()
  const idIn = bindIntInList(headerReq, 'id', ids)
  const headerR = await headerReq.query(`
    SELECT [id], LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([xsaj01], N'')))) AS piNo
    FROM ${HEADER_FROM}
    WHERE [id] IN (${idIn.inSql})
  `)
  const headers = headerR.recordset ?? []
  if (!headers.length) return { ok: true, data: {} }

  const piNos = headers.map((row) => text(row.piNo)).filter(Boolean)
  if (!piNos.length) return { ok: true, data: {} }

  const lineReq = pool.request()
  const piIn = bindNVarCharInList(lineReq, 'pi', piNos, 200)
  const lineR = await lineReq.query(`
    ${buildSalesExpandLineSelectSql()}
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[xsak01], N'')))) IN (${piIn.inSql})
    ORDER BY LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[xsak01], N'')))), ISNULL(l.[seq], l.[id]) ASC
  `)
  const rawLines = (lineR.recordset ?? []).map(serializeRow)
  const lineGroups = groupRowsByKey(rawLines, (row) => row.piNo)
  const usageMap = await fetchSalesOrderPiCostUsageBatch(
    pool,
    piNos,
    rawLines.map((row) => row.kcaa01),
  )

  const data = {}
  for (const header of headers) {
    const piNo = text(header.piNo)
    const lines = enrichSalesExpandLines(lineGroups.get(piNo) ?? [], piNo, usageMap)
    data[String(header.id)] = { lines }
  }
  return { ok: true, data }
}

export async function fetchSalesOrderExpandLines(pool, id) {
  const orderId = Number(id)
  if (!Number.isFinite(orderId) || orderId <= 0) return { ok: false, status: 400, msg: '参数错误：id' }
  const batch = await fetchSalesOrderExpandLinesBatch(pool, [orderId])
  if (!batch.ok) return batch
  const data = batch.data?.[String(orderId)]
  if (!data) return { ok: false, status: 404, msg: '记录不存在' }
  return { ok: true, data }
}
