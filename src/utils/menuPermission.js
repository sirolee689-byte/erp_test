/**
 * 菜单与按钮级权限（v1.0.7+）
 * UB_ERP_System_role.Permissions：
 * - 旧版 JSON 数组：["*"] 或 ["system/operator"]（仅菜单，等价该页全部操作）
 * - 新版 JSON 对象：{ "system/operator": ["view","add"], "system/role": ["all"] }
 * - 全局：{"*":["all"]} 或 ["*"]
 */

const ALL_ACTIONS = ['view', 'add', 'edit', 'delete', 'audit']

/**
 * 从 localStorage 的 erp_user 解析 Permissions 字段
 * @returns {string|null|undefined}
 */
export function readPermissionsRawFromStorage() {
  const raw = localStorage.getItem('erp_user')
  if (!raw) return undefined
  try {
    const user = JSON.parse(raw)
    return user?.Permissions
  } catch {
    return undefined
  }
}

/**
 * 解析为统一模型（与 server/permissions.js 逻辑对齐）
 * @returns {{
 *   mode: 'full' | 'none' | 'scoped',
 *   actionsByPath: Map<string, Set<string>>
 * }}
 */
export function parsePermissionsModel(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return { mode: 'full', actionsByPath: new Map() }
  }
  let data = raw
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw)
    } catch {
      return { mode: 'full', actionsByPath: new Map() }
    }
  }

  if (Array.isArray(data)) {
    if (data.includes('*')) {
      return { mode: 'full', actionsByPath: new Map() }
    }
    if (data.length === 0) {
      return { mode: 'none', actionsByPath: new Map() }
    }
    const map = new Map()
    for (const p of data) {
      const path = String(p).trim()
      if (path) {
        map.set(path, new Set(['all', ...ALL_ACTIONS]))
      }
    }
    return { mode: 'scoped', actionsByPath: map }
  }

  if (data && typeof data === 'object') {
    if (data['*'] && Array.isArray(data['*']) && data['*'].map(String).includes('all')) {
      return { mode: 'full', actionsByPath: new Map() }
    }
    const map = new Map()
    for (const [k, v] of Object.entries(data)) {
      const path = String(k).trim()
      if (!path || path === '*') continue
      const arr = Array.isArray(v) ? v : []
      const set = new Set(arr.map((x) => String(x).trim().toLowerCase()).filter(Boolean))
      if (set.size > 0) {
        map.set(path, set)
      }
    }
    if (map.size === 0) {
      return { mode: 'none', actionsByPath: new Map() }
    }
    return { mode: 'scoped', actionsByPath: map }
  }

  return { mode: 'full', actionsByPath: new Map() }
}

export function getPermissionModelFromStorage() {
  return parsePermissionsModel(readPermissionsRawFromStorage())
}

/**
 * 侧栏：某 path 是否应出现（有任意操作或子级可见）
 */
export function isPathVisibleForMenu(path, model) {
  if (model.mode === 'full') return true
  if (model.mode === 'none') return false
  const keys = [...model.actionsByPath.keys()]
  for (const k of keys) {
    if (path === k || path.startsWith(`${k}/`) || k.startsWith(`${path}/`)) {
      return true
    }
  }
  return false
}

/**
 * 【递归过滤菜单树 — filter 算法说明】
 * 1) 对当前层每个节点计算 path。
 * 2) 递归得到 filteredChildren。
 * 3) 若本节点 isPathVisibleForMenu，或 filteredChildren 非空，则保留。
 * 4) map 后用 filter(Boolean) 去掉 null。
 */
export function filterMenuTreeByPermission(nodes, model, base = '') {
  if (model.mode === 'full') {
    return nodes
  }
  return nodes
    .map((n) => {
      const path = base ? `${base}/${n.name}` : n.name
      const rawChildren = n.children?.length ? n.children : null
      const filteredChildren = rawChildren
        ? filterMenuTreeByPermission(rawChildren, model, path)
        : []
      const selfOk = isPathVisibleForMenu(path, model)
      if (!selfOk && filteredChildren.length === 0) {
        return null
      }
      const next = { ...n }
      if (filteredChildren.length > 0) {
        next.children = filteredChildren
      } else {
        delete next.children
      }
      return next
    })
    .filter(Boolean)
}

export function getFirstLeafPath(nodes, base = '') {
  for (const n of nodes) {
    const p = base ? `${base}/${n.name}` : n.name
    if (!n.children?.length) {
      return `/${p}`
    }
    const sub = getFirstLeafPath(n.children, p)
    if (sub) return sub
  }
  return null
}

export function getFirstPermittedRoutePath(menuStructure) {
  const model = getPermissionModelFromStorage()
  const tree = filterMenuTreeByPermission(menuStructure, model, '')
  return getFirstLeafPath(tree, '') || '/403'
}

function normalizeFullPath(fullPath) {
  return String(fullPath ?? '').replace(/^\/+/, '').replace(/\/+$/, '')
}

/**
 * 路由是否可进入：需具备 view（或 all 覆盖）
 */
export function isRouteAllowed(fullPath, model) {
  const p = normalizeFullPath(fullPath)
  if (!p || p === '403') {
    return true
  }
  if (model.mode === 'full') {
    return true
  }
  if (model.mode === 'none') {
    return false
  }
  return hasPageAction(model, p, 'view')
}

export function isFullPathAllowedForCurrentUser(fullPath) {
  const model = getPermissionModelFromStorage()
  return isRouteAllowed(fullPath, model)
}

/**
 * 是否具备某页某操作（path 无斜杠前缀；action 小写）
 */
export function hasPageAction(model, menuPath, action) {
  const act = String(action ?? '').trim().toLowerCase()
  if (!act) return false
  if (model.mode === 'full') return true
  if (model.mode === 'none') return false
  const path = normalizeFullPath(menuPath)

  for (const [key, set] of model.actionsByPath.entries()) {
    const match = path === key || path.startsWith(`${key}/`) || key.startsWith(`${path}/`)
    if (!match) continue
    if (set.has('all')) return true
    if (set.has(act)) return true
  }
  return false
}

/** 供 globalProperties / 指令：默认用当前路由 path */
export function hasPageActionForCurrentRoute(action, menuPathOverride) {
  const model = getPermissionModelFromStorage()
  const path =
    menuPathOverride != null && menuPathOverride !== ''
      ? normalizeFullPath(menuPathOverride)
      : normalizeFullPath(
          typeof window !== 'undefined' ? window.location.pathname.replace(/^\/+/, '') : '',
        )
  return hasPageAction(model, path, action)
}
