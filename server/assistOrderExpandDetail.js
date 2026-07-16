import { ERP_MAX_PAGE_SIZE } from './erpPagination.js'
import { ASSIST_ORDER_HEADER_TABLE } from './assistOrderListQuery.js'
import { bindIntInList, bindNVarCharInList, groupRowsByKey, normalizeIntIds } from './sqlInListHelpers.js'

const HEADER_FROM = `dbo.[${ASSIST_ORDER_HEADER_TABLE}]`
const LINE_FROM = 'dbo.[UB_ERP_assist_order_list]'
const MONEY_FROM = 'dbo.[UB_ERP_assist_order_money]'
const STOCK_IN_FROM = 'dbo.[UB_ERP_Stocks_Storage]'
const STOCK_IN_LINE_FROM = 'dbo.[UB_ERP_Stocks_Storage_list]'
const STOCK_OUT_FROM = 'dbo.[UB_ERP_Stocks_out]'
const STOCK_OUT_LINE_FROM = 'dbo.[UB_ERP_Stocks_out_list]'

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

function buildAssistLineSelectSql() {
  return `
    SELECT
      ROW_NUMBER() OVER (PARTITION BY LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[wxak01], N'')))) ORDER BY l.[id] ASC) AS seq,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[wxak01], N'')))) AS orderNo,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[pi], N'')))) AS piNo,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[Product], N'')))) AS product,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) AS kcaa01,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa02], N'')))) AS kcaa02,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa02_en], N'')))) AS kcaa02En,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kpname], N'')))) AS invoiceName,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa03], N'')))) AS kcaa03,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(l.[kcaa04], N'')))) AS kcaa04,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(l.[kcaa05], N'')))) AS kcaa05,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(l.[kcaa09], N'')))) AS origin,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(l.[kcaa10], N'')))) AS kcaa10,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(l.[kcaa11], N'')))) AS kcaa11,
      LTRIM(RTRIM(CONVERT(nvarchar(1000), ISNULL(l.[Describe], N'')))) AS describe,
      l.[version],
      l.[Customer_supply] AS customerSupply,
      l.[wxak03],
      l.[wxak04],
      l.[wxak041],
      l.[wxak05],
      l.[wxak051],
      l.[tax],
      l.[delivery_date] AS deliveryDate,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[reference], N'')))) AS referenceNo,
      LTRIM(RTRIM(CONVERT(nvarchar(1000), ISNULL(l.[wxak06], N'')))) AS remark
    FROM ${LINE_FROM} AS l
  `
}

function warehouseKey(orderNo, materialCode) {
  return `${text(orderNo)}\u0000${text(materialCode)}`
}

export function buildAssistOrderWarehouseInboundSql(orderNoInSql, materialCodeInSql) {
  return `
    SELECT
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan04], N'')))) AS orderNo,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) AS materialCode,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan01], N'')))) AS documentNo,
      h.[kcan02] AS documentDate,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[kcan08], N'')))) AS deliveryNo,
      LTRIM(RTRIM(CONVERT(nvarchar(1000), ISNULL(h.[remark], N'')))) AS remark,
      SUM(ISNULL(l.[kcao03], 0)) AS quantity,
      SUM(ISNULL(l.[kcao031], 0)) AS backupQuantity
    FROM ${STOCK_IN_FROM} AS h
    INNER JOIN ${STOCK_IN_LINE_FROM} AS l ON h.[kcan01] = l.[kcao01]
    WHERE h.[pass] = 1
      AND h.[del] = 0
      AND h.[kcan03] = 2
      AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan04], N'')))) IN (${orderNoInSql})
      AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) IN (${materialCodeInSql})
    GROUP BY h.[kcan04], l.[kcaa01], h.[kcan01], h.[kcan02], h.[kcan08], h.[remark]
    ORDER BY h.[kcan04], l.[kcaa01], h.[kcan02], h.[kcan01]
  `
}

export function buildAssistOrderWarehouseOutboundSql(orderNoInSql, materialCodeInSql) {
  return `
    SELECT
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcap04], N'')))) AS orderNo,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) AS materialCode,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcap01], N'')))) AS documentNo,
      h.[kcap02] AS documentDate,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[kcap08], N'')))) AS paperNo,
      LTRIM(RTRIM(CONVERT(nvarchar(1000), ISNULL(h.[remark], N'')))) AS remark,
      SUM(ISNULL(l.[kcaq03], 0)) AS quantity
    FROM ${STOCK_OUT_FROM} AS h
    INNER JOIN ${STOCK_OUT_LINE_FROM} AS l ON h.[kcap01] = l.[kcaq01]
    WHERE h.[pass] = 1
      AND h.[del] = 0
      AND h.[kcap03] = 2
      AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcap04], N'')))) IN (${orderNoInSql})
      AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) IN (${materialCodeInSql})
    GROUP BY h.[kcap04], l.[kcaa01], h.[kcap01], h.[kcap02], h.[kcap08], h.[remark]
    ORDER BY h.[kcap04], l.[kcaa01], h.[kcap02], h.[kcap01]
  `
}

