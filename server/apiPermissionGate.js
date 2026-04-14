/**
 * API 级权限闸门：根据 Method + Path + Body 匹配「菜单 path + 操作」
 * 未匹配的接口：仅校验已登录（避免一次性改全站）；匹配到的必须满足角色 Permissions
 */
import { getPool, sql } from './db.js'
import { parseRolePermissions, roleAllowsAction } from './permissions.js'

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {number} userId
 * @param {string} menuPath
 * @param {string} action
 */
export async function assertUserHasAction(pool, userId, menuPath, action) {
  const req = pool.request()
  req.input('UserID', sql.Int, userId)
  const result = await req.query(`
    SELECT TOP (1) r.Permissions AS Permissions
    FROM Sys_Users AS u
    INNER JOIN Sys_Roles AS r ON r.RoleID = u.RoleID
    WHERE u.UserID = @UserID AND u.Status = 1 AND r.Status = 1
  `)
  const row = result.recordset?.[0]
  const parsed = parseRolePermissions(row?.Permissions)
  return roleAllowsAction(parsed, menuPath, action)
}

/**
 * 任一条件满足即可（如 GET /api/roles：操作员页与角色页都可能调用）
 */
export async function assertUserHasAnyAction(pool, userId, candidates) {
  for (const { menuPath, action } of candidates) {
    if (await assertUserHasAction(pool, userId, menuPath, action)) {
      return true
    }
  }
  return false
}

/**
 * @param {string} method
 * @param {string} path express req.path
 * @param {any} body
 * @param {Record<string, string>} params req.params
 */
export function matchApiPermissionRule(method, path, body, params) {
  const m = String(method || '').toUpperCase()

  if (m === 'GET' && path === '/api/users') {
    return { menuPath: 'system/operator', action: 'view' }
  }
  if (m === 'POST' && path === '/api/users') {
    return { menuPath: 'system/operator', action: 'add' }
  }
  if (m === 'PUT' && path === '/api/users') {
    if (body && Number(body.Status) === 0) {
      return { menuPath: 'system/operator', action: 'delete' }
    }
    return { menuPath: 'system/operator', action: 'edit' }
  }
  if (m === 'PUT' && path === '/api/users/resume') {
    return { menuPath: 'system/operator', action: 'edit' }
  }
  if (m === 'PUT' && path === '/api/users/change-password') {
    return { menuPath: 'system/operator', action: 'edit' }
  }
  if (m === 'DELETE' && /^\/api\/users\/\d+$/.test(path)) {
    return { menuPath: 'system/operator', action: 'delete' }
  }

  if (m === 'GET' && path === '/api/roles') {
    return {
      anyOf: [
        { menuPath: 'system/role', action: 'view' },
        { menuPath: 'system/operator', action: 'view' },
      ],
    }
  }
  if (m === 'POST' && path === '/api/roles') {
    return { menuPath: 'system/role', action: 'add' }
  }
  if (m === 'PUT' && path === '/api/roles') {
    if (body && body.Status !== undefined && body.Status !== null && Number(body.Status) === 0) {
      return { menuPath: 'system/role', action: 'delete' }
    }
    return { menuPath: 'system/role', action: 'edit' }
  }
  if (m === 'PUT' && path === '/api/roles/resume') {
    return { menuPath: 'system/role', action: 'edit' }
  }
  if (m === 'PUT' && path === '/api/roles/permissions') {
    return { menuPath: 'system/role', action: 'audit' }
  }
  if (m === 'DELETE' && /^\/api\/roles\/\d+$/.test(path)) {
    return { menuPath: 'system/role', action: 'delete' }
  }

  return null
}

/**
 * 创建 Express 中间件（需在 express.json() 之后注册，以便读取 body）
 * @param {{ getCurrentUserFromReq: (req: any) => any | null }} deps
 */
export function createApiPermissionGate(deps) {
  return async function apiPermissionGate(req, res, next) {
    const p = req.path || ''
    if (p === '/api/login' || p === '/api/health') {
      return next()
    }
    if (!p.startsWith('/api/')) {
      return next()
    }

    const user = deps.getCurrentUserFromReq(req)
    if (!user) {
      res.status(401).json({
        code: 401,
        msg: '未登录或 token 无效：请在请求头携带 Authorization: Bearer <token>',
        data: null,
      })
      return
    }

    const rule = matchApiPermissionRule(req.method, p, req.body, req.params)
    if (!rule) {
      return next()
    }

    try {
      const pool = await getPool()
      let ok = false
      if (rule.anyOf?.length) {
        ok = await assertUserHasAnyAction(pool, user.userId, rule.anyOf)
      } else {
        ok = await assertUserHasAction(pool, user.userId, rule.menuPath, rule.action)
      }
      if (!ok) {
        res.status(403).json({ code: 403, msg: '无权限执行此操作', data: null })
        return
      }
    } catch (e) {
      console.error('API 权限校验异常：', e)
      res.status(500).json({ code: 500, msg: '权限校验失败', data: null })
      return
    }

    next()
  }
}
