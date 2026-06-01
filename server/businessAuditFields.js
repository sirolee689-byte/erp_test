/**
 * 业务表审计字段：INSERT/UPDATE 时从当前登录态取 uid、uname、utruename
 * 依赖：apiPermissionGate 在校验通过后挂载 req.user（与 token 解析结果一致）
 *
 * 口径（与 CONTEXT.md 第三节一致）：
 * - uid → Sys_Users.UserID
 * - uname → Sys_Users.UserName（登录账号列 username/UserName，非 usercode、非 Sys_Users.uname）
 * - utruename → Sys_Users.truename
 */
import { resolveSysUsersAuditTripletByUsercode } from './sysUsersDb.js'

/**
 * @param {import('express').Request} req
 * @returns {{ UID: string | null, uname: string | null }}
 */
export function getActorAuditFromReq(req) {
  const u = req?.user
  if (!u || typeof u !== 'object') {
    return { UID: null, uname: null }
  }
  const UID = u.userId != null && u.userId !== '' ? String(u.userId) : null
  const auditUserName = String(u.auditUserName ?? '').trim()
  const usercode = String(u.userCode ?? '').trim()
  const unameRaw = auditUserName || usercode || ''
  const uname = String(unameRaw).trim() || null
  return { UID, uname }
}

/**
 * 同步三字段（令牌内 auditUserName / auditTruename，登录时写入）。
 * 有 pool 时请用 resolveActorAuditTripletFromReq 按 usercode 查库覆盖。
 * @param {import('express').Request} req
 * @returns {{ uidInt: number | null, uname: string | null, utruename: string | null }}
 */
export function getActorAuditTripletFromReq(req) {
  const u = req?.user
  if (!u || typeof u !== 'object') {
    return { uidInt: null, uname: null, utruename: null }
  }
  const uidInt = Number(u.userId)
  const uidOk = Number.isFinite(uidInt) && uidInt > 0 ? uidInt : null
  const auditUserName = String(u.auditUserName ?? '').trim()
  const auditTruename = String(u.auditTruename ?? '').trim()
  const usercode = String(u.userCode ?? '').trim()
  const uidStr = uidOk != null ? String(uidOk) : ''
  const uname = auditUserName || usercode || uidStr || null
  const utruename = auditTruename || null
  return { uidInt: uidOk, uname, utruename }
}

/**
 * 按当前登录 usercode 查 Sys_Users，返回业务表审计三字段（优先于令牌缓存）。
 * @param {import('mssql').ConnectionPool | null | undefined} pool
 * @param {import('express').Request} req
 * @returns {Promise<{ uidInt: number | null, uname: string | null, utruename: string | null }>}
 */
export async function resolveActorAuditTripletFromReq(pool, req) {
  const base = getActorAuditTripletFromReq(req)
  const usercode = String(req?.user?.userCode ?? '').trim()
  if (!pool || !usercode) return base
  const resolved = await resolveSysUsersAuditTripletByUsercode(pool, usercode)
  if (!resolved) return base
  return {
    uidInt: resolved.uidInt ?? base.uidInt,
    uname: resolved.uname ?? base.uname,
    utruename: resolved.utruename ?? base.utruename,
  }
}
