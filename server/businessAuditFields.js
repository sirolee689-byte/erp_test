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
