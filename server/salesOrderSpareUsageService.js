/**
 * 销售订单：增加散件单用量 → 仅写 UB_ERP_Bom_pi_cost（不写 pi_consumption）
 */
import sql from 'mssql'
import {
  applyBomCostAuditToRows,
  enrichBomCostInsertRowsFromBom000,
  fetchBom000ForBomCostEnrich,
  formatBomCostAuditTimestamp,
  insertCostBulkEnriched,
} from './bomCostEnrichFromBom000.js'
import { validateCalculateOrderState } from './salesOrderCalculateLogic.js'
import { allOrderLinesHavePiCost } from './salesOrderPiCostCoverage.js'
import {
  buildEmptyPiCostParentTFields,
  formatPiCostTempFromOrderQty,
} from './salesOrderPiCostFields.js'
import { formatSalesOrderAuditTime } from './salesOrderPiBom.js'
import {
  buildSalesOrderCalcStatusExpr,
  pickSalesOrderCalcStatusColumn,
  SALES_ORDER_HEADER_TABLE,
} from './salesOrderListQuery.js'
import { normKcaa01 } from './salesOrderSaveLogic.js'
import {
  fetchBomCodeExcludePrefixes,
  filterSparePartOrderLines,
  filterWholeProductOrderLines,
  orderLinesHaveSpareParts,
  orderLinesIsMixed,
} from './salesOrderSpareParts.js'

const HEADER_FROM = `dbo.[${SALES_ORDER_HEADER_TABLE}]`
const LINE_FROM = 'dbo.[UB_ERP_Sales_order_list]'
const PI_COST_TABLE = 'UB_ERP_Bom_pi_cost'
const PI_COST_FROM = `dbo.[${PI_COST_TABLE}]`

/** @type {Promise<string> | null} */
let CALC_COL_PROMISE = null

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
async function fetchOrderHeaderForSpareUsage(pool, id) {
  const calcCol = await ensureCalcStatusColumn(pool)
  const calcExpr = buildSalesOrderCalcStatusExpr(calcCol)
  const r = await pool.request().input('id', sql.Int, id).query(`
    SELECT TOP 1
      h.[id],
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[xsaj01], N'')))) AS piNo,
      LTRIM(RTRIM(ISNULL(h.[pass], N''))) AS pass,
      LTRIM(RTRIM(ISNULL(h.[del], N''))) AS del,
      LTRIM(RTRIM(ISNULL(h.[${calcCol}], N''))) AS calcFlag,
      ${calcExpr} AS calcStatus
    FROM ${HEADER_FROM} AS h
    WHERE h.[id] = @id
  `)
  return r.recordset?.[0] ?? null
}

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {string} piNo
 */
async function fetchOrderLinesForSpareUsage(pool, piNo) {
  const pi = normKcaa01(piNo)
  const r = await pool.request().input('pi', sql.NVarChar(200), pi).query(`
    SELECT
      LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL([kcaa01], N'')))) AS kcaa01,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([kcaa02], N'')))) AS materialName,
      CAST(ISNULL([xsak03], [plan_quantity]) AS decimal(18, 4)) AS orderQty
    FROM ${LINE_FROM}
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([xsak01], N'')))) = @pi
  `)
  return (r.recordset ?? [])
    .map((row) => ({
      kcaa01: normKcaa01(row.kcaa01),
      materialName: String(row.materialName ?? '').trim(),
      orderQty: Number(row.orderQty ?? 0),
    }))
    .filter((row) => row.kcaa01)
}

/**
 * @param {import('mssql').Transaction} tx
 * @param {string} piNo
 * @param {string[]} products
 */
async function deletePiCostForProducts(tx, piNo, products) {
  const pi = normKcaa01(piNo)
  const codes = [...new Set((products ?? []).map(normKcaa01).filter(Boolean))]
  if (!codes.length) return
  for (let i = 0; i < codes.length; i += 40) {
    const batch = codes.slice(i, i + 40)
    const del = new sql.Request(tx)
    del.input('pi', sql.NVarChar(200), pi)
    const or = []
    for (let j = 0; j < batch.length; j++) {
      const p = `pq${i}_${j}`
      del.input(p, sql.NVarChar(300), batch[j])
      or.push(`LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL([pq], N'')))) = @${p}`)
    }
    await del.query(`
      DELETE FROM ${PI_COST_FROM}
      WHERE LTRIM(RTRIM(ISNULL([sid], N''))) = @pi
        AND (${or.join(' OR ')})
    `)
  }
}

/**
 * @param {string} code
 * @param {string} name
 * @param {number} orderQty
 */
