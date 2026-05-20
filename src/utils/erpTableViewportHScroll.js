/**
 * Element Plus 主列表：视口底部固定横向滚动条，与表体 scrollLeft 双向同步。
 * 横条挂在 document.body，避免随页面滚到「上百条数据最底」才出现。
 */

const stateMap = new WeakMap()

const HSCROLL_CLASS = 'erp-table-viewport-hscroll'
const ACTIVE_CLASS = 'erp-table-viewport-hscroll-active'
const REFRESH_DEBOUNCE_MS = 80

function resolveTableRoot(el) {
  if (!el) return null
  if (el.classList?.contains('el-table')) return el
  return el.querySelector?.('.el-table') || null
}

function getBodyScrollEl(tableEl) {
  return (
    tableEl.querySelector('.el-table__body-wrapper .el-scrollbar__wrap') ||
    tableEl.querySelector('.el-table__body-wrapper')
  )
}

function getHeaderScrollEl(tableEl) {
  return (
    tableEl.querySelector('.el-table__header-wrapper .el-scrollbar__wrap') ||
    tableEl.querySelector('.el-table__header-wrapper')
  )
}

function getScrollParents(el) {
  const parents = []
  let node = el?.parentElement
  while (node && node !== document.body) {
    const { overflow, overflowX, overflowY } = getComputedStyle(node)
    const scrollable = [overflow, overflowX, overflowY].some((v) => v === 'auto' || v === 'scroll')
    if (scrollable) parents.push(node)
    node = node.parentElement
  }
  parents.push(window)
  return parents
}

function needsHorizontalScroll(scrollEl) {
  if (!scrollEl) return false
  return scrollEl.scrollWidth > scrollEl.clientWidth + 1
}

function getMaxScrollLeft(scrollEl) {
  if (!scrollEl) return 0
  return Math.max(0, scrollEl.scrollWidth - scrollEl.clientWidth)
}

/** 触发 Element Plus 表头/表体列宽对齐 */
export function requestErpTableLayout(tableEl) {
  const root = resolveTableRoot(tableEl) || tableEl
  if (!root) return
  const proxy = root.__vueParentComponent?.proxy
  if (typeof proxy?.doLayout === 'function') {
    proxy.doLayout()
    return
  }
  window.dispatchEvent(new Event('resize'))
}

/**
 * @param {HTMLElement} tableEl el-table 根节点（需含 class erp-list-table 或任意 el-table）
 * @param {{ bottomOffset?: number }} [options]
 * @returns {() => void}
 */
export function attachErpTableViewportHScroll(tableEl, options = {}) {
  const root = resolveTableRoot(tableEl) || tableEl
  if (!root?.classList?.contains('el-table')) {
    return () => {}
  }

  let state = stateMap.get(root)
  if (state) {
    state.options = { ...state.options, ...options }
    state.scheduleRefresh(true)
    return state.detach
  }

  state = createState(root, options)
  stateMap.set(root, state)
  state.bind()
  return state.detach
}

