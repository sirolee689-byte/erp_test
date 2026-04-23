/**
 * 业务表审计字段：INSERT/UPDATE 时从当前登录态取 UID、uname
 * 依赖：apiPermissionGate 在校验通过后挂载 req.user（与 token 解析结果一致）
 */

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
  const unameRaw = u.userName ?? u.userCode ?? ''
  const uname = String(unameRaw).trim() || null
  return { UID, uname }
}

/**
 * 规则 16 三字段：uid（Sys_Users.UserID）、uname（UserCode）、utruename（UserName）
 * 仅从 req.user 取值，禁止信任前端 body 传入。
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
  const uname = String(u.userCode ?? '').trim() || null
  const utruename = String(u.userName ?? '').trim() || null
  return { uidInt: uidOk, uname, utruename }
}
