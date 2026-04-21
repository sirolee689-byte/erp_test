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

  if (m === 'GET' && path === '/api/sys/logs') {
    return { menuPath: 'system/logs', action: 'view' }
  }

  /* v1.0.8：人力资源 — 部门资料（菜单 path与 erp_structure_dump 一致：hr/files/department） */
  if (m === 'GET' && path === '/api/hr/departments') {
    return { menuPath: 'hr/files/department', action: 'view' }
  }
  if (m === 'GET' && path === '/api/hr/departments/tree') {
    return { menuPath: 'hr/files/department', action: 'view' }
  }
  if (m === 'GET' && path === '/api/hr/departments/options') {
    return { menuPath: 'hr/files/department', action: 'view' }
  }
  if (m === 'GET' && path === '/api/hr/departments/posts') {
    return { menuPath: 'hr/files/department', action: 'view' }
  }
  if (m === 'POST' && path === '/api/hr/departments') {
    return { menuPath: 'hr/files/department', action: 'add' }
  }
  /* 须先于泛化的 PUT /api/hr/departments 匹配（审核 / 反审共用 audit 权限） */
  if (m === 'PUT' && path === '/api/hr/departments/audit') {
    return { menuPath: 'hr/files/department', action: 'audit' }
  }
  if (m === 'PUT' && path === '/api/hr/departments/audit-batch') {
    return { menuPath: 'hr/files/department', action: 'audit' }
  }
  if (m === 'PUT' && path === '/api/hr/departments/unaudit') {
    return { menuPath: 'hr/files/department', action: 'audit' }
  }
  if (m === 'PUT' && path === '/api/hr/departments') {
    return { menuPath: 'hr/files/department', action: 'edit' }
  }
  /* 旧系统部门主键为字符串 code，路径段非纯数字 */
  if (m === 'DELETE' && /^\/api\/hr\/departments\/.+$/.test(path)) {
    return { menuPath: 'hr/files/department', action: 'delete' }
  }

  /* v1.0.9：人事档案精简管理（菜单 path 与 erp_structure_dump 一致：hr/files/employee-files） */
  if (m === 'GET' && path === '/api/hr/staff/department-options') {
    return { menuPath: 'hr/files/employee-files', action: 'view' }
  }
  if (m === 'GET' && path === '/api/hr/staff/department-posts') {
    return { menuPath: 'hr/files/employee-files', action: 'view' }
  }
  if (m === 'GET' && path === '/api/hr/staff') {
    return { menuPath: 'hr/files/employee-files', action: 'view' }
  }
  if (m === 'GET' && /^\/api\/hr\/staff\/.+$/.test(path)) {
    return { menuPath: 'hr/files/employee-files', action: 'view' }
  }
  if (m === 'GET' && path === '/api/hr/staff/debug-code') {
    return { menuPath: 'hr/files/employee-files', action: 'view' }
  }
  if (m === 'POST' && path === '/api/hr/staff') {
    return { menuPath: 'hr/files/employee-files', action: 'add' }
  }
  if (m === 'POST' && path === '/api/hr/staff/batch-update') {
    return { menuPath: 'hr/files/employee-files', action: 'edit' }
  }
  if (m === 'PUT' && path === '/api/hr/staff/audit') {
    return { menuPath: 'hr/files/employee-files', action: 'audit' }
  }
  if (m === 'PUT' && path === '/api/hr/staff/unaudit') {
    return { menuPath: 'hr/files/employee-files', action: 'audit' }
  }
  if (m === 'PUT' && path === '/api/hr/staff') {
    return { menuPath: 'hr/files/employee-files', action: 'edit' }
  }
  if (m === 'PUT' && path === '/api/hr/staff/restore') {
    return { menuPath: 'hr/files/employee-files', action: 'edit' }
  }
  if (m === 'PUT' && /^\/api\/hr\/staff\/leave\/.+$/.test(path)) {
    return { menuPath: 'hr/files/employee-files', action: 'edit' }
  }
  if (m === 'DELETE' && /^\/api\/hr\/staff\/.+$/.test(path)) {
    return { menuPath: 'hr/files/employee-files', action: 'delete' }
  }

  /* v1.1.3：宿舍 — 房间管理 / 住宿办理（菜单 path 与 erp_structure_dump 一致） */
  if (m === 'GET' && path === '/api/hr/dormitory/rooms') {
    return { menuPath: 'hr/dormitory/room-management', action: 'view' }
  }
  if (m === 'GET' && /^\/api\/hr\/dormitory\/rooms\/\d+$/.test(path)) {
    return { menuPath: 'hr/dormitory/room-management', action: 'view' }
  }
  if (m === 'POST' && path === '/api/hr/dormitory/rooms') {
    return { menuPath: 'hr/dormitory/room-management', action: 'add' }
  }
  if (m === 'PUT' && path === '/api/hr/dormitory/rooms/audit') {
    return { menuPath: 'hr/dormitory/room-management', action: 'audit' }
  }
  if (m === 'PUT' && path === '/api/hr/dormitory/rooms/unaudit') {
    return { menuPath: 'hr/dormitory/room-management', action: 'audit' }
  }
  if (m === 'POST' && path === '/api/hr/dormitory/check-in') {
    return { menuPath: 'hr/dormitory/lodging-records', action: 'add' }
  }
  if (m === 'GET' && path === '/api/hr/dormitory/check-in/staff-options') {
    return { menuPath: 'hr/dormitory/lodging-records', action: 'add' }
  }
  if (m === 'GET' && path === '/api/hr/dormitory/room-occupants') {
    return { menuPath: 'hr/dormitory/lodging-records', action: 'view' }
  }
  if (m === 'PUT' && path === '/api/hr/dormitory/check-out') {
    return { menuPath: 'hr/dormitory/lodging-records', action: 'add' }
  }
  if (m === 'PUT' && path === '/api/hr/dormitory/room-in/room-info') {
    return { menuPath: 'hr/dormitory/lodging-records', action: 'edit' }
  }
  if (m === 'GET' && path === '/api/hr/dormitory/lodging-overview') {
    return { menuPath: 'hr/dormitory/lodging-records', action: 'view' }
  }
  if (m === 'GET' && path === '/api/hr/dormitory/lodging-history') {
    return { menuPath: 'hr/dormitory/lodging-records', action: 'view' }
  }
  /* v1.1.4：入住审批 Tab 并入「住宿管理」；列表/审核走 lodging-records 权限 */
  if (m === 'GET' && path === '/api/hr/dormitory/lodging-in/audit-center-list') {
    return { menuPath: 'hr/dormitory/lodging-records', action: 'view' }
  }
  if (m === 'PUT' && path === '/api/hr/dormitory/lodging-in/audit') {
    return { menuPath: 'hr/dormitory/lodging-records', action: 'audit' }
  }
  if (m === 'PUT' && path === '/api/hr/dormitory/lodging-in/reject') {
    return { menuPath: 'hr/dormitory/lodging-records', action: 'audit' }
  }
  if (m === 'PUT' && path === '/api/hr/dormitory/lodging-in/audit-batch') {
    return { menuPath: 'hr/dormitory/lodging-records', action: 'audit' }
  }
  /* 入住单反审核（独立路径，权限与 lodging-in/audit 一致） */
  if (m === 'PUT' && path === '/api/dorm/un-audit') {
    return { menuPath: 'hr/dormitory/lodging-records', action: 'audit' }
  }
  /* 未审核入住申请物理删除（与审核/反审核同级敏感操作） */
  if (m === 'DELETE' && path === '/api/dorm/delete-checkin') {
    return { menuPath: 'hr/dormitory/lodging-records', action: 'audit' }
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

    // 供业务 INSERT（UID/uname）与 writeLog 等统一读取当前登录用户（与 Bearer 解析结果一致）
    req.user = user

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
