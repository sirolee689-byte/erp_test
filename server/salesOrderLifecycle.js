/**
 * 销售订单生命周期：审核 / 反审 / 软删 / 恢复 / 彻底删除（issue 03）
 */
import { sql } from './db.js'
import { normKcaa01 } from './salesOrderSaveLogic.js'
import { formatSalesOrderAuditTime } from './salesOrderPiBom.js'
import { SALES_ORDER_HEADER_TABLE } from './salesOrderListQuery.js'

const HEADER_FROM = `dbo.[${SALES_ORDER_HEADER_TABLE}]`
const LINE_FROM = 'dbo.[UB_ERP_Sales_order_list]'
const PI_BOM_HEAD_FROM = 'dbo.[UB_ERP_Bom_Sales]'
const PI_BOM_LIST_FROM = 'dbo.[UB_ERP_Bom_Sales_list]'
const PI_COST_FROM = 'dbo.[UB_ERP_Bom_pi_cost]'
const PI_CONSUMPTION_TABLE = 'UB_ERP_Bom_pi_consumption'
const PI_CONSUMPTION_FROM = `dbo.[${PI_CONSUMPTION_TABLE}]`

/** @type {Promise<Set<string>> | null} */
let HEADER_COLS_PROMISE = null
/** @type {Promise<boolean> | null} */
let PI_CONSUMPTION_EXISTS_PROMISE = null

/**
 * @param {import('mssql').ConnectionPool} pool
 */
async function loadHeaderColumnSet(pool) {
  if (!HEADER_COLS_PROMISE) {
    HEADER_COLS_PROMISE = pool
      .request()
      .input('t', sql.NVarChar(200), SALES_ORDER_HEADER_TABLE)
      .query(
        `
        SELECT c.COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS AS c
        WHERE c.TABLE_NAME = @t
      `,
      )
      .then((r) => new Set((r.recordset ?? []).map((row) => String(row.COLUMN_NAME).toLowerCase())))
  }
  return HEADER_COLS_PROMISE
}

/**
 * @param {import('mssql').ConnectionPool} pool
 */
async function piConsumptionTableExists(pool) {
  if (!PI_CONSUMPTION_EXISTS_PROMISE) {
    PI_CONSUMPTION_EXISTS_PROMISE = pool
      .request()
      .input('t', sql.NVarChar(200), PI_CONSUMPTION_TABLE)
      .query(
        `
        SELECT 1 AS ok
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_NAME = @t
      `,
      )
      .then((r) => (r.recordset?.length ?? 0) > 0)
  }
  return PI_CONSUMPTION_EXISTS_PROMISE
}

/**
 * 探测审核时间/人列（仅显式 pass/audit 命名，避免误写 intime 等业务列）
 * @param {Set<string>} colSet
 */
export function pickSalesOrderAuditColumnNames(colSet) {
  const has = (name) => colSet.has(String(name).toLowerCase())
  const passTime =
    ['passtime', 'pass_time', 'audittime', 'audit_time', 'shtime'].find((c) => has(c)) ?? null
  const passUid = ['pass_uid', 'passuid'].find((c) => has(c)) ?? null
  const passUname = ['passuname', 'pass_uname'].find((c) => has(c)) ?? null
  const passUtruename = ['passutruename', 'pass_utruename'].find((c) => has(c)) ?? null
  return { passTime, passUid, passUname, passUtruename }
}

/**
 * @param {unknown} idRaw
 */
export function parseSalesOrderId(idRaw) {
  const id = Number(String(idRaw ?? '').trim())
  if (!Number.isFinite(id) || id <= 0) return { ok: false, msg: '参数错误：id' }
  return { ok: true, id }
}

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {number} id
 */
export async function fetchSalesOrderHeaderStatus(pool, id) {
  const r = await pool.request().input('id', sql.Int, id).query(`
    SELECT TOP 1
      [id],
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([xsaj01], N'')))) AS piNo,
      LTRIM(RTRIM(ISNULL([pass], N''))) AS pass,
      LTRIM(RTRIM(ISNULL([del], N''))) AS del
    FROM ${HEADER_FROM}
    WHERE [id] = @id
  `)
  const row = r.recordset?.[0]
  if (!row) return null
  return {
    id: Number(row.id),
    piNo: String(row.piNo ?? '').trim(),
    pass: String(row.pass ?? '').trim(),
    del: String(row.del ?? '').trim(),
  }
}

