import { sql } from './db.js'
import { formatSalesOrderAuditTime } from './salesOrderPiBom.js'
import { STOCK_OUT_HEADER_TABLE, STOCK_OUT_LINE_TABLE } from './stockOutListQuery.js'
import {
  buildStockOutAuditLogPayload,
  buildStockOutDeleteLogPayload,
  buildStockOutRestoreLogPayload,
  buildStockOutUnauditLogPayload,
  writeStockOutOperationLog,
} from './stockOutOperationLog.js'

const HEADER_FROM = `dbo.[${STOCK_OUT_HEADER_TABLE}]`
const LINE_FROM = `dbo.[${STOCK_OUT_LINE_TABLE}]`

const SOURCE_WRITEBACK_BY_TYPE = {
  1: { tableName: 'UB_ERP_Buy_order_list', writebackField: 'kcak07', convertUnit: true },
  2: { tableName: 'UB_ERP_assist_order_list', writebackField: 'wxak08', convertUnit: true },
  3: { tableName: 'UB_ERP_assist_order_list', writebackField: 'wxak08', convertUnit: true },
  4: { tableName: 'UB_ERP_Dispatch_order_list', writebackField: 'scak04', convertUnit: false },
  5: { tableName: 'UB_ERP_Dispatch_order_list', writebackField: 'scak05', convertUnit: false },
  6: { tableName: 'UB_ERP_Sales_order_list', writebackField: 'xsak06', convertUnit: false },
}

export function resolveStockOutSourceWritebackConfig(type) {
  return SOURCE_WRITEBACK_BY_TYPE[String(type ?? '').trim()] ?? null
}

function isOne(v) {
  return String(v ?? '').trim() === '1'
}

function hasColumn(cols, name) {
  return cols instanceof Set && cols.has(String(name ?? '').toLowerCase())
}

function isAdminActor(actor = {}) {
  return actor.isAdmin === true || actor.is_admin === 1 || actor.is_admin === '1' || actor.isAdmin === 1 || actor.role === 'admin'
}

const columnSetCache = new Map()

async function fetchColumnSet(pool, tableName) {
  const cacheKey = String(tableName ?? '').trim().toLowerCase()
  if (columnSetCache.has(cacheKey)) return columnSetCache.get(cacheKey)
  const r = await pool.request().input('tableName', sql.NVarChar(128), tableName).query(`
    SELECT LOWER([name]) AS name
    FROM sys.columns
    WHERE [object_id] = OBJECT_ID(N'dbo.[${tableName}]')
  `)
  const cols = new Set((r.recordset ?? []).map((row) => String(row.name ?? '').toLowerCase()))
  columnSetCache.set(cacheKey, cols)
  return cols
}

function chooseSourceKeyColumn(cols) {
  if (hasColumn(cols, 'systemcode')) return 'systemcode'
  if (hasColumn(cols, 'guid')) return 'GUID'
  if (hasColumn(cols, 'id')) return 'id'
  return ''
}

