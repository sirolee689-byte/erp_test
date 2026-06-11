/**
 * 外协订单批量选材（订单外协）：PI 销售 BOM 两层树 + 未外协数量计算
 */
import sql from 'mssql'
import { INV_BOM_CODE_FROM } from './bomTables.js'
import { normKcaa01 } from './salesOrderSaveLogic.js'
import {
  buildSalesOrderCalcStatusExpr,
  pickSalesOrderCalcStatusColumn,
  SALES_ORDER_HEADER_TABLE,
} from './salesOrderListQuery.js'
import { buildMaterialBillCostLines } from './salesOrderMaterialBillService.js'

const SALES_HEADER_FROM = `dbo.[${SALES_ORDER_HEADER_TABLE}]`
const SALES_LINE_FROM = 'dbo.[UB_ERP_Sales_order_list]'
const PI_COST_FROM = 'dbo.[UB_ERP_Bom_pi_cost]'
const PI_BOM_LIST_FROM = 'dbo.[UB_ERP_Bom_Sales_list]'
const ASSIST_LINE_FROM = 'dbo.[UB_ERP_assist_order_list]'
const ASSIST_HEADER_FROM = 'dbo.[UB_ERP_assist_order]'

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
      .query(`
        SELECT c.COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS AS c
        WHERE c.TABLE_NAME = @t
      `)
      .then((r) => pickSalesOrderCalcStatusColumn((r.recordset ?? []).map((row) => row.COLUMN_NAME)))
  }
  return CALC_COL_PROMISE
}

export function buildAssistBatchLineKey(piNo, product, kcaa01) {
  const pi = String(piNo ?? '').trim().toLowerCase()
  const prod = normKcaa01(product).toLowerCase()
  const mat = normKcaa01(kcaa01).toLowerCase()
  return `${pi}|${prod}|${mat}`
}

export function roundQty(value, digits = 2) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  const factor = 10 ** digits
  return Math.round(n * factor) / factor
}

/**
 * @param {{ pq: string, kcaa01: string, kcac06: number, orderQty: number }[]} costLines
 */
export function buildBomQtyMapFromCostLines(costLines) {
  /** @type {Map<string, number>} */
  const map = new Map()
  const list = Array.isArray(costLines) ? costLines : []
  for (const row of list) {
    const product = normKcaa01(row?.pq)
    const material = normKcaa01(row?.kcaa01)
    if (!product || !material) continue
    const key = `${product.toLowerCase()}|${material.toLowerCase()}`
    const piece = Number(row?.kcac06 ?? 0)
    const orderQty = Number(row?.orderQty ?? 0)
    const add = Number.isFinite(piece) && Number.isFinite(orderQty) ? piece * orderQty : 0
    map.set(key, roundQty((map.get(key) ?? 0) + add, 6))
  }
  return map
}

/**
 * 批量选材：同一款+物料只取 pi_cost 第一条 kcac06 × 订单数量（不汇总多行）。
 * @param {{ pq: string, kcaa01: string, kcac06: number, orderQty: number }[]} costLines
 */
/**
 * pi_cost 款|物料 → px（第一条为准，供批量选材排序）。
 * @param {{ pq: string, kcaa01: string, px?: number | null }[]} costLines
 */