function isAudited(pass) {
  return String(pass ?? '').trim() === '1'
}

function isRecycled(del) {
  return String(del ?? '').trim() === '1'
}

/**
 * @param {Set<string>} cols
 * @param {string[]} names
 */
function firstExistingCol(cols, names) {
  return names.find((n) => cols.has(n.toLowerCase())) ?? null
}

/**
 * @param {{
 *   cols: Set<string>,
 *   auditCols: ReturnType<typeof pickSalesOrderAuditColumnNames>,
 *   actor: { uidInt: number | null, uname: string | null, utruename: string | null },
 *   now: string,
 *   mode: 'approve' | 'unapprove',
 * }} opts
 */
export function buildPassAuditSetClauses(opts) {
  const { cols, auditCols, actor, now, mode } = opts
  /** @type {string[]} */
  const sets = [`[pass] = ${mode === 'approve' ? "N'1'" : "N'0'"}`]
  if (cols.has('edittime')) sets.push('[edittime] = @edittime')

  if (mode === 'approve') {
    if (auditCols.passTime) sets.push(`[${auditCols.passTime}] = @auditTime`)
    if (auditCols.passUid) sets.push(`[${auditCols.passUid}] = @passUid`)
    if (auditCols.passUname) sets.push(`[${auditCols.passUname}] = @passUname`)
    if (auditCols.passUtruename) sets.push(`[${auditCols.passUtruename}] = @passUtruename`)
  }

  return { sets, now, actor }
}

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {number} id
 * @param {{ uidInt: number | null, uname: string | null, utruename: string | null }} actor
 */
export async function approveSalesOrder(pool, id, actor) {
  const row = await fetchSalesOrderHeaderStatus(pool, id)
  if (!row) return { ok: false, status: 404, msg: '记录不存在' }
  if (isRecycled(row.del)) return { ok: false, status: 400, msg: '回收站记录不可审核，请先恢复' }
  if (isAudited(row.pass)) return { ok: false, status: 400, msg: '审核失败：记录不存在或已审核' }

  const cols = await loadHeaderColumnSet(pool)
  const auditCols = pickSalesOrderAuditColumnNames(cols)
  const now = formatSalesOrderAuditTime()
  const { sets } = buildPassAuditSetClauses({ cols, auditCols, actor, now, mode: 'approve' })

  const req = pool.request()
  req.input('id', sql.Int, id)
  req.input('edittime', sql.NVarChar(50), now)
  if (auditCols.passTime) req.input('auditTime', sql.NVarChar(50), now)
  if (auditCols.passUid) req.input('passUid', sql.NVarChar(50), actor.uidInt != null ? String(actor.uidInt) : '')
  if (auditCols.passUname) req.input('passUname', sql.NVarChar(100), String(actor.uname ?? ''))
  if (auditCols.passUtruename) req.input('passUtruename', sql.NVarChar(100), String(actor.utruename ?? ''))

  const rs = await req.query(`
    UPDATE ${HEADER_FROM}
    SET ${sets.join(', ')}
    WHERE [id] = @id
      AND LTRIM(RTRIM(ISNULL([pass], N''))) <> N'1'
      AND (ISNULL([del], N'') = N'' OR [del] = N'0')
  `)
  const affected = Number(rs.rowsAffected?.[0] ?? 0)
  if (affected <= 0) return { ok: false, status: 400, msg: '审核失败：记录不存在或已审核' }
  return { ok: true, piNo: row.piNo }
}

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {number} id
 * @param {{ uidInt: number | null, uname: string | null, utruename: string | null }} actor
 */