export function buildStockOutSourceWritebackSql({ tableName, writebackField, keyColumn, direction }) {
  const from = `dbo.[${tableName}]`
  const qtyExpr = `
        CASE
          WHEN @convertUnit = 1 AND ISNULL(src.[kcaa26], 0) > 0 AND LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(src.[kcaa27], N'')))) = N'1'
            THEN ISNULL(src.[kcaq03], 0) * ISNULL(src.[kcaa26], 0)
          WHEN @convertUnit = 1 AND ISNULL(src.[kcaa26], 0) > 0 AND LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(src.[kcaa27], N'')))) = N'0'
            THEN ISNULL(src.[kcaq03], 0) / ISNULL(src.[kcaa26], 0)
          ELSE ISNULL(src.[kcaq03], 0)
        END`
  const sourceAggSql = `
    SELECT
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(src.[kcaq02], N'')))) AS sourceLineCode,
      SUM(ABS(${qtyExpr})) AS delta
    FROM ${LINE_FROM} AS src
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(src.[kcaq01], N'')))) = @outboundNo
      AND (ISNULL(src.[del], N'') = N'' OR src.[del] = N'0')
      AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(src.[kcaq02], N'')))) <> N''
    GROUP BY LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(src.[kcaq02], N''))))
  `
  const keyJoinSql = String(keyColumn ?? '').toLowerCase() === 'id'
    ? `LTRIM(RTRIM(CONVERT(nvarchar(200), tgt.[${keyColumn}]))) = agg.[sourceLineCode]`
    : `tgt.[${keyColumn}] = agg.[sourceLineCode]`
  if (direction < 0) {
    return `
      UPDATE tgt
      SET [${writebackField}] = CASE WHEN ISNULL(tgt.[${writebackField}], 0) - agg.[delta] < 0 THEN 0 ELSE ISNULL(tgt.[${writebackField}], 0) - agg.[delta] END
      FROM ${from} AS tgt
      INNER JOIN (
        ${sourceAggSql}
      ) AS agg
        ON ${keyJoinSql}
    `
  }
  return `
    UPDATE tgt
    SET [${writebackField}] = ISNULL(tgt.[${writebackField}], 0) + agg.[delta]
    FROM ${from} AS tgt
    INNER JOIN (
      ${sourceAggSql}
    ) AS agg
      ON ${keyJoinSql}
  `
}

/** 审核前校验：草稿可空明细保存，过账须至少一条有效明细 */
export function validateStockOutAuditLineCount(lineCount) {
  if (Number(lineCount) > 0) return null
  return '出库单至少需要一条明细才能审核'
}

export function resolveStockOutLifecycleConfig(action, row = {}, actor = {}) {
  const audited = isOne(row.pass)
  const deleted = isOne(row.del)
  const closed = isOne(row.closed)

  if (closed) return { error: '此出库单已结案，只允许查看' }

  if (action === 'audit') {
    if (deleted) return { error: '回收站里的出库单不能审核' }
    if (audited) return { error: '出库单已审核' }
    return { nextPass: '1', msg: '审核成功' }
  }
  if (action === 'unaudit') {
    if (deleted) return { error: '回收站里的出库单不能反审核' }
    if (!audited) return { error: '未审核出库单不能反审核' }
    return { nextPass: '0', msg: '反审核成功' }
  }
  if (action === 'delete') {
    if (deleted) return { error: '出库单已在回收站' }
    if (audited) return { error: '已审核出库单不能删除，请先反审核' }
    return { nextDel: '1', msg: '删除成功' }
  }
  if (action === 'restore') {
    if (!deleted) return { error: '只有回收站里的出库单可以恢复' }
    if (audited) return { error: '已审核出库单请恢复后先确认状态' }
    return { nextDel: '0', msg: '恢复成功' }
  }
  if (action === 'hard-delete') {
    if (!isAdminActor(actor)) return { error: '只有超级管理员可以彻底删除出库单' }
    if (!deleted) return { error: '只有回收站里的出库单可以彻底删除' }
    if (audited) return { error: '已审核出库单不能彻底删除，请先反审核' }
    return { hardDelete: true, msg: '彻底删除成功' }
  }
  return { error: '不支持的出库单操作' }
}

