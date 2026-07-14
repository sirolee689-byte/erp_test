/**
 * 销售订单：列表与只读详情（issue 01）
 * SQL Server 2008 R2：ROW_NUMBER 分页
 */
import { sql } from './db.js'
import { resolveActorAuditTripletFromReq } from './businessAuditFields.js'
import {
  SALES_ORDER_HEADER_TABLE,
  buildSalesOrderCalcStatusExpr,
  buildSalesOrderListPagedSql,
  buildSalesOrderListWhereSql,
  escapeSalesOrderSqlLikePattern,
  parseSalesOrderListQuery,
  pickSalesOrderCalcStatusColumn,
} from './salesOrderListQuery.js'
import {
  fetchBomCodeExcludePrefixes,
  orderLinesHaveSpareParts,
  orderLinesIsPureSpare,
  resolveCanAddSpareUsage,
} from './salesOrderSpareParts.js'
import { normKcaa01 } from './salesOrderSaveLogic.js'
import { assertPiNoUnique, createSalesOrder, getClientIpFromReq, updateSalesOrder } from './salesOrderSaveService.js'
import {
  approveSalesOrder,
  hardDeleteSalesOrder,
  parseSalesOrderId,
  restoreSalesOrder,
  softDeleteSalesOrder,
  unapproveSalesOrder,
} from './salesOrderLifecycle.js'
import { syncSalesOrderBomForLine } from './salesOrderSyncBomService.js'
import { calculateSalesOrderMaterialBill } from './salesOrderCalculateService.js'
import { addSalesOrderSpareUsage } from './salesOrderSpareUsageService.js'
import { fetchSalesOrderMaterialBill } from './salesOrderMaterialBillService.js'
import { fetchOutsourcingMaterialList } from './salesOrderOutsourcingListService.js'
import { fetchCutPositionMaterialList } from './salesOrderCutPositionListService.js'
import {
  fetchSalesOrderPiBom,
  saveSalesOrderPiBom,
} from './salesOrderPiBomMaintainService.js'
import { fetchSalesOrderExpandLinesBatch } from './salesOrderExpandLines.js'
import { fetchSalesOrderMaterialTrace, fetchSalesOrderMaterialTraceCategories } from './salesOrderMaterialTrace.js'

const HEADER_FROM = `dbo.[${SALES_ORDER_HEADER_TABLE}]`
const LINE_FROM = 'dbo.[UB_ERP_Sales_order_list]'
const PI_COST_FROM = 'dbo.[UB_ERP_Bom_pi_cost]'
const STOCK_OUT_FROM = 'dbo.[UB_ERP_Stocks_out]'
const STOCK_OUT_LINE_FROM = 'dbo.[UB_ERP_Stocks_out_list]'
const BUY_ORDER_FROM = 'dbo.[UB_ERP_Buy_order]'
const ASSIST_ORDER_FROM = 'dbo.[UB_ERP_assist_order]'
const DISPATCH_ORDER_FROM = 'dbo.[UB_ERP_Dispatch_order]'

/** @type {Promise<string> | null} */
let CALC_STATUS_COL_PROMISE = null
/** @type {Promise<string> | null} */
let SALES_ORDER_LIST_DATE_COL_PROMISE = null
/** @type {Promise<boolean> | null} */
let SALES_ORDER_CLOSED_COL_PROMISE = null

async function ensureSalesOrderCalcStatusColumn(pool) {
  if (!CALC_STATUS_COL_PROMISE) {
    CALC_STATUS_COL_PROMISE = pool
      .request()
      .input('t', sql.NVarChar(200), SALES_ORDER_HEADER_TABLE)
      .query(
        `
        SELECT c.COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS AS c
        WHERE c.TABLE_NAME = @t
      `,
      )
      .then((r) => pickSalesOrderCalcStatusColumn((r.recordset ?? []).map((row) => row.COLUMN_NAME)))
  }
  return CALC_STATUS_COL_PROMISE
}

async function ensureSalesOrderListDateColumn(pool) {
  if (!SALES_ORDER_LIST_DATE_COL_PROMISE) {
    SALES_ORDER_LIST_DATE_COL_PROMISE = pool
      .request()
      .input('t', sql.NVarChar(200), SALES_ORDER_HEADER_TABLE)
      .query(
        `
        SELECT c.COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS AS c
        WHERE c.TABLE_NAME = @t
      `,
      )
      .then((r) => {
        const lower = new Set((r.recordset ?? []).map((row) => String(row.COLUMN_NAME ?? '').toLowerCase()))
        if (lower.has('xsaj03')) return 'xsaj03'
        return 'xsaj02'
      })
  }
  return SALES_ORDER_LIST_DATE_COL_PROMISE
}

async function ensureSalesOrderClosedColumn(pool) {
  if (!SALES_ORDER_CLOSED_COL_PROMISE) {
    SALES_ORDER_CLOSED_COL_PROMISE = pool
      .request()
      .input('t', sql.NVarChar(200), SALES_ORDER_HEADER_TABLE)
      .input('c', sql.NVarChar(200), 'closed')
      .query(
        `
        SELECT COUNT(1) AS total
        FROM INFORMATION_SCHEMA.COLUMNS AS c
        WHERE c.TABLE_NAME = @t
          AND c.COLUMN_NAME = @c
      `,
      )
      .then((r) => Number(r.recordset?.[0]?.total ?? 0) > 0)
  }
  return SALES_ORDER_CLOSED_COL_PROMISE
}

/** @param {Record<string, unknown>} row */
function serializeRow(row) {
  /** @type {Record<string, unknown>} */
  const o = {}
  for (const [k, v] of Object.entries(row ?? {})) {
    if (k === 'rn') continue
    if (v instanceof Date) o[k] = v.toISOString()
    else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(v)) o[k] = `[binary:${v.length}]`
    else o[k] = v
  }
  if (o.id != null) o.id = Number(o.id)
  if (Object.prototype.hasOwnProperty.call(o, 'hasSpareParts')) {
    o.hasSpareParts = Number(o.hasSpareParts ?? 0) === 1
  }
  if (Object.prototype.hasOwnProperty.call(o, 'isPureSpareOrder')) {
    o.isPureSpareOrder = Number(o.isPureSpareOrder ?? 0) === 1
  }
  if (Object.prototype.hasOwnProperty.call(o, 'canAddSpareUsage')) {
    o.canAddSpareUsage = Number(o.canAddSpareUsage ?? 0) === 1
  }
  return o
}

