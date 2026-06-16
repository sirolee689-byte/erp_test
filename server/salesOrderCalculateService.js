/**
 * 销售订单一键运算物料单（issue 05）
 */
import sql from 'mssql'
import { getDefaultBomCostHidePrefixes } from './bomCostHidePrefixes.js'
import { buildBomCostInsertPayloadFromFlatUsage } from './bomUsageYl.js'
import {
  applyBomCostPxForRows,
  applyBomCostAuditToRows,
  enrichBomCostInsertRowsFromBom000,
  fetchBomMaterialPxByCategoryCodes,
  fetchBom000ForBomCostEnrich,
  formatBomCostAuditTimestamp,
  insertCostBulkEnriched,
} from './bomCostEnrichFromBom000.js'
import {
  aggregateBomConsumptionFromFlat,
  flattenBomPartsCostUsageFlatForBomCost,
} from './bomUsageFlatten.js'
import { normKcaa01 } from './salesOrderSaveLogic.js'
import { formatSalesOrderAuditTime } from './salesOrderPiBom.js'
import {
  fetchTopLevelFinishedBomCodeFlag5Prefixes,
} from './salesOrderPiBom.js'
import {
  applyPiCostExtendedFieldsToRows,
  applyPiCostKcaa13FromSalesList,
  collectPiCostHierarchyMetaFromTree,
  collectPiCostKcaa13BySourceIdFromTree,
} from './salesOrderPiCostFields.js'
import { buildPiBomUsageTreeForProduct } from './salesOrderPiBomUsageTree.js'
import {
  parseSyncedKcaa01List,
  resolveMaterialBillCalculateScope,
  validateCalculateOrderState,
} from './salesOrderCalculateLogic.js'
import { allOrderLinesHavePiCost } from './salesOrderPiCostCoverage.js'
import {
  fetchBomCodeExcludePrefixes,
  filterWholeProductOrderLines,
  orderLinesIsPureSpare,
} from './salesOrderSpareParts.js'
import {
  buildSalesOrderCalcStatusExpr,
  pickSalesOrderCalcStatusColumn,
  SALES_ORDER_HEADER_TABLE,
} from './salesOrderListQuery.js'

const HEADER_FROM = `dbo.[${SALES_ORDER_HEADER_TABLE}]`
const LINE_FROM = 'dbo.[UB_ERP_Sales_order_list]'
const PI_COST_TABLE = 'UB_ERP_Bom_pi_cost'
const PI_COST_FROM = `dbo.[${PI_COST_TABLE}]`
const PI_CONSUMPTION_TABLE = 'UB_ERP_Bom_pi_consumption'
const PI_CONSUMPTION_FROM = `dbo.[${PI_CONSUMPTION_TABLE}]`

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
 */
async function piConsumptionTableExists(pool) {
  const r = await pool.request().input('t', sql.NVarChar(200), PI_CONSUMPTION_TABLE).query(`
    SELECT 1 AS ok FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = @t
  `)
  return (r.recordset?.length ?? 0) > 0
}

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {number} id
 */