function createState(tableEl, options) {
  const bottomOffset = Number(options.bottomOffset) || 0

  const bar = document.createElement('div')
  bar.className = HSCROLL_CLASS
  bar.setAttribute('role', 'presentation')
  bar.setAttribute('aria-hidden', 'true')
  const inner = document.createElement('div')
  inner.className = `${HSCROLL_CLASS}-inner`
  bar.appendChild(inner)
  document.body.appendChild(bar)

  tableEl.classList.add(ACTIVE_CLASS)

  let syncing = false
  let barDragging = false
  let bodyEl = null
  let headerEl = null
  let ro = null
  let mo = null
  let scrollParents = []
  let bindAttempts = 0
  let refreshTimer = null
  let layoutTimer = null

  const clampScrollLeft = (left) => {
    const max = getMaxScrollLeft(bodyEl)
    return Math.min(Math.max(0, left), max)
  }

  const setScrollLeft = (left) => {
    if (syncing || !bodyEl) return
    const clamped = clampScrollLeft(left)
    syncing = true
    bodyEl.scrollLeft = clamped
    if (headerEl && headerEl !== bodyEl) headerEl.scrollLeft = clamped
    if (bar.scrollLeft !== clamped) bar.scrollLeft = clamped
    syncing = false
  }

  const syncInnerWidth = () => {
    bodyEl = getBodyScrollEl(tableEl)
    headerEl = getHeaderScrollEl(tableEl)
    if (!bodyEl) return

    const scrollW = bodyEl.scrollWidth
    inner.style.width = `${scrollW}px`
    inner.style.height = '1px'

    if (!barDragging && !syncing) {
      const clamped = clampScrollLeft(bodyEl.scrollLeft)
      if (bar.scrollLeft !== clamped) bar.scrollLeft = clamped
    }
  }

  const updateGeometry = () => {
    const rect = tableEl.getBoundingClientRect()
    const inView = rect.bottom > 0 && rect.top < window.innerHeight
    const overflow = needsHorizontalScroll(bodyEl)

    if (!inView || !overflow) {
      bar.style.display = 'none'
      bar.style.pointerEvents = 'none'
      return
    }

    bar.style.display = 'block'
    bar.style.pointerEvents = 'auto'
    bar.style.left = `${Math.max(0, rect.left)}px`
    bar.style.width = `${Math.max(0, rect.width)}px`
    bar.style.bottom = `${bottomOffset}px`
  }

  const runRefresh = () => {
    syncInnerWidth()
    updateGeometry()
  }

  const scheduleLayout = () => {
    if (layoutTimer) clearTimeout(layoutTimer)
    layoutTimer = setTimeout(() => {
      layoutTimer = null
      requestErpTableLayout(tableEl)
      runRefresh()
    }, REFRESH_DEBOUNCE_MS)
  }

  const scheduleRefresh = (withLayout = false) => {
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => {
      refreshTimer = null
      if (withLayout) requestErpTableLayout(tableEl)
      runRefresh()
    }, REFRESH_DEBOUNCE_MS)
  }

  const refresh = () => {
    scheduleRefresh(false)
  }

  const onBodyScroll = () => {
    if (syncing || !bodyEl) return
    syncing = true
    const left = bodyEl.scrollLeft
    if (headerEl && headerEl !== bodyEl) headerEl.scrollLeft = left
    if (!barDragging && bar.scrollLeft !== left) bar.scrollLeft = left
    syncing = false
  }

  const onBarScroll = () => {
    if (syncing || !bodyEl) return
    setScrollLeft(bar.scrollLeft)
  }

  const onBarPointerDown = (e) => {
    if (e.button !== 0) return
    barDragging = true
  }

  const onBarPointerUp = () => {
    barDragging = false
    runRefresh()
  }

  const onWindowChange = () => scheduleRefresh(false)

  const bindScrollParents = () => {
    scrollParents.forEach((p) => {
      if (p === window) {
        window.removeEventListener('scroll', onWindowChange, true)
        window.removeEventListener('resize', onWindowChange)
      } else {
        p.removeEventListener('scroll', onWindowChange)
      }
    })
    scrollParents = getScrollParents(tableEl)
    scrollParents.forEach((p) => {
      if (p === window) {
        window.addEventListener('scroll', onWindowChange, true)
        window.addEventListener('resize', onWindowChange, { passive: true })
      } else {
        p.addEventListener('scroll', onWindowChange, { passive: true })
      }
    })
  }

  const bind = () => {
    bodyEl = getBodyScrollEl(tableEl)
    if (!bodyEl) {
      if (bindAttempts < 40) {
        bindAttempts += 1
        requestAnimationFrame(bind)
      }
      return
    }
    bindAttempts = 0
    bodyEl.removeEventListener('scroll', onBodyScroll)
    bodyEl.addEventListener('scroll', onBodyScroll, { passive: true })
    bar.removeEventListener('scroll', onBarScroll)
    bar.addEventListener('scroll', onBarScroll, { passive: true })
    bindScrollParents()
    scheduleRefresh(true)
  }

  ro = new ResizeObserver(() => scheduleRefresh(true))
  ro.observe(tableEl)

  const bodyWrapper = tableEl.querySelector('.el-table__body-wrapper')
  mo = new MutationObserver(() => {
    const nextBody = getBodyScrollEl(tableEl)
    if (nextBody !== bodyEl) {
      bodyEl?.removeEventListener('scroll', onBodyScroll)
      bind()
      return
    }
    scheduleLayout()
  })
  if (bodyWrapper) {
    mo.observe(bodyWrapper, { childList: true, subtree: false })
  } else {
    mo.observe(tableEl, { childList: true, subtree: false })
  }

  bar.addEventListener('pointerdown', onBarPointerDown)
  bar.addEventListener('pointerup', onBarPointerUp)
  bar.addEventListener('pointercancel', onBarPointerUp)
  window.addEventListener('pointerup', onBarPointerUp)

  const detach = () => {
    if (refreshTimer) clearTimeout(refreshTimer)
    if (layoutTimer) clearTimeout(layoutTimer)
    bodyEl?.removeEventListener('scroll', onBodyScroll)
    bar.removeEventListener('scroll', onBarScroll)
    bar.removeEventListener('pointerdown', onBarPointerDown)
    bar.removeEventListener('pointerup', onBarPointerUp)
    bar.removeEventListener('pointercancel', onBarPointerUp)
    window.removeEventListener('pointerup', onBarPointerUp)
    scrollParents.forEach((p) => {
      if (p === window) {
        window.removeEventListener('scroll', onWindowChange, true)
        window.removeEventListener('resize', onWindowChange)
      } else {
        p.removeEventListener('scroll', onWindowChange)
      }
    })
    ro?.disconnect()
    mo?.disconnect()
    bar.remove()
    tableEl.classList.remove(ACTIVE_CLASS)
    stateMap.delete(tableEl)
  }

  return {
    options: { bottomOffset },
    bind,
    refresh,
    scheduleRefresh,
    detach,
  }
}

export function refreshErpTableViewportHScroll(tableEl) {
  const root = resolveTableRoot(tableEl) || tableEl
  const state = stateMap.get(root)
  if (state) state.scheduleRefresh(true)
  else requestErpTableLayout(root)
}

/** @deprecated 使用 attachErpTableViewportHScroll */
export function setupErpListTableStickyHScroll(tableEl, options) {
  return attachErpTableViewportHScroll(tableEl, options)
}

/** @deprecated */
export function teardownErpListTableStickyHScroll(tableEl) {
  detachErpTableViewportHScroll(tableEl)
}

export function detachErpTableViewportHScroll(tableEl) {
  const root = resolveTableRoot(tableEl) || tableEl
  stateMap.get(root)?.detach()
}
