/**
 * 登录凭证清理（与退出登录、主壳关页确认离开共用）
 * 只删 erp_token / erp_user，保留「记住账号」、主题/密度等偏好。
 */
export function clearErpAuthStorage() {
  try {
    localStorage.removeItem('erp_token')
    localStorage.removeItem('erp_user')
  } catch {
    /* 隐私模式等读失败时忽略 */
  }
  try {
    sessionStorage.removeItem('erp_token')
    sessionStorage.removeItem('erp_user')
  } catch {
    /* ignore */
  }
}
