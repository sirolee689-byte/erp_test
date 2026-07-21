/**
 * PI追溯：正向（按 PI 查成品/BOM/业务单）与反向（按物料上追成品与 PI）。
 * 只读；pass/del 口径按业务分段，禁止统一审核条件。
 */
import { sql } from './db.js'
import { clampErpPageSize } from './erpPagination.js'

const BOM_SALES_FROM = 'dbo.[UB_ERP_Bom_Sales]'
const BOM_SALES_LIST_FROM = 'dbo.[UB_ERP_Bom_Sales_list]'
const SALES_ORDER_FROM = 'dbo.[UB_ERP_Sales_order]'
const SALES_ORDER_LIST_FROM = 'dbo.[UB_ERP_Sales_order_list]'
const BUY_ORDER_FROM = 'dbo.[UB_ERP_Buy_order]'
const BUY_ORDER_LIST_FROM = 'dbo.[UB_ERP_Buy_order_list]'
const ASSIST_ORDER_FROM = 'dbo.[UB_ERP_assist_order]'
const ASSIST_ORDER_LIST_FROM = 'dbo.[UB_ERP_assist_order_list]'
const DISPATCH_ORDER_FROM = 'dbo.[UB_ERP_Dispatch_order]'
const DISPATCH_ORDER_LIST_FROM = 'dbo.[UB_ERP_Dispatch_order_list]'
const STOCK_IN_FROM = 'dbo.[UB_ERP_Stocks_Storage]'
const STOCK_IN_LIST_FROM = 'dbo.[UB_ERP_Stocks_Storage_list]'
const STOCK_OUT_FROM = 'dbo.[UB_ERP_Stocks_out]'
const STOCK_OUT_LIST_FROM = 'dbo.[UB_ERP_Stocks_out_list]'
const PI_COST_FROM = 'dbo.[UB_ERP_Bom_pi_cost]'
const PI_CONSUMPTION_TABLE = 'UB_ERP_Bom_pi_consumption'
const PI_CONSUMPTION_FROM = `dbo.[${PI_CONSUMPTION_TABLE}]`

const DEL_ACTIVE = `(ISNULL(del, N'') = N'' OR LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), del), N''))) = N'0')`
const PASS_AUDITED = `LTRIM(RTRIM(ISNULL(pass, N''))) = N'1'`

const MAX_TREE_DEPTH = 40

/** @type {Promise<boolean> | null} */
let consumptionExistsPromise = null
/** @type {Promise<Set<string>> | null} */
let consumptionColsetPromise = null

function text(v) {
  return String(v ?? '').trim()
}