export function buildStockOutLifecycleSetSql({ config, actor, headerCols, lineCols }) {
  const headerSet = []
  const lineSet = []
  const params = {}

  if (config.nextPass === '1') {
    headerSet.push("[pass]=N'1'")
    lineSet.push("[pass]=N'1'")
    const uidRaw = actor?.uidInt ?? actor?.uid ?? actor?.userId ?? actor?.UserID
    const passuid = String(uidRaw ?? '')
    const passuname = String(actor?.uname ?? actor?.auditUserName ?? actor?.userName ?? '')
    if (hasColumn(headerCols, 'passuid')) {
      headerSet.push('[passuid]=@passuid')
      params.passuid = passuid
    }
    if (hasColumn(headerCols, 'passuname')) {
      headerSet.push('[passuname]=@passuname')
      params.passuname = passuname
    }
    if (hasColumn(headerCols, 'shtime')) headerSet.push('[shtime]=CONVERT(nvarchar(30), GETDATE(), 120)')
    if (hasColumn(lineCols, 'passuid')) lineSet.push('[passuid]=@passuid')
    if (hasColumn(lineCols, 'passuname')) lineSet.push('[passuname]=@passuname')
  } else if (config.nextPass === '0') {
    headerSet.push("[pass]=N'0'")
    lineSet.push("[pass]=N'0'")
    if (hasColumn(headerCols, 'passuid')) headerSet.push('[passuid]=NULL')
    if (hasColumn(headerCols, 'passuname')) headerSet.push('[passuname]=NULL')
    if (hasColumn(headerCols, 'shtime')) headerSet.push('[shtime]=NULL')
    if (hasColumn(lineCols, 'passuid')) lineSet.push('[passuid]=NULL')
    if (hasColumn(lineCols, 'passuname')) lineSet.push('[passuname]=NULL')
  } else if (config.nextDel === '1') {
    headerSet.push("[del]=N'1'")
    const uidRaw = actor?.uidInt ?? actor?.uid ?? actor?.userId ?? actor?.UserID
    if (hasColumn(headerCols, 'delid')) {
      headerSet.push('[delid]=@delid')
      params.delid = String(uidRaw ?? '')
    }
    if (hasColumn(headerCols, 'delname')) {
      headerSet.push('[delname]=@delname')
      params.delname = String(actor?.uname ?? actor?.auditUserName ?? actor?.userName ?? '')
    }
    if (hasColumn(headerCols, 'deltruename')) {
      headerSet.push('[deltruename]=@deltruename')
      params.deltruename = String(actor?.utruename ?? actor?.auditTruename ?? actor?.truename ?? actor?.userName ?? '')
    }
    if (hasColumn(headerCols, 'deltime')) headerSet.push('[deltime]=CONVERT(nvarchar(30), GETDATE(), 120)')
  } else if (config.nextDel === '0') {
    headerSet.push("[del]=N'0'")
  }

  return { headerSetSql: headerSet.join(', '), lineSetSql: lineSet.join(', '), params }
}

async function fetchOrder(pool, id) {
  const r = await pool.request().input('id', sql.Int, id).query(`
    SELECT TOP 1
      [id],
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([kcap01], N'')))) AS outboundNo,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([kcap04], N'')))) AS sourceOrderNo,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([systemcode], N'')))) AS systemCode,
      LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL([kcap03], N'')))) AS outboundType,
      LTRIM(RTRIM(ISNULL([pass], N''))) AS pass,
      LTRIM(RTRIM(ISNULL([del], N''))) AS del,
      LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL([Closed], 0)))) AS closed
    FROM ${HEADER_FROM}
    WHERE [id] = @id
  `)
  return r.recordset?.[0] ?? null
}

async function countActiveLines(poolOrTx, outboundNo) {
  const r = await new sql.Request(poolOrTx).input('outboundNo', sql.NVarChar(200), outboundNo).query(`
    SELECT COUNT(1) AS cnt
    FROM ${LINE_FROM}
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([kcaq01], N'')))) = @outboundNo
      AND (ISNULL([del], N'') = N'' OR [del] = N'0')
  `)
  return Number(r.recordset?.[0]?.cnt ?? 0)
}

async function applyStockOutSourceWriteback({ pool, tx, row, direction }) {
  const cfg = resolveStockOutSourceWritebackConfig(row.outboundType)
  if (!cfg) return

  const cols = await fetchColumnSet(pool, cfg.tableName)
  if (!hasColumn(cols, cfg.writebackField)) return
  const keyColumn = chooseSourceKeyColumn(cols)
  if (!keyColumn) return

  await new sql.Request(tx)
    .input('outboundNo', sql.NVarChar(200), row.outboundNo)
    .input('convertUnit', sql.Int, cfg.convertUnit ? 1 : 0)
    .query(buildStockOutSourceWritebackSql({
      tableName: cfg.tableName,
      writebackField: cfg.writebackField,
      keyColumn,
      direction,
    }))
}

