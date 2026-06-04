/**
 * 销售订单保存服务（事务：主表 + 明细替换 + PI BOM 对齐）
 */
import crypto from 'node:crypto'
import { sql } from './db.js'
import {
  mergeSalesOrderLinesByKcaa01,
  normKcaa01,
  planPiBomAlign,
  shouldMarkSalesOrderUncalculated,
  validateSalesOrderSavePayload,
} from './salesOrderSaveLogic.js'
import {
  applyPiBomAlignPlan,
  fetchPiBomHeadKcaa01Set,
  formatSalesOrderAuditTime,
} from './salesOrderPiBom.js'
import { SALES_ORDER_HEADER_TABLE } from './salesOrderListQuery.js'
import {
  INV_BOM_MASTER_FROM as BOM_MASTER_FROM,
  INV_BOM_MASTER_TABLE as BOM_MASTER_TABLE,
} from './bomTables.js'
import {
  BOM000_EXTENDED_SNAPSHOT_COLUMNS,
  mapBom000ExtendedSnapshotRow,
  SALES_ORDER_LINE_BOM000_EXTENDED_COLUMNS,
} from './salesOrderLineBom000Snapshot.js'

const HEADER_FROM = `dbo.[${SALES_ORDER_HEADER_TABLE}]`
const LINE_TABLE = 'UB_ERP_Sales_order_list'
const LINE_FROM = `dbo.[${LINE_TABLE}]`
const CUSTOMER_FROM = 'dbo.[System_sales_customer]'
const CURRENCY_FROM = 'dbo.[bom_currency]'
const SALES_ORDER_EMPTY_TEXT = ''
const SALES_ORDER_LINE_REQUIRED_COLUMNS = [
  'xsak02',
  'kcac01',
  'kcac02',
  'kcac03',
  'GUID',
  'systemcode',
  'kcaa07',
  'kcaa08',
  'kcaa11',
  'kcaa12',
  'kcaa13',
  'kcaa14',
  'kcaa15',
  'kcaa25',
  'kcaa26',
  'kcaa16',
  'kcaa27',
  'kcaa28',
  'kcaa29',
  'kcaa30',
  'kcaa31',
  'type',
  'location',
  'remark',
  'pass',
  ...SALES_ORDER_LINE_BOM000_EXTENDED_COLUMNS,
]
const BOM_SNAPSHOT_REQUIRED_COLUMNS = [
  'GUID',
  'kcaa07',
  'kcaa08',
  'kcaa11',
  'kcaa12',
  'kcaa13',
  'kcaa14',
  'kcaa15',
  'kcaa25',
  'kcaa26',
  'kcaa16',
  'kcaa27',
  'kcaa28',
  'kcaa29',
  'kcaa30',
  'kcaa31',
  'type',
  'location',
  'remark',
  'pass',
  ...BOM000_EXTENDED_SNAPSHOT_COLUMNS,
]

export function buildSalesOrderGuid() {
  const d = new Date()
  const stamp = `${d.getFullYear()}${d.getMonth() + 1}${d.getDate()}${d.getHours()}${d.getMinutes()}${d.getSeconds()}`
  return `PI-${stamp}${crypto.randomBytes(16).toString('hex').toUpperCase()}`
}

/** @param {import('express').Request} req */
export function getClientIpFromReq(req) {
  const forwarded = String(req.headers?.['x-forwarded-for'] ?? '').trim()
  if (forwarded) return forwarded.split(',')[0].trim()
  return String(req.ip || req.socket?.remoteAddress || '').trim()
}

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {string} piNo
 * @param {number | null} excludeId
 */