function escapeSqlLikePattern(s) {
  return String(s ?? '')
    .replace(/\[/g, '[[]')
    .replace(/%/g, '[%]')
    .replace(/_/g, '[_]')
}

function toNum(v, fallback = 0) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function round4(v) {
  const n = toNum(v, 0)
  return Math.round(n * 1e4) / 1e4
}

function isCutCode(code) {
  return text(code).toUpperCase().startsWith('CUT-')
}

function isoDate(v) {
  const s = text(v)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''
}

function nextIsoDate(iso) {
  const s = isoDate(iso)
  if (!s) return ''
  const d = new Date(`${s}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return ''
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/**
 * 反向销售日期：双空=不筛；双有=早起晚止；单有=当天。
 * @returns {{ startDate: string, endExclusive: string }}
 */
function normalizeSalesDateRange(startRaw, endRaw) {
  let a = isoDate(startRaw)
  let b = isoDate(endRaw)
  if (!a && !b) return { startDate: '', endExclusive: '' }
  if (a && !b) return { startDate: a, endExclusive: nextIsoDate(a) }
  if (!a && b) return { startDate: b, endExclusive: nextIsoDate(b) }
  if (a > b) {
    const t = a
    a = b
    b = t
  }
  return { startDate: a, endExclusive: nextIsoDate(b) }
}

function piLooksValid(pi) {
  return /pi/i.test(pi)
}

function emptyBillGroup() {
  return { count: 0, bills: [] }
}

/**
 * @param {Array<{ id?: unknown, billNo?: unknown }>} rows
 */
function dedupeBills(rows) {
  /** @type {Map<string, { id: number|null, billNo: string }>} */
  const map = new Map()
  for (const row of rows) {
    const billNo = text(row?.billNo)
    if (!billNo) continue
    if (map.has(billNo)) continue
    const idNum = Number(row?.id)
    map.set(billNo, {
      id: Number.isFinite(idNum) && idNum > 0 ? Math.trunc(idNum) : null,
      billNo,
    })
  }
  const bills = [...map.values()]
  return { count: bills.length, bills }
}

/**
 * @param {import('mssql').ConnectionPool} pool
 */
async function hasPiConsumptionTable(pool) {
  if (!consumptionExistsPromise) {
    consumptionExistsPromise = pool
      .request()
      .input('t', sql.NVarChar(200), PI_CONSUMPTION_TABLE)
      .query(`SELECT 1 AS ok FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = @t`)
      .then((r) => (r.recordset?.length ?? 0) > 0)
      .catch(() => false)
  }
  return consumptionExistsPromise
}

/**
 * @param {import('mssql').ConnectionPool} pool
 */
async function getPiConsumptionColset(pool) {
  if (!(await hasPiConsumptionTable(pool))) return new Set()
  if (!consumptionColsetPromise) {
    consumptionColsetPromise = pool
      .request()
      .input('t', sql.NVarChar(200), PI_CONSUMPTION_TABLE)
      .query(
        `SELECT COLUMN_NAME AS name FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = @t`,
      )
      .then((r) => {
        const set = new Set()
        for (const row of r.recordset ?? []) {
          const n = text(row?.name).toLowerCase()
          if (n) set.add(n)
        }
        return set
      })
      .catch(() => new Set())
  }
  return consumptionColsetPromise
}

/**
 * 物料用量：优先旧库 kcac06（+pq）；否则新库 sumby（仅 sid+kcaa01）；表不存在返回 null。
 * @param {import('mssql').ConnectionPool} pool
 * @param {string} piNo
 * @param {string} productCode
 * @param {string} materialCode
 */
async function fetchMaterialUsageFromConsumption(pool, piNo, productCode, materialCode) {
  const cols = await getPiConsumptionColset(pool)
  if (!cols.size) return null
  const req = pool
    .request()
    .input('sid', sql.NVarChar(100), piNo)
    .input('kcaa01', sql.NVarChar(300), materialCode)
  if (cols.has('kcac06') && cols.has('pq')) {
    req.input('pq', sql.NVarChar(300), productCode)
    const r = await req.query(`
      SELECT TOP 1 CAST(ISNULL(c.[kcac06], 0) AS decimal(28, 6)) AS qty
      FROM ${PI_CONSUMPTION_FROM} AS c
      WHERE LTRIM(RTRIM(ISNULL(c.[sid], N''))) = @sid
        AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(c.[pq], N'')))) = @pq
        AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(c.[kcaa01], N'')))) = @kcaa01
      ORDER BY c.id DESC
    `)
    const raw = r.recordset?.[0]?.qty
    return raw == null ? null : round4(raw)
  }
  if (cols.has('sumby')) {
    const r = await req.query(`
      SELECT TOP 1 CAST(ISNULL(c.[sumby], 0) AS decimal(28, 6)) AS qty
      FROM ${PI_CONSUMPTION_FROM} AS c
      WHERE LTRIM(RTRIM(ISNULL(c.[sid], N''))) = @sid
        AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(c.[kcaa01], N'')))) = @kcaa01
      ORDER BY c.id DESC
    `)
    const raw = r.recordset?.[0]?.qty
    return raw == null ? null : round4(raw)
  }
  return null
}

/**
 * 计价用量：SUM(pi_cost.kcac06)，不乘销售数量。
 * @param {import('mssql').ConnectionPool} pool
 */
async function fetchPricedUsageFromCost(pool, piNo, productCode, materialCode) {
  const r = await pool
    .request()
    .input('sid', sql.NVarChar(100), piNo)
    .input('pq', sql.NVarChar(300), productCode)
    .input('kcaa01', sql.NVarChar(300), materialCode)
    .query(`
      SELECT ISNULL(SUM(ISNULL(CONVERT(decimal(28, 6), c.[kcac06]), 0)), 0) AS qty
      FROM ${PI_COST_FROM} AS c
      WHERE LTRIM(RTRIM(ISNULL(c.[sid], N''))) = @sid
        AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(c.[pq], N'')))) = @pq
        AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(c.[kcaa01], N'')))) = @kcaa01
        AND (${DEL_ACTIVE.replace(/\bdel\b/g, 'c.del')})
        AND ISNULL(c.[isok], 1) = 1
    `)
  return round4(r.recordset?.[0]?.qty)
}

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {string} piNo
 */
async function fetchBomSalesHeads(pool, piNo, productCode) {
  const req = pool.request().input('pi', sql.NVarChar(100), piNo)
  let productWhere = ''
  if (productCode) {
    req.input('product', sql.NVarChar(300), productCode)
    productWhere = ` AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(h.[kcaa01], N'')))) = @product`
  }
  const r = await req.query(`
    SELECT
      h.[id],
      LTRIM(RTRIM(ISNULL(h.[sid], N''))) AS sid,
      LTRIM(RTRIM(ISNULL(CAST(h.[GUID] AS nvarchar(100)), N''))) AS guid,
      LTRIM(RTRIM(ISNULL(CAST(h.[systemcode] AS nvarchar(100)), N''))) AS systemcode,
      LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(h.[kcaa01], N'')))) AS kcaa01,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[kcaa02], N'')))) AS kcaa02,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[kcaa03], N'')))) AS kcaa03
    FROM ${BOM_SALES_FROM} AS h
    WHERE LTRIM(RTRIM(ISNULL(h.[sid], N''))) = @pi
      ${productWhere}
    ORDER BY h.[id] ASC
  `)
  return (r.recordset ?? []).map((row) => ({
    id: Number(row.id),
    sid: text(row.sid),
    guid: text(row.guid) || text(row.systemcode),
    systemcode: text(row.systemcode) || text(row.guid),
    kcaa01: text(row.kcaa01),
    kcaa02: text(row.kcaa02),
    kcaa03: text(row.kcaa03),
  }))
}

/**
 * @param {import('mssql').ConnectionPool} pool
 */
async function fetchSalesQtyUnit(pool, piNo, productCode) {
  const r = await pool
    .request()
    .input('pi', sql.NVarChar(100), piNo)
    .input('product', sql.NVarChar(300), productCode)
    .query(`
      SELECT TOP 1
        CAST(ISNULL(l.[xsak03], 0) AS decimal(28, 6)) AS salesQty,
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(l.[kcaa04], N'')))) AS salesUnit
      FROM ${SALES_ORDER_LIST_FROM} AS l
      WHERE LTRIM(RTRIM(ISNULL(l.[xsak01], N''))) = @pi
        AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa01], N'')))) = @product
      ORDER BY l.[id] DESC
    `)
  const row = r.recordset?.[0]
  return {
    salesQty: row ? toNum(row.salesQty) : null,
    salesUnit: row ? text(row.salesUnit) : '',
  }
}

/**
 * 一次拉齐当前 PI 全部 Bom_Sales_list（del=0），内存建树。
 * @param {import('mssql').ConnectionPool} pool
 */
async function fetchAllBomListRowsForPi(pool, piNo) {
  const r = await pool.request().input('pi', sql.NVarChar(100), piNo).query(`
    SELECT
      l.[id],
      LTRIM(RTRIM(ISNULL(l.[sid], N''))) AS sid,
      LTRIM(RTRIM(ISNULL(CAST(l.[kcac01] AS nvarchar(500)), N''))) AS kcac01,
      LTRIM(RTRIM(ISNULL(CAST(l.[kcac02] AS nvarchar(500)), N''))) AS kcac02,
      LTRIM(RTRIM(ISNULL(CAST(l.[systemcode] AS nvarchar(500)), N''))) AS systemcode,
      LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa01], N'')))) AS kcaa01,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa02], N'')))) AS kcaa02,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa03], N'')))) AS kcaa03,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(l.[kcaa04], N'')))) AS kcaa04,
      CAST(ISNULL(l.[kcac04], 0) AS decimal(18, 6)) AS kcac04,
      CAST(ISNULL(l.[kcac05], 0) AS decimal(18, 6)) AS kcac05,
      CAST(ISNULL(l.[kcac04], 0) * (1 + ISNULL(l.[kcac05], 0)) AS decimal(18, 6)) AS kcac06,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[Describe], N'')))) AS Describe,
      CONVERT(int, ISNULL(l.[seq], 0)) AS seq
    FROM ${BOM_SALES_LIST_FROM} AS l
    WHERE LTRIM(RTRIM(ISNULL(l.[sid], N''))) = @pi
      AND (${DEL_ACTIVE.replace(/\bdel\b/g, 'l.del')})
    ORDER BY ISNULL(l.[seq], l.[id]) ASC, l.[id] ASC
  `)
  return (r.recordset ?? []).map((row) => ({
    id: Number(row.id),
    sid: text(row.sid),
    kcac01: text(row.kcac01),
    kcac02: text(row.kcac02),
    systemcode: text(row.systemcode),
    kcaa01: text(row.kcaa01),
    kcaa02: text(row.kcaa02),
    kcaa03: text(row.kcaa03),
    kcaa04: text(row.kcaa04),
    kcac04: toNum(row.kcac04),
    kcac05: toNum(row.kcac05),
    kcac06: toNum(row.kcac06),
    Describe: text(row.Describe),
    seq: Number(row.seq) || 0,
  }))
}

/**
 * @param {ReturnType<typeof fetchAllBomListRowsForPi> extends Promise<infer T> ? T : never} rows
 */
function indexBomListByParent(rows) {
  /** @type {Map<string, typeof rows>} */
  const map = new Map()
  for (const row of rows) {
    const key = text(row.kcac01)
    if (!key) continue
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(row)
  }
  return map
}

/**
 * @param {Map<string, any[]>} byParent
 * @param {string} parentKey
 * @param {number} depth
 * @param {number} parentPathQty
 * @param {Set<string>} stack
 * @param {Map<string, any>} docsByMaterial
 */
function buildBomTreeNodes(byParent, parentKey, depth, parentPathQty, stack, docsByMaterial) {
  if (depth > MAX_TREE_DEPTH) return []
  const key = text(parentKey)
  if (!key) return []
  if (stack.has(key)) return []
  const rows = byParent.get(key) ?? []
  const nextStack = new Set(stack)
  nextStack.add(key)
  /** @type {any[]} */
  const out = []
  for (const row of rows) {
    const qty = toNum(row.kcac04)
    const pathQty = parentPathQty * qty
    const cut = isCutCode(row.kcaa01)
    const childKey = text(row.kcac02)
    const children = childKey
      ? buildBomTreeNodes(byParent, childKey, depth + 1, pathQty, nextStack, docsByMaterial)
      : []
    const docs = docsByMaterial.get(row.kcaa01) || emptyMaterialDocs()
    out.push({
      id: row.id,
      kcaa01: row.kcaa01,
      kcaa02: row.kcaa02,
      kcaa03: row.kcaa03,
      kcaa04: row.kcaa04,
      kcac04: qty,
      kcac05: toNum(row.kcac05),
      kcac06: toNum(row.kcac06),
      pathQty: cut ? null : round4(pathQty),
      isCut: cut,
      Describe: row.Describe,
      kcac01: row.kcac01,
      kcac02: row.kcac02,
      children,
      docs,
    })
  }
  return out
}

function emptyMaterialDocs() {
  return {
    buy: emptyBillGroup(),
    assist: emptyBillGroup(),
    dispatch: emptyBillGroup(),
    stockIn: emptyBillGroup(),
    stockOutFg: emptyBillGroup(),
  }
}

/**
 * PI 头六类单据汇总（pass 口径分段）。
 * @param {import('mssql').ConnectionPool} pool
 */
async function fetchPiHeaderBills(pool, piNo) {
  const req = () => pool.request().input('pi', sql.NVarChar(100), piNo)

  const [buyR, assistR, dispatchR, issueR, stockInR, stockOutFgR] = await Promise.all([
    req().query(`
      SELECT h.[id], LTRIM(RTRIM(ISNULL(h.[kcaj01], N''))) AS billNo
      FROM ${BUY_ORDER_FROM} AS h
      WHERE LTRIM(RTRIM(ISNULL(h.[kcaj04], N''))) = @pi
        AND (${DEL_ACTIVE.replace(/\bdel\b/g, 'h.del')})
        AND (${PASS_AUDITED.replace(/\bpass\b/g, 'h.pass')})
      ORDER BY h.[id] DESC
    `),
    req().query(`
      SELECT h.[id], LTRIM(RTRIM(ISNULL(h.[wxaj01], N''))) AS billNo
      FROM ${ASSIST_ORDER_FROM} AS h
      WHERE LTRIM(RTRIM(ISNULL(h.[wxaj04], N''))) = @pi
        AND (${DEL_ACTIVE.replace(/\bdel\b/g, 'h.del')})
        AND (${PASS_AUDITED.replace(/\bpass\b/g, 'h.pass')})
      ORDER BY h.[id] DESC
    `),
    req().query(`
      SELECT h.[id], LTRIM(RTRIM(ISNULL(h.[scaj01], N''))) AS billNo
      FROM ${DISPATCH_ORDER_FROM} AS h
      WHERE LTRIM(RTRIM(ISNULL(h.[scaj04], N''))) = @pi
        AND (${DEL_ACTIVE.replace(/\bdel\b/g, 'h.del')})
        AND (${PASS_AUDITED.replace(/\bpass\b/g, 'h.pass')})
      ORDER BY h.[id] DESC
    `),
    // 生产领料：不加 pass（与旧系统一致）
    req().query(`
      SELECT h.[id], LTRIM(RTRIM(ISNULL(h.[kcap01], N''))) AS billNo
      FROM ${STOCK_OUT_FROM} AS h
      WHERE (
          LTRIM(RTRIM(ISNULL(h.[kcap04], N''))) = @pi
          OR LTRIM(RTRIM(ISNULL(h.[kcap08], N''))) = @pi
        )
        AND CONVERT(int, ISNULL(h.[kcap03], 0)) IN (2, 4, 7, 8)
        AND (${DEL_ACTIVE.replace(/\bdel\b/g, 'h.del')})
      ORDER BY h.[id] DESC
    `),
    req().query(`
      SELECT h.[id], LTRIM(RTRIM(ISNULL(h.[kcan01], N''))) AS billNo
      FROM ${STOCK_IN_FROM} AS h
      WHERE (
          LTRIM(RTRIM(ISNULL(h.[kcan04], N''))) = @pi
          OR LTRIM(RTRIM(ISNULL(h.[kcan08], N''))) = @pi
        )
        AND CONVERT(int, ISNULL(h.[kcan03], 0)) = 4
        AND (${DEL_ACTIVE.replace(/\bdel\b/g, 'h.del')})
        AND (${PASS_AUDITED.replace(/\bpass\b/g, 'h.pass')})
      ORDER BY h.[id] DESC
    `),
    // 成品出库头汇总：不加 pass
    req().query(`
      SELECT h.[id], LTRIM(RTRIM(ISNULL(h.[kcap01], N''))) AS billNo
      FROM ${STOCK_OUT_FROM} AS h
      WHERE LTRIM(RTRIM(ISNULL(h.[kcap04], N''))) = @pi
        AND CONVERT(int, ISNULL(h.[kcap03], 0)) = 6
        AND (${DEL_ACTIVE.replace(/\bdel\b/g, 'h.del')})
      ORDER BY h.[id] DESC
    `),
  ])

  return {
    buy: dedupeBills(buyR.recordset ?? []),
    assist: dedupeBills(assistR.recordset ?? []),
    dispatch: dedupeBills(dispatchR.recordset ?? []),
    productionIssue: dedupeBills(issueR.recordset ?? []),
    stockInFg: dedupeBills(stockInR.recordset ?? []),
    stockOutFg: dedupeBills(stockOutFgR.recordset ?? []),
  }
}

/**
 * 物料级明细单据：按物料编码分组；成品出库明细要求 pass=1。
 * @param {import('mssql').ConnectionPool} pool
 * @returns {Promise<Map<string, ReturnType<typeof emptyMaterialDocs>>>}
 */
async function fetchMaterialDocsByCode(pool, piNo) {
  const req = () => pool.request().input('pi', sql.NVarChar(100), piNo)

  const [buyR, assistR, dispatchR, stockInR, stockOutR] = await Promise.all([
    req().query(`
      SELECT
        LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa01], N'')))) AS materialCode,
        h.[id],
        LTRIM(RTRIM(ISNULL(h.[kcaj01], N''))) AS billNo,
        CAST(ISNULL(l.[kcak03], 0) AS decimal(28, 6)) AS qty
      FROM ${BUY_ORDER_FROM} AS h
      INNER JOIN ${BUY_ORDER_LIST_FROM} AS l
        ON LTRIM(RTRIM(ISNULL(h.[kcaj01], N''))) = LTRIM(RTRIM(ISNULL(l.[kcak01], N'')))
      WHERE LTRIM(RTRIM(ISNULL(h.[kcaj04], N''))) = @pi
        AND (${DEL_ACTIVE.replace(/\bdel\b/g, 'h.del')})
        AND (${PASS_AUDITED.replace(/\bpass\b/g, 'h.pass')})
        AND (${DEL_ACTIVE.replace(/\bdel\b/g, 'l.del')})
      ORDER BY h.[id] DESC
    `),
    req().query(`
      SELECT
        LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa01], N'')))) AS materialCode,
        h.[id],
        LTRIM(RTRIM(ISNULL(h.[wxaj01], N''))) AS billNo,
        CAST(ISNULL(l.[wxak03], 0) AS decimal(28, 6)) AS qty
      FROM ${ASSIST_ORDER_FROM} AS h
      INNER JOIN ${ASSIST_ORDER_LIST_FROM} AS l
        ON LTRIM(RTRIM(ISNULL(h.[wxaj01], N''))) = LTRIM(RTRIM(ISNULL(l.[wxak01], N'')))
      WHERE LTRIM(RTRIM(ISNULL(h.[wxaj04], N''))) = @pi
        AND (${DEL_ACTIVE.replace(/\bdel\b/g, 'h.del')})
        AND (${PASS_AUDITED.replace(/\bpass\b/g, 'h.pass')})
        AND (${DEL_ACTIVE.replace(/\bdel\b/g, 'l.del')})
      ORDER BY h.[id] DESC
    `),
    req().query(`
      SELECT
        LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa01], N'')))) AS materialCode,
        h.[id],
        LTRIM(RTRIM(ISNULL(h.[scaj01], N''))) AS billNo,
        CAST(ISNULL(l.[scak03], 0) AS decimal(28, 6)) AS qty
      FROM ${DISPATCH_ORDER_FROM} AS h
      INNER JOIN ${DISPATCH_ORDER_LIST_FROM} AS l
        ON LTRIM(RTRIM(ISNULL(h.[scaj01], N''))) = LTRIM(RTRIM(ISNULL(l.[scak01], N'')))
      WHERE LTRIM(RTRIM(ISNULL(h.[scaj04], N''))) = @pi
        AND (${DEL_ACTIVE.replace(/\bdel\b/g, 'h.del')})
        AND (${PASS_AUDITED.replace(/\bpass\b/g, 'h.pass')})
        AND (${DEL_ACTIVE.replace(/\bdel\b/g, 'l.del')})
      ORDER BY h.[id] DESC
    `),
    req().query(`
      SELECT
        LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa01], N'')))) AS materialCode,
        h.[id],
        LTRIM(RTRIM(ISNULL(h.[kcan01], N''))) AS billNo,
        CAST(ISNULL(l.[kcao03], 0) AS decimal(28, 6)) AS qty
      FROM ${STOCK_IN_FROM} AS h
      INNER JOIN ${STOCK_IN_LIST_FROM} AS l
        ON LTRIM(RTRIM(ISNULL(h.[kcan01], N''))) = LTRIM(RTRIM(ISNULL(l.[kcao01], N'')))
      WHERE (
          LTRIM(RTRIM(ISNULL(h.[kcan04], N''))) = @pi
          OR LTRIM(RTRIM(ISNULL(h.[kcan08], N''))) = @pi
        )
        AND CONVERT(int, ISNULL(h.[kcan03], 0)) = 4
        AND (${DEL_ACTIVE.replace(/\bdel\b/g, 'h.del')})
        AND (${PASS_AUDITED.replace(/\bpass\b/g, 'h.pass')})
        AND (${DEL_ACTIVE.replace(/\bdel\b/g, 'l.del')})
      ORDER BY h.[id] DESC
    `),
    // 成品出库明细：要 pass=1（与 PI 头汇总口径分离）
    req().query(`
      SELECT
        LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa01], N'')))) AS materialCode,
        h.[id],
        LTRIM(RTRIM(ISNULL(h.[kcap01], N''))) AS billNo,
        CAST(ISNULL(l.[kcaq03], 0) AS decimal(28, 6)) AS qty
      FROM ${STOCK_OUT_FROM} AS h
      INNER JOIN ${STOCK_OUT_LIST_FROM} AS l
        ON LTRIM(RTRIM(ISNULL(h.[kcap01], N''))) = LTRIM(RTRIM(ISNULL(l.[kcaq01], N'')))
      WHERE (
          LTRIM(RTRIM(ISNULL(h.[kcap04], N''))) = @pi
          OR LTRIM(RTRIM(ISNULL(h.[kcap08], N''))) = @pi
        )
        AND CONVERT(int, ISNULL(h.[kcap03], 0)) = 6
        AND (${DEL_ACTIVE.replace(/\bdel\b/g, 'h.del')})
        AND (${PASS_AUDITED.replace(/\bpass\b/g, 'h.pass')})
        AND (${DEL_ACTIVE.replace(/\bdel\b/g, 'l.del')})
      ORDER BY h.[id] DESC
    `),
  ])

  /** @type {Map<string, ReturnType<typeof emptyMaterialDocs>>} */
  const map = new Map()

  function ensure(code) {
    const c = text(code)
    if (!c) return null
    if (!map.has(c)) map.set(c, emptyMaterialDocs())
    return map.get(c)
  }

  /**
   * @param {any[]} rows
   * @param {'buy'|'assist'|'dispatch'|'stockIn'|'stockOutFg'} kind
   */
  function absorb(rows, kind) {
    /** @type {Map<string, Map<string, { id: number|null, billNo: string, qty: number }>>} */
    const perMat = new Map()
    for (const row of rows) {
      const code = text(row.materialCode)
      const billNo = text(row.billNo)
      if (!code || !billNo) continue
      if (!perMat.has(code)) perMat.set(code, new Map())
      const bills = perMat.get(code)
      if (bills.has(billNo)) continue
      const idNum = Number(row.id)
      bills.set(billNo, {
        id: Number.isFinite(idNum) && idNum > 0 ? Math.trunc(idNum) : null,
        billNo,
        qty: toNum(row.qty),
      })
    }
    for (const [code, bills] of perMat) {
      const bucket = ensure(code)
      if (!bucket) continue
      const list = [...bills.values()]
      bucket[kind] = {
        count: list.length,
        bills: list.map((b) => ({ id: b.id, billNo: b.billNo, qty: b.qty })),
      }
    }
  }

  absorb(buyR.recordset ?? [], 'buy')
  absorb(assistR.recordset ?? [], 'assist')
  absorb(dispatchR.recordset ?? [], 'dispatch')
  absorb(stockInR.recordset ?? [], 'stockIn')
  absorb(stockOutR.recordset ?? [], 'stockOutFg')
  return map
}

/**
 * @param {import('express').Express} app
 * @param {{ getPool: () => Promise<import('mssql').ConnectionPool> }} deps
 */
export function registerPiTraceRoutes(app, deps) {
  const { getPool } = deps

  app.get('/api/traceability/pi-trace/forward', async (req, res) => {
    try {
      const pi = text(req.query?.pi)
      const productCode = text(req.query?.productCode)
      if (!pi) {
        return res.status(400).json({ code: 400, msg: '请输入PI号', data: null })
      }
      if (!piLooksValid(pi)) {
        return res.status(400).json({
          code: 400,
          msg: '请输入正确的PI号，例如：PI-888。',
          data: null,
        })
      }

      const pool = await getPool()
      const heads = await fetchBomSalesHeads(pool, pi, productCode)
      if (!heads.length) {
        return res.json({ code: 200, msg: '无此PI数据。', data: { products: [], empty: true } })
      }

      const [listRows, headerBills, docsByMaterial] = await Promise.all([
        fetchAllBomListRowsForPi(pool, pi),
        fetchPiHeaderBills(pool, pi),
        fetchMaterialDocsByCode(pool, pi),
      ])
      const byParent = indexBomListByParent(listRows)

      const salesList = await Promise.all(heads.map((h) => fetchSalesQtyUnit(pool, pi, h.kcaa01)))
      /** @type {any[]} */
      const products = heads.map((head, idx) => {
        const sales = salesList[idx]
        const rootKey = head.guid || head.systemcode
        const bomTree = buildBomTreeNodes(byParent, rootKey, 1, 1, new Set(), docsByMaterial)
        return {
          id: head.id,
          sid: head.sid,
          kcaa01: head.kcaa01,
          kcaa02: head.kcaa02,
          kcaa03: head.kcaa03,
          guid: rootKey,
          salesQty: sales.salesQty,
          salesUnit: sales.salesUnit,
          headerBills,
          bomTree,
        }
      })

      res.json({ code: 200, msg: 'success', data: { products, empty: false, pi } })
    } catch (err) {
      console.error('GET /api/traceability/pi-trace/forward 失败：', err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '数据库查询失败')
      res.status(500).json({ code: 500, msg: `PI正向追溯失败：${detail}`, data: null })
    }
  })

  app.get('/api/traceability/pi-trace/reverse/list', async (req, res) => {
    try {
      const keyword = text(req.query?.keyword)
      if (!keyword) {
        return res.status(400).json({ code: 400, msg: '请输入物料关键字', data: null })
      }
      const page = Math.max(1, Number(req.query?.page ?? 1) || 1)
      const pageSize = clampErpPageSize(req.query?.pageSize, 10)
      const startRow = (page - 1) * pageSize + 1
      const endRow = page * pageSize

      const pool = await getPool()
      const like = `%${escapeSqlLikePattern(keyword)}%`
      const reqDb = pool
        .request()
        .input('kw', sql.NVarChar(500), like)
        .input('startRow', sql.Int, startRow)
        .input('endRow', sql.Int, endRow)

      const fuzzyWhere = `
        (
          CONVERT(nvarchar(300), ISNULL(l.[kcaa01], N'')) LIKE @kw
          OR CONVERT(nvarchar(100), ISNULL(l.[systemcode], N'')) LIKE @kw
          OR CONVERT(nvarchar(100), ISNULL(l.[kcac01], N'')) LIKE @kw
          OR CONVERT(nvarchar(100), ISNULL(l.[kcac02], N'')) LIKE @kw
          OR CONVERT(nvarchar(100), ISNULL(CONVERT(nvarchar(100), l.[kcac03]), N'')) LIKE @kw
          OR CONVERT(nvarchar(100), ISNULL(CONVERT(nvarchar(100), l.[kcac04]), N'')) LIKE @kw
          OR CONVERT(nvarchar(100), ISNULL(CONVERT(nvarchar(100), l.[kcac05]), N'')) LIKE @kw
          OR CONVERT(nvarchar(100), ISNULL(CONVERT(nvarchar(100), l.[kcac06]), N'')) LIKE @kw
          OR CONVERT(nvarchar(500), ISNULL(l.[kcaa02], N'')) LIKE @kw
          OR CONVERT(nvarchar(500), ISNULL(l.[kcaa02_en], N'')) LIKE @kw
          OR CONVERT(nvarchar(200), ISNULL(l.[kpname], N'')) LIKE @kw
          OR CONVERT(nvarchar(500), ISNULL(l.[remark], N'')) LIKE @kw
          OR CONVERT(nvarchar(200), ISNULL(l.[location], N'')) LIKE @kw
          OR CONVERT(nvarchar(100), ISNULL(CONVERT(nvarchar(100), l.[sale_price]), N'')) LIKE @kw
          OR CONVERT(nvarchar(100), ISNULL(CONVERT(nvarchar(100), l.[cost_price]), N'')) LIKE @kw
          OR CONVERT(nvarchar(100), ISNULL(CONVERT(nvarchar(100), l.[Customer_supply]), N'')) LIKE @kw
          OR CONVERT(nvarchar(200), ISNULL(l.[Customer_Name], N'')) LIKE @kw
          OR CONVERT(nvarchar(100), ISNULL(CONVERT(nvarchar(100), l.[version]), N'')) LIKE @kw
        )
      `

      const countR = await reqDb.query(`
        SELECT COUNT(1) AS total
        FROM ${BOM_SALES_LIST_FROM} AS l
        WHERE (${DEL_ACTIVE.replace(/\bdel\b/g, 'l.del')})
          AND (${PASS_AUDITED.replace(/\bpass\b/g, 'l.pass')})
          AND ${fuzzyWhere}
      `)
      const total = Number(countR.recordset?.[0]?.total ?? 0)

      const listR = await pool
        .request()
        .input('kw', sql.NVarChar(500), like)
        .input('startRow', sql.Int, startRow)
        .input('endRow', sql.Int, endRow)
        .query(`
          SELECT *
          FROM (
            SELECT
              ROW_NUMBER() OVER (ORDER BY l.[id] DESC) AS rn,
              l.[id],
              LTRIM(RTRIM(ISNULL(l.[sid], N''))) AS sid,
              LTRIM(RTRIM(ISNULL(CAST(l.[kcac01] AS nvarchar(500)), N''))) AS kcac01,
              LTRIM(RTRIM(ISNULL(CAST(l.[kcac02] AS nvarchar(500)), N''))) AS kcac02,
              LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa01], N'')))) AS kcaa01,
              LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa02], N'')))) AS kcaa02,
              LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa03], N'')))) AS kcaa03,
              LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(l.[kcaa04], N'')))) AS kcaa04,
              CAST(ISNULL(l.[kcac04], 0) AS decimal(18, 6)) AS kcac04,
              CAST(ISNULL(l.[kcac05], 0) AS decimal(18, 6)) AS kcac05,
              CAST(ISNULL(l.[kcac04], 0) * (1 + ISNULL(l.[kcac05], 0)) AS decimal(18, 6)) AS kcac06,
              LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[Describe], N'')))) AS Describe,
              LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[remark], N'')))) AS remark,
              LTRIM(RTRIM(ISNULL(l.[pass], N''))) AS pass
            FROM ${BOM_SALES_LIST_FROM} AS l
            WHERE (${DEL_ACTIVE.replace(/\bdel\b/g, 'l.del')})
              AND (${PASS_AUDITED.replace(/\bpass\b/g, 'l.pass')})
              AND ${fuzzyWhere}
          ) AS t
          WHERE t.rn BETWEEN @startRow AND @endRow
          ORDER BY t.rn
        `)

      const list = (listR.recordset ?? []).map((row) => ({
        id: Number(row.id),
        sid: text(row.sid),
        kcac01: text(row.kcac01),
        kcac02: text(row.kcac02),
        kcaa01: text(row.kcaa01),
        kcaa02: text(row.kcaa02),
        kcaa03: text(row.kcaa03),
        kcaa04: text(row.kcaa04),
        kcac04: toNum(row.kcac04),
        kcac05: toNum(row.kcac05),
        kcac06: toNum(row.kcac06),
        Describe: text(row.Describe),
        remark: text(row.remark),
        pass: text(row.pass),
        parentKey: text(row.kcac01),
      }))

      res.json({ code: 200, msg: 'success', data: { total, list, page, pageSize } })
    } catch (err) {
      console.error('GET /api/traceability/pi-trace/reverse/list 失败：', err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '数据库查询失败')
      res.status(500).json({ code: 500, msg: `PI反向追溯列表失败：${detail}`, data: null })
    }
  })

  app.get('/api/traceability/pi-trace/reverse/detail', async (req, res) => {
    try {
      const id = Number(req.query?.id)
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ code: 400, msg: '无效的物料行 id', data: null })
      }
      const { startDate, endExclusive } = normalizeSalesDateRange(
        req.query?.startDate,
        req.query?.endDate,
      )

      const pool = await getPool()
      const currentR = await pool.request().input('id', sql.Int, id).query(`
        SELECT TOP 1
          l.[id],
          LTRIM(RTRIM(ISNULL(l.[sid], N''))) AS sid,
          LTRIM(RTRIM(ISNULL(CAST(l.[kcac01] AS nvarchar(500)), N''))) AS kcac01,
          LTRIM(RTRIM(ISNULL(CAST(l.[kcac02] AS nvarchar(500)), N''))) AS kcac02,
          LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa01], N'')))) AS kcaa01,
          LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa02], N'')))) AS kcaa02,
          LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa03], N'')))) AS kcaa03,
          LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(l.[kcaa04], N'')))) AS kcaa04,
          CAST(ISNULL(l.[kcac04], 0) AS decimal(18, 6)) AS kcac04,
          CAST(ISNULL(l.[kcac05], 0) AS decimal(18, 6)) AS kcac05,
          CAST(ISNULL(l.[kcac04], 0) * (1 + ISNULL(l.[kcac05], 0)) AS decimal(18, 6)) AS kcac06,
          LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[Describe], N'')))) AS Describe,
          LTRIM(RTRIM(ISNULL(l.[pass], N''))) AS pass
        FROM ${BOM_SALES_LIST_FROM} AS l
        WHERE l.[id] = @id
          AND (${DEL_ACTIVE.replace(/\bdel\b/g, 'l.del')})
          AND (${PASS_AUDITED.replace(/\bpass\b/g, 'l.pass')})
      `)
      const current = currentR.recordset?.[0]
      if (!current) {
        return res.status(404).json({ code: 404, msg: '物料行不存在或未审核', data: null })
      }

      /** @type {any[]} */
      const ancestors = []
      /** @type {any | null} */
      let product = null
      let childKey = text(current.kcac01)
      const seenKeys = new Set()

      for (let level = 0; level < MAX_TREE_DEPTH && childKey; level += 1) {
        if (seenKeys.has(childKey)) break
        seenKeys.add(childKey)
        const parentR = await pool.request().input('childKey', sql.VarChar(50), childKey).query(`
          SELECT TOP 30
            id, sid, kcac01, kcac02, kcaa01, kcaa02, kcaa03, kcaa06, kcaa10,
            CAST(ISNULL(kcac04, 0) AS decimal(18, 6)) AS kcac04,
            CAST(ISNULL(kcac05, 0) AS decimal(18, 6)) AS kcac05
          FROM ${BOM_SALES_LIST_FROM}
          WHERE kcac02 = @childKey
            AND (${DEL_ACTIVE})
          ORDER BY id DESC
        `)
        const parents = parentR.recordset ?? []
        if (!parents.length) break

        for (const p of parents) {
          const node = {
            id: Number(p.id),
            sid: text(p.sid),
            kcac01: text(p.kcac01),
            kcac02: text(p.kcac02),
            kcaa01: text(p.kcaa01),
            kcaa02: text(p.kcaa02),
            kcaa03: text(p.kcaa03),
            kcaa06: text(p.kcaa06),
            kcaa10: text(p.kcaa10),
            kcac04: toNum(p.kcac04),
            kcac05: toNum(p.kcac05),
          }
          ancestors.push(node)
          const spec = text(p.kcaa03)
          if (/PQ-/i.test(spec) || /PQ-/i.test(text(p.kcaa01))) {
            const pqHit = spec.match(/PQ-[A-Za-z0-9/_-]+/i)?.[0] || text(p.kcaa01)
            product = {
              productCode: text(pqHit),
              customerStyle: text(p.kcaa06),
              kcaa01: text(p.kcaa01),
              kcaa02: text(p.kcaa02),
              kcaa03: text(p.kcaa03),
              kcaa10: text(p.kcaa10),
            }
            break
          }
        }
        if (product) break
        childKey = text(parents[0]?.kcac01)
      }

      /** @type {any[]} */
      const pis = []
      if (product?.productCode) {
        const materialCode = text(current.kcaa01)
        const productCode = text(product.productCode)
        const reqPi = pool.request().input('product', sql.NVarChar(300), productCode)
        let dateWhere = ''
        if (startDate) {
          reqPi.input('startDate', sql.NVarChar(10), startDate)
          dateWhere += ` AND CONVERT(nvarchar(10), so.xsaj02, 120) >= @startDate `
        }
        if (endExclusive) {
          reqPi.input('endNext', sql.NVarChar(10), endExclusive)
          dateWhere += ` AND CONVERT(nvarchar(10), so.xsaj02, 120) < @endNext `
        }

        const piR = await reqPi.query(`
          SELECT
            LTRIM(RTRIM(ISNULL(sol.[xsak01], N''))) AS piNo,
            LTRIM(RTRIM(ISNULL(so.[xsaj06], N''))) AS poNo,
            CONVERT(nvarchar(10), so.[xsaj02], 120) AS salesDate,
            LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(sol.[kcaa01], N'')))) AS productCode,
            LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(sol.[xsak08], N'')))) AS piCustomerStyle,
            CAST(ISNULL(sol.[xsak03], 0) AS decimal(28, 6)) AS salesQty
          FROM ${SALES_ORDER_LIST_FROM} AS sol
          INNER JOIN ${SALES_ORDER_FROM} AS so
            ON LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(so.[xsaj01], N'')))) =
               LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(sol.[xsak01], N''))))
          WHERE LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(sol.[kcaa01], N'')))) = @product
            AND (${DEL_ACTIVE.replace(/\bdel\b/g, 'sol.del')})
            AND (${PASS_AUDITED.replace(/\bpass\b/g, 'sol.pass')})
            AND (${DEL_ACTIVE.replace(/\bdel\b/g, 'so.del')})
            AND (${PASS_AUDITED.replace(/\bpass\b/g, 'so.pass')})
            ${dateWhere}
          ORDER BY so.[xsaj02] DESC, sol.[xsak01] DESC
        `)

        /** @type {Array<{ piNo: string, poNo: string, salesDate: string, productCode: string, piCustomerStyle: string, salesQty: number }>} */
        const uniqueRows = []
        /** @type {Set<string>} */
        const seen = new Set()
        for (const row of piR.recordset ?? []) {
          const piNo = text(row.piNo)
          const pq = text(row.productCode)
          const cust = text(row.piCustomerStyle)
          const sq = toNum(row.salesQty)
          const dedupeKey = `${piNo}\x1f${pq}\x1f${cust}\x1f${sq}`
          if (seen.has(dedupeKey)) continue
          seen.add(dedupeKey)
          uniqueRows.push({
            piNo,
            poNo: text(row.poNo),
            salesDate: text(row.salesDate),
            productCode: pq,
            piCustomerStyle: cust,
            salesQty: sq,
          })
        }

        const usagePairs = await Promise.all(
          uniqueRows.map(async (row) => {
            const [materialUsage, pricedUsage] = await Promise.all([
              fetchMaterialUsageFromConsumption(pool, row.piNo, row.productCode, materialCode),
              fetchPricedUsageFromCost(pool, row.piNo, row.productCode, materialCode),
            ])
            return { ...row, materialUsage, pricedUsage }
          }),
        )
        for (const row of usagePairs) pis.push(row)
      }

      res.json({
        code: 200,
        msg: 'success',
        data: {
          current: {
            id: Number(current.id),
            sid: text(current.sid),
            kcaa01: text(current.kcaa01),
            kcaa02: text(current.kcaa02),
            kcaa03: text(current.kcaa03),
            kcaa04: text(current.kcaa04),
            kcac01: text(current.kcac01),
            kcac04: toNum(current.kcac04),
            kcac05: toNum(current.kcac05),
            kcac06: toNum(current.kcac06),
            Describe: text(current.Describe),
            pass: text(current.pass),
          },
          ancestors,
          product,
          pis,
        },
      })
    } catch (err) {
      console.error('GET /api/traceability/pi-trace/reverse/detail 失败：', err)
      const detail = String(err?.message ?? err?.originalError?.message ?? '数据库查询失败')
      res.status(500).json({ code: 500, msg: `PI反向追溯详情失败：${detail}`, data: null })
    }
  })
}
