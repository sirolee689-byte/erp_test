/**
 * 操作日志写入：供中间件与业务路由复用；CreateTime 由库表默认值 GETDATE() 填充
 */
import { getPool, sql } from './db.js'
import { getRequestIp, redactBodyForOperationAudit } from './operationAuditMiddleware.js'

export const SYS_OPERATION_LOGS_FROM = 'dbo.[Sys_OperationLogs]'

const MAX_CONTENT_LEN = 2000

/** @type {(req: import('express').Request) => any | null} */
let getCurrentUserFromReq = () => null

/**
 * 在 index.js 启动时注入 getCurrentUserFromReq（避免循环依赖）
 * @param {{ getCurrentUserFromReq: (req: import('express').Request) => any | null }} deps
 */
export function configureOperationLogWriter(deps) {
  getCurrentUserFromReq = deps.getCurrentUserFromReq
}

/**
 * 底层写入 Sys_OperationLogs（与中间件 payload 一致）
 * @param {import('mssql').ConnectionPool|import('mssql').Transaction} poolOrTx
 * @param {{
 *   userId?: string|number|null,
 *   userName?: string|null,
 *   action: string,
 *   targetTable: string,
 *   content: string,
 *   ipAddress?: string|null,
 * }} payload
 */
export async function writeOperationLog(poolOrTx, payload) {
  const req = poolOrTx.request()
  req.input('UserId', sql.NVarChar(50), payload.userId == null ? null : String(payload.userId))
  req.input('UserName', sql.NVarChar(50), String(payload.userName ?? '').trim() || null)
  req.input('Action', sql.NVarChar(50), String(payload.action ?? '').trim())
  req.input('TargetTable', sql.NVarChar(100), String(payload.targetTable ?? '').trim())
  req.input('Content', sql.NVarChar(2000), String(payload.content ?? '').trim() || null)
  req.input('IPAddress', sql.NVarChar(50), String(payload.ipAddress ?? '').trim() || null)
  await req.query(`
    INSERT INTO ${SYS_OPERATION_LOGS_FROM} (UserId, UserName, Action, TargetTable, Content, IPAddress)
    VALUES (@UserId, @UserName, @Action, @TargetTable, @Content, @IPAddress)
  `)
}

/**
 * 业务代码补记日志：自动带出操作者、IP；时间由数据库默认列处理
 * @param {import('express').Request} req
 * @param {string} action 中文业务动作（建议与 action_map 语义一致）
 * @param {string | Record<string, unknown> | null | undefined} details 文本或对象（对象会脱敏后 JSON 化）
 * @param {{ targetTable?: string, pool?: import('mssql').ConnectionPool }} [options]
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

  if (content.length > MAX_CONTENT_LEN) {
    content = `${content.slice(0, MAX_CONTENT_LEN - 30)}…(已截断，共超${MAX_CONTENT_LEN}字符)`
  }

  await writeOperationLog(pool, {
    userId: user?.userId ?? null,
    userName: String(user?.userName ?? user?.userCode ?? '').trim() || null,
    action: String(action ?? '').trim(),
    targetTable: String(options.targetTable ?? 'ERP').trim(),
    content: content.trim() || null,
    ipAddress: getRequestIp(req) || null,
  })
}