export async function unapproveSalesOrder(pool, id, actor) {
  const row = await fetchSalesOrderHeaderStatus(pool, id)
  if (!row) return { ok: false, status: 404, msg: '记录不存在' }
  if (isRecycled(row.del)) return { ok: false, status: 400, msg: '回收站记录不可反审' }
  if (!isAudited(row.pass)) return { ok: false, status: 400, msg: '反审失败：记录未审核或不存在' }

  const cols = await loadHeaderColumnSet(pool)
  const auditCols = pickSalesOrderAuditColumnNames(cols)
  const now = formatSalesOrderAuditTime()
  const { sets } = buildPassAuditSetClauses({ cols, auditCols, actor, now, mode: 'unapprove' })

  const req = pool.request()
  req.input('id', sql.Int, id)
  req.input('edittime', sql.NVarChar(50), now)

  const rs = await req.query(`
    UPDATE ${HEADER_FROM}
    SET ${sets.join(', ')}
    WHERE [id] = @id
      AND LTRIM(RTRIM(ISNULL([pass], N''))) = N'1'
      AND (ISNULL([del], N'') = N'' OR [del] = N'0')
  `)
  const affected = Number(rs.rowsAffected?.[0] ?? 0)
  if (affected <= 0) return { ok: false, status: 400, msg: '反审失败：记录未审核或不存在' }
  return { ok: true, piNo: row.piNo }
}

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {number} id
 * @param {{ uidInt: number | null, uname: string | null, utruename: string | null }} actor
 */
export async function softDeleteSalesOrder(pool, id, actor) {
  const row = await fetchSalesOrderHeaderStatus(pool, id)
  if (!row) return { ok: false, status: 404, msg: '记录不存在' }
  if (isAudited(row.pass)) return { ok: false, status: 400, msg: '已审核订单不可删除，请先反审' }
  if (isRecycled(row.del)) return { ok: false, status: 400, msg: '删除失败：记录状态已变化' }

  const cols = await loadHeaderColumnSet(pool)
  const now = formatSalesOrderAuditTime()
  /** @type {string[]} */
  const sets = [`[del] = N'1'`]
  const deltimeCol = firstExistingCol(cols, ['deltime'])
  if (deltimeCol) sets.push(`[${deltimeCol}] = @deltime`)
  if (cols.has('edittime')) sets.push('[edittime] = @edittime')
  const delnameCol = firstExistingCol(cols, ['delname'])
  const deltruenameCol = firstExistingCol(cols, ['deltruename'])
  if (delnameCol) sets.push(`[${delnameCol}] = @delname`)
  if (deltruenameCol) sets.push(`[${deltruenameCol}] = @deltruename`)

  const req = pool.request()
  req.input('id', sql.Int, id)
  req.input('deltime', sql.NVarChar(50), now)
  req.input('edittime', sql.NVarChar(50), now)
  req.input('delname', sql.NVarChar(100), String(actor.uname ?? ''))
  req.input('deltruename', sql.NVarChar(100), String(actor.utruename ?? ''))

  const rs = await req.query(`
    UPDATE ${HEADER_FROM}
    SET ${sets.join(', ')}
    WHERE [id] = @id
      AND LTRIM(RTRIM(ISNULL([pass], N''))) <> N'1'
      AND (ISNULL([del], N'') = N'' OR [del] = N'0')
  `)
  const affected = Number(rs.rowsAffected?.[0] ?? 0)
  if (affected <= 0) return { ok: false, status: 400, msg: '删除失败：记录状态已变化' }
  return { ok: true, piNo: row.piNo, pass: row.pass }
}

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {number} id
 * @param {{ uidInt: number | null, uname: string | null, utruename: string | null }} actor
 */
