/**
 * 业务动作映射：HTTP Method + Path → 中文 Action + 目标表
 * 新增接口时请在此补充映射；未命中时中间件兜底为「系统操作」。
 */

export const DEFAULT_UNKNOWN_ACTION = '系统操作'
export const DEFAULT_UNKNOWN_TARGET_TABLE = 'ERP'

/** @typedef {string | RegExp} PathMatcher */

/**
 * @typedef {{
 *   method: string,
 *   path: PathMatcher,
 *   action: string,
 *   targetTable: string,
 * }} OperationAuditRouteRule
 */

/**
 * 规则按「更具体的路径优先」自上而下匹配（同 Method 下先写子路径再写父路径）
 * @type {OperationAuditRouteRule[]}
 */
export const OPERATION_AUDIT_ROUTE_RULES = [
  { method: 'PUT', path: '/api/hr/staff/audit', action: '审核员工档案', targetTable: 'HR_staff' },
  { method: 'PUT', path: '/api/hr/staff/unaudit', action: '反审员工档案', targetTable: 'HR_staff' },
  { method: 'PUT', path: '/api/hr/staff/restore', action: '恢复员工档案', targetTable: 'HR_staff' },
  { method: 'PUT', path: /^\/api\/hr\/staff\/leave\/.+$/, action: '办理员工离职', targetTable: 'HR_staff' },
  { method: 'POST', path: '/api/hr/staff/batch-update', action: '批量更新员工档案', targetTable: 'HR_staff' },
  { method: 'POST', path: '/api/hr/staff', action: '新增员工档案', targetTable: 'HR_staff' },
  { method: 'PUT', path: '/api/hr/staff', action: '修改员工档案', targetTable: 'HR_staff' },
  { method: 'DELETE', path: /^\/api\/hr\/staff\/.+/, action: '删除员工档案', targetTable: 'HR_staff' },

  { method: 'POST', path: '/api/hr/dormitory/rooms', action: '新增宿舍房间', targetTable: 'Hr_room' },
  { method: 'PUT', path: '/api/hr/dormitory/rooms/audit', action: '审核宿舍房间', targetTable: 'Hr_room' },
  { method: 'PUT', path: '/api/hr/dormitory/rooms/unaudit', action: '反审宿舍房间', targetTable: 'Hr_room' },
  { method: 'POST', path: '/api/hr/dormitory/check-in', action: '办理了入住', targetTable: 'Hr_room_in' },
  { method: 'PUT', path: '/api/hr/dormitory/room-in/room-info', action: '修改入住备注', targetTable: 'Hr_room_in' },
  { method: 'PUT', path: '/api/hr/dormitory/check-out', action: '办理了退宿', targetTable: 'Hr_room_in' },
  { method: 'PUT', path: '/api/hr/dormitory/lodging-in/audit', action: '审核入住单', targetTable: 'Hr_room_in' },
  { method: 'PUT', path: '/api/hr/dormitory/lodging-in/audit-batch', action: '批量审核入住单', targetTable: 'Hr_room_in' },

  { method: 'PUT', path: '/api/hr/departments/audit-batch', action: '批量审核部门', targetTable: 'HR_Departments' },
  { method: 'PUT', path: '/api/hr/departments/audit', action: '审核部门', targetTable: 'HR_Departments' },
  { method: 'PUT', path: '/api/hr/departments/unaudit', action: '反审部门', targetTable: 'HR_Departments' },
  { method: 'POST', path: '/api/hr/departments', action: '新增部门', targetTable: 'HR_Departments' },
  { method: 'PUT', path: '/api/hr/departments', action: '修改部门', targetTable: 'HR_Departments' },
  { method: 'DELETE', path: /^\/api\/hr\/departments\/.+/, action: '删除部门', targetTable: 'HR_Departments' },

  { method: 'PUT', path: '/api/roles/permissions', action: '保存角色权限', targetTable: 'Sys_Roles' },
  { method: 'PUT', path: '/api/roles/resume', action: '恢复角色', targetTable: 'Sys_Roles' },
  { method: 'POST', path: '/api/roles', action: '新增角色', targetTable: 'Sys_Roles' },
  { method: 'PUT', path: '/api/roles', action: '修改角色', targetTable: 'Sys_Roles' },
  { method: 'DELETE', path: /^\/api\/roles\/\d+$/, action: '删除角色', targetTable: 'Sys_Roles' },

  { method: 'PUT', path: '/api/users/resume', action: '恢复操作员', targetTable: 'Sys_Users' },
  { method: 'PUT', path: '/api/users/change-password', action: '修改密码', targetTable: 'Sys_Users' },
  { method: 'POST', path: '/api/users', action: '新增操作员', targetTable: 'Sys_Users' },
  { method: 'PUT', path: '/api/users', action: '修改操作员', targetTable: 'Sys_Users' },
  { method: 'DELETE', path: /^\/api\/users\/\d+$/, action: '删除操作员', targetTable: 'Sys_Users' },

  { method: 'DELETE', path: '/api/sys/logs/clear', action: '清空操作日志', targetTable: 'Sys_OperationLogs' },

  // 示例：仓储入库（路由落地后无需改中间件，只需保留/调整本行映射）
  { method: 'POST', path: '/api/warehouse/stock-in', action: '入库单新增', targetTable: 'Inv_StockIn' },
  { method: 'DELETE', path: /^\/api\/warehouse\/stock-in\/[^/]+$/, action: '入库单作废', targetTable: 'Inv_StockIn' },
]

/**
 * @param {PathMatcher} matcher
 * @param {string} path
 */
function pathMatches(matcher, path) {
  const p = String(path || '')
  if (matcher instanceof RegExp) return matcher.test(p)
  return matcher === p
}

/**
 * 根据 Method + Path 解析中文动作与目标表（未命中则兜底「系统操作」）
 * @param {string} method
 * @param {string} path express req.path
 * @returns {{ action: string, targetTable: string }}
 */
export function resolveAuditActionAndTable(method, path) {
  const m = String(method || '').toUpperCase()
  const p = String(path || '')
  for (const rule of OPERATION_AUDIT_ROUTE_RULES) {
    if (String(rule.method || '').toUpperCase() !== m) continue
    if (pathMatches(rule.path, p)) {
      return { action: rule.action, targetTable: rule.targetTable }
    }
  }
  return { action: DEFAULT_UNKNOWN_ACTION, targetTable: DEFAULT_UNKNOWN_TARGET_TABLE }
}
