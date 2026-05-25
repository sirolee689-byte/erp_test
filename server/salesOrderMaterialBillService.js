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
  const lr = await pool.request().input('pi', sql.NVarChar(200), piNo).query(`
    SELECT
      LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL([kcaa01], N'')))) AS kcaa01,
      CAST(ISNULL([xsak03], [plan_quantity]) AS decimal(18, 4)) AS orderQty
    FROM ${LINE_FROM}
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([xsak01], N'')))) = @pi
    ORDER BY ISNULL([seq], [id]) ASC
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
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([Describe], N'')))) AS remark,
      LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL([top_kcaa01], N'')))) AS topKcaa01,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([top_kcaa02], N'')))) AS topKcaa02
    FROM ${PI_COST_FROM}
    WHERE LTRIM(RTRIM(ISNULL([sid], N''))) = @pi
    ORDER BY [pq], [id]
  `)

  const costLines = (costR.recordset ?? []).map((row) => {
    const pq = normKcaa01(row.pq)
    const orderQty = qtyByProduct.get(pq) ?? 0
    const usage = Number(row.kcac04 ?? 0)
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
      remark: String(row.remark ?? ''),
      topKcaa01: String(row.topKcaa01 ?? ''),
      topKcaa02: String(row.topKcaa02 ?? ''),
      orderQty,
      /** 备料用量 = 结构用量 × 该款订货数量（展示用，非落库） */
      prepQty: usage * orderQty,
    }
  })

  const consTableR = await pool
    .request()
    .input('t', sql.NVarChar(200), 'UB_ERP_Bom_pi_consumption')
    .query(`SELECT 1 AS ok FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = @t`)
  const hasConsumptionTable = (consTableR.recordset?.length ?? 0) > 0

  /** @type {{ id?: number, kcaa01: string, kcaa02: string, kcaa03: string, kcaa04: string, sumay: number, sumby: number, kcac05: number, remark: string }[]} */
  let consumptionLines = []
  if (hasConsumptionTable) {
    const consR = await pool.request().input('pi', sql.NVarChar(200), piNo).query(`
      SELECT
        [id],
        LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL([kcaa01], N'')))) AS kcaa01,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([kcaa02], N'')))) AS kcaa02,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([kcaa03], N'')))) AS kcaa03,
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL([kcaa04], N'')))) AS kcaa04,
        CAST(ISNULL([sumay], 0) AS decimal(18, 6)) AS sumay,
        CAST(ISNULL([sumby], 0) AS decimal(18, 6)) AS sumby,
        CAST(ISNULL([kcac05], 0) AS decimal(18, 6)) AS kcac05,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([Describe], N'')))) AS remark
      FROM ${PI_CONSUMPTION_FROM}
      WHERE LTRIM(RTRIM(ISNULL([sid], N''))) = @pi
      ORDER BY [id]
    `)
    consumptionLines = (consR.recordset ?? []).map((row) => ({
      id: row.id,
      kcaa01: String(row.kcaa01 ?? ''),
      kcaa02: String(row.kcaa02 ?? ''),
      kcaa03: String(row.kcaa03 ?? ''),
      kcaa04: String(row.kcaa04 ?? ''),
      sumay: Number(row.sumay ?? 0),
      sumby: Number(row.sumby ?? 0),
      kcac05: Number(row.kcac05 ?? 0),
      remark: String(row.remark ?? ''),
    }))
  } else {
    const merged = aggregateBomConsumptionFromFlat(
      costLines.map((row) => ({
        kcaa01: row.kcaa01,
        kcaa02: row.kcaa02,
        kcaa03: row.kcaa03,
        kcaa04: row.kcaa04,
        Describe: row.remark,
        yl: row.kcac04,
        loss_rate: row.kcac05,
        total_qty: row.kcac06,
      })),
      [],
    )
    consumptionLines = merged.map((row, idx) => ({
      id: idx + 1,
      kcaa01: row.kcaa01,
      kcaa02: row.kcaa02,
      kcaa03: row.kcaa03,
      kcaa04: row.kcaa04,
      sumay: row.sumay,
      sumby: row.sumby,
      kcac05: row.kcac05,
      remark: row.Describe,
    }))
  }

  return {
    ok: true,
    piNo,
    calcStatus,
    lines,
    costLines,
    consumptionLines,
  }
}
