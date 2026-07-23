import { onBeforeUnmount, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ERP_NO_CLOSE_GUARD_PARAM } from '@/utils/erpOpenInNewTab'
import { clearErpAuthStorage } from '@/utils/erpAuthStorage'

/** sessionStorage：本标签跳过浏览器关页确认（右键/深链新开时写入） */
export const ERP_SKIP_BROWSER_CLOSE_CONFIRM_KEY = 'erp_skip_browser_close_confirm'

/** sessionStorage 备份：与内存 refreshIntent 同步，供极端情况对照 */
const ERP_REFRESH_KEEP_AUTH_KEY = 'erp_refresh_keep_auth'

/** URL 上出现任一则视为「从主页打开的副标签」，应跳过守卫 */
const SKIP_QUERY_KEYS = [ERP_NO_CLOSE_GUARD_PARAM, 'erpOpen', 'erpMode', 'erpRecordId']

let guardEnabled = false
/** 键盘刷新意图（同页内存）；关标签无此意图则清登录 */
let refreshIntent = false

function readSkipFromSession() {
  try {
    return sessionStorage.getItem(ERP_SKIP_BROWSER_CLOSE_CONFIRM_KEY) === '1'
  } catch {
    return false
  }
}

function writeSkipToSession() {
  try {
    sessionStorage.setItem(ERP_SKIP_BROWSER_CLOSE_CONFIRM_KEY, '1')
  } catch {
    /* 隐私模式等写失败时仍依赖 URL 参数当次生效 */
  }
}

function markRefreshKeepAuth() {
  refreshIntent = true
  try {
    sessionStorage.setItem(ERP_REFRESH_KEEP_AUTH_KEY, '1')
  } catch {
    /* ignore */
  }
}

function clearRefreshKeepAuth() {
  refreshIntent = false
  try {
    sessionStorage.removeItem(ERP_REFRESH_KEEP_AUTH_KEY)
  } catch {
    /* ignore */
  }
}

function shouldKeepAuthOnPageHide() {
  if (refreshIntent) {
    clearRefreshKeepAuth()
    return true
  }
  try {
    if (sessionStorage.getItem(ERP_REFRESH_KEEP_AUTH_KEY) === '1') {
      sessionStorage.removeItem(ERP_REFRESH_KEEP_AUTH_KEY)
      return true
    }
  } catch {
    /* ignore */
  }
  return false
}

/**
 * @param {Record<string, unknown>} [query]
 */
export function shouldSkipCloseGuard(query = {}) {
  if (readSkipFromSession()) return true
  for (const key of SKIP_QUERY_KEYS) {
    const raw = query?.[key]
    if (raw != null && String(raw).trim() !== '') return true
  }
  return false
}

function onBeforeUnload(event) {
  event.preventDefault()
  event.returnValue = ''
  // 点「留下」后定时器会跑：清掉刷新意图，避免下次关标签误留登录
  // 点「离开」时页面卸载，定时器通常来不及误伤 pagehide 判断
  setTimeout(() => {
    clearRefreshKeepAuth()
  }, 0)
}

/** 用户确认离开后才会走到 pagehide；点「留下」不会触发 */
function onPageHide(event) {
  if (event?.persisted) return
  // 键盘 F5 / Ctrl+R：保留登录；关标签无刷新意图 → 清凭证
  if (shouldKeepAuthOnPageHide()) return
  clearErpAuthStorage()
}

/** 常见键盘刷新：打标，避免 pagehide 误清登录 */
function onKeyDownForRefresh(event) {
  const key = String(event.key || '')
  if (key === 'F5') {
    markRefreshKeepAuth()
    return
  }
  if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === 'r') {
    markRefreshKeepAuth()
  }
}

export function enableBrowserCloseGuard() {
  if (guardEnabled) return
  window.addEventListener('beforeunload', onBeforeUnload)
  window.addEventListener('pagehide', onPageHide)
  window.addEventListener('keydown', onKeyDownForRefresh)
  guardEnabled = true
}

export function disableBrowserCloseGuard() {
  if (!guardEnabled) return
  window.removeEventListener('beforeunload', onBeforeUnload)
  window.removeEventListener('pagehide', onPageHide)
  window.removeEventListener('keydown', onKeyDownForRefresh)
  guardEnabled = false
  clearRefreshKeepAuth()
}

/**
 * 退出登录等主动离开：临时关掉守卫，避免叠系统确认
 * @param {() => (void | Promise<void>)} fn
 */
export async function runWithoutCloseGuard(fn) {
  disableBrowserCloseGuard()
  try {
    return await fn()
  } finally {
    /* 离开主壳后不再恢复；若仍停在主壳且未跳过，由调用方自行 sync */
  }
}

/**
 * 仅挂在 ErpLayout：主壳关浏览器标签/刷新时系统确认；副标签与独立窗不挂。
 * 确认「离开此网站」后清 erp_token/erp_user；键盘刷新尽量保留登录。
 */
export function useErpBrowserCloseGuard() {
  const route = useRoute()
  const router = useRouter()

  /** 深链/右键标记落入 session，并清掉仅作信使的 erpNoCloseGuard */
  function markSkipCloseGuardFromRoute() {
    const q = route.query || {}
    const hasSkipSignal = SKIP_QUERY_KEYS.some((key) => {
      const raw = q[key]
      return raw != null && String(raw).trim() !== ''
    })
    if (hasSkipSignal) writeSkipToSession()

    if (q[ERP_NO_CLOSE_GUARD_PARAM] == null || String(q[ERP_NO_CLOSE_GUARD_PARAM]).trim() === '') {
      return
    }
    const nextQuery = { ...q }
    delete nextQuery[ERP_NO_CLOSE_GUARD_PARAM]
    router.replace({ path: route.path, query: nextQuery, hash: route.hash })
  }

  function syncGuard() {
    markSkipCloseGuardFromRoute()
    if (shouldSkipCloseGuard(route.query)) {
      disableBrowserCloseGuard()
      return
    }
    enableBrowserCloseGuard()
  }

  onMounted(() => {
    syncGuard()
  })

  onBeforeUnmount(() => {
    disableBrowserCloseGuard()
  })

  return {
    syncGuard,
    runWithoutCloseGuard,
    shouldSkipCloseGuard,
  }
}
