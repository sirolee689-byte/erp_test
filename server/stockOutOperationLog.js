import { sql } from './db.js'

const LOG_FROM = 'dbo.[UB_Date_ERP_Operation_log]'
const LOG_TABLE = 'UB_Date_ERP_Operation_log'
const LOG_CODE = 'UB_ERP_Stocks_out'
const MAX_ACT_INFO_LEN = 500

function text(value) {
  return String(value ?? '').trim()
}

function clip(value) {
  const s = text(value)
  return s.length > MAX_ACT_INFO_LEN ? `${s.slice(0, MAX_ACT_INFO_LEN - 3)}...` : s
}

function actorUid(actor = {}) {
  const n = Number(actor.uidInt ?? actor.uid ?? actor.userId ?? actor.UserID)
  return Number.isFinite(n) && n > 0 ? String(Math.trunc(n)) : ''
}

function actorUname(actor = {}) {
  return text(actor.uname ?? actor.auditUserName ?? actor.userName)
}

function actorTruename(actor = {}) {
  return text(actor.utruename ?? actor.auditTruename ?? actor.truename ?? actor.userName ?? actorUname(actor))
}

export function stockOutTypeLogName(type) {
  const map = {
    0: '其他出库',
    1: '采购退货',
    2: '外协领料',
    3: '外协退货',
    4: '生产领料',
    5: '生产返修',
    6: '成品出库',
    7: '生产领料（计划外）',
    8: '生产领料（补数）',
    9: '盈亏出库',
    10: '销售出库',
  }
  return map[text(type)] || '出库单'
}

export function buildStockOutLogInfo({ outboundNo, sourceOrderNo, actor } = {}) {
  const parts = [`出库单号：${outboundNo || ''}`]
  if (sourceOrderNo) parts.push(`关联单号：${sourceOrderNo}`)
  const name = actorTruename(actor)
  if (name) parts.push(`操作人：${name}`)
  return parts.join('，')
}

export function buildStockOutSaveLogPayload({ action, outboundType, outboundNo, actor, now }) {
  const typeName = stockOutTypeLogName(outboundType)
  const truename = actorTruename(actor)
  const isEdit = action === 'edit'
  const prefix = isEdit ? '出库单修改成功,等待审核！' : '出库单录入成功,等待审核！'
  return {
    actName: isEdit ? '出库单修改' : '出库单录入',
    info: `${prefix}出库单号：${outboundNo}，出库类型：${typeName}，操作时间：${now}，操作者：${truename}`,
  }
}

export function buildStockOutDeleteLogPayload({ outboundNo, actor, now }) {
  return {
    actName: '出库单删除',
    info: `出库单删除，出库单号：${outboundNo}，操作时间：${now} ,操作人：${actorTruename(actor)}`,
  }
}

export function buildStockOutRestoreLogPayload({ systemCode, now }) {
  return {
    actName: '被删除出库单恢复成功',
    info: `恢复成功！系统唯一编码：${systemCode}出库单名称、出库单编码：${systemCode}，操作时间：${now}`,
  }
}

export function buildStockOutAuditLogPayload({ outboundNo, outboundType, actor, now, batch = false }) {
  const typeName = stockOutTypeLogName(outboundType)
  const truename = actorTruename(actor)
  if (batch) {
    return {
      actName: '批量出库单申请审核',
      info: `批量出库单申请通过审核！出库单号：${outboundNo}，出库类型：${typeName}，操作时间：${now}，操作者：${truename}`,
    }
  }
  return {
    actName: '申请审核',
    info: `申请通过审核！出库单号：${outboundNo}，出库类型：${typeName}，操作时间：${now}，操作者：${truename}`,
  }
}

export function buildStockOutAuditRejectLogPayload({ name, now }) {
  return {
    actName: '申请审核',
    info: `审核不通过！出库单名称：${name}，操作时间：${now}`,
  }
}

export function buildStockOutUnauditLogPayload({ outboundNo, outboundType, actor, now, reason = '' }) {
  const typeName = stockOutTypeLogName(outboundType)
  return {
    actName: '出库单反审核',
    info: `出库单反审核操作！出库单号：${outboundNo}，出库类型：${typeName}，操作时间：${now}，操作者：${actorTruename(actor)}，反审原因：${text(reason)}`,
  }
}

export function buildStockOutSaveExceptionLogPayload({ outboundNo, materialCode, actor, reason }) {
  const message = reason === 'qty_gt_stock' ? '出现物料大于库存数' : '出现物料库存为0'
  return {
    actName: '出库单保存异常',
    info: `出库单录入成功,${message}，保存跳过！单号：${outboundNo}，物料：${materialCode} ，操作者：${actorTruename(actor)}`,
  }
}

async function fetchLogColumns(poolOrTx) {
  const r = await poolOrTx.request().query(`
    SELECT LOWER([name]) AS name
    FROM sys.columns
    WHERE [object_id] = OBJECT_ID(N'dbo.[${LOG_TABLE}]')
  `)
  return new Set((r.recordset ?? []).map((row) => text(row.name).toLowerCase()))
}

function addValue(values, cols, name, value) {
  if (!cols.has(name.toLowerCase())) return
  values.push([name, value])
}

export async function writeStockOutOperationLog(poolOrTx, { actName, info, actor = {}, outboundNo, systemCode, now } = {}) {
  const cols = await fetchLogColumns(poolOrTx)
  const values = []
  addValue(values, cols, 'uid', actorUid(actor))
  addValue(values, cols, 'uname', actorUname(actor))
  addValue(values, cols, 'utruename', actorTruename(actor))
  addValue(values, cols, 'code', LOG_CODE)
  addValue(values, cols, 'systemcode', text(systemCode))
  addValue(values, cols, 'ip', text(actor.ip))
  addValue(values, cols, 'act_name', text(actName))
  addValue(values, cols, 'act_info', clip(info || buildStockOutLogInfo({ outboundNo, actor })))

  if (!values.length && !cols.has('addtime')) return
  const req = poolOrTx.request()
  const fieldSql = []
  const valueSql = []
  if (cols.has('addtime')) {
    fieldSql.push('[addtime]')
    if (now) {
      req.input('addtime', sql.NVarChar(30), text(now))
      valueSql.push('@addtime')
    } else {
      valueSql.push('CONVERT(nvarchar(30), GETDATE(), 120)')
    }
  }
  for (const [name, value] of values) {
    fieldSql.push(`[${name}]`)
    valueSql.push(`@${name}`)
    req.input(name, name === 'act_info' ? sql.NVarChar(MAX_ACT_INFO_LEN) : sql.NVarChar(200), value || null)
  }
  await req.query(`
    INSERT INTO ${LOG_FROM} (${fieldSql.join(', ')})
    VALUES (${valueSql.join(', ')})
  `)
}