function formatSalesOrderLineUsageCostText(row) {
  const count = Number(row?.piCostRowCount ?? 0)
  if (!Number.isFinite(count) || count <= 0) return '-'
  const sum4 = Number(row?.piCostKcac04Total ?? 0)
  const sum6 = Number(row?.piCostKcac06Total ?? 0)
  const s4 = Number.isFinite(sum4) ? sum4.toFixed(4) : '0.0000'
  const s6 = Number.isFinite(sum6) ? sum6.toFixed(4) : '0.0000'
  return `成本：${s4},${s6}`
}

function text(v) {
  return String(v ?? '').trim()
}

function uniqueTexts(values) {
  return [...new Set((values ?? []).map((v) => text(v)).filter(Boolean))]
}

function bindNVarCharList(req, name, values, length = 300) {
  return values.map((value, index) => {
    const key = `${name}${index}`
    req.input(key, sql.NVarChar(length), value)
    return `@${key}`
  })
}

function createSalesOrderDataSummaryMap(piNos) {
  const map = new Map()
  for (const piNo of uniqueTexts(piNos)) {
    map.set(piNo, {
      lineCount: 0,
      lineQtyTotal: 0,
      lineAmountTotal: 0,
      stockOutQtyTotal: 0,
      buyOrderApprovedCount: 0,
      buyOrderUnauditedCount: 0,
      assistOrderApprovedCount: 0,
      assistOrderUnauditedCount: 0,
      dispatchOrderApprovedCount: 0,
      dispatchOrderUnauditedCount: 0,
    })
  }
  return map
}

