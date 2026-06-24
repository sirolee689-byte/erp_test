import { sql } from './db.js'
import { STOCK_OUT_HEADER_TABLE, STOCK_OUT_LINE_TABLE } from './stockOutListQuery.js'
import { buildStockOutLogInfo, writeStockOutOperationLog } from './stockOutOperationLog.js'

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

function isOne(v) {
  return String(v ?? '').trim() === '1'
}

function hasColumn(cols, name) {
  return cols instanceof Set && cols.has(String(name ?? '').toLowerCase())
}

function isAdminActor(actor = {}) {
  return actor.isAdmin === true || actor.is_admin === 1 || actor.is_admin === '1' || actor.isAdmin === 1 || actor.role === 'admin'
}

function numeric(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function sourceWritebackQty(line, convertUnit) {
  const qty = numeric(line.qty, 0)
  if (!convertUnit) return qty
  const rate = numeric(line.unitRate, 0)
  if (rate <= 0) return qty
  return String(line.unitDirection ?? '').trim() === '1' ? qty * rate : qty / rate
}

async function fetchColumnSet(pool, tableName) {
  const r = await pool.request().input('tableName', sql.NVarChar(128), tableName).query(`
    SELECT LOWER([name]) AS name
    FROM sys.columns
    WHERE [object_id] = OBJECT_ID(N'dbo.[${tableName}]')
  `)
  return new Set((r.recordset ?? []).map((row) => String(row.name ?? '').toLowerCase()))
}

function chooseSourceKeyColumn(cols) {
  if (hasColumn(cols, 'systemcode')) return 'systemcode'
  if (hasColumn(cols, 'guid')) return 'GUID'
  if (hasColumn(cols, 'id')) return 'id'
  return ''
}

export function buildStockOutSourceWritebackSql({ tableName, writebackField, keyColumn, direction }) {
  const from = `dbo.[${tableName}]`
  if (direction < 0) {
    return `
      UPDATE ${from}
      SET [${writebackField}] = CASE WHEN ISNULL([${writebackField}], 0) - @delta < 0 THEN 0 ELSE ISNULL([${writebackField}], 0) - @delta END
      WHERE [${keyColumn}] = @sourceLineCode
    `
  }
  return `
    UPDATE ${from}
    SET [${writebackField}] = ISNULL([${writebackField}], 0) + @delta
    WHERE [${keyColumn}] = @sourceLineCode
  `
}

export function resolveStockOutLifecycleConfig(action, row = {}, actor = {}) {
  const audited = isOne(row.pass)
  const deleted = isOne(row.del)
  const closed = isOne(row.closed)

  if (closed) return { error: '此出库单已结案，只允许查看' }

  if (action === 'audit') {
    if (deleted) return { error: '回收站里的出库单不能审核' }
    if (audited) return { error: '出库单已审核' }
    return { nextPass: '1', actName: '审核出库单', msg: '审核成功' }
  }
  if (action === 'unaudit') {
    if (deleted) return { error: '回收站里的出库单不能反审核' }
    if (!audited) return { error: '未审核出库单不能反审核' }
    return { nextPass: '0', actName: '反审核出库单', msg: '反审核成功' }
  }
  if (action === 'delete') {
    if (deleted) return { error: '出库单已在回收站' }
    if (audited) return { error: '已审核出库单不能删除，请先反审核' }
    return { nextDel: '1', actName: '删除出库单', msg: '删除成功' }
  }
  if (action === 'restore') {
    if (!deleted) return { error: '只有回收站里的出库单可以恢复' }
    if (audited) return { error: '已审核出库单请恢复后先确认状态' }
    return { nextDel: '0', actName: '恢复出库单', msg: '恢复成功' }
  }
  if (action === 'hard-delete') {
    if (!isAdminActor(actor)) return { error: '只有超级管理员可以彻底删除出库单' }
    if (!deleted) return { error: '只有回收站里的出库单可以彻底删除' }
    if (audited) return { error: '已审核出库单不能彻底删除，请先反审核' }
    return { hardDelete: true, actName: '彻底删除出库单', msg: '彻底删除成功' }
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

async function fetchLinesForWriteback(tx, outboundNo) {
  const r = await new sql.Request(tx).input('outboundNo', sql.NVarChar(200), outboundNo).query(`
    SELECT
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([kcaq02], N'')))) AS sourceLineCode,
      ISNULL([kcaq03], 0) AS qty,
      ISNULL([kcaa26], 0) AS unitRate,
      LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL([kcaa27], N'')))) AS unitDirection
    FROM ${LINE_FROM}
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([kcaq01], N'')))) = @outboundNo
      AND (ISNULL([del], N'') = N'' OR [del] = N'0')
  `)
  return r.recordset ?? []
}

async function applyStockOutSourceWriteback({ pool, tx, row, direction }) {
  const cfg = SOURCE_WRITEBACK_BY_TYPE[String(row.outboundType ?? '').trim()]
  if (!cfg) return

  const cols = await fetchColumnSet(pool, cfg.tableName)
  if (!hasColumn(cols, cfg.writebackField)) return
  const keyColumn = chooseSourceKeyColumn(cols)
  if (!keyColumn) return

  const lines = await fetchLinesForWriteback(tx, row.outboundNo)
  for (const line of lines) {
    const sourceLineCode = String(line.sourceLineCode ?? '').trim()
    const delta = Math.abs(sourceWritebackQty(line, cfg.convertUnit))
    if (!sourceLineCode || delta <= 0) continue
    await new sql.Request(tx)
      .input('sourceLineCode', sql.NVarChar(200), sourceLineCode)
      .input('delta', sql.Decimal(18, 6), delta)
      .query(buildStockOutSourceWritebackSql({
        tableName: cfg.tableName,
        writebackField: cfg.writebackField,
        keyColumn,
        direction,
      }))
  }
}

export async function applyStockOutLifecycleAction({ pool, id, action, actor }) {
  const row = await fetchOrder(pool, id)
  if (!row) return { ok: false, status: 404, msg: '出库单不存在' }
  const config = resolveStockOutLifecycleConfig(action, row, actor)
  if (config.error) return { ok: false, status: 400, msg: config.error }
  const info = buildStockOutLogInfo({ outboundNo: row.outboundNo, sourceOrderNo: row.sourceOrderNo, actor })
  const tx = new sql.Transaction(pool)
  await tx.begin()

  if (config.hardDelete) {
    try {
      await new sql.Request(tx).input('id', sql.Int, id).input('outboundNo', sql.NVarChar(200), row.outboundNo).query(`
        DELETE FROM ${LINE_FROM} WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([kcaq01], N'')))) = @outboundNo;
        DELETE FROM ${HEADER_FROM} WHERE [id] = @id;
      `)
      await writeStockOutOperationLog(tx, { actName: config.actName, info, actor, outboundNo: row.outboundNo, systemCode: row.systemCode })
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
    await writeStockOutOperationLog(tx, { actName: config.actName, info, actor, outboundNo: row.outboundNo, systemCode: row.systemCode })
    await tx.commit()
    return { ok: true, msg: config.msg, id, outboundNo: row.outboundNo }
  } catch (err) {
    try {
      await tx.rollback()
    } catch {}
    throw err
  }
}
