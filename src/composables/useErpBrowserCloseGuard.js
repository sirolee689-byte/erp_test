import { onBeforeUnmount, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ERP_NO_CLOSE_GUARD_PARAM } from '@/utils/erpOpenInNewTab'

/** sessionStorage：本标签跳过浏览器关页确认（右键/深链新开时写入） */
export const ERP_SKIP_BROWSER_CLOSE_CONFIRM_KEY = 'erp_skip_browser_close_confirm'

/** URL 上出现任一则视为「从主页打开的副标签」，应跳过守卫 */
const SKIP_QUERY_KEYS = [ERP_NO_CLOSE_GUARD_PARAM, 'erpOpen', 'erpMode', 'erpRecordId']

let guardEnabled = false

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
}

export function enableBrowserCloseGuard() {
  if (guardEnabled) return
  window.addEventListener('beforeunload', onBeforeUnload)
  guardEnabled = true
}

export function disableBrowserCloseGuard() {
  if (!guardEnabled) return
  window.removeEventListener('beforeunload', onBeforeUnload)
  guardEnabled = false
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
