import { reactive } from 'vue'

/**
 * 多标签导航（与 Vue Router 联动）
 * 说明：visitedViews 每项含 title / path / name，供 Tab 展示与 keep-alive include 对齐路由 name。
 */
const state = reactive({
  /** @type {{ title: string, path: string, name: string }[]} */
  visitedViews: [],
})

/**
 * @param {import('vue-router').RouteLocationNormalizedLoaded} route
 */
function normalizeVisited(route) {
  const title = route.meta?.title != null ? String(route.meta.title) : ''
  return {
    title: title || '未命名',
    path: route.path,
    name: route.name != null ? String(route.name) : '',
  }
}

/**
 * 打开或更新当前路由对应标签（同 path 覆盖标题与 name）
 * @param {import('vue-router').RouteLocationNormalizedLoaded} route
 */
function addVisitedView(route) {
  const path = String(route.path ?? '')
  if (!path || path === '/login') return

  const next = normalizeVisited(route)
  const idx = state.visitedViews.findIndex((v) => v.path === next.path)
  if (idx >= 0) {
    state.visitedViews[idx] = { ...state.visitedViews[idx], ...next }
    return
  }
  state.visitedViews.push(next)
}

/**
 * 关闭指定 path 的标签，返回宜跳转的目标视图（优先左侧相邻，否则右侧）
 * @param {string} path
 * @returns {{ title: string, path: string, name: string } | null}
 */
function delVisitedView(path) {
  const p = String(path ?? '')
  const i = state.visitedViews.findIndex((v) => v.path === p)
  if (i < 0) return null

  const left = i > 0 ? state.visitedViews[i - 1] : null
  const right = i < state.visitedViews.length - 1 ? state.visitedViews[i + 1] : null
  state.visitedViews.splice(i, 1)
  return left || right
}

/**
 * 保留当前 path，关闭其它标签
 * @param {string} path
 */
function delOthersViews(path) {
  const p = String(path ?? '')
  state.visitedViews = state.visitedViews.filter((v) => v.path === p)
}

/** 清空全部标签（调用方负责后续路由跳转） */
function delAllViews() {
  state.visitedViews = []
}

export function useTagsViewStore() {
  return {
    state,
    addVisitedView,
    delVisitedView,
    delOthersViews,
    delAllViews,
  }
}
