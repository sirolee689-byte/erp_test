import { sql } from './db.js'
import { DISPATCH_ORDER_HEADER_TABLE, DISPATCH_ORDER_LINE_TABLE } from './dispatchOrderListQuery.js'
import { buildDispatchOrderLogInfo, writeDispatchOrderOperationLog } from './dispatchOrderOperationLog.js'

const HEADER_FROM = `dbo.[${DISPATCH_ORDER_HEADER_TABLE}]`
const LINE_FROM = `dbo.[${DISPATCH_ORDER_LINE_TABLE}]`

function isOne(v) {
  return String(v ?? '').trim() === '1'
}

function hasColumn(cols, name) {
  return cols instanceof Set && cols.has(String(name ?? '').toLowerCase())
}

async function fetchDispatchOrderColumnSet(pool, tableName) {
  const r = await pool.request().input('tableName', sql.NVarChar(128), tableName).query(`
    SELECT LOWER([name]) AS name
    FROM sys.columns
    WHERE [object_id] = OBJECT_ID(N'dbo.[${tableName}]')
  `)
  return new Set((r.recordset ?? []).map((row) => String(row.name ?? '').toLowerCase()))
}

export function buildDispatchOrderLifecycleSetSql({ config, actor, headerCols, lineCols }) {
  const headerSet = []
  const lineSet = []
  const params = {}

  if (config.nextPass === '1') {
    headerSet.push('[pass]=N\'1\'')
    lineSet.push('[pass]=N\'1\'')
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
    if (hasColumn(lineCols, 'passuid')) {
      lineSet.push('[passuid]=@passuid')
      params.passuid = passuid
    }
    if (hasColumn(lineCols, 'passuname')) {
      lineSet.push('[passuname]=@passuname')
      params.passuname = passuname
    }
  } else if (config.nextPass === '0') {
    headerSet.push('[pass]=N\'0\'')
    lineSet.push('[pass]=N\'0\'')
    if (hasColumn(headerCols, 'passuid')) headerSet.push('[passuid]=NULL')
    if (hasColumn(headerCols, 'passuname')) headerSet.push('[passuname]=NULL')
    if (hasColumn(lineCols, 'passuid')) lineSet.push('[passuid]=NULL')
    if (hasColumn(lineCols, 'passuname')) lineSet.push('[passuname]=NULL')
  } else if (config.nextDel === '1') {
    headerSet.push('[del]=N\'1\'')
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
    headerSet.push('[del]=N\'0\'')
  }

  return { headerSetSql: headerSet.join(', '), lineSetSql: lineSet.join(', '), params }
}

export function resolveDispatchOrderLifecycleConfig(action, row) {
  const audited = isOne(row?.pass)
  const deleted = isOne(row?.del)
  if (action === 'audit') {
    if (deleted) return { error: '回收站里的派工单不能审核' }
    if (audited) return { error: '派工单已审核' }
    return { nextPass: '1', actName: '审核派工单', msg: '审核成功' }
  }
  if (action === 'unaudit') {
    if (deleted) return { error: '回收站里的派工单不能反审核' }
    if (!audited) return { error: '未审核派工单不能反审核' }
    return { nextPass: '0', clearPassActor: true, actName: '反审核派工单', msg: '反审核成功' }
  }
  if (action === 'delete') {
    if (deleted) return { error: '派工单已在回收站' }
    if (audited) return { error: '已审核派工单不能删除，请先反审核' }
    return { nextDel: '1', actName: '删除派工单', msg: '删除成功' }
  }
  if (action === 'restore') {
    if (!deleted) return { error: '只有回收站里的派工单可以恢复' }
    return { nextDel: '0', actName: '恢复派工单', msg: '恢复成功' }
  }
  if (action === 'hard-delete') {
    if (!deleted) return { error: '只有回收站里的派工单可以彻底删除' }
    if (audited) return { error: '已审核派工单不能彻底删除，请先反审核' }
    return { hardDelete: true, actName: '彻底删除派工单', msg: '彻底删除成功' }
  }
  return { error: '不支持的派工单操作' }
}

async function fetchOrder(pool, id) {
  const r = await pool.request().input('id', sql.Int, id).query(`
    SELECT TOP 1
      [id],
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([scaj01], N'')))) AS dispatchOrderNo,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([scaj04], N'')))) AS referenceNo,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([systemcode], N'')))) AS systemCode,
      LTRIM(RTRIM(ISNULL([pass], N''))) AS pass,
      LTRIM(RTRIM(ISNULL([del], N''))) AS del
    FROM ${HEADER_FROM}
    WHERE [id] = @id
  `)
  return r.recordset?.[0] ?? null
}

export async function applyDispatchOrderLifecycleAction({ pool, id, action, actor }) {
  const row = await fetchOrder(pool, id)
  if (!row) return { ok: false, status: 404, msg: '派工单不存在' }
  const config = resolveDispatchOrderLifecycleConfig(action, row)
  if (config.error) return { ok: false, status: 400, msg: config.error }
  const info = buildDispatchOrderLogInfo({ orderNo: row.dispatchOrderNo, referenceNo: row.referenceNo, actor })

  if (config.hardDelete) {
    const req = pool.request().input('id', sql.Int, id).input('orderNo', sql.NVarChar(200), row.dispatchOrderNo)
    await req.query(`
      DELETE FROM ${LINE_FROM} WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([scak01], N'')))) = @orderNo;
      DELETE FROM ${HEADER_FROM} WHERE [id] = @id;
    `)
    await writeDispatchOrderOperationLog(pool, { actName: config.actName, info, actor, orderNo: row.dispatchOrderNo, systemCode: row.systemCode })
    return { ok: true, msg: config.msg, id, dispatchOrderNo: row.dispatchOrderNo }
  }

  const [headerCols, lineCols] = await Promise.all([
    fetchDispatchOrderColumnSet(pool, DISPATCH_ORDER_HEADER_TABLE),
    fetchDispatchOrderColumnSet(pool, DISPATCH_ORDER_LINE_TABLE),
  ])
  const { headerSetSql, lineSetSql, params } = buildDispatchOrderLifecycleSetSql({ config, actor, headerCols, lineCols })
  const req = pool.request().input('id', sql.Int, id)
  for (const [key, value] of Object.entries(params)) req.input(key, sql.NVarChar(200), value)
  await req.query(`UPDATE ${HEADER_FROM} SET ${headerSetSql} WHERE [id] = @id`)
  if (config.nextPass) {
    const lreq = pool.request().input('orderNo', sql.NVarChar(200), row.dispatchOrderNo)
    for (const [key, value] of Object.entries(params)) lreq.input(key, sql.NVarChar(200), value)
    await lreq.query(`UPDATE ${LINE_FROM} SET ${lineSetSql} WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([scak01], N'')))) = @orderNo`)
  }
  await writeDispatchOrderOperationLog(pool, { actName: config.actName, info, actor, orderNo: row.dispatchOrderNo, systemCode: row.systemCode })
  return { ok: true, msg: config.msg, id, dispatchOrderNo: row.dispatchOrderNo }
}
