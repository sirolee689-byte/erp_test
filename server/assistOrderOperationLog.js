import { sql } from './db.js'

const LOG_FROM = 'dbo.[UB_Date_ERP_Operation_log]'
const MAX_ACT_INFO_LEN = 500

function actorName(actor) {
  return String(actor?.trueName ?? actor?.name ?? actor?.username ?? actor?.utruename ?? '').trim()
}

export function buildAssistOrderLogInfo({ orderNo, referenceNo = '', systemCode = '', actor }) {
  const raw = `单号：${orderNo || ''}，关联号：${referenceNo || ''}，系统编码：${systemCode || ''}，操作时间：${new Date().toISOString()}，操作者：${actorName(actor)}`
  return raw.length > MAX_ACT_INFO_LEN ? `${raw.slice(0, MAX_ACT_INFO_LEN - 3)}...` : raw
}

export async function writeAssistOrderOperationLog(poolOrTx, { actName, info, actor, orderNo, systemCode, ip = '' }) {
  const req = poolOrTx.request ? poolOrTx.request() : new sql.Request(poolOrTx)
  const actInfo = String(info ?? '').trim()
  const clippedInfo =
    actInfo.length > MAX_ACT_INFO_LEN ? `${actInfo.slice(0, MAX_ACT_INFO_LEN - 3)}...` : actInfo
  req.input('act_name', sql.NVarChar(200), actName)
  req.input('act_info', sql.NVarChar(MAX_ACT_INFO_LEN), clippedInfo)
  req.input('act_user', sql.NVarChar(200), actorName(actor))
  req.input('code', sql.NVarChar(200), orderNo || '')
  req.input('systemcode', sql.NVarChar(200), systemCode || orderNo || '')
  req.input('ip', sql.NVarChar(50), String(ip ?? '').trim() || null)
  await req.query(`
    INSERT INTO ${LOG_FROM} ([act_name], [act_info], [addtime], [uname], [utruename], [code], [systemcode], [ip])
    VALUES (@act_name, @act_info, CONVERT(nvarchar(30), GETDATE(), 120), @act_user, @act_user, @code, @systemcode, @ip)
  `)
}
