import { sql } from './db.js'
import { ASSIST_ORDER_HEADER_TABLE } from './assistOrderListQuery.js'
import {
  buildAssistOrderLogInfo,
  writeAssistOrderOperationLog,
} from './assistOrderOperationLog.js'

const HEADER_FROM = `dbo.[${ASSIST_ORDER_HEADER_TABLE}]`
const LINE_FROM = 'dbo.[UB_ERP_assist_order_list]'
const FEE_FROM = 'dbo.[UB_ERP_assist_order_money]'

function flag(value) {
  return String(value ?? '').trim() === '1'
}

async function fetchOrder(pool, id) {
  const r = await pool.request().input('id', sql.Int, id).query(`
    SELECT TOP 1
      [id],
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([wxaj01], N'')))) AS assistOrderNo,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([wxaj04], N'')))) AS referenceNo,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([systemcode], N'')))) AS systemCode,
      LTRIM(RTRIM(ISNULL([pass], N''))) AS pass,
      LTRIM(RTRIM(ISNULL([closed], N''))) AS closed,
      LTRIM(RTRIM(ISNULL([del], N''))) AS del
    FROM ${HEADER_FROM}
    WHERE [id] = @id
  `)
  return r.recordset?.[0] ?? null
}

function actionConfig(action, row) {
  const isAudited = flag(row.pass)
  const isClosed = flag(row.closed)
  const isDeleted = flag(row.del)

  if (action === 'audit') {
    if (isDeleted) return { error: '回收站单据不能审核' }
    if (isAudited) return { error: '单据已审核' }
    return { setSql: '[pass]=N\'1\'', actName: '申请审核', msg: '审核成功' }
  }
  if (action === 'unaudit') {
    if (isDeleted) return { error: '回收站单据不能反审' }
    if (isClosed) return { error: '已结案单据必须先反结案，再反审' }
    if (!isAudited) return { error: '未审核单据不能反审' }
    return { setSql: '[pass]=N\'0\'', actName: '申请反审核', msg: '反审成功' }
  }
  if (action === 'close') {
    if (isDeleted) return { error: '回收站单据不能结案' }
    if (!isAudited) return { error: '未审核单据不能结案' }
    if (isClosed) return { error: '单据已结案' }
    return { setSql: '[closed]=N\'1\'', actName: '申请结案', msg: '结案成功' }
  }
  if (action === 'unclose') {
    if (isDeleted) return { error: '回收站单据不能反结案' }
    if (!isClosed) return { error: '未结案单据不能反结案' }
    return { setSql: '[closed]=N\'0\'', actName: '申请反结案', msg: '反结案成功' }
  }
  if (action === 'delete') {
    if (isAudited || isClosed) return { error: '已审核或已结案单据删除前必须先反审/反结案' }
    if (isDeleted) return { error: '单据已在回收站' }
    return { setSql: '[del]=N\'1\'', actName: '外协订单删除', msg: '删除成功' }
  }
  if (action === 'restore') {
    if (!isDeleted) return { error: '只有回收站单据可以恢复' }
    return { setSql: '[del]=N\'0\'', actName: '被删除外协订单恢复成功', msg: '恢复成功' }
  }
  if (action === 'hard-delete') {
    if (!isDeleted) return { error: '只有回收站单据可以彻底删除' }
    if (isAudited) return { error: '已审核单据不能彻底删除' }
    return { hardDelete: true, actName: '外协订单删除', msg: '彻底删除成功' }
  }
  return { error: '不支持的外协订单动作' }
}

function actionLogName(action, fallback) {
  const names = {
    audit: '审核',
    unaudit: '反审',
    close: '结案',
    unclose: '反结案',
    delete: '删除',
    restore: '恢复',
    'hard-delete': '彻底删除',
  }
  return names[action] ?? fallback
}

export async function applyAssistOrderLifecycleAction({ pool, id, action, actor }) {
  const row = await fetchOrder(pool, id)
  if (!row) return { ok: false, status: 404, msg: '外协订单不存在' }

  const config = actionConfig(action, row)
  if (config.error) return { ok: false, status: 400, msg: config.error }

  const info = buildAssistOrderLogInfo({
    orderNo: row.assistOrderNo,
    referenceNo: row.referenceNo,
    systemCode: row.systemCode,
    actor,
  })
  if (config.hardDelete) {
    const req = pool.request().input('orderNo', sql.NVarChar(200), row.assistOrderNo).input('id', sql.Int, id)
    await req.query(`
      DELETE FROM ${LINE_FROM} WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([wxak01], N'')))) = @orderNo;
      DELETE FROM ${FEE_FROM} WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([assist_code], N'')))) = @orderNo;
      DELETE FROM ${HEADER_FROM} WHERE [id] = @id;
    `)
    await writeAssistOrderOperationLog(pool, {
      actName: actionLogName(action, config.actName),
      info,
      actor,
      orderNo: row.assistOrderNo,
      systemCode: row.systemCode,
    })
    return { ok: true, msg: config.msg, id, assistOrderNo: row.assistOrderNo }
  }

  const req = pool.request().input('id', sql.Int, id)
  await req.query(`
    UPDATE ${HEADER_FROM}
    SET ${config.setSql}
    WHERE [id] = @id
  `)
  await writeAssistOrderOperationLog(pool, {
    actName: actionLogName(action, config.actName),
    info,
    actor,
    orderNo: row.assistOrderNo,
    systemCode: row.systemCode,
  })
  return { ok: true, msg: config.msg, id, assistOrderNo: row.assistOrderNo }
}