export async function assertPiNoUnique(pool, piNo, excludeId) {
  const req = pool.request()
  req.input('pi', sql.NVarChar(200), normKcaa01(piNo))
  let sqlText = `
    SELECT COUNT(1) AS c
    FROM ${HEADER_FROM}
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([xsaj01], N'')))) = @pi
  `
  if (excludeId != null && Number.isFinite(excludeId) && excludeId > 0) {
    req.input('excludeId', sql.Int, excludeId)
    sqlText += ' AND [id] <> @excludeId'
  }
  const r = await req.query(sqlText)
  const c = Number(r.recordset?.[0]?.c ?? 0)
  if (c > 0) return `PI 号「${normKcaa01(piNo)}」已存在`
  return null
}

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {string} customerCode
 */
export async function assertCustomerAudited(pool, customerCode) {
  const code = normKcaa01(customerCode)
  const r = await pool.request().input('code', sql.NVarChar(200), code).query(`
    SELECT TOP 1
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.[s_code], N'')))) AS s_code,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(c.[s_name], N'')))) AS s_name
    FROM ${CUSTOMER_FROM} AS c
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.[s_code], N'')))) = @code
      AND (ISNULL(c.[del], N'') = N'' OR c.[del] = N'0')
      AND LTRIM(RTRIM(ISNULL(c.[pass], N''))) = N'1'
  `)
  const row = r.recordset?.[0]
  if (!row) return { ok: false, msg: `客户「${code}」不存在或未审核` }
  return { ok: true, customerName: String(row.s_name ?? '').trim() }
}

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {string} currencyCode
 */
export async function resolveCurrency(pool, currencyCode) {
  const raw = String(currencyCode ?? '').trim()
  const r = await pool.request().input('id', sql.Int, Number(raw)).query(`
    SELECT TOP 1
      CAST([id] AS nvarchar(20)) AS id,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL([cn_name], N'')))) AS cn_name
    FROM ${CURRENCY_FROM}
    WHERE [id] = @id
      AND (ISNULL([del], N'') = N'' OR [del] = N'0')
  `)
  const row = r.recordset?.[0]
  if (!row?.cn_name) return { ok: false, msg: '币别无效' }
  return { ok: true, currencyId: Number(row.id), currencyName: String(row.cn_name).trim() }
}

/**
 * @param {import('mssql').ConnectionPool | import('mssql').Transaction} db
 * @param {string} tableName
 * @param {string[]} required
 */
async function assertTableColumns(db, tableName, required) {
  const req = new sql.Request(db)
  req.input('tableName', sql.NVarChar(128), tableName)
  const r = await req.query(`
    SELECT [COLUMN_NAME] AS name
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE [TABLE_SCHEMA] = N'dbo'
      AND [TABLE_NAME] = @tableName
  `)
  const existing = new Set((r.recordset ?? []).map((row) => String(row.name ?? '').toLowerCase()))
  const missing = required.filter((name) => !existing.has(String(name).toLowerCase()))
  if (missing.length) {
    const err = new Error(`${tableName} 缺少字段：${missing.join('、')}`)
    err.code = 'SCHEMA_MISSING'
    throw err
  }
}

