import { getPool, sql } from './db.js'
import { getRequestIp, redactBodyForOperationAudit } from './operationAuditMiddleware.js'

export const OPERATION_LOG_FROM = 'dbo.[UB_Date_ERP_Operation_log]'

const MAX_ACT_INFO_LEN = 500

/** @type {(req: import('express').Request) => any | null} */
let getCurrentUserFromReq = () => null

/**
 * @param {{ getCurrentUserFromReq: (req: import('express').Request) => any | null }} deps
 */
export function configureOperationLogWriter(deps) {
  getCurrentUserFromReq = deps.getCurrentUserFromReq
}

function trimString(value) {
  return String(value ?? '').trim()
}

function clipActInfo(value) {
  const text = trimString(value)
  if (text.length <= MAX_ACT_INFO_LEN) return text
  return `${text.slice(0, MAX_ACT_INFO_LEN - 3)}...`
}

function resolveUserCode(user, payload) {
  return (
    trimString(payload.uname) ||
    trimString(payload.userCode) ||
    trimString(user?.userCode) ||
    trimString(payload.userName) ||
    trimString(user?.auditUserName) ||
    trimString(user?.userName)
  )
}

function resolveTrueName(user, payload, uname) {
  return (
    trimString(payload.utruename) ||
    trimString(payload.userTrueName) ||
    trimString(user?.userName) ||
    trimString(user?.auditTruename) ||
    trimString(payload.userName) ||
    uname
  )
}

/**
 * Write one operation log row into the official legacy log table.
 * @param {import('mssql').ConnectionPool|import('mssql').Transaction} poolOrTx
 * @param {{
 *   action?: string|null,
 *   actName?: string|null,
 *   content?: string|null,
 *   actInfo?: string|null,
 *   targetTable?: string|null,
 *   code?: string|null,
 *   systemcode?: string|number|null,
 *   ipAddress?: string|null,
 *   ip?: string|null,
 *   userCode?: string|null,
 *   userTrueName?: string|null,
 *   userName?: string|null,
 *   uname?: string|null,
 *   utruename?: string|null,
 * }} payload
 */
export async function writeOperationLog(poolOrTx, payload) {
  const req = poolOrTx.request()
  const uname = resolveUserCode(null, payload)
  const utruename = resolveTrueName(null, payload, uname)
  const actName = trimString(payload.actName ?? payload.action)
  const actInfo = clipActInfo(payload.actInfo ?? payload.content)
  const code = trimString(payload.code ?? payload.targetTable) || 'ERP'
  const systemcode = trimString(payload.systemcode)
  const ip = trimString(payload.ip ?? payload.ipAddress) || null

  req.input('act_name', sql.NVarChar(200), actName || null)
  req.input('act_info', sql.NVarChar(MAX_ACT_INFO_LEN), actInfo || null)
  req.input('uname', sql.NVarChar(200), uname || null)
  req.input('utruename', sql.NVarChar(200), utruename || null)
  req.input('code', sql.NVarChar(200), code)
  req.input('systemcode', sql.NVarChar(200), systemcode || null)
  req.input('ip', sql.NVarChar(50), ip)
  await req.query(`
    INSERT INTO ${OPERATION_LOG_FROM} ([act_name], [act_info], [addtime], [uname], [utruename], [code], [systemcode], [ip])
    VALUES (@act_name, @act_info, CONVERT(nvarchar(30), GETDATE(), 120), @uname, @utruename, @code, @systemcode, @ip)
  `)
}

/**
 * Business routes can call this helper directly. Log failures are intentionally
 * left to callers here so transactional routes can choose whether to catch them.
 * @param {import('express').Request} req
 * @param {string} action
 * @param {string | Record<string, unknown> | null | undefined} details
 * @param {{ targetTable?: string, code?: string, systemcode?: string|number, pool?: import('mssql').ConnectionPool }} [options]
 */
export async function writeLog(req, action, details, options = {}) {
  const user = getCurrentUserFromReq(req)
  const pool = options.pool ?? (await getPool())

  let content = ''
  if (details === null || details === undefined) {
    content = ''
  } else if (typeof details === 'string') {
    content = details
  } else if (typeof details === 'object') {
    try {
      content = JSON.stringify(redactBodyForOperationAudit(details))
    } catch {
      content = String(details)
    }
  } else {
    content = String(details)
  }

  const uname = trimString(user?.userCode) || trimString(user?.auditUserName) || trimString(user?.userName)
  const utruename = trimString(user?.userName) || trimString(user?.auditTruename) || uname

  await writeOperationLog(pool, {
    action,
    content,
    code: options.code ?? options.targetTable ?? 'ERP',
    systemcode: options.systemcode ?? '',
    uname,
    utruename,
    ip: getRequestIp(req) || null,
  })
}
