const DINING_TOKEN_KEY = 'dining_token'
const DINING_USER_KEY = 'dining_user'

export function getDiningToken() {
  try {
    return String(localStorage.getItem(DINING_TOKEN_KEY) ?? '').trim()
  } catch {
    return ''
  }
}

export function getDiningUser() {
  try {
    const raw = localStorage.getItem(DINING_USER_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function saveDiningAuth(token, user) {
  localStorage.setItem(DINING_TOKEN_KEY, String(token ?? '').trim())
  localStorage.setItem(DINING_USER_KEY, JSON.stringify(user || {}))
}

export function saveDiningUser(user) {
  localStorage.setItem(DINING_USER_KEY, JSON.stringify(user || {}))
}

export function clearDiningAuth() {
  try {
    localStorage.removeItem(DINING_TOKEN_KEY)
    localStorage.removeItem(DINING_USER_KEY)
  } catch {
    /* 隐私模式等存储不可用时忽略，路由仍会回登录页。 */
  }
}