export function buildPiCostPxMapFromCostLines(costLines) {
  /** @type {Map<string, number | null>} */
  const map = new Map()
  const list = Array.isArray(costLines) ? costLines : []
  for (const row of list) {
    const product = normKcaa01(row?.pq)
    const material = normKcaa01(row?.kcaa01)
    if (!product || !material) continue
    const key = `${product.toLowerCase()}|${material.toLowerCase()}`
    if (map.has(key)) continue
    map.set(key, parseBatchAddSortPx(row?.px))
  }
  return map
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
export function parseBatchAddSortPx(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export function buildFirstBomQtyMapFromCostLines(costLines) {
  /** @type {Map<string, number>} */
  const map = new Map()
  const list = Array.isArray(costLines) ? costLines : []
  for (const row of list) {
    const product = normKcaa01(row?.pq)
    const material = normKcaa01(row?.kcaa01)
    if (!product || !material) continue
    const key = `${product.toLowerCase()}|${material.toLowerCase()}`
    if (map.has(key)) continue
    const piece = Number(row?.kcac06 ?? 0)
    const orderQty = Number(row?.orderQty ?? 0)
    const qty = Number.isFinite(piece) && Number.isFinite(orderQty) ? piece * orderQty : 0
    map.set(key, roundQty(qty, 6))
  }
  return map
}

/**
 * 同一款式下按 kcaa01 去重（保留 BOM 顺序第一条），并隐藏 kcaa13=0 不可外协行。
 * @param {{ kcaa01?: string, isOutsource?: number }[]} materialRows
 */
/**
 * 旧系统 s_choose_pi_list.asp bomstr：Bom_code.copen=1，OUT 用后缀，其余用 flag5- 前缀。
 * @param {import('mssql').ConnectionPool} pool
 * @returns {Promise<string[]>}
 */
export async function fetchBomCodeAssistBatchPrefixes(pool) {
  const r = await pool.request().query(`
    SELECT
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(bc.[flag5], N'')))) AS flag5
    FROM ${INV_BOM_CODE_FROM} AS bc
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(bc.[copen], N'')))) = N'1'
      AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(bc.[flag5], N'')))) <> N''
    ORDER BY bc.[px] ASC
  `)
  /** @type {string[]} */
  const out = []
  const seen = new Set()
  for (const row of r.recordset ?? []) {
    const f5 = String(row.flag5 ?? '').trim().toUpperCase()
    if (!f5 || seen.has(f5)) continue
    seen.add(f5)
    out.push(f5)
  }
  return out
}

/**
 * @param {unknown} kcaa01
 * @param {unknown} flag5
 */
export function kcaa01MatchesBomCodeAssistBatchPrefix(kcaa01, flag5) {
  const code = String(kcaa01 ?? '').trim().toUpperCase()
  const f5 = String(flag5 ?? '').trim().toUpperCase()
  if (!code || !f5) return false
  if (f5.includes('OUT')) {
    return code.includes(`-${f5}`)
  }
  return code.startsWith(`${f5}-`)
}

/**
 * @param {unknown} kcaa01
 * @param {string[]} prefixes
 */
export function kcaa01MatchesAnyBomCodeAssistBatchPrefix(kcaa01, prefixes) {
  const list = Array.isArray(prefixes) ? prefixes : []
  for (const f5 of list) {
    if (kcaa01MatchesBomCodeAssistBatchPrefix(kcaa01, f5)) return true
  }
  return false
}

/**
 * 编码颜色：命中 Bom_code.flag5 前缀（含 OUT 后缀口径）→ 蓝；否则红。
 * @param {{ kcaa01: string, bomCodePrefixes: string[] }} opts
 * @returns {'pi_cost' | 'sales_list'}
 */
export function resolveBatchAddCodeColor({ kcaa01, bomCodePrefixes }) {
  if (kcaa01MatchesAnyBomCodeAssistBatchPrefix(kcaa01, bomCodePrefixes)) {
    return 'sales_list'
  }
  return 'pi_cost'
}

/**
 * 合并 pkcaa01 子树行与 kcaa03=父款号的半成品行（BOM 顺序：先子树后半成品）。
 * @param {{ kcaa01?: string }[]} pkcaa01Rows
 * @param {{ kcaa01?: string, kcaa03?: string, isOutsource?: number }[]} allBomRows
 * @param {string} product
 * @param {string[]} bomCodePrefixes
 */
export function mergeBatchAddMaterialRows(pkcaa01Rows, allBomRows, product, bomCodePrefixes) {
  /** @type {Set<string>} */
  const seen = new Set()
  const merged = []
  const prod = normKcaa01(product)
  const prefixes = Array.isArray(bomCodePrefixes) ? bomCodePrefixes : []
  for (const row of Array.isArray(pkcaa01Rows) ? pkcaa01Rows : []) {
    const material = normKcaa01(row?.kcaa01)
    if (!material) continue
    if (kcaa01MatchesAnyBomCodeAssistBatchPrefix(material, prefixes)) continue
    const key = material.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(row)
  }
  for (const row of Array.isArray(allBomRows) ? allBomRows : []) {
    if (normKcaa01(row?.kcaa03) !== prod) continue
    if (Number(row?.isOutsource) !== 1) continue
    if (!kcaa01MatchesAnyBomCodeAssistBatchPrefix(row?.kcaa01, bomCodePrefixes)) continue
    const material = normKcaa01(row?.kcaa01)
    if (!material) continue
    const key = material.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(row)
  }
  return merged
}

export function filterBatchAddMaterialRows(materialRows) {
  /** @type {Set<string>} */
  const seen = new Set()
  const result = []
  for (const row of Array.isArray(materialRows) ? materialRows : []) {
    const material = normKcaa01(row?.kcaa01)
    if (!material) continue
    const key = material.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    if (Number(row?.isOutsource) !== 1) continue
    result.push(row)
  }
  return result
}

/** @typedef {'pi_cost_red' | 'sales_list_blue' | 'pi_cost_blue'} BatchAddMaterialPath */

/**
 * 批量选材子行路径（对齐旧 s_choose_pi_list.asp 三段展示）。
 * @param {{ kcaa01?: string, kcaa03?: string }} row
 * @param {string} product
 * @param {string[]} bomCodePrefixes
 * @returns {BatchAddMaterialPath}
 */
export function classifyBatchAddMaterialPath(row, product, bomCodePrefixes) {
  const material = normKcaa01(row?.kcaa01)
  const prefixes = Array.isArray(bomCodePrefixes) ? bomCodePrefixes : []
  if (!kcaa01MatchesAnyBomCodeAssistBatchPrefix(material, prefixes)) {
    return 'pi_cost_red'
  }
  if (normKcaa01(row?.kcaa03) === normKcaa01(product)) {
    return 'sales_list_blue'
  }
  return 'pi_cost_blue'
}

/**
 * 三段排序：①红 pi_cost（px）②蓝 sales_list kcaa03=款号（seq）③蓝 pi_cost 余量（px）。
 * @param {{ kcaa01?: string, kcaa03?: string, seq?: number }[]} materialRows
 * @param {string} product
 * @param {string[]} bomCodePrefixes
 * @param {Map<string, number | null>} piCostPxMap
 */
export function sortBatchAddMaterialRows(materialRows, product, bomCodePrefixes, piCostPxMap) {
  const pathRed = []
  const pathBlueSeq = []
  const pathBluePx = []
  const pxMap = piCostPxMap instanceof Map ? piCostPxMap : new Map()
  for (const row of Array.isArray(materialRows) ? materialRows : []) {
    const path = classifyBatchAddMaterialPath(row, product, bomCodePrefixes)
    if (path === 'pi_cost_red') pathRed.push(row)
    else if (path === 'sales_list_blue') pathBlueSeq.push(row)
    else pathBluePx.push(row)
  }
  const prodKey = normKcaa01(product).toLowerCase()
  pathRed.sort((a, b) =>
    compareBatchAddPx(
      lookupPiCostPx(pxMap, prodKey, a?.kcaa01),
      lookupPiCostPx(pxMap, prodKey, b?.kcaa01),
    ),
  )
  pathBlueSeq.sort((a, b) => compareBatchAddSeq(a?.seq, b?.seq))
  pathBluePx.sort((a, b) =>
    compareBatchAddPx(
      lookupPiCostPx(pxMap, prodKey, a?.kcaa01),
      lookupPiCostPx(pxMap, prodKey, b?.kcaa01),
    ),
  )
  return [...pathRed, ...pathBlueSeq, ...pathBluePx]
}

/**
 * @param {Map<string, number | null>} pxMap
 * @param {string} prodKey
 * @param {unknown} kcaa01
 * @returns {number | null}
 */
function lookupPiCostPx(pxMap, prodKey, kcaa01) {
  const matKey = normKcaa01(kcaa01).toLowerCase()
  if (!matKey) return null
  return pxMap.get(`${prodKey}|${matKey}`) ?? null
}

/**
 * @param {number | null} a
 * @param {number | null} b
 */
function compareBatchAddPx(a, b) {
  const aNull = a == null
  const bNull = b == null
  if (aNull && bNull) return 0
  if (aNull) return 1
  if (bNull) return -1
  return a - b
}

/**
 * @param {unknown} a
 * @param {unknown} b
 */
function compareBatchAddSeq(a, b) {
  const aNum = parseBatchAddSortPx(a)
  const bNum = parseBatchAddSortPx(b)
  return compareBatchAddPx(aNum, bNum)
}

/**
 * 批量选材 BOM 用量：pi_cost 优先；否则半成品（Bom 前缀命中）用 xsak03 × kcac04。
 * @param {{ product: string, material: string, matRow: { kcac04?: number }, bomQtyMap: Map<string, number>, orderQty: number, bomCodePrefixes: string[] }} opts
 */
export function resolveBatchAddBomQty({
  product,
  material,
  matRow,
  bomQtyMap,
  orderQty,
  bomCodePrefixes,
}) {
  const prod = normKcaa01(product).toLowerCase()
  const mat = normKcaa01(material).toLowerCase()
  const bomKey = `${prod}|${mat}`
  if (bomQtyMap.has(bomKey)) {
    return bomQtyMap.get(bomKey) ?? 0
  }
  if (kcaa01MatchesAnyBomCodeAssistBatchPrefix(material, bomCodePrefixes)) {
    const kcac04 = Number(matRow?.kcac04 ?? 0)
    const qty = Number(orderQty ?? 0)
    if (Number.isFinite(kcac04) && Number.isFinite(qty)) {
      return roundQty(kcac04 * qty, 6)
    }
  }
  return 0
}

/**
 * @param {{ piNo?: string, product?: string, kcaa01?: string, wxak03?: number }[]} lines
 */
export function buildCurrentLineQtyMap(lines, piNo) {
  /** @type {Map<string, number>} */
  const map = new Map()
  const pi = String(piNo ?? '').trim()
  for (const row of Array.isArray(lines) ? lines : []) {
    const key = buildAssistBatchLineKey(pi || row?.piNo, row?.product, row?.kcaa01)
    const qty = Number(row?.wxak03 ?? 0)
    map.set(key, roundQty((map.get(key) ?? 0) + (Number.isFinite(qty) ? qty : 0), 2))
  }
  return map
}

/**
 * @param {Map<string, number>} bomQtyMap product|material -> qty
 * @param {Map<string, number>} outsourcedDb full key -> qty
 * @param {Map<string, number>} outsourcedCurrent full key -> qty
 */
export function calcAvailableQty(bomQty, outsourcedDb = 0, outsourcedCurrent = 0) {
  const bom = Number(bomQty ?? 0)
  const db = Number(outsourcedDb ?? 0)
  const cur = Number(outsourcedCurrent ?? 0)
  const left = bom - db - cur
  return roundQty(Math.max(left, 0), 2)
}

function parseCurrentLinesParam(raw) {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  try {
    const parsed = JSON.parse(String(raw))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function serializeRow(row) {
  const o = {}
  for (const [k, v] of Object.entries(row ?? {})) {
    if (v instanceof Date) o[k] = v.toISOString()
    else o[k] = v
  }
  return o
}

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {{ piNo: string, excludeOrderNo?: string, currentLines?: unknown }} opts
 */
export async function fetchAssistOrderBatchAddTree(pool, opts) {
  const piNo = String(opts?.piNo ?? '').trim()
  if (!piNo) {
    return { ok: false, status: 400, msg: '请先填写关联 PI 号' }
  }

  const excludeOrderNo = String(opts?.excludeOrderNo ?? '').trim()
  const currentLines = parseCurrentLinesParam(opts?.currentLines)
  const currentQtyMap = buildCurrentLineQtyMap(currentLines, piNo)

  const calcCol = await ensureCalcStatusColumn(pool)
  const calcExpr = buildSalesOrderCalcStatusExpr(calcCol)

  const headerR = await pool.request().input('pi', sql.NVarChar(200), piNo).query(`
    SELECT TOP 1
      h.[id] AS orderId,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[xsaj01], N'')))) AS piNo,
      LTRIM(RTRIM(ISNULL(h.[pass], N''))) AS pass,
      ${calcExpr} AS calcStatus
    FROM ${SALES_HEADER_FROM} AS h
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[xsaj01], N'')))) = @pi
      AND (ISNULL(h.[del], N'') = N'' OR h.[del] = N'0')
    ORDER BY h.[id] DESC
  `)
  const header = headerR.recordset?.[0]
  if (!header) {
    return { ok: false, status: 404, msg: `未找到 PI 号「${piNo}」对应的在册销售订单` }
  }
  if (String(header.pass ?? '').trim() !== '1') {
    return { ok: false, status: 409, msg: '关联销售订单未审核，不能批量选材' }
  }

  const calcStatus = String(header.calcStatus ?? '')
  if (calcStatus !== '已运算') {
    return {
      ok: false,
      status: 409,
      msg: '销售订单未一键运算，暂无有效 BOM 用量；请先执行一键运算',
      calcStatus,
    }
  }

  const orderId = Number(header.orderId)

  const styleR = await pool.request().input('pi', sql.NVarChar(200), piNo).query(`
    SELECT
      l.[id],
      l.[seq],
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[xsak01], N'')))) AS piNo,
      LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa01], N'')))) AS product,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa02], N'')))) AS productName,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa03], N'')))) AS spec,
      CAST(ISNULL(l.[xsak03], l.[plan_quantity]) AS decimal(18, 4)) AS orderQty,
      CAST(ISNULL(l.[xsak04], 0) AS decimal(18, 6)) AS unitPrice,
      CAST(ISNULL(l.[xsak05], 0) AS decimal(18, 6)) AS amount,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(l.[version], N'')))) AS version,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa02_en], N'')))) AS nameEn,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kpname], N'')))) AS invoiceName
    FROM ${SALES_LINE_FROM} AS l
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[xsak01], N'')))) = @pi
    ORDER BY ISNULL(l.[seq], l.[id]) ASC
  `)
  const styleRows = styleR.recordset ?? []

  const qtyByProduct = new Map(
    styleRows.map((row) => [normKcaa01(row.product), Number(row.orderQty ?? 0)]),
  )

  const bomCodePrefixes = await fetchBomCodeAssistBatchPrefixes(pool)

  const costR = await pool.request().input('pi', sql.NVarChar(200), piNo).query(`
    SELECT
      LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(c.[pq], N'')))) AS pq,
      LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(c.[kcaa01], N'')))) AS kcaa01,
      CAST(ISNULL(c.[kcac06], 0) AS decimal(18, 6)) AS kcac06,
      CASE WHEN ISNULL(c.[kcaa13], 0) <> 0 THEN 1 ELSE 0 END AS isOutsource,
      CASE
        WHEN c.[px] IS NULL THEN NULL
        WHEN ISNUMERIC(LTRIM(RTRIM(CONVERT(nvarchar(100), c.[px])))) = 1
          THEN CONVERT(int, LTRIM(RTRIM(CONVERT(nvarchar(100), c.[px]))))
        ELSE NULL
      END AS px
    FROM ${PI_COST_FROM} AS c
    WHERE LTRIM(RTRIM(ISNULL(c.[sid], N''))) = @pi
  `)
  const costRawRows = (costR.recordset ?? []).map((row) => ({ ...row, id: 0 }))
  const costLines = buildMaterialBillCostLines(costRawRows, qtyByProduct)
  const bomQtyMap = buildFirstBomQtyMapFromCostLines(costLines)
  const piCostPxMap = buildPiCostPxMapFromCostLines(costRawRows)

  const bomListR = await pool.request().input('pi', sql.NVarChar(200), piNo).query(`
    SELECT
      LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(src.[pkcaa01], N'')))) AS product,
      LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(src.[kcaa01], N'')))) AS kcaa01,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(src.[kcaa02], N'')))) AS kcaa02,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(src.[kcaa02_en], N'')))) AS kcaa02En,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(src.[kpname], N'')))) AS invoiceName,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(src.[kcaa03], N'')))) AS kcaa03,
      CAST(ISNULL(src.[kcac04], 0) AS decimal(18, 6)) AS kcac04,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(src.[kcaa04], N'')))) AS kcaa04,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(src.[kcaa05], N'')))) AS kcaa05,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(src.[kcaa09], N'')))) AS origin,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(src.[kcaa10], N'')))) AS kcaa10,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(src.[kcaa11], N'')))) AS kcaa11,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(src.[version], N'')))) AS version,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(src.[Customer_supply], N'')))) AS customerSupply,
      CASE WHEN ISNULL(src.[kcaa13], 0) <> 0 THEN 1 ELSE 0 END AS isOutsource,
      src.[seq]
    FROM ${PI_BOM_LIST_FROM} AS src
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(src.[sid], N'')))) = @pi
      AND (ISNULL(src.[del], N'') = N'' OR src.[del] = N'0')
    ORDER BY src.[pkcaa01] ASC, src.[seq] ASC
  `)
  const bomListRows = bomListR.recordset ?? []

  const outsourcedReq = pool.request().input('pi', sql.NVarChar(200), piNo)
  let excludeSql = ''
  if (excludeOrderNo) {
    outsourcedReq.input('excludeOrderNo', sql.NVarChar(200), excludeOrderNo)
    excludeSql = `
      AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[wxaj01], N'')))) <> @excludeOrderNo
    `
  }
  const outsourcedR = await outsourcedReq.query(`
    SELECT
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[pi], N'')))) AS piNo,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[Product], N'')))) AS product,
      LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa01], N'')))) AS kcaa01,
      SUM(ISNULL(l.[wxak03], 0)) AS outsourcedQty
    FROM ${ASSIST_LINE_FROM} AS l
    INNER JOIN ${ASSIST_HEADER_FROM} AS h
      ON LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[wxak01], N'')))) =
         LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[wxaj01], N''))))
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[pi], N'')))) = @pi
      AND (ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')
      AND (ISNULL(h.[del], N'') = N'' OR h.[del] = N'0')
      ${excludeSql}
    GROUP BY
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[pi], N'')))),
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[Product], N'')))),
      LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa01], N''))))
  `)

  /** @type {Map<string, number>} */
  const outsourcedDbMap = new Map()
  for (const row of outsourcedR.recordset ?? []) {
    const key = buildAssistBatchLineKey(row.piNo, row.product, row.kcaa01)
    outsourcedDbMap.set(key, roundQty(Number(row.outsourcedQty ?? 0), 2))
  }

  /** @type {Map<string, typeof bomListRows>} */
  const materialsByProduct = new Map()
  for (const row of bomListRows) {
    const product = normKcaa01(row.product)
    if (!product) continue
    const list = materialsByProduct.get(product) ?? []
    list.push(row)
    materialsByProduct.set(product, list)
  }

  const styles = styleRows.map((style, styleIndex) => {
    const product = normKcaa01(style.product)
    const pi = String(style.piNo ?? piNo).trim()
    const mergedRows = mergeBatchAddMaterialRows(
      materialsByProduct.get(product) ?? [],
      bomListRows,
      product,
      bomCodePrefixes,
    )
    const filteredRows = filterBatchAddMaterialRows(mergedRows)
    const materialRows = sortBatchAddMaterialRows(
      filteredRows,
      product,
      bomCodePrefixes,
      piCostPxMap,
    )
    const orderQty = Number(style.orderQty ?? 0)
    const materials = materialRows.map((mat, matIndex) => {
      const material = normKcaa01(mat.kcaa01)
      const lineKey = buildAssistBatchLineKey(pi, product, material)
      const bomQty = resolveBatchAddBomQty({
        product,
        material,
        matRow: mat,
        bomQtyMap,
        orderQty,
        bomCodePrefixes,
      })
      const outsourcedDb = outsourcedDbMap.get(lineKey) ?? 0
      const outsourcedCurrent = currentQtyMap.get(lineKey) ?? 0
      const availableQty = calcAvailableQty(bomQty, outsourcedDb, outsourcedCurrent)
      const isOutsource = Number(mat.isOutsource) === 1
      const codeColor = resolveBatchAddCodeColor({
        kcaa01: material,
        bomCodePrefixes,
      })
      return serializeRow({
        childSeq: `${styleIndex + 1}-${matIndex + 1}`,
        lineKey,
        product,
        piNo: pi,
        codeColor,
        kcaa01: material,
        kcaa02: String(mat.kcaa02 ?? '').trim(),
        kcaa02En: String(mat.kcaa02En ?? '').trim(),
        invoiceName: String(mat.invoiceName ?? '').trim(),
        kcaa03: String(mat.kcaa03 ?? '').trim(),
        kcaa04: String(mat.kcaa04 ?? '').trim(),
        kcaa05: String(mat.kcaa05 ?? '').trim(),
        origin: String(mat.origin ?? '').trim(),
        kcaa10: String(mat.kcaa10 ?? '').trim(),
        kcaa11: String(mat.kcaa11 ?? '').trim(),
        version: String(mat.version ?? '').trim(),
        customerSupply: String(mat.customerSupply ?? '').trim(),
        isOutsource,
        bomQty: roundQty(bomQty, 2),
        outsourcedQty: roundQty(outsourcedDb + outsourcedCurrent, 2),
        availableQty,
        outboundQtyLabel: '待开发',
      })
    })

    const styleCodeColor = resolveBatchAddCodeColor({
      kcaa01: product,
      bomCodePrefixes,
    })

    return serializeRow({
      seq: styleIndex + 1,
      piNo: pi,
      product,
      codeColor: styleCodeColor,
      productName: String(style.productName ?? '').trim(),
      orderQty: Number(style.orderQty ?? 0),
      unitPrice: Number(style.unitPrice ?? 0),
      unitPriceTax: null,
      amount: Number(style.amount ?? 0),
      amountTax: null,
      version: String(style.version ?? '').trim(),
      nameEn: String(style.nameEn ?? '').trim(),
      invoiceName: String(style.invoiceName ?? '').trim(),
      spec: String(style.spec ?? '').trim(),
      materials,
    })
  })

  return {
    ok: true,
    piNo,
    orderId,
    calcStatus,
    styles,
  }
}
