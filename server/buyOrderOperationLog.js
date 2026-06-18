import { sql } from './db.js'

const LOG_FROM = 'dbo.[UB_Date_ERP_Operation_log]'
const TABLE_CODE = 'UB_ERP_Buy_order'
const MAX_ACT_INFO_LEN = 500

function firstText(...values) {
  for (const value of values) {
    const s = String(value ?? '').trim()
    if (s) return s
  }
  return ''
}

function normalizeActor(actor = {}) {
  const uidRaw = actor.uidInt ?? actor.uid ?? actor.userId ?? actor.UserID
  const uidNum = Number(uidRaw)
  return {
    uid: Number.isFinite(uidNum) && uidNum > 0 ? String(Math.trunc(uidNum)) : firstText(uidRaw),
    uname: firstText(actor.uname, actor.auditUserName, actor.username, actor.userName, actor.userCode, actor.UserName),
    utruename: firstText(actor.utruename, actor.auditTruename, actor.trueName, actor.truename, actor.name, actor.userTrueName, actor.userName),
  }
}

function clip(s) {
  const raw = String(s ?? '').trim()
  return raw.length > MAX_ACT_INFO_LEN ? `${raw.slice(0, MAX_ACT_INFO_LEN - 3)}...` : raw
}

export function buildBuyOrderLogInfo({ orderNo, referenceNo = '', actor, reason = '' }) {
  const a = normalizeActor(actor)
  return clip(`单号：${orderNo || ''}，关联号：${referenceNo || ''}，操作者：${a.utruename || a.uname}${reason ? `，原因：${reason}` : ''}`)
}

export async function writeBuyOrderOperationLog(poolOrTx, { actName, info, actor, orderNo, systemCode, ip = '' }) {
  const req = poolOrTx.request ? poolOrTx.request() : new sql.Request(poolOrTx)
  const a = normalizeActor(actor)
  req.input('act_name', sql.NVarChar(200), actName)
  req.input('act_info', sql.NVarChar(MAX_ACT_INFO_LEN), clip(info))
  req.input('uid', sql.NVarChar(50), a.uid)
  req.input('uname', sql.NVarChar(200), a.uname)
  req.input('utruename', sql.NVarChar(200), a.utruename)
  req.input('code', sql.NVarChar(200), TABLE_CODE)
  req.input('systemcode', sql.NVarChar(200), systemCode || orderNo || '')
  req.input('ip', sql.NVarChar(50), String(ip ?? '').trim() || null)
  await req.query(`
    INSERT INTO ${LOG_FROM} ([act_name], [act_info], [addtime], [uid], [uname], [utruename], [code], [systemcode], [ip])
    VALUES (@act_name, @act_info, CONVERT(nvarchar(30), GETDATE(), 120), @uid, @uname, @utruename, @code, @systemcode, @ip)
  `)
}

