/**
 * 外协订单批量选材（订单外协）：PI 销售 BOM 两层树 + 未外协数量计算
 */
import sql from 'mssql'
import { INV_BOM_CODE_FROM, INV_BOM_MASTER_FROM } from './bomTables.js'
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
const ASSIST_OFFER_FROM = 'dbo.[UB_ERP_assist_offer]'
const ASSIST_OFFER_LINE_FROM = 'dbo.[UB_ERP_assist_offer_list]'
const BUY_OFFER_LINE_FROM = 'dbo.[UB_ERP_Buy_offer_list]'

function parsePositiveInt(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0
}

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

export function buildAssistOfferPriceKey(kcaa01) {
  return normKcaa01(kcaa01).toLowerCase()
}

export function normalizeAssistOfferPrice(row = {}) {
  return {
    wxab04: Number.isFinite(Number(row?.wxab04)) ? Number(row.wxab04) : 0,
    wxab05: Number.isFinite(Number(row?.wxab05)) ? Number(row.wxab05) : 0,
    tax: Number.isFinite(Number(row?.tax)) ? Number(row.tax) : 0,
  }
}

export function mergeAssistOfferPriceRows(supplierRows, fallbackRows) {
  const map = new Map()
  for (const row of Array.isArray(supplierRows) ? supplierRows : []) {
    const key = buildAssistOfferPriceKey(row?.kcaa01)
    if (!key || map.has(key)) continue
    map.set(key, normalizeAssistOfferPrice(row))
  }
  for (const row of Array.isArray(fallbackRows) ? fallbackRows : []) {
    const key = buildAssistOfferPriceKey(row?.kcaa01)
    if (!key || map.has(key)) continue
    map.set(key, normalizeAssistOfferPrice(row))
  }
  return map
}

export function getAssistOfferPriceOrZero(priceMap, kcaa01) {
  const key = buildAssistOfferPriceKey(kcaa01)
  const value = priceMap instanceof Map ? priceMap.get(key) : null
  return value ?? { wxab04: 0, wxab05: 0, tax: 0 }
}

export function buildBuyOfferPriceKey(systemcode) {
  return String(systemcode ?? '').trim().toLowerCase()
}

export function normalizeBuyOfferPrice(row = {}) {
  return {
    wxab04: Number.isFinite(Number(row?.cgab04)) ? Number(row.cgab04) : 0,
    wxab05: Number.isFinite(Number(row?.cgab05)) ? Number(row.cgab05) : 0,
    tax: Number.isFinite(Number(row?.tax)) ? Number(row.tax) : 0,
  }
}

export function mergeBuyOfferPriceRows(rows) {
  const map = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = buildBuyOfferPriceKey(row?.systemcode ?? row?.cgab02)
    if (!key || map.has(key)) continue
    map.set(key, normalizeBuyOfferPrice(row))
  }
  return map
}

