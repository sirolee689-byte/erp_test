import { sql } from './db.js'

const LOG_FROM = 'dbo.[UB_Date_ERP_Operation_log]'

function actorName(actor) {
  return String(actor?.trueName ?? actor?.name ?? actor?.username ?? '').trim()
}

export function buildAssistOrderLogInfo({ orderNo, referenceNo = '', systemCode = '', actor }) {
  return `单号：${orderNo || ''}，关联号：${referenceNo || ''}，系统编码：${systemCode || ''}，操作时间：${new Date().toISOString()}，操作者：${actorName(actor)}`
}

export async function writeAssistOrderOperationLog(poolOrTx, { actName, info, actor, orderNo, systemCode }) {
  const req = poolOrTx.request ? poolOrTx.request() : new sql.Request(poolOrTx)
  req.input('act_name', sql.NVarChar(200), actName)
  req.input('act_info', sql.NVarChar(sql.MAX), info)
  req.input('act_user', sql.NVarChar(200), actorName(actor))
  req.input('code', sql.NVarChar(200), orderNo || '')
  req.input('systemcode', sql.NVarChar(200), systemCode || orderNo || '')
  await req.query(`
    INSERT INTO ${LOG_FROM} ([act_name], [act_info], [addtime], [uname], [utruename], [code], [systemcode])
    VALUES (@act_name, @act_info, CONVERT(nvarchar(30), GETDATE(), 120), @act_user, @act_user, @code, @systemcode)
  `)
}