async function fetchOrderHeaderForCalculate(pool, id) {
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
async function fetchOrderLinesForCalculate(pool, piNo) {
  const pi = normKcaa01(piNo)
  const r = await pool.request().input('pi', sql.NVarChar(200), pi).query(`
    SELECT
      LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL([kcaa01], N'')))) AS kcaa01,
      CAST(ISNULL([xsak03], [plan_quantity]) AS decimal(18, 4)) AS orderQty
    FROM ${LINE_FROM}
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([xsak01], N'')))) = @pi
  `)
  return (r.recordset ?? [])
    .map((row) => ({
      kcaa01: normKcaa01(row.kcaa01),
      orderQty: Number(row.orderQty ?? 0),
    }))
    .filter((row) => row.kcaa01)
}

/**
 * @param {import('mssql').Transaction} tx
 * @param {string} piNo
 * @param {string[]} products 空=删整单 pi_cost
 */
async function deletePiCostForProducts(tx, piNo, products) {
  const pi = normKcaa01(piNo)
  const req = new sql.Request(tx)
  req.input('pi', sql.NVarChar(200), pi)
  if (!products?.length) {
    await req.query(`DELETE FROM ${PI_COST_FROM} WHERE LTRIM(RTRIM(ISNULL([sid], N''))) = @pi`)
    return
  }
  const codes = [...new Set(products.map(normKcaa01).filter(Boolean))]
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
 * @param {import('mssql').Transaction} tx
 * @param {string} piNo
 */
async function deletePiConsumptionForOrder(tx, piNo) {
  const pi = normKcaa01(piNo)
  const req = new sql.Request(tx)
  req.input('pi', sql.NVarChar(200), pi)
  await req.query(`DELETE FROM ${PI_CONSUMPTION_FROM} WHERE LTRIM(RTRIM(ISNULL([sid], N''))) = @pi`)
}

/**
 * @param {import('mssql').Transaction} tx
 * @param {string} piNo
 * @param {{ kcaa01: string, kcaa02: string, kcaa03: string, kcaa04: string, sumay: number, sumby: number, kcac05: number }[]} rows
 */
async function insertPiConsumptionBulk(tx, piNo, rows) {
  if (!rows.length) return
  const sidV = normKcaa01(piNo)
  const DEC = sql.Decimal(28, 10)
  const NV300 = sql.NVarChar(300)
  const NV80 = sql.NVarChar(80)
  const ROW_PARAMS = 8
  const maxRowsPerChunk = Math.min(100, Math.floor((2000 - 1) / ROW_PARAMS))

  for (let off = 0; off < rows.length; off += maxRowsPerChunk) {
    const slice = rows.slice(off, off + maxRowsPerChunk)
    const req = new sql.Request(tx)
    req.input('sid', sql.NVarChar(200), sidV)
    const valueTuples = []
    for (let i = 0; i < slice.length; i++) {
      const row = slice[i]
      const pre = `pc${off}_${i}_`
      req.input(`${pre}k1`, NV300, String(row.kcaa01 ?? '').trim())
      req.input(`${pre}k2`, NV300, String(row.kcaa02 ?? '').trim() || null)
      req.input(`${pre}k3`, NV300, String(row.kcaa03 ?? '').trim() || null)
      req.input(`${pre}k4`, NV80, String(row.kcaa04 ?? '').trim() || null)
      req.input(`${pre}sa`, DEC, Number(row.sumay ?? 0))
      req.input(`${pre}sb`, DEC, Number(row.sumby ?? 0))
      req.input(`${pre}lr`, DEC, Number(row.kcac05 ?? 0))
      valueTuples.push(
        `(@sid, @${pre}k1, @${pre}k2, @${pre}k3, @${pre}k4, @${pre}sa, @${pre}sb, @${pre}lr)`,
      )
    }
    await req.query(`
      INSERT INTO ${PI_CONSUMPTION_FROM} (sid, kcaa01, kcaa02, kcaa03, kcaa04, sumay, sumby, kcac05)
      VALUES ${valueTuples.join(',\n')}
    `)
  }
}

/**
 * 从当前 pi_cost 全量重建 consumption（部分重算后须整单汇总）
 * @param {import('mssql').ConnectionPool} pool
 * @param {import('mssql').Transaction} tx
 * @param {string} piNo
 */
async function rebuildPiConsumptionFromAllCost(pool, tx, piNo) {
  const pi = normKcaa01(piNo)
  const r = await pool.request().input('pi', sql.NVarChar(200), pi).query(`
    SELECT
      LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL([kcaa01], N'')))) AS kcaa01,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([kcaa02], N'')))) AS kcaa02,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([kcaa03], N'')))) AS kcaa03,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL([kcaa04], N'')))) AS kcaa04,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([Describe], N'')))) AS Describe,
      CAST(ISNULL([kcac04], 0) AS decimal(18, 6)) AS yl,
      CAST(ISNULL([kcac05], 0) AS decimal(18, 6)) AS loss_rate,
      CAST(ISNULL([kcac06], 0) AS decimal(18, 6)) AS total_qty
    FROM ${PI_COST_FROM}
    WHERE LTRIM(RTRIM(ISNULL([sid], N''))) = @pi
  `)
  const flat = (r.recordset ?? []).map((row) => ({
    kcaa01: row.kcaa01,
    kcaa02: row.kcaa02,
    kcaa03: row.kcaa03,
    kcaa04: row.kcaa04,
    Describe: row.Describe,
    yl: Number(row.yl ?? 0),
    loss_rate: Number(row.loss_rate ?? 0),
    total_qty: Number(row.total_qty ?? 0),
  }))
  const merged = aggregateBomConsumptionFromFlat(flat, [])
  await insertPiConsumptionBulk(tx, pi, merged)
}

/**
 * 平铺用量 → UB_ERP_Bom_cost / pi_cost 落库 payload（与 POST /api/bom/usage-calc 一致，平铺不合并）
 * @param {any[]} flatForCost flattenBomPartsCostUsageFlatForBomCost 结果
 * @param {string} productKcaa01 成品 pq，用于跳过树根行
 */
export function buildPiCostInsertPayloadFromFlatUsage(flatForCost, productKcaa01) {
  return buildBomCostInsertPayloadFromFlatUsage(
    flatForCost,
    getDefaultBomCostHidePrefixes(),
    productKcaa01,
  )
}

/**
 * 单款用量树 → UB_ERP_Bom_cost / pi_cost 落库 payload
 * @param {any[]} tree
 * @param {string} productKcaa01
 */
export function buildPiCostInsertPayloadFromUsageTree(tree, productKcaa01) {
  const flat = flattenBomPartsCostUsageFlatForBomCost(tree, null, [])
  return buildPiCostInsertPayloadFromFlatUsage(flat, productKcaa01)
}

/**
 * 单款 PI BOM 树 → pi_cost 行
 * @param {import('mssql').ConnectionPool} pool
 * @param {any[]} tree
 * @param {string} productKcaa01
 * @param {{ uidInt: number | null, uname: string | null, utruename: string | null }} actor
 */
async function buildPiCostRowsFromTree(pool, tree, productKcaa01, actor, orderQty) {
  const flatForPiCost = flattenBomPartsCostUsageFlatForBomCost(tree, null, [])
  const topLevelPrefixes = await fetchTopLevelFinishedBomCodeFlag5Prefixes(pool)
  const hierarchyMeta = collectPiCostHierarchyMetaFromTree(tree, topLevelPrefixes)
  const payload = buildPiCostInsertPayloadFromFlatUsage(flatForPiCost, productKcaa01)
  const bom000Map = await fetchBom000ForBomCostEnrich(
    pool,
    payload.map((r) => r.kcaa01),
  )
  const enriched = enrichBomCostInsertRowsFromBom000(payload, bom000Map)
  const kcaa13BySourceId = collectPiCostKcaa13BySourceIdFromTree(tree)
  const enrichedWithListKcaa13 = applyPiCostKcaa13FromSalesList(enriched, kcaa13BySourceId)
  const bomMaterialPxMap = await fetchBomMaterialPxByCategoryCodes(
    pool,
    enrichedWithListKcaa13.map((r) => r.kcaa05),
  )
  const rowsWithPx = applyBomCostPxForRows(enrichedWithListKcaa13, bomMaterialPxMap)
  const rowsWithAudit = applyBomCostAuditToRows(rowsWithPx, {
    actor,
    addtime: formatBomCostAuditTimestamp(),
  })
  return {
    rows: applyPiCostExtendedFieldsToRows(rowsWithAudit, hierarchyMeta, orderQty),
    flat: flatForPiCost,
  }
}

/**
 * @param {{
 *   pool: import('mssql').ConnectionPool,
 *   id: number,
 *   body: Record<string, unknown>,
 *   actor: { uidInt: number | null, uname: string | null, utruename: string | null },
 *   ip: string,
 * }} opts
 */
export async function calculateSalesOrderMaterialBill(opts) {
  const { pool, id, body, actor, ip } = opts
  const syncedParsed = parseSyncedKcaa01List(body?.syncedKcaa01)
  if (!syncedParsed.ok) return { ok: false, status: 400, msg: syncedParsed.msg }

  const header = await fetchOrderHeaderForCalculate(pool, id)
  const stateErr = validateCalculateOrderState(header)
  if (stateErr) return { ok: false, status: stateErr === '记录不存在' ? 404 : 400, msg: stateErr }

  const piNo = normKcaa01(header.piNo)
  const orderLines = await fetchOrderLinesForCalculate(pool, piNo)
  const lineCodes = orderLines.map((row) => row.kcaa01)
  const qtyByProduct = new Map(orderLines.map((row) => [row.kcaa01, row.orderQty]))
  const existR = await pool.request().input('pi', sql.NVarChar(200), piNo).query(`
    SELECT TOP 1 1 AS ok FROM ${PI_COST_FROM}
    WHERE LTRIM(RTRIM(ISNULL([sid], N''))) = @pi
  `)
  const hasExistingPiCost = (existR.recordset?.length ?? 0) > 0

  const scope = resolveMaterialBillCalculateScope({
    calcFlag: String(header.calcFlag ?? ''),
    orderLineCodes: lineCodes,
    syncedKcaa01: syncedParsed.list,
    hasExistingPiCost,
  })
  if (!scope.ok) return { ok: false, status: 400, msg: scope.msg }

  const excludePrefixes = await fetchBomCodeExcludePrefixes(pool)
  if (orderLinesIsPureSpare(orderLines, excludePrefixes)) {
    return { ok: false, status: 400, msg: '纯散件单请使用「增加散件单用量」，无需一键运算' }
  }

  const wholeCodeSet = new Set(
    filterWholeProductOrderLines(orderLines, excludePrefixes).map((line) => line.kcaa01),
  )
  scope.products = scope.products.filter((code) => wholeCodeSet.has(normKcaa01(code)))
  if (!scope.products.length) {
    return { ok: false, status: 400, msg: '当前订单无整款明细，无法一键运算' }
  }

  const hasConsumption = await piConsumptionTableExists(pool)
  const calcCol = await ensureCalcStatusColumn(pool)
  const tx = new sql.Transaction(pool)
  await tx.begin()
  try {
    if (scope.mode === 'full') {
      await deletePiCostForProducts(tx, piNo, [])
      if (hasConsumption) await deletePiConsumptionForOrder(tx, piNo)
    } else {
      await deletePiCostForProducts(tx, piNo, scope.products)
    }

    /** @type {Record<string, unknown>[]} */
    const allFlatForConsumption = []
    const hidePrefixes = getDefaultBomCostHidePrefixes()

    for (const product of scope.products) {
      const tree = await buildPiBomUsageTreeForProduct(pool, piNo, product)
      const orderQty = qtyByProduct.get(product) ?? null
      const { rows, flat } = await buildPiCostRowsFromTree(pool, tree, product, actor, orderQty)
      if (!rows.length) {
        const err = new Error(`货品 ${product} 运算结果为空，请检查 PI BOM 或先同步 BOM`)
        err.code = 'PI_COST_EMPTY'
        throw err
      }
      await insertCostBulkEnriched(pool, tx, PI_COST_TABLE, product, piNo, rows)
      for (const f of flat) allFlatForConsumption.push(f)
    }

    if (hasConsumption) {
      await deletePiConsumptionForOrder(tx, piNo)
      if (scope.mode === 'partial') {
        await rebuildPiConsumptionFromAllCost(pool, tx, piNo)
      } else {
        const merged = aggregateBomConsumptionFromFlat(allFlatForConsumption, hidePrefixes)
        await insertPiConsumptionBulk(tx, piNo, merged)
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
    const calcVal = allCovered ? '1' : '0'
    const mark = pool.request()
    mark.input('id', sql.Int, id)
    mark.input('calcVal', sql.NVarChar(10), calcVal)
    await mark.query(`
      UPDATE ${HEADER_FROM}
      SET [${calcCol}] = @calcVal
      WHERE [id] = @id
    `)

    return {
      ok: true,
      piNo,
      mode: scope.mode,
      productCount: scope.products.length,
      calcStatus: allCovered ? '已运算' : '未运算',
    }
  } catch (err) {
    try {
      await tx.rollback()
    } catch {
      // ignore
    }
    if (
      err?.code === 'BOM_CYCLE' ||
      err?.code === 'BOM_DEPTH' ||
      err?.code === 'PI_BOM_MISSING' ||
      err?.code === 'PI_BOM_TREE_EMPTY' ||
      err?.code === 'PI_COST_EMPTY'
    ) {
      return { ok: false, status: 409, msg: String(err.message ?? 'BOM 运算失败') }
    }
    throw err
  }
}