export async function restoreSalesOrder(pool, id, actor) {
  const row = await fetchSalesOrderHeaderStatus(pool, id)
  if (!row) return { ok: false, status: 404, msg: '记录不存在' }
  if (!isRecycled(row.del)) return { ok: false, status: 400, msg: '恢复失败：记录不在回收站' }

  const cols = await loadHeaderColumnSet(pool)
  const now = formatSalesOrderAuditTime()
  /** @type {string[]} */
  const sets = [`[del] = N'0'`]
  const deltimeCol = firstExistingCol(cols, ['deltime'])
  if (deltimeCol) sets.push(`[${deltimeCol}] = NULL`)
  if (cols.has('edittime')) sets.push('[edittime] = @edittime')

  const req = pool.request()
  req.input('id', sql.Int, id)
  req.input('edittime', sql.NVarChar(50), now)

  const rs = await req.query(`
    UPDATE ${HEADER_FROM}
    SET ${sets.join(', ')}
    WHERE [id] = @id
      AND LTRIM(RTRIM(ISNULL([del], N''))) = N'1'
  `)
  const affected = Number(rs.rowsAffected?.[0] ?? 0)
  if (affected <= 0) return { ok: false, status: 400, msg: '恢复失败：记录不在回收站' }
  return { ok: true, piNo: row.piNo, pass: row.pass }
}

/**
 * @param {import('mssql').Transaction} tx
 * @param {string} piNo
 * @param {boolean} hasConsumptionTable
 */
async function deletePiRelatedByPiNo(tx, piNo, hasConsumptionTable) {
  const pi = normKcaa01(piNo)
  const delList = new sql.Request(tx)
  delList.input('pi', sql.NVarChar(200), pi)
  await delList.query(`DELETE FROM ${PI_BOM_LIST_FROM} WHERE LTRIM(RTRIM(ISNULL([sid], N''))) = @pi`)

  const delHead = new sql.Request(tx)
  delHead.input('pi', sql.NVarChar(200), pi)
  await delHead.query(`DELETE FROM ${PI_BOM_HEAD_FROM} WHERE LTRIM(RTRIM(ISNULL([sid], N''))) = @pi`)

  const delCost = new sql.Request(tx)
  delCost.input('pi', sql.NVarChar(200), pi)
  await delCost.query(`DELETE FROM ${PI_COST_FROM} WHERE LTRIM(RTRIM(ISNULL([sid], N''))) = @pi`)

  if (hasConsumptionTable) {
    const delCons = new sql.Request(tx)
    delCons.input('pi', sql.NVarChar(200), pi)
    await delCons.query(`DELETE FROM ${PI_CONSUMPTION_FROM} WHERE LTRIM(RTRIM(ISNULL([sid], N''))) = @pi`)
  }

  const delLines = new sql.Request(tx)
  delLines.input('pi', sql.NVarChar(200), pi)
  await delLines.query(`
    DELETE FROM ${LINE_FROM}
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([xsak01], N'')))) = @pi
  `)
}

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {number} id
 */
export async function hardDeleteSalesOrder(pool, id) {
  const row = await fetchSalesOrderHeaderStatus(pool, id)
  if (!row) return { ok: false, status: 404, msg: '记录不存在' }
  if (!isRecycled(row.del)) return { ok: false, status: 400, msg: '仅允许彻底删除回收站中的记录' }
  if (isAudited(row.pass)) return { ok: false, status: 400, msg: '已审核订单不可彻底删除，请先反审' }

  const piNo = normKcaa01(row.piNo)
  if (!piNo) return { ok: false, status: 400, msg: 'PI 号为空，无法彻底删除' }

  const hasConsumption = await piConsumptionTableExists(pool)
  const tx = new sql.Transaction(pool)
  await tx.begin()
  try {
    await deletePiRelatedByPiNo(tx, piNo, hasConsumption)

    const delHdr = new sql.Request(tx)
    delHdr.input('id', sql.Int, id)
    delHdr.input('pi', sql.NVarChar(200), piNo)
    const dr = await delHdr.query(`
      DELETE FROM ${HEADER_FROM}
      WHERE [id] = @id
        AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([xsaj01], N'')))) = @pi
        AND LTRIM(RTRIM(ISNULL([del], N''))) = N'1'
        AND LTRIM(RTRIM(ISNULL([pass], N''))) <> N'1'
    `)
    const affected = Number(dr.rowsAffected?.[0] ?? 0)
    if (affected <= 0) {
      await tx.rollback()
      return { ok: false, status: 400, msg: '彻底删除失败：状态不符' }
    }
    await tx.commit()
    return { ok: true, piNo }
  } catch (err) {
    try {
      await tx.rollback()
    } catch {
      // ignore
    }
    throw err
  }
}