export async function fetchAssistOrderWarehouseRecords(pool, { orderNos, materialCodes }) {
  const orders = [...new Set((orderNos ?? []).map(text).filter(Boolean))]
  const materials = [...new Set((materialCodes ?? []).map(text).filter(Boolean))]
  const empty = { inboundByKey: new Map(), outboundByKey: new Map() }
  if (!orders.length || !materials.length) return empty

  const inboundReq = pool.request()
  const inboundOrders = bindNVarCharInList(inboundReq, 'ino', orders, 200)
  const inboundMaterials = bindNVarCharInList(inboundReq, 'imc', materials, 200)
  const inboundResult = await inboundReq.query(buildAssistOrderWarehouseInboundSql(inboundOrders.inSql, inboundMaterials.inSql))

  const outboundReq = pool.request()
  const outboundOrders = bindNVarCharInList(outboundReq, 'ono', orders, 200)
  const outboundMaterials = bindNVarCharInList(outboundReq, 'omc', materials, 200)
  const outboundResult = await outboundReq.query(buildAssistOrderWarehouseOutboundSql(outboundOrders.inSql, outboundMaterials.inSql))

  return {
    inboundByKey: groupRowsByKey(inboundResult.recordset ?? [], (row) => warehouseKey(row.orderNo, row.materialCode)),
    outboundByKey: groupRowsByKey(outboundResult.recordset ?? [], (row) => warehouseKey(row.orderNo, row.materialCode)),
  }
}

function buildAssistFeeSelectSql() {
  return `
    SELECT
      ROW_NUMBER() OVER (PARTITION BY LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(m.[assist_code], N'')))) ORDER BY m.[id] ASC) AS seq,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(m.[assist_code], N'')))) AS orderNo,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(m.[kcaa01], N'')))) AS feeCode,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(NULLIF(m.[kcaa02], N''), m.[mtitle])))) AS feeName,
      m.[money],
      m.[tax],
      LTRIM(RTRIM(CONVERT(nvarchar(1000), ISNULL(m.[remark], N'')))) AS remark
    FROM ${MONEY_FROM} AS m
  `
}

export async function fetchAssistOrderExpandDetailBatch(pool, rawIds) {
  const parsed = normalizeIntIds(rawIds)
  if (!parsed.ok) {
    return { ok: false, status: parsed.status, msg: `一次最多查询 ${ERP_MAX_PAGE_SIZE} 条外协订单展开明细` }
  }
  const ids = parsed.ids
  if (!ids.length) return { ok: true, data: {} }

  const headerReq = pool.request()
  const idIn = bindIntInList(headerReq, 'id', ids)
  const headerR = await headerReq.query(`
    SELECT [id], LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([wxaj01], N'')))) AS assistOrderNo
    FROM ${HEADER_FROM}
    WHERE [id] IN (${idIn.inSql})
  `)
  const headers = headerR.recordset ?? []
  if (!headers.length) return { ok: true, data: {} }

  const orderNos = headers.map((row) => text(row.assistOrderNo)).filter(Boolean)
  if (!orderNos.length) return { ok: true, data: {} }

  const lineReq = pool.request()
  const orderIn = bindNVarCharInList(lineReq, 'ono', orderNos, 200)
  const lineR = await lineReq.query(`
    ${buildAssistLineSelectSql()}
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[wxak01], N'')))) IN (${orderIn.inSql})
      AND (ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')
    ORDER BY LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[wxak01], N'')))), l.[id] ASC
  `)

  const rawLines = lineR.recordset ?? []
  const warehouseRecords = await fetchAssistOrderWarehouseRecords(pool, {
    orderNos,
    materialCodes: rawLines.map((row) => row.kcaa01),
  })

  const feeReq = pool.request()
  const feeOrderIn = bindNVarCharInList(feeReq, 'fno', orderNos, 200)
  const feeR = await feeReq.query(`
    ${buildAssistFeeSelectSql()}
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(m.[assist_code], N'')))) IN (${feeOrderIn.inSql})
      AND ISNULL(m.[del], 0) = 0
    ORDER BY LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(m.[assist_code], N'')))), m.[id] ASC
  `)

  const lineGroups = groupRowsByKey(rawLines, (row) => row.orderNo)
  const feeGroups = groupRowsByKey(feeR.recordset ?? [], (row) => row.orderNo)

  const data = {}
  for (const header of headers) {
    const orderNo = text(header.assistOrderNo)
    data[String(header.id)] = {
      lines: (lineGroups.get(orderNo) ?? []).map((line) => {
        const key = warehouseKey(orderNo, line.kcaa01)
        return {
          ...serializeRow(line),
          warehouse: {
            inbound: (warehouseRecords.inboundByKey.get(key) ?? []).map(serializeRow),
            outbound: (warehouseRecords.outboundByKey.get(key) ?? []).map(serializeRow),
          },
        }
      }),
      fees: (feeGroups.get(orderNo) ?? []).map(serializeRow),
    }
  }
  return { ok: true, data }
}

export async function fetchAssistOrderExpandDetail(pool, id) {
  const orderId = Number(id)
  if (!Number.isInteger(orderId) || orderId <= 0) return { ok: false, status: 400, msg: '外协订单参数无效' }
  const batch = await fetchAssistOrderExpandDetailBatch(pool, [orderId])
  if (!batch.ok) return batch
  const data = batch.data?.[String(orderId)]
  if (!data) return { ok: false, status: 404, msg: '外协订单不存在' }
  return { ok: true, data }
}