function buildLifecycleLogPayload({ action, row, actor, now, reason }) {
  if (action === 'audit') return buildStockOutAuditLogPayload({ outboundNo: row.outboundNo, outboundType: row.outboundType, actor, now })
  if (action === 'unaudit') return buildStockOutUnauditLogPayload({ outboundNo: row.outboundNo, outboundType: row.outboundType, actor, now, reason })
  if (action === 'restore') return buildStockOutRestoreLogPayload({ systemCode: row.systemCode, now })
  return buildStockOutDeleteLogPayload({ outboundNo: row.outboundNo, actor, now })
}

export async function applyStockOutLifecycleAction({ pool, id, action, actor, reason = '' }) {
  const row = await fetchOrder(pool, id)
  if (!row) return { ok: false, status: 404, msg: '出库单不存在' }
  const config = resolveStockOutLifecycleConfig(action, row, actor)
  if (config.error) return { ok: false, status: 400, msg: config.error }
  if (action === 'unaudit' && !String(reason ?? '').trim()) return { ok: false, status: 400, msg: '请填写反审原因' }
  if (action === 'audit') {
    const auditErr = validateStockOutAuditLineCount(await countActiveLines(pool, row.outboundNo))
    if (auditErr) return { ok: false, status: 400, msg: auditErr }
  }
  const now = formatSalesOrderAuditTime()
  const logPayload = buildLifecycleLogPayload({ action, row, actor, now, reason })
  const tx = new sql.Transaction(pool)
  await tx.begin()

  if (config.hardDelete) {
    try {
      await new sql.Request(tx).input('id', sql.Int, id).input('outboundNo', sql.NVarChar(200), row.outboundNo).query(`
        DELETE FROM ${LINE_FROM} WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([kcaq01], N'')))) = @outboundNo;
        DELETE FROM ${HEADER_FROM} WHERE [id] = @id;
      `)
      await writeStockOutOperationLog(tx, {
        actName: logPayload.actName,
        info: logPayload.info,
        actor,
        outboundNo: row.outboundNo,
        systemCode: row.systemCode,
        now,
      })
      await tx.commit()
      return { ok: true, msg: config.msg, id, outboundNo: row.outboundNo }
    } catch (err) {
      try {
        await tx.rollback()
      } catch {}
      throw err
    }
  }

  try {
    const [headerCols, lineCols] = await Promise.all([
      fetchColumnSet(pool, STOCK_OUT_HEADER_TABLE),
      fetchColumnSet(pool, STOCK_OUT_LINE_TABLE),
    ])
    const { headerSetSql, lineSetSql, params } = buildStockOutLifecycleSetSql({ config, actor, headerCols, lineCols })
    if (config.nextPass === '1') await applyStockOutSourceWriteback({ pool, tx, row, direction: 1 })
    if (config.nextPass === '0') await applyStockOutSourceWriteback({ pool, tx, row, direction: -1 })

    const req = new sql.Request(tx).input('id', sql.Int, id)
    for (const [key, value] of Object.entries(params)) req.input(key, sql.NVarChar(200), value)
    await req.query(`UPDATE ${HEADER_FROM} SET ${headerSetSql} WHERE [id] = @id`)
    if (config.nextPass) {
      const lreq = new sql.Request(tx).input('outboundNo', sql.NVarChar(200), row.outboundNo)
      for (const [key, value] of Object.entries(params)) lreq.input(key, sql.NVarChar(200), value)
      await lreq.query(`UPDATE ${LINE_FROM} SET ${lineSetSql} WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([kcaq01], N'')))) = @outboundNo`)
    }
    await writeStockOutOperationLog(tx, {
      actName: logPayload.actName,
      info: logPayload.info,
      actor,
      outboundNo: row.outboundNo,
      systemCode: row.systemCode,
      now,
    })
    await tx.commit()
    return { ok: true, msg: config.msg, id, outboundNo: row.outboundNo }
  } catch (err) {
    try {
      await tx.rollback()
    } catch {}
    throw err
  }
}
