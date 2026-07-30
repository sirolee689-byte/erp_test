/**
 * 前端只用于控制按钮显示；真正的超级管理员门禁由后端实时查询
 * New_UB_ERP_User.is_admin=1 后执行，不能把这里当作安全校验。
 */
export function isErpSuperAdmin() {
  try {
    const raw = localStorage.getItem('erp_user')
    const user = raw ? JSON.parse(raw) : null
    return Number(user?.is_admin ?? user?.isAdmin ?? user?.IsAdmin) === 1 || user?.isAdmin === true
  } catch {
    return false
  }
}