function buildSpareSelfUsageBaseRow(code, name, orderQty) {
  const kcaa01 = normKcaa01(code)
  const kcaa02 = String(name ?? '').trim()
  return {
    kcaa01,
    kcaa02,
    top_kcaa01: kcaa01,
    top_kcaa02: kcaa02,
    kcaa03: '',
    kcaa04: '',
    Describe: '',
    kcac04: 1,
    kcac05: 0,
    kcac06: 1,
    kcac07: 0,
    kcac08: 1,
    kcaa07: 0,
    kcaa08: 0,
    isok: 1,
    pass: '1',
    t_kcaa01: null,
    t_kcaa02: null,
    ...buildEmptyPiCostParentTFields(),
    temp: formatPiCostTempFromOrderQty(orderQty),
  }
}

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {{ kcaa01: string, materialName: string, orderQty: number }[]} spareLines
 * @param {{ uidInt: number | null, uname: string | null, utruename: string | null }} actor
 */
async function buildSparePartPiCostRows(pool, spareLines, actor) {
  const baseRows = spareLines.map((line) =>
    buildSpareSelfUsageBaseRow(line.kcaa01, line.materialName, line.orderQty),
  )
  const bom000Map = await fetchBom000ForBomCostEnrich(
    pool,
    baseRows.map((row) => row.kcaa01),
  )
  const enriched = enrichBomCostInsertRowsFromBom000(baseRows, bom000Map)
  return applyBomCostAuditToRows(enriched, {
    actor,
    addtime: formatBomCostAuditTimestamp(),
  })
}

/**
 * @param {{
 *   pool: import('mssql').ConnectionPool,
 *   id: number,
 *   actor: { uidInt: number | null, uname: string | null, utruename: string | null },
 *   ip: string,
 * }} opts
 */
export async function addSalesOrderSpareUsage(opts) {
  const { pool, id, actor, ip } = opts
  const header = await fetchOrderHeaderForSpareUsage(pool, id)
  const stateErr = validateCalculateOrderState(header)
  if (stateErr) return { ok: false, status: stateErr === '记录不存在' ? 404 : 400, msg: stateErr }

  const piNo = normKcaa01(header.piNo)
  const orderLines = await fetchOrderLinesForSpareUsage(pool, piNo)
  if (!orderLines.length) return { ok: false, status: 400, msg: '订单无明细，无法增加散件单用量' }

  const excludePrefixes = await fetchBomCodeExcludePrefixes(pool)
  if (!orderLinesHaveSpareParts(orderLines, excludePrefixes)) {
    return { ok: false, status: 400, msg: '当前订单不含散件明细，无需增加散件单用量' }
  }

  if (orderLinesIsMixed(orderLines, excludePrefixes)) {
    const wholeCodes = filterWholeProductOrderLines(orderLines, excludePrefixes).map((line) => line.kcaa01)
    const wholeCovered = await allOrderLinesHavePiCost(pool, piNo, wholeCodes)
    if (!wholeCovered) {
      return { ok: false, status: 400, msg: '混单须先一键运算整款，再增加散件单用量' }
    }
  }

  const spareLines = filterSparePartOrderLines(orderLines, excludePrefixes)
  const spareCodes = spareLines.map((line) => line.kcaa01)
  const lineCodes = orderLines.map((line) => line.kcaa01)
  const rows = await buildSparePartPiCostRows(pool, spareLines, actor)

  const calcCol = await ensureCalcStatusColumn(pool)
  const tx = new sql.Transaction(pool)
  await tx.begin()
  try {
    await deletePiCostForProducts(tx, piNo, spareCodes)
    for (const line of spareLines) {
      const productRows = rows.filter((row) => normKcaa01(row.kcaa01) === line.kcaa01)
      if (productRows.length) {
        await insertCostBulkEnriched(pool, tx, PI_COST_TABLE, line.kcaa01, piNo, productRows)
      }
    }

    const now = formatSalesOrderAuditTime()
    const up = new sql.Request(tx)
    up.input('id', sql.Int, id)
    up.input('uname', sql.NVarChar(100), String(actor.uname ?? ''))
    up.input('utruename', sql.NVarChar(100), String(actor.utruename ?? ''))
    up.input('uid', sql.NVarChar(50), actor.uidInt != null ? String(actor.uidInt) : '')
    up.input('edittime', sql.NVarChar(50), now)
    up.input('ip', sql.NVarChar(100), ip)
    await up.query(`
      UPDATE ${HEADER_FROM}
      SET [uname] = @uname,
          [utruename] = @utruename,
          [uid] = @uid,
          [edittime] = @edittime,
          [ip] = @ip
      WHERE [id] = @id
    `)

    await tx.commit()

    const allCovered = await allOrderLinesHavePiCost(pool, piNo, lineCodes)
    if (allCovered) {
      const mark = pool.request()
      mark.input('id', sql.Int, id)
      mark.input('calcVal', sql.NVarChar(10), '1')
      await mark.query(`
        UPDATE ${HEADER_FROM}
        SET [${calcCol}] = @calcVal
        WHERE [id] = @id
      `)
    }

    return {
      ok: true,
      piNo,
      spareCount: spareLines.length,
      rowCount: rows.length,
      calcStatus: allCovered ? '已运算' : String(header.calcStatus ?? '未运算'),
    }
  } catch (err) {
    try {
      await tx.rollback()
    } catch {
      // ignore
    }
    throw err
  }
}
