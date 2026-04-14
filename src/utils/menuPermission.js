/**
 * 菜单权限工具（v1.0.7）
 * 与 Sys_Roles.Permissions（JSON 字符串，菜单 path 数组）配合使用。
 */

/**
 * 从 localStorage 的 erp_user 解析 Permissions 字段
 * @returns {string|null|undefined} 原始字符串或 undefined
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
 * 把数据库/登录返回的 Permissions 规范成「权限集合」或「放行全部」哨兵
 *
 * 约定：
 * - null / undefined /空字符串：视为未配置，兼容旧库 →放行全部菜单（与 null 相同）
 * - JSON 解析失败：放行全部（避免锁死系统）
 * - 数组含 "*：放行全部
 * - 数组为空 []：无任何菜单权限（仅保留 403 等白名单路由）
 * - 其余：转为 Set，元素为菜单 path（与 erp_structure_dump 拼接规则一致，如 system/operator）
 *
 * @param {unknown} raw
 * @returns {Set<string>|null} null 表示不限制；Set 表示按集合与前缀规则过滤
 */
export function normalizePermissionSet(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return null
  }
  let arr
  if (typeof raw === 'string') {
    try {
      arr = JSON.parse(raw)
    } catch {
      return null
    }
  } else if (Array.isArray(raw)) {
    arr = raw
  } else {
    return null
  }
  if (!Array.isArray(arr)) {
    return null
  }
  if (arr.includes('*')) {
    return null
  }
  if (arr.length === 0) {
    return new Set()
  }
  return new Set(arr.map((x) => String(x).trim()).filter(Boolean))
}

/**
 * 当前登录用户权限集合（未登录时视为 null）
 */
export function getPermissionSetFromStorage() {
  const raw = readPermissionsRawFromStorage()
  return normalizePermissionSet(raw)
}

/**
 * 判断某个菜单 path 是否「自身命中」或「被某个已授权前缀覆盖」
 * 例：已授权 supply-chain，则 supply-chain/basic/suppliers 可见
 */
export function isPathGranted(path, permSet) {
  if (permSet == null) return true
  if (permSet.has('*')) return true
  if (permSet.size === 0) return false
  if (permSet.has(path)) return true
  for (const k of permSet) {
    if (path.startsWith(`${k}/`)) {
      return true
    }
  }
  return false
}

/**
 * 【递归过滤菜单树 — filter 算法说明】
 *
 * 目标：在内存里得到一棵「缩小后的菜单树」，只包含当前角色有权看到的节点。
 *
 * 做法（深度优先 + Array.prototype.map + filter）：
 * 1) 对当前层的每个节点，先算出它在 ERP 里的 path（父 path + "/" + name，根节点只有 name）。
 * 2) 若该节点还有 children，则先递归调用本函数处理子数组，得到 filteredChildren。
 * 3) 若「本节点 path 已授权」或「filteredChildren 非空」（说明下面还有可见项），则保留该节点：
 *    - 有可见子节点时，把 children 设为 filteredChildren；
 *    - 没有子节点被保留且本节点也未授权，则丢弃（返回 null）。
 * 4) 最后用 .filter(Boolean) 去掉被丢弃的槽位。
 *
 * 这样一层层「筛」下去，父级会因为有可见子级而自动出现，无需在数据库里重复存父 path。
 *
 * @param {any[]} nodes erp_structure_dump 的节点数组
 * @param {Set<string>|null} permSet normalizePermissionSet 的结果；null 表示不筛选
 * @param {string} base父级 path 前缀
 * @returns {any[]}
 */
export function filterMenuTreeByPermission(nodes, permSet, base = '') {
  if (permSet == null) {
    return nodes
  }
  return nodes
    .map((n) => {
      const path = base ? `${base}/${n.name}` : n.name
      const rawChildren = n.children?.length ? n.children : null
      const filteredChildren = rawChildren
        ? filterMenuTreeByPermission(rawChildren, permSet, path)
        : []
      const selfOk = isPathGranted(path, permSet)
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

/**
 * 在已过滤的菜单树上取第一个「叶子」对应的路由路径（带前导 /）
 */
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

/**
 * 登录后首页应跳转的第一个有权限菜单 */
export function getFirstPermittedRoutePath(menuStructure) {
  const permSet = getPermissionSetFromStorage()
  const tree = filterMenuTreeByPermission(menuStructure, permSet, '')
  return getFirstLeafPath(tree, '') || '/403'
}

/**
 * 路由 path（如 /system/operator）是否允许访问（已登录前提下）
 * @param {string} fullPath 必须以 / 开头或为空
 */
export function isRouteAllowed(fullPath, permSet) {
  const p = String(fullPath ?? '').replace(/^\/+/, '').replace(/\/+$/, '')
  if (!p || p === '403') {
    return true
  }
  if (permSet == null) {
    return true
  }
  if (permSet.size === 0) {
    return false
  }
  if (permSet.has('*')) {
    return true
  }
  if (permSet.has(p)) {
    return true
  }
  for (const k of permSet) {
    if (p.startsWith(`${k}/`) || k.startsWith(`${p}/`)) {
      return true
    }
  }
  return false
}

/**
 * 供登录后 redirect 校验：是否允许进入该地址
 */
export function isFullPathAllowedForCurrentUser(fullPath) {
  const permSet = getPermissionSetFromStorage()
  return isRouteAllowed(fullPath, permSet)
}