function toSafeNumber(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function toSafeInt(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.trunc(n)
}

function normalizeSalesDataSummary(summary) {
  const buyOrderTotal = toSafeInt(summary.buyOrderApprovedCount) + toSafeInt(summary.buyOrderUnauditedCount)
  const assistOrderTotal = toSafeInt(summary.assistOrderApprovedCount) + toSafeInt(summary.assistOrderUnauditedCount)
  const dispatchOrderTotal = toSafeInt(summary.dispatchOrderApprovedCount) + toSafeInt(summary.dispatchOrderUnauditedCount)
  return {
    lineCount: toSafeInt(summary.lineCount),
    lineQtyTotal: toSafeNumber(summary.lineQtyTotal),
    lineAmountTotal: toSafeNumber(summary.lineAmountTotal),
    stockOutQtyTotal: toSafeNumber(summary.stockOutQtyTotal),
    buyOrderApprovedCount: toSafeInt(summary.buyOrderApprovedCount),
    buyOrderUnauditedCount: toSafeInt(summary.buyOrderUnauditedCount),
    buyOrderTotal,
    assistOrderApprovedCount: toSafeInt(summary.assistOrderApprovedCount),
    assistOrderUnauditedCount: toSafeInt(summary.assistOrderUnauditedCount),
    assistOrderTotal,
    dispatchOrderApprovedCount: toSafeInt(summary.dispatchOrderApprovedCount),
    dispatchOrderUnauditedCount: toSafeInt(summary.dispatchOrderUnauditedCount),
    dispatchOrderTotal,
  }
}

async function fetchSalesOrderDataSummaryByPi(pool, piNos) {
  const list = uniqueTexts(piNos)
  const out = createSalesOrderDataSummaryMap(list)
  if (!list.length) return out

  const loadLineSummary = async () => {
    const req = pool.request()
    const inList = bindNVarCharList(req, 'salesPi', list, 200).join(',')
    const r = await req.query(`
      SELECT
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[xsak01], N'')))) AS piNo,
        COUNT_BIG(1) AS lineCount,
        ISNULL(SUM(ISNULL(CONVERT(decimal(18, 6), l.[xsak03]), 0)), 0) AS lineQtyTotal,
        ISNULL(SUM(
          ISNULL(CONVERT(decimal(18, 6), l.[xsak03]), 0) * ISNULL(CONVERT(decimal(18, 6), l.[xsak04]), 0)
        ), 0) AS lineAmountTotal
      FROM ${LINE_FROM} AS l
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[xsak01], N'')))) IN (${inList})
        AND (ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')
      GROUP BY LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[xsak01], N''))))
    `)
    for (const row of r.recordset ?? []) {
      const piNo = text(row.piNo)
      const current = out.get(piNo)
      if (!current) continue
      current.lineCount = toSafeInt(row.lineCount)
      current.lineQtyTotal = toSafeNumber(row.lineQtyTotal)
      current.lineAmountTotal = toSafeNumber(row.lineAmountTotal)
    }
  }

  const loadStockOutSummary = async () => {
    const req = pool.request()
    const inList = bindNVarCharList(req, 'soPi', list, 200).join(',')
    const r = await req.query(`
      SELECT
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(s.[kcap04], N'')))) AS piNo,
        ISNULL(SUM(ISNULL(CONVERT(decimal(18, 6), l.[kcaq03]), 0)), 0) AS stockOutQtyTotal
      FROM ${STOCK_OUT_FROM} AS s
      INNER JOIN ${STOCK_OUT_LINE_FROM} AS l
        ON LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaq01], N'')))) =
           LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(s.[kcap01], N''))))
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(s.[kcap04], N'')))) IN (${inList})
        AND ISNULL(CONVERT(int, s.[kcap03]), 0) = 6
        AND LTRIM(RTRIM(ISNULL(s.[pass], N''))) = N'1'
        AND (ISNULL(s.[del], N'') = N'' OR s.[del] = N'0')
        AND (ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')
      GROUP BY LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(s.[kcap04], N''))))
    `)
    for (const row of r.recordset ?? []) {
      const piNo = text(row.piNo)
      const current = out.get(piNo)
      if (!current) continue
      current.stockOutQtyTotal = toSafeNumber(row.stockOutQtyTotal)
    }
  }

  const loadBuyOrderSummary = async () => {
    const req = pool.request()
    const inList = bindNVarCharList(req, 'buyPi', list, 200).join(',')
    const r = await req.query(`
      SELECT
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(b.[kcaj04], N'')))) AS piNo,
        SUM(CASE WHEN LTRIM(RTRIM(ISNULL(b.[pass], N''))) = N'1' THEN 1 ELSE 0 END) AS approvedCount,
        SUM(CASE WHEN LTRIM(RTRIM(ISNULL(b.[pass], N''))) = N'0' THEN 1 ELSE 0 END) AS unauditedCount
      FROM ${BUY_ORDER_FROM} AS b
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(b.[kcaj04], N'')))) IN (${inList})
        AND (ISNULL(b.[del], N'') = N'' OR b.[del] = N'0')
      GROUP BY LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(b.[kcaj04], N''))))
    `)
    for (const row of r.recordset ?? []) {
      const piNo = text(row.piNo)
      const current = out.get(piNo)
      if (!current) continue
      current.buyOrderApprovedCount = toSafeInt(row.approvedCount)
      current.buyOrderUnauditedCount = toSafeInt(row.unauditedCount)
    }
  }

  const loadAssistOrderSummary = async () => {
    const req = pool.request()
    const inList = bindNVarCharList(req, 'assistPi', list, 200).join(',')
    const r = await req.query(`
      SELECT
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(a.[wxaj04], N'')))) AS piNo,
        SUM(CASE WHEN LTRIM(RTRIM(ISNULL(a.[pass], N''))) = N'1' THEN 1 ELSE 0 END) AS approvedCount,
        SUM(CASE WHEN LTRIM(RTRIM(ISNULL(a.[pass], N''))) = N'0' THEN 1 ELSE 0 END) AS unauditedCount
      FROM ${ASSIST_ORDER_FROM} AS a
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(a.[wxaj04], N'')))) IN (${inList})
        AND (ISNULL(a.[del], N'') = N'' OR a.[del] = N'0')
      GROUP BY LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(a.[wxaj04], N''))))
    `)
    for (const row of r.recordset ?? []) {
      const piNo = text(row.piNo)
      const current = out.get(piNo)
      if (!current) continue
      current.assistOrderApprovedCount = toSafeInt(row.approvedCount)
      current.assistOrderUnauditedCount = toSafeInt(row.unauditedCount)
    }
  }

  const loadDispatchOrderSummary = async () => {
    const req = pool.request()
    const inList = bindNVarCharList(req, 'dispatchPi', list, 200).join(',')
    const r = await req.query(`
      SELECT
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(d.[scaj04], N'')))) AS piNo,
        SUM(CASE WHEN LTRIM(RTRIM(ISNULL(d.[pass], N''))) = N'1' THEN 1 ELSE 0 END) AS approvedCount,
        SUM(CASE WHEN LTRIM(RTRIM(ISNULL(d.[pass], N''))) = N'0' THEN 1 ELSE 0 END) AS unauditedCount
      FROM ${DISPATCH_ORDER_FROM} AS d
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(d.[scaj04], N'')))) IN (${inList})
        AND (ISNULL(d.[del], N'') = N'' OR d.[del] = N'0')
      GROUP BY LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(d.[scaj04], N''))))
    `)
    for (const row of r.recordset ?? []) {
      const piNo = text(row.piNo)
      const current = out.get(piNo)
      if (!current) continue
      current.dispatchOrderApprovedCount = toSafeInt(row.approvedCount)
      current.dispatchOrderUnauditedCount = toSafeInt(row.unauditedCount)
    }
  }

  await Promise.all([
    loadLineSummary(),
    loadStockOutSummary(),
    loadBuyOrderSummary(),
    loadAssistOrderSummary(),
    loadDispatchOrderSummary(),
  ])

  for (const [piNo, summary] of out.entries()) {
    out.set(piNo, normalizeSalesDataSummary(summary))
  }
  return out
}

async function fetchSalesOrderLineCodesByPi(pool, piNos) {
  const list = uniqueTexts(piNos)
  const out = new Map(list.map((piNo) => [piNo, []]))
  if (!list.length) return out
  const req = pool.request()
  const inList = bindNVarCharList(req, 'pi', list, 200).join(',')
  const r = await req.query(`
    SELECT
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[xsak01], N'')))) AS piNo,
      LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa01], N'')))) AS kcaa01
    FROM ${LINE_FROM} AS l
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[xsak01], N'')))) IN (${inList})
      AND (ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')
      AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa01], N'')))) <> N''
  `)
  for (const row of r.recordset ?? []) {
    const piNo = text(row.piNo)
    if (!out.has(piNo)) out.set(piNo, [])
    out.get(piNo).push({ kcaa01: text(row.kcaa01) })
  }
  return out
}

async function fetchPiCostPqSetByPi(pool, piNos) {
  const list = uniqueTexts(piNos)
  const out = new Map(list.map((piNo) => [piNo, new Set()]))
  if (!list.length) return out
  const req = pool.request()
  const inList = bindNVarCharList(req, 'costPi', list, 200).join(',')
  const r = await req.query(`
    SELECT
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.[sid], N'')))) AS piNo,
      LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(c.[pq], N'')))) AS pq
    FROM ${PI_COST_FROM} AS c
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.[sid], N'')))) IN (${inList})
      AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(c.[pq], N'')))) <> N''
      AND ISNULL(c.[isok], 0) = 1
    GROUP BY
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.[sid], N'')))),
      LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(c.[pq], N''))))
  `)
  for (const row of r.recordset ?? []) {
    const piNo = text(row.piNo)
    if (!out.has(piNo)) out.set(piNo, new Set())
    out.get(piNo).add(normKcaa01(row.pq))
  }
  return out
}

async function fetchSalesOrderCalcStatusByPi(pool, piNos) {
  const list = uniqueTexts(piNos)
  const out = new Map(list.map((piNo) => [piNo, '未运算']))
  if (!list.length) return out
  const req = pool.request()
  const inList = bindNVarCharList(req, 'calcPi', list, 200).join(',')
  const r = await req.query(`
    SELECT
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.[sid], N'')))) AS piNo
    FROM ${PI_COST_FROM} AS c
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.[sid], N'')))) IN (${inList})
      AND ISNULL(c.[isok], 0) = 1
    GROUP BY LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.[sid], N''))))
  `)
  for (const row of r.recordset ?? []) {
    const piNo = text(row.piNo)
    if (piNo) out.set(piNo, '已运算')
  }
  return out
}

async function enrichSalesOrderOperationFlags(pool, rows) {
  const list = Array.isArray(rows) ? rows : []
  if (!list.length) return list
  const piNos = uniqueTexts(list.map((row) => row.piNo))
  const [excludePrefixes, lineMap] = await Promise.all([
    fetchBomCodeExcludePrefixes(pool),
    fetchSalesOrderLineCodesByPi(pool, piNos),
  ])

  const mixedPiNos = []
  for (const row of list) {
    const piNo = text(row.piNo)
    const lines = lineMap.get(piNo) ?? []
    const hasSpareParts = orderLinesHaveSpareParts(lines, excludePrefixes)
    const isPureSpareOrder = orderLinesIsPureSpare(lines, excludePrefixes)
    row.hasSpareParts = hasSpareParts
    row.isPureSpareOrder = isPureSpareOrder
    row.canAddSpareUsage = isPureSpareOrder
    if (hasSpareParts && !isPureSpareOrder) mixedPiNos.push(piNo)
  }

  const piCostPqMap = await fetchPiCostPqSetByPi(pool, mixedPiNos)
  for (const row of list) {
    if (!row.hasSpareParts || row.isPureSpareOrder) continue
    const piNo = text(row.piNo)
    row.canAddSpareUsage = resolveCanAddSpareUsage(
      lineMap.get(piNo) ?? [],
      excludePrefixes,
      piCostPqMap.get(piNo) ?? new Set(),
    )
  }
  return list
}

async function fetchSalesOrderPiCostUsageByPq(pool, piNo, pqValues) {
  const codes = uniqueTexts(pqValues)
  const out = new Map()
  if (!text(piNo) || !codes.length) return out
  const req = pool.request().input('piNo', sql.NVarChar(200), text(piNo))
  const inList = bindNVarCharList(req, 'pq', codes, 300).join(',')
  const r = await req.query(`
    SELECT
      LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(c.[pq], N'')))) AS pq,
      COUNT_BIG(1) AS [rowCount],
      ISNULL(SUM(ISNULL(CONVERT(decimal(18, 6), c.[kcac04]), 0)), 0) AS totalKcac04,
      ISNULL(SUM(ISNULL(CONVERT(decimal(18, 6), c.[kcac06]), 0)), 0) AS totalKcac06
    FROM ${PI_COST_FROM} AS c
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.[sid], N'')))) = @piNo
      AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(c.[pq], N'')))) IN (${inList})
      AND ISNULL(c.[isok], 0) = 1
    GROUP BY LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(c.[pq], N''))))
  `)
  for (const row of r.recordset ?? []) {
    out.set(text(row.pq), row)
  }
  return out
}

/**
 * @param {import('express').Express} app
 * @param {{
 *   getPool: () => Promise<import('mssql').ConnectionPool>,
 *   getActorAuditTripletFromReq: (req: import('express').Request) => {
 *     uidInt: number | null,
 *     uname: string | null,
 *     utruename: string | null,
 *   },
 * }} deps
 */
export function registerSalesOrderRoutes(app, deps) {
  const { getPool, getActorAuditTripletFromReq } = deps

  async function getSalesOrderActor(pool, req) {
    return resolveActorAuditTripletFromReq(pool, req)
  }

  /**
   * GET /api/sales-order/currency-options — 币别下拉（UB_ERP_System_currency 全表在册）
   */
  app.get('/api/sales-order/currency-options', async (req, res) => {
    try {
      const pool = await getPool()
      const r = await pool.request().query(`
        SELECT
          CAST([id] AS int) AS id,
          LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL([cn_name], N'')))) AS cn_name
        FROM dbo.[UB_ERP_System_currency]
        WHERE ISNULL([del], N'') = N'' OR [del] = N'0'
        ORDER BY [id] ASC
      `)
      res.json({
        code: 200,
        msg: 'success',
        data: { list: r.recordset ?? [] },
      })
    } catch (err) {
      console.error('GET /api/sales-order/currency-options 失败：', err)
      res.status(500).json({ code: 500, msg: '读取币别失败', data: null })
    }
  })

  app.get('/api/sales-order/material-trace/categories', async (_req, res) => {
    try {
      const list = await fetchSalesOrderMaterialTraceCategories(await getPool())
      res.json({ code: 200, msg: 'success', data: { list } })
    } catch (err) {
      const detail = String(err?.message ?? err?.originalError?.message ?? err)
      res.status(500).json({ code: 500, msg: `读取销售订单物料分类失败：${detail}`, data: null })
    }
  })

  app.get('/api/sales-order/material-trace/list', async (req, res) => {
    try {
      const result = await fetchSalesOrderMaterialTrace(await getPool(), req.query ?? {})
      res.json({ code: 200, msg: 'success', data: result })
    } catch (err) {
      const detail = String(err?.message ?? err?.originalError?.message ?? err)
      const isQueryError = /^(开始日期|结束日期).*(格式无效|无效)$/.test(detail) || detail === '开始日期不能晚于结束日期'
      res.status(isQueryError ? 400 : 500).json({ code: isQueryError ? 400 : 500, msg: `读取销售订单转向物料失败：${detail}`, data: null })
    }
  })

  /**
   * GET /api/sales-order/list
   */
  app.get('/api/sales-order/list', async (req, res) => {
    try {
      const pool = await getPool()
      const q = parseSalesOrderListQuery(req.query ?? {})
      const [salesDateColumn, hasClosedColumn] = await Promise.all([
        ensureSalesOrderListDateColumn(pool),
        ensureSalesOrderClosedColumn(pool),
      ])
      const { whereSql } = buildSalesOrderListWhereSql({
        recycled: q.recycled,
        pass: q.pass,
        keyword: q.keyword,
        piNo: q.piNo,
        systemCode: q.systemCode,
        customer: q.customer,
        salesDateFrom: q.salesDateFrom,
        salesDateTo: q.salesDateTo,
        salesDateColumn,
      })

      const countReq = pool.request()
      if (q.pass) countReq.input('pass', sql.NVarChar(10), q.pass)
      if (q.keyword) {
        countReq.input('keyword', sql.NVarChar(500), `%${escapeSalesOrderSqlLikePattern(q.keyword)}%`)
      }
      if (q.piNo) countReq.input('piNo', sql.NVarChar(200), q.piNo)
      if (q.systemCode) {
        countReq.input('systemCode', sql.NVarChar(200), `%${escapeSalesOrderSqlLikePattern(q.systemCode)}%`)
      }
      if (q.customer) {
        countReq.input('customer', sql.NVarChar(400), `%${escapeSalesOrderSqlLikePattern(q.customer)}%`)
      }
      if (q.salesDateFrom) countReq.input('salesDateFrom', sql.DateTime, new Date(q.salesDateFrom))
      if (q.salesDateTo) countReq.input('salesDateTo', sql.DateTime, new Date(q.salesDateTo))

      const totalRow = await countReq.query(`
        SELECT COUNT(1) AS total
        FROM ${HEADER_FROM} AS h
        WHERE 1 = 1
        ${whereSql}
      `)
      const total = Number(totalRow.recordset?.[0]?.total ?? 0)

      const safeOffset = (q.page - 1) * q.pageSize
      const startRow = safeOffset + 1
      const endRow = safeOffset + q.pageSize

      const listReq = pool.request()
      listReq.input('startRow', sql.Int, startRow)
      listReq.input('endRow', sql.Int, endRow)
      if (q.pass) listReq.input('pass', sql.NVarChar(10), q.pass)
      if (q.keyword) {
        listReq.input('keyword', sql.NVarChar(500), `%${escapeSalesOrderSqlLikePattern(q.keyword)}%`)
      }
      if (q.piNo) listReq.input('piNo', sql.NVarChar(200), q.piNo)
      if (q.systemCode) {
        listReq.input('systemCode', sql.NVarChar(200), `%${escapeSalesOrderSqlLikePattern(q.systemCode)}%`)
      }
      if (q.customer) {
        listReq.input('customer', sql.NVarChar(400), `%${escapeSalesOrderSqlLikePattern(q.customer)}%`)
      }
      if (q.salesDateFrom) listReq.input('salesDateFrom', sql.DateTime, new Date(q.salesDateFrom))
      if (q.salesDateTo) listReq.input('salesDateTo', sql.DateTime, new Date(q.salesDateTo))

      const { sql: listSql } = buildSalesOrderListPagedSql({
        whereSql,
        salesDateColumn,
        closeStatusExpr: hasClosedColumn ? 'h.[closed]' : "N'0'",
      })
      const listResult = await listReq.query(listSql)
      const pageRows = (listResult.recordset ?? []).map((row) => serializeRow(row))
      const piNos = uniqueTexts(pageRows.map((row) => row.piNo))
      const [calcStatusMap, salesDataMap] = await Promise.all([
        fetchSalesOrderCalcStatusByPi(pool, piNos),
        fetchSalesOrderDataSummaryByPi(pool, piNos),
        enrichSalesOrderOperationFlags(pool, pageRows),
      ])
      const list = pageRows.map((row) => ({
        ...row,
        calcStatus: calcStatusMap.get(text(row.piNo)) ?? '未运算',
        salesData: salesDataMap.get(text(row.piNo)) ?? normalizeSalesDataSummary({}),
      }))

      res.json({ code: 200, msg: 'success', data: { total, list } })
    } catch (err) {
      console.error('GET /api/sales-order/list 失败：', err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '数据库查询失败')
      res.status(500).json({ code: 500, msg: `读取销售订单列表失败：${detail}`, data: null })
    }
  })

  /**
   * GET /api/sales-order/pi-suggest?keyword=
   * 物料单报表页：仅按 PI 号相近匹配已审核在册订单。
   */
  app.get('/api/sales-order/pi-suggest', async (req, res) => {
    try {
      const keyword = String(req.query?.keyword ?? '').trim()
      if (!keyword) {
        res.json({ code: 200, msg: 'success', data: { list: [] } })
        return
      }
      const pool = await getPool()
      const r = await pool
        .request()
        .input('keyword', sql.NVarChar(300), `%${escapeSalesOrderSqlLikePattern(keyword)}%`)
        .query(`
          SELECT TOP 20
            h.[id],
            LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[xsaj01], N'')))) AS piNo,
            h.[xsaj08] AS deliveryDate
          FROM ${HEADER_FROM} AS h
          WHERE (ISNULL(h.[del], N'') = N'' OR h.[del] = N'0')
            AND LTRIM(RTRIM(ISNULL(h.[pass], N''))) = N'1'
            AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[xsaj01], N'')))) LIKE @keyword
          ORDER BY h.[id] DESC
        `)
      const list = (r.recordset ?? [])
        .map((row) => {
          const serialized = serializeRow(row)
          return {
            id: Number(serialized.id),
            piNo: String(serialized.piNo ?? '').trim(),
            deliveryDate: serialized.deliveryDate ?? null,
          }
        })
        .filter((row) => row.id && row.piNo)
      res.json({ code: 200, msg: 'success', data: { list } })
    } catch (err) {
      console.error('GET /api/sales-order/pi-suggest 失败：', err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '查询失败')
      res.status(500).json({ code: 500, msg: `读取 PI 候选失败：${detail}`, data: null })
    }
  })

  /**
   * GET /api/sales-order/check-pi?piNo=&excludeId=
   */
  app.get('/api/sales-order/check-pi', async (req, res) => {
    try {
      const piNo = String(req.query?.piNo ?? '').trim()
      if (!piNo) {
        res.status(400).json({ code: 400, msg: '参数错误：piNo', data: null })
        return
      }
      const excludeRaw = String(req.query?.excludeId ?? '').trim()
      const excludeId = excludeRaw ? Number(excludeRaw) : null
      const safeExcludeId = Number.isFinite(excludeId) && Number(excludeId) > 0 ? Number(excludeId) : null
      const pool = await getPool()
      const dupMsg = await assertPiNoUnique(pool, piNo, safeExcludeId)
      res.json({
        code: 200,
        msg: 'success',
        data: {
          exists: Boolean(dupMsg),
          duplicateMessage: dupMsg || '',
        },
      })
    } catch (err) {
      console.error('GET /api/sales-order/check-pi 失败：', err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '查询失败')
      res.status(500).json({ code: 500, msg: `PI 号校验失败：${detail}`, data: null })
    }
  })

  function lifecycleJson(res, result, okMsg) {
    if (!result.ok) {
      res.status(result.status ?? 400).json({ code: result.status ?? 400, msg: result.msg, data: null })
      return
    }
    res.json({ code: 200, msg: okMsg, data: { id: result.id, piNo: result.piNo, pass: result.pass } })
  }

  /**
   * POST /api/sales-order/:id/approve
   */
  app.post('/api/sales-order/:id/approve', async (req, res) => {
    try {
      const parsed = parseSalesOrderId(req.params.id)
      if (!parsed.ok) {
        res.status(400).json({ code: 400, msg: parsed.msg, data: null })
        return
      }
      const pool = await getPool()
      const actor = await getSalesOrderActor(pool, req)
      const result = await approveSalesOrder(pool, parsed.id, actor)
      lifecycleJson(res, { ...result, id: parsed.id }, '审核成功')
    } catch (err) {
      console.error('POST /api/sales-order/:id/approve 失败：', err)
      res.status(500).json({ code: 500, msg: '审核失败', data: null })
    }
  })

  /**
   * POST /api/sales-order/:id/unapprove
   */
  app.post('/api/sales-order/:id/unapprove', async (req, res) => {
    try {
      const parsed = parseSalesOrderId(req.params.id)
      if (!parsed.ok) {
        res.status(400).json({ code: 400, msg: parsed.msg, data: null })
        return
      }
      const pool = await getPool()
      const actor = await getSalesOrderActor(pool, req)
      const result = await unapproveSalesOrder(pool, parsed.id, actor)
      lifecycleJson(res, { ...result, id: parsed.id }, '反审成功')
    } catch (err) {
      console.error('POST /api/sales-order/:id/unapprove 失败：', err)
      res.status(500).json({ code: 500, msg: '反审失败', data: null })
    }
  })

  /**
   * POST /api/sales-order/:id/soft-delete
   */
  app.post('/api/sales-order/:id/soft-delete', async (req, res) => {
    try {
      const parsed = parseSalesOrderId(req.params.id)
      if (!parsed.ok) {
        res.status(400).json({ code: 400, msg: parsed.msg, data: null })
        return
      }
      const pool = await getPool()
      const actor = await getSalesOrderActor(pool, req)
      const result = await softDeleteSalesOrder(pool, parsed.id, actor)
      lifecycleJson(res, { ...result, id: parsed.id }, '已移入回收站')
    } catch (err) {
      console.error('POST /api/sales-order/:id/soft-delete 失败：', err)
      res.status(500).json({ code: 500, msg: '删除失败', data: null })
    }
  })

  /**
   * POST /api/sales-order/:id/restore
   */
  app.post('/api/sales-order/:id/restore', async (req, res) => {
    try {
      const parsed = parseSalesOrderId(req.params.id)
      if (!parsed.ok) {
        res.status(400).json({ code: 400, msg: parsed.msg, data: null })
        return
      }
      const pool = await getPool()
      const actor = await getSalesOrderActor(pool, req)
      const result = await restoreSalesOrder(pool, parsed.id, actor)
      lifecycleJson(res, { ...result, id: parsed.id }, '恢复成功')
    } catch (err) {
      console.error('POST /api/sales-order/:id/restore 失败：', err)
      res.status(500).json({ code: 500, msg: '恢复失败', data: null })
    }
  })

  /**
   * POST /api/sales-order/:id/hard-delete
   */
  app.post('/api/sales-order/:id/hard-delete', async (req, res) => {
    try {
      const parsed = parseSalesOrderId(req.params.id)
      if (!parsed.ok) {
        res.status(400).json({ code: 400, msg: parsed.msg, data: null })
        return
      }
      const pool = await getPool()
      const result = await hardDeleteSalesOrder(pool, parsed.id)
      lifecycleJson(res, { ...result, id: parsed.id }, '已彻底删除')
    } catch (err) {
      console.error('POST /api/sales-order/:id/hard-delete 失败：', err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '彻底删除失败')
      res.status(500).json({ code: 500, msg: `彻底删除失败：${detail}`, data: null })
    }
  })

  /**
   * GET /api/sales-order/expand-lines/batch
   */
  app.get('/api/sales-order/expand-lines/batch', async (req, res) => {
    try {
      const pool = await getPool()
      const ids = req.query?.ids ?? req.query?.id
      const result = await fetchSalesOrderExpandLinesBatch(pool, ids)
      if (!result.ok) return res.status(result.status ?? 400).json({ code: result.status ?? 400, msg: result.msg, data: null })
      res.json({ code: 200, msg: 'success', data: result.data })
    } catch (err) {
      console.error('GET /api/sales-order/expand-lines/batch 失败：', err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '数据库查询失败')
      res.status(500).json({ code: 500, msg: `批量读取销售订单展开明细失败：${detail}`, data: null })
    }
  })

  /**
   * GET /api/sales-order/:id
   */
  app.get('/api/sales-order/:id', async (req, res) => {
    try {
      const idRaw = String(req.params.id ?? '').trim()
      const id = Number(idRaw)
      if (!Number.isFinite(id) || id <= 0) {
        res.status(400).json({ code: 400, msg: '参数错误：id', data: null })
        return
      }

      const pool = await getPool()
      const calcCol = await ensureSalesOrderCalcStatusColumn(pool)
      const calcStatusExpr = buildSalesOrderCalcStatusExpr(calcCol)

      const hr = await pool.request().input('id', sql.Int, id).query(`
        SELECT TOP 1
          h.[id],
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[xsaj01], N'')))) AS piNo,
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[xsaj06], N'')))) AS poNo,
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[systemcode], N'')))) AS systemCode,
          LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[kehu], N'')))) AS customerName,
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(NULLIF(h.[xsaj05], N''), h.[d_code])))) AS customerCode,
          LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(h.[xsaj07], N'')))) AS currencyCode,
          LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(h.[rmb], N'')))) AS currencyName,
          h.[xsaj02] AS salesDate,
          h.[xsaj08] AS deliveryDate,
          LTRIM(RTRIM(ISNULL(h.[pass], N''))) AS pass,
          LTRIM(RTRIM(ISNULL(h.[del], N''))) AS del,
          LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(h.[decimal_view], N'')))) AS decimalPlaces,
          LTRIM(RTRIM(CONVERT(nvarchar(max), ISNULL(h.[remark], N'')))) AS remark,
          ${calcStatusExpr} AS calcStatus
        FROM ${HEADER_FROM} AS h
        WHERE h.[id] = @id
      `)
      const header = hr.recordset?.[0] ?? null
      if (!header) {
        res.status(404).json({ code: 404, msg: '记录不存在', data: null })
        return
      }

      const piNo = String(header.piNo ?? '').trim()
      const lr = await pool.request().input('piNo', sql.NVarChar(200), piNo).query(`
        SELECT
          l.[id],
          l.[seq],
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
        WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[xsak01], N'')))) = @piNo
        ORDER BY ISNULL(l.[seq], l.[id]) ASC
      `)

      const lineRows = (lr.recordset ?? []).map((row) => serializeRow(row))
      const [excludePrefixes, usageMap] = await Promise.all([
        fetchBomCodeExcludePrefixes(pool),
        fetchSalesOrderPiCostUsageByPq(
          pool,
          piNo,
          lineRows.map((row) => row.kcaa01),
        ),
      ])
      const headerRow = serializeRow(header)
      const piCostPqSet = new Set([...usageMap.keys()].map((pq) => normKcaa01(pq)))
      headerRow.hasSpareParts = orderLinesHaveSpareParts(lineRows, excludePrefixes)
      headerRow.isPureSpareOrder = orderLinesIsPureSpare(lineRows, excludePrefixes)
      headerRow.canAddSpareUsage = resolveCanAddSpareUsage(lineRows, excludePrefixes, piCostPqSet)
      const lines = lineRows.map((line) => {
        const usage = usageMap.get(text(line.kcaa01)) ?? {}
        line.piCostRowCount = Number(usage.rowCount ?? 0)
        line.piCostKcac04Total = Number(usage.totalKcac04 ?? 0)
        line.piCostKcac06Total = Number(usage.totalKcac06 ?? 0)
        line.usageCostText = formatSalesOrderLineUsageCostText(line)
        return line
      })

      res.json({
        code: 200,
        msg: 'success',
        data: {
          header: headerRow,
          lines,
        },
      })
    } catch (err) {
      console.error('GET /api/sales-order/:id 失败：', err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '数据库查询失败')
      res.status(500).json({ code: 500, msg: `读取销售订单详情失败：${detail}`, data: null })
    }
  })

  /**
   * POST /api/sales-order
   * body: { header: { piNo, poNo?, salesDate, deliveryDate?, customerCode, currencyCode, remark?, decimalPlaces? }, lines: [] }
   */
  app.post('/api/sales-order', async (req, res) => {
    try {
      const pool = await getPool()
      const actor = await getSalesOrderActor(pool, req)
      const ip = getClientIpFromReq(req)
      const result = await createSalesOrder({
        pool,
        body: req.body ?? {},
        actor,
        ip,
      })
      if (!result.ok) {
        res.status(result.status ?? 400).json({ code: result.status ?? 400, msg: result.msg, data: null })
        return
      }
      res.json({ code: 200, msg: '保存成功', data: { id: result.id } })
    } catch (err) {
      console.error('POST /api/sales-order 失败：', err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '保存失败')
      res.status(500).json({ code: 500, msg: `新增销售订单失败：${detail}`, data: null })
    }
  })

  /**
   * POST /api/sales-order/:id/calculate
   * body: { syncedKcaa01?: string[] }
   */
  app.post('/api/sales-order/:id/calculate', async (req, res) => {
    try {
      const parsed = parseSalesOrderId(req.params.id)
      if (!parsed.ok) {
        res.status(400).json({ code: 400, msg: parsed.msg, data: null })
        return
      }
      const pool = await getPool()
      const actor = await getSalesOrderActor(pool, req)
      const ip = getClientIpFromReq(req)
      const result = await calculateSalesOrderMaterialBill({
        pool,
        id: parsed.id,
        body: req.body ?? {},
        actor,
        ip,
      })
      if (!result.ok) {
        res.status(result.status ?? 400).json({ code: result.status ?? 400, msg: result.msg, data: null })
        return
      }
      res.json({
        code: 200,
        msg: '运算成功',
        data: {
          id: parsed.id,
          piNo: result.piNo,
          mode: result.mode,
          productCount: result.productCount,
          calcStatus: result.calcStatus,
        },
      })
    } catch (err) {
      console.error('POST /api/sales-order/:id/calculate 失败：', err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '运算失败')
      res.status(500).json({ code: 500, msg: `一键运算失败：${detail}`, data: null })
    }
  })

  /**
   * POST /api/sales-order/:id/add-spare-usage
   * 增加散件单用量：仅写 UB_ERP_Bom_pi_cost（不写 pi_consumption）
   */
  app.post('/api/sales-order/:id/add-spare-usage', async (req, res) => {
    try {
      const parsed = parseSalesOrderId(req.params.id)
      if (!parsed.ok) {
        res.status(400).json({ code: 400, msg: parsed.msg, data: null })
        return
      }
      const pool = await getPool()
      const actor = await getSalesOrderActor(pool, req)
      const ip = getClientIpFromReq(req)
      const result = await addSalesOrderSpareUsage({
        pool,
        id: parsed.id,
        actor,
        ip,
      })
      if (!result.ok) {
        res.status(result.status ?? 400).json({ code: result.status ?? 400, msg: result.msg, data: null })
        return
      }
      res.json({
        code: 200,
        msg: '散件单用量已增加',
        data: {
          id: parsed.id,
          piNo: result.piNo,
          spareCount: result.spareCount,
          rowCount: result.rowCount,
          calcStatus: result.calcStatus,
        },
      })
    } catch (err) {
      console.error('POST /api/sales-order/:id/add-spare-usage 失败：', err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '增加散件单用量失败')
      res.status(500).json({ code: 500, msg: `增加散件单用量失败：${detail}`, data: null })
    }
  })

  /**
   * GET /api/sales-order/:id/material-bill
   */
  app.get('/api/sales-order/:id/material-bill', async (req, res) => {
    try {
      const parsed = parseSalesOrderId(req.params.id)
      if (!parsed.ok) {
        res.status(400).json({ code: 400, msg: parsed.msg, data: null })
        return
      }
      const pool = await getPool()
      const result = await fetchSalesOrderMaterialBill(pool, parsed.id)
      if (!result.ok) {
        res.status(result.status ?? 400).json({
          code: result.status ?? 400,
          msg: result.msg,
          data: result.calcStatus != null ? { calcStatus: result.calcStatus } : null,
        })
        return
      }
      res.json({
        code: 200,
        msg: 'success',
        data: {
          piNo: result.piNo,
          calcStatus: result.calcStatus,
          lines: result.lines,
          materialHeaders: result.materialHeaders,
          costLines: result.costLines,
          consumptionLines: result.consumptionLines,
        },
      })
    } catch (err) {
      console.error('GET /api/sales-order/:id/material-bill 失败：', err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '查询失败')
      res.status(500).json({ code: 500, msg: `读取物料单失败：${detail}`, data: null })
    }
  })

  /**
   * GET /api/production/material-sheet/outsourcing-list
   * 物料单「外协清单」报表：按日期/PI/PO 查销售订单，展开 kcaa13=1 外协材料。
   */
  app.get('/api/production/material-sheet/outsourcing-list', async (req, res) => {
    try {
      const pool = await getPool()
      const result = await fetchOutsourcingMaterialList(pool, {
        startDate: req.query?.startDate,
        endDate: req.query?.endDate,
        piNo: req.query?.piNo,
        poNo: req.query?.poNo,
      })
      if (!result.ok) {
        res.status(result.status ?? 400).json({
          code: result.status ?? 400,
          msg: result.msg,
          data: null,
        })
        return
      }
      res.json({ code: 200, msg: 'success', data: { list: result.list ?? [] } })
    } catch (err) {
      console.error('GET /api/production/material-sheet/outsourcing-list 失败：', err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '查询失败')
      res.status(500).json({ code: 500, msg: `读取外协清单失败：${detail}`, data: null })
    }
  })

  /**
   * GET /api/production/material-sheet/cut-position-list
   * 物料单「位置裁片清单」：PI 成本用量（不限外协）+ 销售 BOM 补充 kcaa13=1。
   */
  app.get('/api/production/material-sheet/cut-position-list', async (req, res) => {
    try {
      const pool = await getPool()
      const result = await fetchCutPositionMaterialList(pool, {
        startDate: req.query?.startDate,
        endDate: req.query?.endDate,
        piNo: req.query?.piNo,
        poNo: req.query?.poNo,
      })
      if (!result.ok) {
        res.status(result.status ?? 400).json({
          code: result.status ?? 400,
          msg: result.msg,
          data: null,
        })
        return
      }
      res.json({ code: 200, msg: 'success', data: { list: result.list ?? [] } })
    } catch (err) {
      console.error('GET /api/production/material-sheet/cut-position-list 失败：', err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '查询失败')
      res.status(500).json({ code: 500, msg: `读取位置裁片清单失败：${detail}`, data: null })
    }
  })

  /**
   * GET /api/sales-order/:id/pi-bom?kcaa01=
   */
  app.get('/api/sales-order/:id/pi-bom', async (req, res) => {
    try {
      const parsed = parseSalesOrderId(req.params.id)
      if (!parsed.ok) {
        res.status(400).json({ code: 400, msg: parsed.msg, data: null })
        return
      }
      const pool = await getPool()
      const result = await fetchSalesOrderPiBom({
        pool,
        id: parsed.id,
        kcaa01: req.query?.kcaa01,
      })
      if (!result.ok) {
        res.status(result.status ?? 400).json({ code: result.status ?? 400, msg: result.msg, data: null })
        return
      }
      res.json({ code: 200, msg: 'success', data: result })
    } catch (err) {
      console.error('GET /api/sales-order/:id/pi-bom 失败：', err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '查询失败')
      res.status(500).json({ code: 500, msg: `读取 PI BOM 失败：${detail}`, data: null })
    }
  })

  /**
   * PUT /api/sales-order/:id/pi-bom
   * body: { kcaa01, lines: [{ id, kcac04, kcac05?, Describe? }] }
   */
  app.put('/api/sales-order/:id/pi-bom', async (req, res) => {
    try {
      const parsed = parseSalesOrderId(req.params.id)
      if (!parsed.ok) {
        res.status(400).json({ code: 400, msg: parsed.msg, data: null })
        return
      }
      const pool = await getPool()
      const actor = await getSalesOrderActor(pool, req)
      const ip = getClientIpFromReq(req)
      const result = await saveSalesOrderPiBom({
        pool,
        id: parsed.id,
        kcaa01: req.body?.kcaa01,
        lines: req.body?.lines,
        actor,
        ip,
      })
      if (!result.ok) {
        res.status(result.status ?? 400).json({ code: result.status ?? 400, msg: result.msg, data: null })
        return
      }
      res.json({
        code: 200,
        msg: '保存 PI BOM 成功',
        data: {
          id: parsed.id,
          piNo: result.piNo,
          kcaa01: result.kcaa01,
          updated: result.updated,
          markUncalc: result.markUncalc,
        },
      })
    } catch (err) {
      console.error('PUT /api/sales-order/:id/pi-bom 失败：', err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '保存失败')
      res.status(500).json({ code: 500, msg: `保存 PI BOM 失败：${detail}`, data: null })
    }
  })

  /**
   * POST /api/sales-order/:id/sync-bom
   * body: { kcaa01 }
   */
  app.post('/api/sales-order/:id/sync-bom', async (req, res) => {
    try {
      const parsed = parseSalesOrderId(req.params.id)
      if (!parsed.ok) {
        res.status(400).json({ code: 400, msg: parsed.msg, data: null })
        return
      }
      const pool = await getPool()
      const actor = await getSalesOrderActor(pool, req)
      const ip = getClientIpFromReq(req)
      const result = await syncSalesOrderBomForLine({
        pool,
        id: parsed.id,
        kcaa01: req.body?.kcaa01,
        actor,
        ip,
      })
      if (!result.ok) {
        res.status(result.status ?? 400).json({ code: result.status ?? 400, msg: result.msg, data: null })
        return
      }
      res.json({
        code: 200,
        msg: '同步 BOM 成功',
        data: { id: parsed.id, piNo: result.piNo, kcaa01: result.kcaa01, markUncalc: true },
      })
    } catch (err) {
      console.error('POST /api/sales-order/:id/sync-bom 失败：', err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '同步失败')
      res.status(500).json({ code: 500, msg: `同步 BOM 失败：${detail}`, data: null })
    }
  })

  /**
   * PUT /api/sales-order/:id
   */
  app.put('/api/sales-order/:id', async (req, res) => {
    try {
      const idRaw = String(req.params.id ?? '').trim()
      const id = Number(idRaw)
      if (!Number.isFinite(id) || id <= 0) {
        res.status(400).json({ code: 400, msg: '参数错误：id', data: null })
        return
      }
      const pool = await getPool()
      const actor = await getSalesOrderActor(pool, req)
      const ip = getClientIpFromReq(req)
      const result = await updateSalesOrder({
        pool,
        id,
        body: req.body ?? {},
        actor,
        ip,
      })
      if (!result.ok) {
        res.status(result.status ?? 400).json({ code: result.status ?? 400, msg: result.msg, data: null })
        return
      }
      res.json({
        code: 200,
        msg: '保存成功',
        data: { id: result.id, markUncalc: Boolean(result.markUncalc) },
      })
    } catch (err) {
      console.error('PUT /api/sales-order/:id 失败：', err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '保存失败')
      res.status(500).json({ code: 500, msg: `保存销售订单失败：${detail}`, data: null })
    }
  })
}