function toNullableNumber(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * @param {import('mssql').ConnectionPool | import('mssql').Transaction} db
 * @param {string} kcaa01
 */
export async function fetchBom000SnapshotForLine(db, kcaa01) {
  const code = normKcaa01(kcaa01)
  const r = await new sql.Request(db).input('kcaa01', sql.NVarChar(300), code).query(`
    SELECT TOP 1
      LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.[kcaa01], N'')))) AS kcaa01,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.[kcaa02], N'')))) AS kcaa02,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.[kcaa03], N'')))) AS kcaa03,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.[kcaa04], N'')))) AS kcaa04,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.[kcaa05], N'')))) AS kcaa05,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.[kcaa06], N'')))) AS kcaa06,
      LTRIM(RTRIM(ISNULL(CAST(b.[GUID] AS nvarchar(500)), N''))) AS bomGuid,
      b.[kcaa07] AS kcaa07,
      b.[kcaa08] AS kcaa08,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.[kcaa11], N'')))) AS kcaa11,
      b.[kcaa12] AS kcaa12,
      b.[kcaa13] AS kcaa13,
      b.[kcaa14] AS kcaa14,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.[kcaa15], N'')))) AS kcaa15,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.[kcaa25], N'')))) AS kcaa25,
      b.[kcaa26] AS kcaa26,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.[kcaa16], N'')))) AS kcaa16,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.[kcaa27], N'')))) AS kcaa27,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.[kcaa28], N'')))) AS kcaa28,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.[kcaa29], N'')))) AS kcaa29,
      b.[kcaa30] AS kcaa30,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.[kcaa31], N'')))) AS kcaa31,
      b.[type] AS type,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(b.[location], N'')))) AS location,
      CONVERT(nvarchar(max), ISNULL(b.[remark], N'')) AS remark,
      LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(b.[pass], N'')))) AS pass,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.[kcaa09], N'')))) AS kcaa09,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.[kcaa10], N'')))) AS kcaa10,
      b.[version] AS version,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.[kcaa02_en], N'')))) AS kcaa02_en,
      b.[kcaa32] AS kcaa32,
      b.[kcaa33] AS kcaa33,
      LTRIM(RTRIM(CONVERT(nvarchar(80), ISNULL(b.[kcaa34], N'')))) AS kcaa34,
      LTRIM(RTRIM(CONVERT(nvarchar(80), ISNULL(b.[kcaa35], N'')))) AS kcaa35,
      b.[sale_price] AS sale_price,
      b.[cost_price] AS cost_price
    FROM ${BOM_MASTER_FROM} AS b
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.[kcaa01], N'')))) = @kcaa01
      AND (ISNULL(b.[del], N'') = N'' OR b.[del] = N'0')
    ORDER BY b.[id] DESC
  `)
  const row = r.recordset?.[0]
  if (!row) return null
  return { ...row, ...mapBom000ExtendedSnapshotRow(row) }
}

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {Date} salesDate
 */
export async function listSystemCodesForSalesDate(pool, salesDate) {
  const d = salesDate instanceof Date ? salesDate : new Date(String(salesDate))
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const prefix = `PI-${y}${m}${day}-`
  const r = await pool.request().input('pfx', sql.NVarChar(50), `${prefix}%`).query(`
    SELECT LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL([syscode], N'')))) AS syscode
    FROM ${HEADER_FROM}
    WHERE [syscode] LIKE @pfx
  `)
  return (r.recordset ?? []).map((row) => String(row.syscode ?? '').trim()).filter(Boolean)
}

/**
 * @param {import('mssql').Transaction} tx
 * @param {string} piNo
 */
async function replaceOrderLines(tx, piNo, mergedLines, actor) {
  const pi = normKcaa01(piNo)
  const parentGuid = normKcaa01(actor.parentGuid)
  if (!parentGuid) {
    const err = new Error('销售订单主表缺少 GUID/systemcode，无法写入明细 kcac01')
    err.code = 'SCHEMA_MISSING'
    throw err
  }
  await assertTableColumns(tx, LINE_TABLE, SALES_ORDER_LINE_REQUIRED_COLUMNS)
  await assertTableColumns(tx, BOM_MASTER_TABLE, BOM_SNAPSHOT_REQUIRED_COLUMNS)
  const delReq = new sql.Request(tx)
  delReq.input('pi', sql.NVarChar(200), pi)
  await delReq.query(`
    DELETE FROM ${LINE_FROM}
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([xsak01], N'')))) = @pi
  `)

  let seq = 0
  for (const line of mergedLines) {
    const snap = await fetchBom000SnapshotForLine(tx, line.kcaa01)
    if (!snap) {
      const err = new Error(`货品 ${line.kcaa01} 不存在于货品资料`)
      err.code = 'PRODUCT_NOT_FOUND'
      throw err
    }
    const bomGuid = normKcaa01(snap.bomGuid)
    if (!bomGuid) {
      const err = new Error(`货品 ${line.kcaa01} 在 bom_000 中缺少 GUID，无法写入明细 xsak02/kcac02/GUID/systemcode`)
      err.code = 'PRODUCT_NOT_FOUND'
      throw err
    }
    seq += 1
    const ins = new sql.Request(tx)
    const now = formatSalesOrderAuditTime()
    ins.input('xsak01', sql.NVarChar(200), pi)
    ins.input('seq', sql.Int, seq)
    ins.input('xsak02', sql.NVarChar(500), bomGuid)
    ins.input('kcac01', sql.NVarChar(500), parentGuid)
    ins.input('kcac02', sql.NVarChar(500), bomGuid)
    ins.input('kcac03', sql.NVarChar(100), String(snap.kcaa25 ?? ''))
    ins.input('guid', sql.NVarChar(500), bomGuid)
    ins.input('systemcode', sql.NVarChar(500), bomGuid)
    ins.input('kcaa01', sql.NVarChar(300), line.kcaa01)
    ins.input('xsak03', sql.Decimal(18, 4), line.orderQty)
    ins.input('plan_quantity', sql.Decimal(18, 4), line.orderQty)
    const unitPrice = Number(line.unitPrice)
    const normalizedUnitPrice = Number.isFinite(unitPrice) ? unitPrice : 0
    ins.input('xsak04', sql.Decimal(18, 6), normalizedUnitPrice)
    ins.input('xsak05', sql.Decimal(18, 6), Number((Number(line.orderQty) * normalizedUnitPrice).toFixed(6)))
    ins.input('kcaa02', sql.NVarChar(500), String(snap.kcaa02 ?? ''))
    ins.input('kcaa03', sql.NVarChar(500), String(snap.kcaa03 ?? ''))
    ins.input('kcaa04', sql.NVarChar(100), String(snap.kcaa04 ?? ''))
    ins.input('kcaa05', sql.NVarChar(100), String(snap.kcaa05 ?? ''))
    ins.input('kcaa06', sql.NVarChar(100), String(snap.kcaa06 ?? ''))
    ins.input('kcaa07', sql.Decimal(18, 6), toNullableNumber(snap.kcaa07))
    ins.input('kcaa08', sql.Decimal(18, 6), toNullableNumber(snap.kcaa08))
    ins.input('kcaa11', sql.NVarChar(100), String(snap.kcaa11 ?? ''))
    ins.input('kcaa12', sql.Int, toNullableNumber(snap.kcaa12))
    ins.input('kcaa13', sql.Int, toNullableNumber(snap.kcaa13))
    ins.input('kcaa14', sql.Int, toNullableNumber(snap.kcaa14))
    ins.input('kcaa15', sql.NVarChar(100), String(snap.kcaa15 ?? ''))
    ins.input('kcaa25', sql.NVarChar(100), String(snap.kcaa25 ?? ''))
    ins.input('kcaa26', sql.Decimal(18, 6), toNullableNumber(snap.kcaa26))
    ins.input('kcaa16', sql.NVarChar(100), String(snap.kcaa16 ?? ''))
    ins.input('kcaa27', sql.NVarChar(100), String(snap.kcaa27 ?? ''))
    ins.input('kcaa28', sql.NVarChar(100), String(snap.kcaa28 ?? ''))
    ins.input('kcaa29', sql.NVarChar(100), String(snap.kcaa29 ?? ''))
    ins.input('kcaa30', sql.Decimal(18, 6), toNullableNumber(snap.kcaa30))
    ins.input('kcaa31', sql.NVarChar(100), String(snap.kcaa31 ?? ''))
    ins.input('kcaa09', sql.NVarChar(100), String(snap.kcaa09 ?? ''))
    ins.input('kcaa10', sql.NVarChar(100), String(snap.kcaa10 ?? ''))
    ins.input('type', sql.Int, snap.type ?? 1)
    ins.input('kcaa02_en', sql.NVarChar(500), String(snap.kcaa02_en ?? ''))
    ins.input('kcaa32', sql.Decimal(18, 6), snap.kcaa32)
    ins.input('kcaa33', sql.Decimal(18, 6), snap.kcaa33)
    ins.input('kcaa34', sql.NVarChar(80), String(snap.kcaa34 ?? ''))
    ins.input('kcaa35', sql.NVarChar(80), String(snap.kcaa35 ?? ''))
    ins.input('sale_price', sql.Decimal(18, 6), snap.sale_price)
    ins.input('cost_price', sql.Decimal(18, 6), snap.cost_price)
    ins.input('location', sql.NVarChar(200), String(snap.location ?? ''))
    const versionNo = Number(snap.version)
    ins.input('version', sql.Int, Number.isFinite(versionNo) ? versionNo : null)
    ins.input('lineRemark', sql.NVarChar(sql.MAX), String(snap.remark ?? ''))
    ins.input('linePass', sql.NVarChar(20), String(snap.pass ?? ''))
    ins.input('uname', sql.NVarChar(100), String(actor.uname ?? ''))
    ins.input('utruename', sql.NVarChar(100), String(actor.utruename ?? ''))
    ins.input('uid', sql.NVarChar(50), String(actor.uid ?? ''))
    ins.input('addtime', sql.NVarChar(50), now)
    await ins.query(`
      INSERT INTO ${LINE_FROM} (
        [xsak01], [seq], [xsak02], [kcac01], [kcac02], [kcac03], [GUID], [systemcode],
        [kcaa01], [xsak03], [plan_quantity], [xsak04], [xsak05],
        [kcaa02], [kcaa03], [kcaa04], [kcaa05], [kcaa06], [kcaa07], [kcaa08], [kcaa09], [kcaa10],
        [kcaa11], [kcaa12], [kcaa13], [kcaa14], [kcaa15], [kcaa25], [kcaa26], [kcaa16], [kcaa27], [kcaa28],
        [kcaa29], [kcaa30], [kcaa31], [kcaa02_en], [kcaa32], [kcaa33], [kcaa34], [kcaa35],
        [sale_price], [cost_price], [type], [location], [version], [remark],
        [uname], [utruename], [uid], [addtime], [del], [pass]
      ) VALUES (
        @xsak01, @seq, @xsak02, @kcac01, @kcac02, @kcac03, @guid, @systemcode,
        @kcaa01, @xsak03, @plan_quantity, @xsak04, @xsak05,
        @kcaa02, @kcaa03, @kcaa04, @kcaa05, @kcaa06, @kcaa07, @kcaa08, @kcaa09, @kcaa10,
        @kcaa11, @kcaa12, @kcaa13, @kcaa14, @kcaa15, @kcaa25, @kcaa26, @kcaa16, @kcaa27, @kcaa28,
        @kcaa29, @kcaa30, @kcaa31, @kcaa02_en, @kcaa32, @kcaa33, @kcaa34, @kcaa35,
        @sale_price, @cost_price, @type, @location, @version, @lineRemark,
        @uname, @utruename, @uid, @addtime, N'0', @linePass
      )
    `)
  }
}

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {number} orderId
 */
export async function fetchOrderLinesForCompare(pool, orderId) {
  const hr = await pool.request().input('id', sql.Int, orderId).query(`
    SELECT LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([xsaj01], N'')))) AS piNo
    FROM ${HEADER_FROM} WHERE [id] = @id
  `)
  const piNo = normKcaa01(hr.recordset?.[0]?.piNo)
  if (!piNo) return []
  const lr = await pool.request().input('pi', sql.NVarChar(200), piNo).query(`
    SELECT
      LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL([kcaa01], N'')))) AS kcaa01,
      CAST(ISNULL([xsak03], [plan_quantity]) AS decimal(18, 4)) AS orderQty
    FROM ${LINE_FROM}
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([xsak01], N'')))) = @pi
  `)
  return lr.recordset ?? []
}

/**
 * @param {{
 *   pool: import('mssql').ConnectionPool,
 *   body: Record<string, unknown>,
 *   actor: { uidInt: number | null, uname: string | null, utruename: string | null },
 *   ip: string,
 * }} opts
 */
export async function createSalesOrder(opts) {
  const { pool, body, actor, ip } = opts
  const header = body?.header && typeof body.header === 'object' ? body.header : {}
  const linesIn = Array.isArray(body?.lines) ? body.lines : []
  const payload = {
    piNo: header.piNo,
    poNo: header.poNo,
    salesDate: header.salesDate,
    deliveryDate: header.deliveryDate,
    customerCode: header.customerCode,
    currencyCode: header.currencyCode,
    lines: linesIn,
  }
  const valErr = validateSalesOrderSavePayload(payload)
  if (valErr) return { ok: false, status: 400, msg: valErr }

  const piNo = normKcaa01(header.piNo)
  const poNo = normKcaa01(header.poNo)
  const piDup = await assertPiNoUnique(pool, piNo, null)
  if (piDup) return { ok: false, status: 400, msg: piDup }

  const cust = await assertCustomerAudited(pool, String(header.customerCode))
  if (!cust.ok) return { ok: false, status: 400, msg: cust.msg }
  const cur = await resolveCurrency(pool, String(header.currencyCode))
  if (!cur.ok) return { ok: false, status: 400, msg: cur.msg }

  const salesDate = new Date(String(header.salesDate))

  const merged = mergeSalesOrderLinesByKcaa01(linesIn)
  const actorRow = {
    uname: actor.uname,
    utruename: actor.utruename,
    uid: actor.uidInt != null ? String(actor.uidInt) : '',
    ip,
    parentGuid: '',
  }

  /** @type {import('mssql').Transaction} */
  const tx = new sql.Transaction(pool)
  await tx.begin()
  try {
    const now = formatSalesOrderAuditTime()
    const ins = new sql.Request(tx)
    const salesOrderGuid = buildSalesOrderGuid()
    actorRow.parentGuid = salesOrderGuid
    ins.input('xsaj01', sql.NVarChar(200), piNo)
    ins.input('xsaj06', sql.NVarChar(200), poNo)
    ins.input('xsaj05', sql.NVarChar(200), normKcaa01(header.customerCode))
    ins.input('xsaj07', sql.Int, Number(cur.currencyId))
    ins.input('guid', sql.NVarChar(200), salesOrderGuid)
    ins.input('systemcode', sql.NVarChar(200), salesOrderGuid)
    ins.input('syscode', sql.NVarChar(50), SALES_ORDER_EMPTY_TEXT)
    ins.input('xsaj02', sql.DateTime, salesDate)
    ins.input('xsaj08', sql.DateTime, header.deliveryDate ? new Date(String(header.deliveryDate)) : null)
    ins.input('kehu', sql.NVarChar(500), cust.customerName ?? '')
    ins.input('d_code', sql.NVarChar(200), SALES_ORDER_EMPTY_TEXT)
    ins.input('rmb', sql.NVarChar(100), cur.currencyName ?? '')
    ins.input('type', sql.Int, 1)
    ins.input('remark', sql.NVarChar(sql.MAX), String(header.remark ?? ''))
    ins.input('decimal_view', sql.NVarChar(50), String(header.decimalPlaces ?? '2'))
    ins.input('uname', sql.NVarChar(100), String(actor.uname ?? ''))
    ins.input('utruename', sql.NVarChar(100), String(actor.utruename ?? ''))
    ins.input('uid', sql.NVarChar(50), actorRow.uid)
    ins.input('addtime', sql.NVarChar(50), now)
    ins.input('ip', sql.NVarChar(100), ip)
    const out = await ins.query(`
      INSERT INTO ${HEADER_FROM} (
        [xsaj01], [xsaj05], [xsaj06], [xsaj07], [GUID], [systemcode], [syscode], [xsaj02], [xsaj08],
        [kehu], [d_code], [rmb], [type], [remark], [decimal_view],
        [uname], [utruename], [uid], [addtime], [ip], [pass], [del], [is_pur]
      )
      OUTPUT INSERTED.[id] AS new_id
      VALUES (
        @xsaj01, @xsaj05, @xsaj06, @xsaj07, @guid, @systemcode, @syscode, @xsaj02, @xsaj08,
        @kehu, @d_code, @rmb, @type, @remark, @decimal_view,
        @uname, @utruename, @uid, @addtime, @ip, N'0', N'0', N'0'
      )
    `)
    const newId = Number(out.recordset?.[0]?.new_id)
    if (!Number.isFinite(newId) || newId <= 0) throw new Error('未能取得新订单 id')

    await replaceOrderLines(tx, piNo, merged, actorRow)

    const existingBom = await fetchPiBomHeadKcaa01Set(tx, piNo)
    const plan = planPiBomAlign({
      detailKcaa01: merged.map((x) => x.kcaa01),
      existingPiBomKcaa01: existingBom,
    })
    await applyPiBomAlignPlan(tx, pool, piNo, plan.toDelete, plan.toCreate, actorRow)

    await tx.commit()
    return { ok: true, id: newId }
  } catch (err) {
    try {
      await tx.rollback()
    } catch {
      // ignore
    }
    if (err?.code === 'BOM_CYCLE' || err?.code === 'BOM_DEPTH' || err?.code === 'BOM_NOT_FOUND') {
      return { ok: false, status: 400, msg: String(err.message) }
    }
    if (err?.code === 'PRODUCT_NOT_FOUND') {
      return { ok: false, status: 400, msg: String(err.message) }
    }
    if (err?.code === 'SCHEMA_MISSING') {
      return { ok: false, status: 500, msg: String(err.message) }
    }
    throw err
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
export async function updateSalesOrder(opts) {
  const { pool, id, body, actor, ip } = opts
  const hr = await pool.request().input('id', sql.Int, id).query(`
    SELECT TOP 1
      [id],
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([xsaj01], N'')))) AS piNo,
      LTRIM(RTRIM(ISNULL([pass], N''))) AS pass,
      LTRIM(RTRIM(ISNULL([del], N''))) AS del,
      LTRIM(RTRIM(ISNULL(CAST([GUID] AS nvarchar(500)), N''))) AS guid,
      LTRIM(RTRIM(ISNULL(CAST([systemcode] AS nvarchar(500)), N''))) AS systemcode,
      [xsaj02] AS salesDate
    FROM ${HEADER_FROM}
    WHERE [id] = @id
  `)
  const head = hr.recordset?.[0]
  if (!head) return { ok: false, status: 404, msg: '记录不存在' }
  if (String(head.pass ?? '').trim() === '1') {
    return { ok: false, status: 400, msg: '已审核订单不可保存，请先反审' }
  }
  if (String(head.del ?? '').trim() === '1') {
    return { ok: false, status: 400, msg: '回收站订单不可编辑' }
  }

  const piNo = normKcaa01(head.piNo)
  const header = body?.header && typeof body.header === 'object' ? body.header : {}
  const poNo = normKcaa01(header.poNo)
  const linesIn = Array.isArray(body?.lines) ? body.lines : []
  const payload = {
    piNo,
    poNo: header.poNo,
    salesDate: header.salesDate ?? head.salesDate,
    deliveryDate: header.deliveryDate,
    customerCode: header.customerCode,
    currencyCode: header.currencyCode,
    lines: linesIn,
  }
  const valErr = validateSalesOrderSavePayload(payload)
  if (valErr) return { ok: false, status: 400, msg: valErr }

  const cust = await assertCustomerAudited(pool, String(header.customerCode))
  if (!cust.ok) return { ok: false, status: 400, msg: cust.msg }
  const cur = await resolveCurrency(pool, String(header.currencyCode))
  if (!cur.ok) return { ok: false, status: 400, msg: cur.msg }

  const oldLines = await fetchOrderLinesForCompare(pool, id)
  const merged = mergeSalesOrderLinesByKcaa01(linesIn)
  const markUncalc = shouldMarkSalesOrderUncalculated(oldLines, merged)

  const actorRow = {
    uname: actor.uname,
    utruename: actor.utruename,
    uid: actor.uidInt != null ? String(actor.uidInt) : '',
    ip,
    parentGuid: normKcaa01(head.guid) || normKcaa01(head.systemcode),
  }

  const tx = new sql.Transaction(pool)
  await tx.begin()
  try {
    const now = formatSalesOrderAuditTime()
    const up = new sql.Request(tx)
    up.input('id', sql.Int, id)
    up.input('xsaj02', sql.DateTime, new Date(String(payload.salesDate)))
    up.input('xsaj08', sql.DateTime, header.deliveryDate ? new Date(String(header.deliveryDate)) : null)
    up.input('xsaj05', sql.NVarChar(200), normKcaa01(header.customerCode))
    up.input('xsaj06', sql.NVarChar(200), poNo)
    up.input('xsaj07', sql.Int, Number(cur.currencyId))
    up.input('kehu', sql.NVarChar(500), cust.customerName ?? '')
    up.input('d_code', sql.NVarChar(200), SALES_ORDER_EMPTY_TEXT)
    up.input('rmb', sql.NVarChar(100), cur.currencyName ?? '')
    up.input('remark', sql.NVarChar(sql.MAX), String(header.remark ?? ''))
    up.input('decimal_view', sql.NVarChar(50), String(header.decimalPlaces ?? '2'))
    up.input('uname', sql.NVarChar(100), String(actor.uname ?? ''))
    up.input('utruename', sql.NVarChar(100), String(actor.utruename ?? ''))
    up.input('uid', sql.NVarChar(50), actorRow.uid)
    up.input('edittime', sql.NVarChar(50), now)
    up.input('ip', sql.NVarChar(100), ip)
    let setSql = `
      [xsaj02]=@xsaj02,[xsaj08]=@xsaj08,[xsaj06]=@xsaj06,[kehu]=@kehu,[d_code]=@d_code,[rmb]=@rmb,
      [xsaj05]=@xsaj05,[xsaj07]=@xsaj07,
      [remark]=@remark,[decimal_view]=@decimal_view,
      [uname]=@uname,[utruename]=@utruename,[uid]=@uid,[edittime]=@edittime,[ip]=@ip
    `
    if (markUncalc) {
      setSql += `, [is_pur]=N'0'`
    }
    await up.query(`UPDATE ${HEADER_FROM} SET ${setSql} WHERE [id]=@id`)

    await replaceOrderLines(tx, piNo, merged, actorRow)

    const existingBom = await fetchPiBomHeadKcaa01Set(tx, piNo)
    const plan = planPiBomAlign({
      detailKcaa01: merged.map((x) => x.kcaa01),
      existingPiBomKcaa01: existingBom,
    })
    await applyPiBomAlignPlan(tx, pool, piNo, plan.toDelete, plan.toCreate, actorRow)

    await tx.commit()
    return { ok: true, id, markUncalc }
  } catch (err) {
    try {
      await tx.rollback()
    } catch {
      // ignore
    }
    if (err?.code === 'BOM_CYCLE' || err?.code === 'BOM_DEPTH' || err?.code === 'BOM_NOT_FOUND') {
      return { ok: false, status: 400, msg: String(err.message) }
    }
    if (err?.code === 'PRODUCT_NOT_FOUND') {
      return { ok: false, status: 400, msg: String(err.message) }
    }
    if (err?.code === 'SCHEMA_MISSING') {
      return { ok: false, status: 500, msg: String(err.message) }
    }
    throw err
  }
}
