/**
 * 销售订单按行同步 BOM（issue 04）
 */
import { sql } from './db.js'
import { normKcaa01 } from './salesOrderSaveLogic.js'
import { formatSalesOrderAuditTime, replacePiBomFromMasterBom } from './salesOrderPiBom.js'
import { SALES_ORDER_HEADER_TABLE } from './salesOrderListQuery.js'
import {
  parseSyncBomKcaa01,
  validateSyncBomLineOnOrder,
  validateSyncBomOrderState,
} from './salesOrderSyncBomLogic.js'

const HEADER_FROM = `dbo.[${SALES_ORDER_HEADER_TABLE}]`
const LINE_FROM = 'dbo.[UB_ERP_Sales_order_list]'

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {number} id
 */
async function fetchOrderHeaderForSync(pool, id) {
  const r = await pool.request().input('id', sql.Int, id).query(`
    SELECT TOP 1
      [id],
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([xsaj01], N'')))) AS piNo,
      LTRIM(RTRIM(ISNULL([pass], N''))) AS pass,
      LTRIM(RTRIM(ISNULL([del], N''))) AS del
    FROM ${HEADER_FROM}
    WHERE [id] = @id
  `)
  return r.recordset?.[0] ?? null
}

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {string} piNo
 */
async function fetchOrderLineKcaa01Set(pool, piNo) {
  const pi = normKcaa01(piNo)
  const r = await pool.request().input('pi', sql.NVarChar(200), pi).query(`
    SELECT LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL([kcaa01], N'')))) AS kcaa01
    FROM ${LINE_FROM}
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([xsak01], N'')))) = @pi
  `)
  return (r.recordset ?? []).map((row) => normKcaa01(row.kcaa01)).filter(Boolean)
}

/**
 * @param {{
 *   pool: import('mssql').ConnectionPool,
 *   id: number,
 *   kcaa01: unknown,
 *   actor: { uidInt: number | null, uname: string | null, utruename: string | null },
 *   ip: string,
 * }} opts
 */
export async function syncSalesOrderBomForLine(opts) {
  const { pool, id, actor, ip } = opts
  const parsed = parseSyncBomKcaa01(opts.kcaa01)
  if (!parsed.ok) return { ok: false, status: 400, msg: parsed.msg }

  const header = await fetchOrderHeaderForSync(pool, id)
  if (!header) return { ok: false, status: 404, msg: '记录不存在' }

  const stateErr = validateSyncBomOrderState(header)
  if (stateErr) return { ok: false, status: 400, msg: stateErr }

  const piNo = normKcaa01(header.piNo)
  const lineCodes = await fetchOrderLineKcaa01Set(pool, piNo)
  const lineErr = validateSyncBomLineOnOrder(parsed.kcaa01, lineCodes)
  if (lineErr) return { ok: false, status: 400, msg: lineErr }

  const actorRow = {
    uname: actor.uname,
    utruename: actor.utruename,
    uid: actor.uidInt != null ? String(actor.uidInt) : '',
    ip,
  }

  const tx = new sql.Transaction(pool)
  await tx.begin()
  try {
    await replacePiBomFromMasterBom(pool, tx, piNo, parsed.kcaa01, actorRow)

    const now = formatSalesOrderAuditTime()
    const up = new sql.Request(tx)
    up.input('id', sql.Int, id)
    up.input('uname', sql.NVarChar(100), String(actor.uname ?? ''))
    up.input('utruename', sql.NVarChar(100), String(actor.utruename ?? ''))
    up.input('uid', sql.NVarChar(50), actorRow.uid)
    up.input('edittime', sql.NVarChar(50), now)
    up.input('ip', sql.NVarChar(100), ip)
    await up.query(`
      UPDATE ${HEADER_FROM}
      SET [is_pur] = N'0',
          [uname] = @uname,
          [utruename] = @utruename,
          [uid] = @uid,
          [edittime] = @edittime,
          [ip] = @ip
      WHERE [id] = @id
    `)

    await tx.commit()
    return { ok: true, piNo, kcaa01: parsed.kcaa01, markUncalc: true }
  } catch (err) {
    try {
      await tx.rollback()
    } catch {
      // ignore
    }
    if (err?.code === 'BOM_CYCLE' || err?.code === 'BOM_DEPTH' || err?.code === 'BOM_NOT_FOUND') {
      return { ok: false, status: 400, msg: String(err.message) }
    }
    throw err
  }
}
