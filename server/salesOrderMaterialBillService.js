/**
 * 销售订单物料单查询（issue 05）
 */
import sql from 'mssql'
import { aggregateBomConsumptionFromFlat } from './bomUsageFlatten.js'
import { normKcaa01 } from './salesOrderSaveLogic.js'
import {
  buildSalesOrderCalcStatusExpr,
  pickSalesOrderCalcStatusColumn,
  SALES_ORDER_HEADER_TABLE,
} from './salesOrderListQuery.js'

const HEADER_FROM = `dbo.[${SALES_ORDER_HEADER_TABLE}]`
const LINE_FROM = 'dbo.[UB_ERP_Sales_order_list]'
const PI_COST_FROM = 'dbo.[UB_ERP_Bom_pi_cost]'
const PI_CONSUMPTION_FROM = 'dbo.[UB_ERP_Bom_pi_consumption]'

/** @type {Promise<string> | null} */
let CALC_COL_PROMISE = null

/**
 * @param {import('mssql').ConnectionPool} pool
 */
async function ensureCalcStatusColumn(pool) {
  if (!CALC_COL_PROMISE) {
    CALC_COL_PROMISE = pool
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
  return CALC_COL_PROMISE
}

function materialBillPxSortValue(row) {
  const raw = row?.px
  if (raw == null || raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

/**
 * 物料单汇总展示：各款单品用量 × 该款订单量后，再按子件编码 + 搭配合并
 * @param {{ kcac04: number, kcac05: number, kcac06: number, orderQty: number, kcaa01: string, kcaa02: string, kcaa03: string, kcaa04: string, Describe: string }[]} costLines
 */
export function buildMaterialBillConsumptionLinesFromCost(costLines) {
  const list = Array.isArray(costLines) ? costLines : []
  const merged = aggregateBomConsumptionFromFlat(
    list.map((row) => {
      const orderQty = Number(row.orderQty ?? 0)
      const usage = Number(row.kcac04 ?? 0)
      const totalQty = Number(row.kcac06 ?? 0)
      const scaledUsage = Number.isFinite(orderQty) ? usage * orderQty : 0
      const scaledTotal = Number.isFinite(orderQty) ? totalQty * orderQty : 0
      return {
        kcaa01: row.kcaa01,
        kcaa02: row.kcaa02,
        kcaa03: row.kcaa03,
        kcaa04: row.kcaa04,
        Describe: row.Describe,
        yl: scaledUsage,
        loss_rate: Number(row.kcac05 ?? 0),
        total_qty: scaledTotal,
      }
    }),
    [],
  )
  return merged.map((row, idx) => ({
    id: idx + 1,
    kcaa01: row.kcaa01,
    kcaa02: row.kcaa02,
    kcaa03: row.kcaa03,
    kcaa04: row.kcaa04,
    sumay: row.sumay,
    sumby: row.sumby,
    kcac05: row.kcac05,
    Describe: row.Describe,
  }))
}

export function buildMaterialBillCostLines(recordset, qtyByProduct = new Map()) {
  const rows = Array.isArray(recordset) ? [...recordset] : []
  rows.sort((a, b) => {
    const pqA = normKcaa01(a?.pq)
    const pqB = normKcaa01(b?.pq)
    if (pqA !== pqB) return pqA.localeCompare(pqB, 'zh-Hans-CN', { sensitivity: 'accent' })
    const pxA = materialBillPxSortValue(a)
    const pxB = materialBillPxSortValue(b)
    if (pxA != null || pxB != null) {
      if (pxA == null) return 1
      if (pxB == null) return -1
      if (pxA !== pxB) return pxA - pxB
    }
    return Number(a?.id ?? 0) - Number(b?.id ?? 0)
  })
  return rows.map((row) => {
    const pq = normKcaa01(row.pq)
    const orderQty = qtyByProduct.get(pq) ?? 0
    const usage = Number(row.kcac04 ?? 0)
    const px = materialBillPxSortValue(row)
    return {
      id: row.id,
      pq,
      kcaa01: String(row.kcaa01 ?? ''),
      kcaa02: String(row.kcaa02 ?? ''),
      kcaa03: String(row.kcaa03 ?? ''),
      kcaa04: String(row.kcaa04 ?? ''),
      kcac04: usage,
      kcac05: Number(row.kcac05 ?? 0),
      kcac06: Number(row.kcac06 ?? 0),
      px,
      Describe: String(row.Describe ?? ''),
      topKcaa01: String(row.topKcaa01 ?? ''),
      topKcaa02: String(row.topKcaa02 ?? ''),
      orderQty,
      prepQty: usage * orderQty,
    }
  })
}

export function buildMaterialBillSingleUsageByProduct(costLines) {
  const map = new Map()
  const list = Array.isArray(costLines) ? costLines : []
  for (const row of list) {
    const pq = normKcaa01(row?.pq)
    if (!pq) continue
    const qty = Number(row?.kcac06 ?? 0)
    const next = (map.get(pq) ?? 0) + (Number.isFinite(qty) ? qty : 0)
    map.set(pq, Math.round(next * 1000000) / 1000000)
  }
  return map
}

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {number} id
 */
export async function fetchSalesOrderMaterialBill(pool, id) {
  const calcCol = await ensureCalcStatusColumn(pool)
  const calcExpr = buildSalesOrderCalcStatusExpr(calcCol)
  const hr = await pool.request().input('id', sql.Int, id).query(`
    SELECT TOP 1
      h.[id],
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[xsaj01], N'')))) AS piNo,
      ${calcExpr} AS calcStatus
    FROM ${HEADER_FROM} AS h
    WHERE h.[id] = @id
  `)
  const header = hr.recordset?.[0] ?? null
  if (!header) return { ok: false, status: 404, msg: '记录不存在' }

  const calcStatus = String(header.calcStatus ?? '')
  if (calcStatus !== '已运算') {
    return {
      ok: false,
      status: 409,
      msg: '订单未运算，暂无有效物料单；请先执行一键运算',
      calcStatus,
    }
  }

  const piNo = normKcaa01(header.piNo)
  const lr = await pool.request().input('id', sql.Int, id).input('pi', sql.NVarChar(200), piNo).query(`
    SELECT
      l.[id],
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[xsak01], N'')))) AS linePiNo,
      LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa01], N'')))) AS kcaa01,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[xsaj06], N'')))) AS poNo,
      h.[xsaj02] AS salesDate,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa09], N'')))) AS factoryStyleNo,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa02], N'')))) AS productName,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa06], N'')))) AS customerStyleNo,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa10], N'')))) AS groupName,
      CAST(ISNULL(l.[xsak03], l.[plan_quantity]) AS decimal(18, 4)) AS orderQty
    FROM ${LINE_FROM} AS l
    INNER JOIN ${HEADER_FROM} AS h
      ON LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[xsaj01], N'')))) =
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[xsak01], N''))))
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[xsak01], N'')))) = @pi
      AND h.[id] = @id
    ORDER BY ISNULL(l.[seq], l.[id]) ASC
  `)
  const lines = (lr.recordset ?? []).map((row) => ({
    kcaa01: normKcaa01(row.kcaa01),
    orderQty: Number(row.orderQty ?? 0),
  }))
  const qtyByProduct = new Map(lines.map((l) => [l.kcaa01, l.orderQty]))
  const costR = await pool.request().input('pi', sql.NVarChar(200), piNo).query(`
    SELECT
      [id],
      LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL([pq], N'')))) AS pq,
      LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL([kcaa01], N'')))) AS kcaa01,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([kcaa02], N'')))) AS kcaa02,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([kcaa03], N'')))) AS kcaa03,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL([kcaa04], N'')))) AS kcaa04,
      CAST(ISNULL([kcac04], 0) AS decimal(18, 6)) AS kcac04,
      CAST(ISNULL([kcac05], 0) AS decimal(18, 6)) AS kcac05,
      CAST(ISNULL([kcac06], 0) AS decimal(18, 6)) AS kcac06,
      CASE
        WHEN [px] IS NULL THEN NULL
        WHEN ISNUMERIC(LTRIM(RTRIM(CONVERT(nvarchar(100), [px])))) = 1
          THEN CONVERT(int, LTRIM(RTRIM(CONVERT(nvarchar(100), [px]))))
        ELSE NULL
      END AS px,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([Describe], N'')))) AS Describe,
      LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL([top_kcaa01], N'')))) AS topKcaa01,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([top_kcaa02], N'')))) AS topKcaa02
    FROM ${PI_COST_FROM}
    WHERE LTRIM(RTRIM(ISNULL([sid], N''))) = @pi
    ORDER BY
      LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL([pq], N'')))) ASC,
      CASE WHEN [px] IS NULL THEN 1 ELSE 0 END ASC,
      [px] ASC,
      [id] ASC
  `)

  const costLines = buildMaterialBillCostLines(costR.recordset ?? [], qtyByProduct)
  const singleUsageByProduct = buildMaterialBillSingleUsageByProduct(costLines)
  const materialHeaders = (lr.recordset ?? []).map((row) => {
    const productCode = normKcaa01(row.kcaa01)
    return {
      key: productCode,
      productCode,
      piNo: String(row.linePiNo ?? '').trim(),
      poNo: String(row.poNo ?? '').trim(),
      salesDate: row.salesDate ?? null,
      factoryStyleNo: String(row.factoryStyleNo ?? '').trim(),
      productName: String(row.productName ?? '').trim(),
      singleUsage: singleUsageByProduct.get(productCode) ?? 0,
      customerStyleNo: String(row.customerStyleNo ?? '').trim(),
      groupName: String(row.groupName ?? '').trim(),
      orderQty: Number(row.orderQty ?? 0),
    }
  })

  // 汇总展示：库内 pi_consumption 为单品合并口径；接口按各款订单量缩放后重聚合
  const consumptionLines = buildMaterialBillConsumptionLinesFromCost(costLines)

  return {
    ok: true,
    piNo,
    calcStatus,
    lines,
    materialHeaders,
    costLines,
    consumptionLines,
  }
}
