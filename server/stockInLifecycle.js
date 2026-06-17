import { sql } from './db.js'
import { STOCK_IN_HEADER_TABLE, STOCK_IN_LINE_TABLE } from './stockInListQuery.js'
import { buildStockInLogInfo, writeStockInOperationLog } from './stockInOperationLog.js'

const HEADER_FROM = `dbo.[${STOCK_IN_HEADER_TABLE}]`
const LINE_FROM = `dbo.[${STOCK_IN_LINE_TABLE}]`

function isOne(v) {
  return String(v ?? '').trim() === '1'
}

function hasColumn(cols, name) {
  return cols instanceof Set && cols.has(String(name ?? '').toLowerCase())
}

function isAdminActor(actor = {}) {
  return actor.isAdmin === true || actor.is_admin === 1 || actor.is_admin === '1' || actor.isAdmin === 1 || actor.role === 'admin'
}

async function fetchStockInColumnSet(pool, tableName) {
  const r = await pool.request().input('tableName', sql.NVarChar(128), tableName).query(`
    SELECT LOWER([name]) AS name
    FROM sys.columns
    WHERE [object_id] = OBJECT_ID(N'dbo.[${tableName}]')
  `)
  return new Set((r.recordset ?? []).map((row) => String(row.name ?? '').toLowerCase()))
}

export function resolveStockInLifecycleConfig(action, row = {}, actor = {}) {
  const audited = isOne(row.pass)
  const deleted = isOne(row.del)
  const reviewed = isOne(row.sp_flag ?? row.spFlag)
  const closed = isOne(row.closed)
  const type = String(row.inboundType ?? row.kcan03 ?? '').trim()

  if (reviewed) return { error: '此入库单已复核，只允许查看' }
  if (closed) return { error: '此入库单已结案，只允许查看' }
  if (type === '8') return { error: '加工入库第一版只读，不允许操作' }

  if (action === 'audit') {
    if (deleted) return { error: '回收站里的入库单不能审核' }
    if (audited) return { error: '入库单已审核' }
    return { nextPass: '1', actName: '审核入库单', msg: '审核成功' }
  }
  if (action === 'unaudit') {
    if (deleted) return { error: '回收站里的入库单不能反审核' }
    if (!audited) return { error: '未审核入库单不能反审核' }
    return { nextPass: '0', actName: '反审核入库单', msg: '反审核成功' }
  }
  if (action === 'delete') {
    if (deleted) return { error: '入库单已在回收站' }
    if (audited) return { error: '已审核入库单不能删除，请先反审核' }
    return { nextDel: '1', actName: '删除入库单', msg: '删除成功' }
  }
  if (action === 'restore') {
    if (!deleted) return { error: '只有回收站里的入库单可以恢复' }
    if (audited) return { error: '已审核入库单请恢复后先确认状态' }
    return { nextDel: '0', actName: '恢复入库单', msg: '恢复成功' }
  }
  if (action === 'hard-delete') {
    if (!isAdminActor(actor)) return { error: '只有超级管理员可以彻底删除入库单' }
    if (!deleted) return { error: '只有回收站里的入库单可以彻底删除' }
    if (audited) return { error: '已审核入库单不能彻底删除，请先反审核' }
    return { hardDelete: true, actName: '彻底删除入库单', msg: '彻底删除成功' }
  }
  return { error: '不支持的入库单操作' }
}

export function buildStockInLifecycleSetSql({ config, actor, headerCols, lineCols }) {
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
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([kcan01], N'')))) AS receiptNo,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([kcan04], N'')))) AS sourceOrderNo,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([systemcode], N'')))) AS systemCode,
      LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL([kcan03], N'')))) AS inboundType,
      LTRIM(RTRIM(ISNULL([pass], N''))) AS pass,
      LTRIM(RTRIM(ISNULL([del], N''))) AS del,
      LTRIM(RTRIM(ISNULL([sp_flag], N''))) AS sp_flag,
      LTRIM(RTRIM(ISNULL([closed], N''))) AS closed
    FROM ${HEADER_FROM}
    WHERE [id] = @id
  `)
  return r.recordset?.[0] ?? null
}

export async function applyStockInLifecycleAction({ pool, id, action, actor }) {
  const row = await fetchOrder(pool, id)
  if (!row) return { ok: false, status: 404, msg: '入库单不存在' }
  const config = resolveStockInLifecycleConfig(action, row, actor)
  if (config.error) return { ok: false, status: 400, msg: config.error }
  const info = buildStockInLogInfo({ receiptNo: row.receiptNo, sourceOrderNo: row.sourceOrderNo, actor })

  if (config.hardDelete) {
    const req = pool.request().input('id', sql.Int, id).input('receiptNo', sql.NVarChar(200), row.receiptNo)
    await req.query(`
      DELETE FROM ${LINE_FROM} WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([kcao01], N'')))) = @receiptNo;
      DELETE FROM ${HEADER_FROM} WHERE [id] = @id;
    `)
    await writeStockInOperationLog(pool, { actName: config.actName, info, actor, receiptNo: row.receiptNo, systemCode: row.systemCode })
    return { ok: true, msg: config.msg, id, receiptNo: row.receiptNo }
  }

  const [headerCols, lineCols] = await Promise.all([
    fetchStockInColumnSet(pool, STOCK_IN_HEADER_TABLE),
    fetchStockInColumnSet(pool, STOCK_IN_LINE_TABLE),
  ])
  const { headerSetSql, lineSetSql, params } = buildStockInLifecycleSetSql({ config, actor, headerCols, lineCols })
  const req = pool.request().input('id', sql.Int, id)
  for (const [key, value] of Object.entries(params)) req.input(key, sql.NVarChar(200), value)
  await req.query(`UPDATE ${HEADER_FROM} SET ${headerSetSql} WHERE [id] = @id`)
  if (config.nextPass) {
    const lreq = pool.request().input('receiptNo', sql.NVarChar(200), row.receiptNo)
    for (const [key, value] of Object.entries(params)) lreq.input(key, sql.NVarChar(200), value)
    await lreq.query(`UPDATE ${LINE_FROM} SET ${lineSetSql} WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([kcao01], N'')))) = @receiptNo`)
  }
  await writeStockInOperationLog(pool, { actName: config.actName, info, actor, receiptNo: row.receiptNo, systemCode: row.systemCode })
  return { ok: true, msg: config.msg, id, receiptNo: row.receiptNo }
}

