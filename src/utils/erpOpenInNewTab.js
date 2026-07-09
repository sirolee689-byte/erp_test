import { ElMessage } from 'element-plus'

/**
 * 构建本站绝对 URL（保留 origin，可带查询参数）
 * @param {string} pathname 以 / 开头的路径
 * @param {Record<string, string | number | boolean | null | undefined>} [searchParams]
 */
export function buildAppUrl(pathname, searchParams = {}) {
  const url = new URL(window.location.href)
  url.pathname = pathname.startsWith('/') ? pathname : `/${pathname}`
  url.search = ''
  url.hash = ''
  for (const [key, raw] of Object.entries(searchParams)) {
    if (raw == null || String(raw).trim() === '') continue
    url.searchParams.set(key, String(raw))
  }
  return url.toString()
}

/**
 * 在新标签页打开 URL；被浏览器拦截时弹中文提示
 * @param {string} url
 * @returns {Window | null}
 */
export function openInNewTab(url) {
  const target = String(url ?? '').trim()
  if (!target) return null
  const win = window.open(target, '_blank', 'noopener')
  if (!win) {
    ElMessage.warning('浏览器拦截了新标签页，请允许本站弹出窗口后重试')
    return null
  }
  win.focus?.()
  return win
}

/**
 * 深链：同模块新标签打开记录（查看/编辑等）
 * @param {string} pathname
 * @param {'view' | 'edit' | 'create'} erpOpen
 * @param {string | number} [recordId]
 */
export function buildErpDeepLinkUrl(pathname, erpOpen, recordId) {
  const params = { erpOpen }
  if (recordId != null && String(recordId).trim() !== '') {
    params.erpRecordId = String(recordId)
  }
  return buildAppUrl(pathname, params)
}

/**
 * 模式条：同模块新标签切换模式（管理/新增/物料追溯等）
 * @param {string} pathname
 * @param {string} erpMode
 */
export function buildErpModeLinkUrl(pathname, erpMode) {
  return buildAppUrl(pathname, { erpMode })
}