export function getBuyOfferPriceOrZero(priceMap, systemcode) {
  const key = buildBuyOfferPriceKey(systemcode)
  const value = priceMap instanceof Map ? priceMap.get(key) : null
  return value ?? { wxab04: 0, wxab05: 0, tax: 0 }
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
 * 旧系统 s_choose_pi_list.asp bomstr：UB_ERP_Bom_code.copen=1，OUT 用后缀，其余用 flag5- 前缀。
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
 * 编码颜色：命中 UB_ERP_Bom_code.flag5 前缀（含 OUT 后缀口径）→ 蓝；否则红。
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

function uniqueAssistOfferMaterialCodes(rows) {
  const out = []
  const seen = new Set()
  for (const row of Array.isArray(rows) ? rows : []) {
    if (Number(row?.isOutsource) !== 1) continue
    const code = normKcaa01(row?.kcaa01)
    const key = code.toLowerCase()
    if (!code || seen.has(key)) continue
    seen.add(key)
    out.push(code)
  }
  return out
}

function uniqueBuyOfferSystemcodes(rows) {
  const out = []
  const seen = new Set()
  for (const row of Array.isArray(rows) ? rows : []) {
    const code = String(row?.materialSystemcode ?? row?.systemcode ?? '').trim()
    const key = code.toLowerCase()
    if (!code || seen.has(key)) continue
    seen.add(key)
    out.push(code)
  }
  return out
}

function bindMaterialCodeParams(req, codes, prefix = 'mat') {
  const names = []
  codes.forEach((code, i) => {
    const name = `${prefix}${i}`
    req.input(name, sql.NVarChar(300), code)
    names.push(`@${name}`)
  })
  return names.join(', ')
}

function buildOtherBatchKeywordSql(alias = 'src') {
  return `
    AND (
      LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(${alias}.[kcaa01], N'')))) LIKE @keyword
      OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(${alias}.[kcaa02], N'')))) LIKE @keyword
      OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(${alias}.[kcaa02En], N'')))) LIKE @keyword
      OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(${alias}.[invoiceName], N'')))) LIKE @keyword
      OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(${alias}.[kcaa03], N'')))) LIKE @keyword
      OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(${alias}.[remark], N'')))) LIKE @keyword
      OR LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(${alias}.[origin], N'')))) LIKE @keyword
    )
  `
}

function buildOtherBatchBomCodeSql(alias = 'src') {
  return `
    AND EXISTS (
      SELECT 1
      FROM ${INV_BOM_CODE_FROM} AS bc_f
      WHERE bc_f.[id] = @bomCodeId
        AND (
          (
            LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(bc_f.[flag5], N'')))) <> N''
            AND UPPER(LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(${alias}.[kcaa01], N'')))))
              LIKE UPPER(LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(bc_f.[flag5], N''))))) + N'%'
          )
          OR (
            LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(bc_f.[flag5], N'')))) = N''
            AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(${alias}.[kcaa05], N''))))
              = LTRIM(RTRIM(CONVERT(nvarchar(50), bc_f.[id])))
          )
        )
    )
  `
}

async function fetchAssistOfferPriceRowsForBatch(pool, materialCodes, supplierCode) {
  const codes = Array.isArray(materialCodes) ? materialCodes.filter(Boolean) : []
  if (!codes.length) return new Map()

  const supplierRows = []
  const fallbackRows = []
  const supplier = String(supplierCode ?? '').trim()

  for (let i = 0; i < codes.length; i += 200) {
    const batch = codes.slice(i, i + 200)

    if (supplier) {
      const supplierReq = pool.request()
      supplierReq.input('supplierCode', sql.NVarChar(200), supplier)
      const inSql = bindMaterialCodeParams(supplierReq, batch, 'sm')
      const supplierR = await supplierReq.query(`
        SELECT x.[kcaa01], x.[wxab04], x.[wxab05], x.[tax]
        FROM (
          SELECT
            LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa01], N'')))) AS kcaa01,
            CAST(ISNULL(l.[wxab04], 0) AS decimal(18, 6)) AS wxab04,
            CAST(ISNULL(l.[wxab05], 0) AS decimal(18, 6)) AS wxab05,
            CAST(ISNULL(l.[tax], 0) AS decimal(18, 6)) AS tax,
            ROW_NUMBER() OVER (
              PARTITION BY LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa01], N''))))
              ORDER BY h.[id] DESC, l.[id] DESC
            ) AS rn
          FROM ${ASSIST_OFFER_FROM} AS h
          INNER JOIN ${ASSIST_OFFER_LINE_FROM} AS l
            ON LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[wxaa01], N'')))) =
               LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[wxab01], N''))))
          WHERE ISNULL(CONVERT(nvarchar(50), h.[del]), N'') IN (N'', N'0')
            AND LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(h.[pass], N'')))) = N'1'
            AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[wxaa04], N'')))) = @supplierCode
            AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa01], N'')))) IN (${inSql})
        ) AS x
        WHERE x.rn = 1
      `)
      supplierRows.push(...(supplierR.recordset ?? []))
    }

    const fallbackReq = pool.request()
    const fallbackInSql = bindMaterialCodeParams(fallbackReq, batch, 'fm')
    const fallbackR = await fallbackReq.query(`
      SELECT x.[kcaa01], x.[wxab04], x.[wxab05], x.[tax]
      FROM (
        SELECT
          LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa01], N'')))) AS kcaa01,
          CAST(ISNULL(l.[wxab04], 0) AS decimal(18, 6)) AS wxab04,
          CAST(ISNULL(l.[wxab05], 0) AS decimal(18, 6)) AS wxab05,
          CAST(ISNULL(l.[tax], 0) AS decimal(18, 6)) AS tax,
          ROW_NUMBER() OVER (
            PARTITION BY LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa01], N''))))
            ORDER BY l.[id] DESC
          ) AS rn
        FROM ${ASSIST_OFFER_LINE_FROM} AS l
        WHERE ISNULL(CONVERT(nvarchar(50), l.[del]), N'') IN (N'', N'0')
          AND LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(l.[pass], N'')))) = N'1'
          AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa01], N'')))) IN (${fallbackInSql})
      ) AS x
      WHERE x.rn = 1
    `)
    fallbackRows.push(...(fallbackR.recordset ?? []))
  }

  return mergeAssistOfferPriceRows(supplierRows, fallbackRows)
}

async function fetchBuyOfferPriceRowsForBatch(pool, systemcodes) {
  const codes = Array.isArray(systemcodes) ? systemcodes.filter(Boolean) : []
  if (!codes.length) return new Map()

  const rows = []
  for (let i = 0; i < codes.length; i += 200) {
    const batch = codes.slice(i, i + 200)
    const req = pool.request()
    const inSql = bindMaterialCodeParams(req, batch, 'bc')
    const r = await req.query(`
      SELECT x.[systemcode], x.[cgab04], x.[cgab05], x.[tax]
      FROM (
        SELECT
          LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[cgab02], N'')))) AS systemcode,
          CAST(ISNULL(l.[cgab04], 0) AS decimal(18, 6)) AS cgab04,
          CAST(ISNULL(l.[cgab05], 0) AS decimal(18, 6)) AS cgab05,
          CAST(ISNULL(l.[tax], 0) AS decimal(18, 6)) AS tax,
          ROW_NUMBER() OVER (
            PARTITION BY LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[cgab02], N''))))
            ORDER BY l.[id] DESC
          ) AS rn
        FROM ${BUY_OFFER_LINE_FROM} AS l
        WHERE LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[cgab02], N'')))) IN (${inSql})
          AND ISNULL(CONVERT(nvarchar(50), l.[del]), N'') IN (N'', N'0')
          AND LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(l.[pass], N'')))) = N'1'
      ) AS x
      WHERE x.rn = 1
    `)
    rows.push(...(r.recordset ?? []))
  }

  return mergeBuyOfferPriceRows(rows)
}

async function fetchAssistOrderOtherBatchAddTree(pool, opts) {
  const keyword = String(opts?.keyword ?? '').trim()
  const bomCodeId = parsePositiveInt(opts?.bomCodeId ?? opts?.bom_code_id)
  const page = Math.max(1, parsePositiveInt(opts?.page) || 1)
  const pageSizeRaw = parsePositiveInt(opts?.pageSize)
  const pageSize = Math.min(100, Math.max(1, pageSizeRaw || 10))
  const startRow = (page - 1) * pageSize + 1
  const endRow = page * pageSize
  const req = pool.request()
  const hasKeyword = keyword.length > 0
  const hasBomCode = bomCodeId > 0
  if (hasKeyword) req.input('keyword', sql.NVarChar(500), `%${keyword}%`)
  if (hasBomCode) req.input('bomCodeId', sql.Int, bomCodeId)
  req.input('startRow', sql.Int, startRow)
  req.input('endRow', sql.Int, endRow)

  const keywordSql = hasKeyword ? buildOtherBatchKeywordSql('src') : ''
  const bomCodeSql = hasBomCode ? buildOtherBatchBomCodeSql('src') : ''
  const sourceSql = `
    SELECT
      b.[id],
      LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.[kcaa01], N'')))) AS kcaa01,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.[kcaa02], N'')))) AS kcaa02,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.[kcaa02_en], N'')))) AS kcaa02En,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.[kpname], N'')))) AS invoiceName,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.[kcaa03], N'')))) AS kcaa03,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.[kcaa04], N'')))) AS kcaa04,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.[kcaa05], N'')))) AS kcaa05,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.[kcaa09], N'')))) AS origin,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.[kcaa10], N'')))) AS kcaa10,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.[kcaa11], N'')))) AS kcaa11,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.[version], N'')))) AS version,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.[Customer_supply], N'')))) AS customerSupply,
      CAST(0 AS decimal(18, 6)) AS wxab04,
      CAST(0 AS decimal(18, 6)) AS wxab05,
      CAST(0 AS decimal(18, 6)) AS tax,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.[remark], N'')))) AS remark
    FROM ${INV_BOM_MASTER_FROM} AS b
    WHERE ISNULL(CONVERT(nvarchar(50), b.[del]), N'') IN (N'', N'0')
      AND LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(b.[pass], N'')))) = N'1'
  `
  const r = await req.query(`
    SELECT *
    FROM (
      SELECT
        src.*,
        COUNT(1) OVER() AS totalRows,
        ROW_NUMBER() OVER (ORDER BY src.[id] DESC) AS rn
      FROM (
        ${sourceSql}
      ) AS src
      WHERE 1 = 1
        ${keywordSql}
        ${bomCodeSql}
    ) AS paged
    WHERE paged.[rn] BETWEEN @startRow AND @endRow
    ORDER BY paged.[rn] ASC
  `)

  const styles = (r.recordset ?? []).map((row, index) => {
    const code = normKcaa01(row.kcaa01)
    const lineKey = buildAssistBatchLineKey('', '', code)
    const wxab04 = Number(row.wxab04 ?? 0)
    const wxab05 = Number(row.wxab05 ?? 0)
    const tax = Number(row.tax ?? 0)
    const material = serializeRow({
      childSeq: String(index + 1),
      lineKey,
      product: '',
      piNo: '',
      codeColor: 'other',
      kcaa01: code,
      kcaa02: String(row.kcaa02 ?? '').trim(),
      kcaa02En: String(row.kcaa02En ?? '').trim(),
      invoiceName: String(row.invoiceName ?? '').trim(),
      kcaa03: String(row.kcaa03 ?? '').trim(),
      kcaa04: String(row.kcaa04 ?? '').trim(),
      kcaa05: String(row.kcaa05 ?? '').trim(),
      origin: String(row.origin ?? '').trim(),
      kcaa10: String(row.kcaa10 ?? '').trim(),
      kcaa11: String(row.kcaa11 ?? '').trim(),
      version: String(row.version ?? '').trim(),
      customerSupply: String(row.customerSupply ?? '').trim(),
      isOutsource: true,
      bomQty: 0,
      outsourcedQty: 0,
      availableQty: 0,
      wxab04: Number.isFinite(wxab04) && wxab04 > 0 ? wxab04 : 0,
      wxab05: Number.isFinite(wxab05) && wxab05 > 0 ? wxab05 : 0,
      tax: Number.isFinite(tax) && tax > 0 ? tax : 0,
      outboundQtyLabel: '-',
      remark: String(row.remark ?? '').trim(),
    })
    return serializeRow({
      seq: index + 1,
      piNo: '',
      product: code,
      codeColor: 'other',
      productName: String(row.kcaa02 ?? '').trim(),
      orderQty: 0,
      unitPrice: material.wxab04,
      unitPriceTax: material.wxab05,
      amount: 0,
      amountTax: 0,
      version: String(row.version ?? '').trim(),
      nameEn: String(row.kcaa02En ?? '').trim(),
      invoiceName: String(row.invoiceName ?? '').trim(),
      spec: String(row.kcaa03 ?? '').trim(),
      materials: [material],
    })
  })
  const firstTotal = Number(r.recordset?.[0]?.totalRows ?? 0)

  return {
    ok: true,
    assistType: '0',
    lx: '2',
    piNo: '',
    orderId: 0,
    calcStatus: '',
    page,
    pageSize,
    total: Number.isFinite(firstTotal) ? firstTotal : 0,
    styles,
  }
}

async function fetchAssistOrderOutboundBatchAddTree(pool, opts) {
  const piNo = String(opts?.piNo ?? '').trim()
  if (!piNo) {
    return { ok: false, status: 400, msg: 'Please fill PI first' }
  }

  const excludeOrderNo = String(opts?.excludeOrderNo ?? '').trim()
  const currentLines = parseCurrentLinesParam(opts?.currentLines)
  const currentQtyMap = buildCurrentLineQtyMap(currentLines, piNo)

  const headerR = await pool.request().input('pi', sql.NVarChar(200), piNo).query(`
    SELECT TOP 1
      h.[id] AS orderId,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[xsaj01], N'')))) AS piNo
    FROM ${SALES_HEADER_FROM} AS h
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[xsaj01], N'')))) = @pi
      AND ISNULL(CONVERT(nvarchar(50), h.[del]), N'') IN (N'', N'0')
      AND ISNULL(CONVERT(nvarchar(50), h.[closed]), N'') IN (N'', N'0')
    ORDER BY h.[id] DESC
  `)
  const header = headerR.recordset?.[0]
  if (!header) {
    return { ok: false, status: 404, msg: `PI ${piNo} has no active unclosed sales order` }
  }

  const orderId = Number(header.orderId)
  const styleR = await pool.request().input('pi', sql.NVarChar(200), piNo).query(`
    SELECT
      l.[id],
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[xsak01], N'')))) AS piNo,
      LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa01], N'')))) AS product,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa02], N'')))) AS productName,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa03], N'')))) AS spec,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(l.[kcaa04], N'')))) AS unit,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(l.[kcaa05], N'')))) AS category,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(l.[kcaa09], N'')))) AS origin,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(l.[kcaa10], N'')))) AS groupName,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(l.[kcaa11], N'')))) AS colorCode,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(l.[version], N'')))) AS version,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa02_en], N'')))) AS nameEn,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kpname], N'')))) AS invoiceName,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(l.[Customer_supply], N'')))) AS customerSupply,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[systemcode], N'')))) AS materialSystemcode,
      CAST(ISNULL(l.[xsak03], l.[plan_quantity]) AS decimal(18, 4)) AS orderQty,
      CAST(ISNULL(l.[xsak04], 0) AS decimal(18, 6)) AS unitPrice,
      CAST(ISNULL(l.[xsak05], 0) AS decimal(18, 6)) AS amount
    FROM ${SALES_LINE_FROM} AS l
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[xsak01], N'')))) = @pi
      AND ISNULL(CONVERT(nvarchar(50), l.[del]), N'') IN (N'', N'0')
      AND LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(l.[pass], N'')))) = N'1'
    ORDER BY l.[id] ASC
  `)
  const styleRows = styleR.recordset ?? []
  const priceMap = await fetchBuyOfferPriceRowsForBatch(pool, uniqueBuyOfferSystemcodes(styleRows))

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
      LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa01], N''))))
  `)

  const outsourcedDbMap = new Map()
  for (const row of outsourcedR.recordset ?? []) {
    const product = normKcaa01(row.kcaa01)
    outsourcedDbMap.set(
      buildAssistBatchLineKey(row.piNo, product, product),
      roundQty(Number(row.outsourcedQty ?? 0), 2),
    )
  }

  const styles = styleRows.map((style, styleIndex) => {
    const product = normKcaa01(style.product)
    const pi = String(style.piNo ?? piNo).trim()
    const lineKey = buildAssistBatchLineKey(pi, product, product)
    const orderQty = Number(style.orderQty ?? 0)
    const outsourcedDb = outsourcedDbMap.get(lineKey) ?? 0
    const outsourcedCurrent = currentQtyMap.get(lineKey) ?? 0
    const availableQty = calcAvailableQty(orderQty, outsourcedDb, outsourcedCurrent)
    const price = getBuyOfferPriceOrZero(priceMap, style.materialSystemcode)
    const material = serializeRow({
      childSeq: String(styleIndex + 1),
      lineKey,
      product,
      piNo: pi,
      codeColor: 'outbound',
      kcaa01: product,
      kcaa02: String(style.productName ?? '').trim(),
      kcaa02En: String(style.nameEn ?? '').trim(),
      invoiceName: String(style.invoiceName ?? '').trim(),
      kcaa03: String(style.spec ?? '').trim(),
      kcaa04: String(style.unit ?? '').trim(),
      kcaa05: String(style.category ?? '').trim(),
      origin: String(style.origin ?? '').trim(),
      kcaa10: String(style.groupName ?? '').trim(),
      kcaa11: String(style.colorCode ?? '').trim(),
      version: String(style.version ?? '').trim(),
      customerSupply: String(style.customerSupply ?? '').trim(),
      isOutsource: availableQty > 0,
      bomQty: roundQty(orderQty, 2),
      outsourcedQty: roundQty(outsourcedDb + outsourcedCurrent, 2),
      availableQty,
      wxab04: price.wxab04,
      wxab05: price.wxab05,
      tax: price.tax,
      outboundQtyLabel: '-',
    })

    return serializeRow({
      seq: styleIndex + 1,
      piNo: pi,
      product,
      codeColor: 'outbound',
      productName: String(style.productName ?? '').trim(),
      orderQty,
      unitPrice: price.wxab04,
      unitPriceTax: price.wxab05,
      amount: roundQty(orderQty * price.wxab04, 2),
      amountTax: roundQty(orderQty * price.wxab05, 2),
      version: String(style.version ?? '').trim(),
      nameEn: String(style.nameEn ?? '').trim(),
      invoiceName: String(style.invoiceName ?? '').trim(),
      spec: String(style.spec ?? '').trim(),
      materials: [material],
    })
  })

  return {
    ok: true,
    assistType: '2',
    piNo,
    orderId,
    calcStatus: '',
    styles,
  }
}

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {{ piNo: string, supplierCode?: string, excludeOrderNo?: string, currentLines?: unknown }} opts
 */
export async function fetchAssistOrderBatchAddTree(pool, opts) {
  const assistType = String(opts?.assistType ?? '1').trim()
  if (assistType === '0') {
    return fetchAssistOrderOtherBatchAddTree(pool, opts)
  }

  const piNo = String(opts?.piNo ?? '').trim()
  if (!piNo) {
    return { ok: false, status: 400, msg: '请先填写关联 PI 号' }
  }

  if (assistType === '2') {
    return fetchAssistOrderOutboundBatchAddTree(pool, opts)
  }

  const supplierCode = String(opts?.supplierCode ?? '').trim()
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
    ORDER BY l.[id] ASC
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
      AND ISNULL(c.[kcaa13], 0) = 1
      AND ISNULL(c.[isok], 0) = 1
    ORDER BY
      LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(c.[pq], N'')))) ASC,
      CASE WHEN c.[px] IS NULL THEN 1 ELSE 0 END ASC,
      c.[px] ASC
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
      src.[id] AS seq
    FROM ${PI_BOM_LIST_FROM} AS src
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(src.[sid], N'')))) = @pi
      AND (ISNULL(src.[del], N'') = N'' OR src.[del] = N'0')
    ORDER BY src.[pkcaa01] ASC, src.[id] ASC
  `)
  const bomListRows = bomListR.recordset ?? []
  const priceMap = await fetchAssistOfferPriceRowsForBatch(
    pool,
    uniqueAssistOfferMaterialCodes(bomListRows),
    supplierCode,
  )

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
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(
        NULLIF(LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[pq], N'')))), N''),
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[Product], N''))))
      )))) AS product,
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
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(
        NULLIF(LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[pq], N'')))), N''),
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[Product], N''))))
      )))),
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
      const price = getAssistOfferPriceOrZero(priceMap, material)
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
        wxab04: price.wxab04,
        wxab05: price.wxab05,
        tax: price.tax,
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
