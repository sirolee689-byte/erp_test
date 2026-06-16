/**
 * 服务端权限解析（与前端 menuPermission.js 规则保持一致）
 * UB_ERP_System_role.Permissions 支持：
 * - 旧版：JSON 数组 ["*"] 或 ["system/operator"]（路径仅菜单，等价于该页 all）
 * - 新版：JSON 对象 { "system/operator": ["view","add"], "supply-chain/daily/purchase-order": ["view","edit"] }
 * - 全局：{"*":["all"]} 或 ["*"]
 */

const ALL_ACTIONS = ['view', 'add', 'edit', 'delete', 'audit']

/**
 * @param {unknown} raw 数据库读出的字符串或已解析对象
 * @returns {{
 *   mode: 'full' | 'none' | 'scoped',
 *   actionsByPath: Map<string, Set<string>>
 * }}
 */
export function parseRolePermissions(raw) {
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
      if (!path) continue
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

/**
 * 某菜单 path 下是否允许某操作（含前缀：授权父 path 则子路由继承）
 */
export function roleAllowsAction(parsed, menuPath, action) {
  const act = String(action ?? '').trim().toLowerCase()
  if (!act) return false
  if (parsed.mode === 'full') return true
  if (parsed.mode === 'none') return false
  const path = String(menuPath ?? '').replace(/^\/+/, '').replace(/\/+$/, '')
  const entries = [...parsed.actionsByPath.entries()]

  const pathMatchesKey = (key) => path === key || path.startsWith(`${key}/`) || key.startsWith(`${path}/`)

  for (const [key, set] of entries) {
    if (!pathMatchesKey(key)) continue
    if (set.has('all')) return true
    if (set.has(act)) return true
  }
  return false
}

/**
 * 校验写入的 Permissions JSON（对象或兼容数组）
 * @returns {{ ok: true, jsonStr: string } | { ok: false, msg: string }}
 */
export function serializePermissionsForStore(raw) {
  if (raw === undefined || raw === null) {
    return { ok: false, msg: 'Permissions 不能为空' }
  }
  let data = raw
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw)
    } catch {
      return { ok: false, msg: 'Permissions 必须是合法 JSON' }
    }
  }

  if (Array.isArray(data)) {
    if (data.includes('*')) {
      return { ok: true, jsonStr: JSON.stringify({ '*': ['all'] }) }
    }
    const obj = {}
    for (const p of data) {
      const path = String(p).trim()
      if (!path) return { ok: false, msg: 'path 不能为空' }
      obj[path] = ['all']
    }
    return { ok: true, jsonStr: JSON.stringify(obj) }
  }

  if (data && typeof data === 'object') {
    const allowed = new Set([...ALL_ACTIONS, 'all'])
    const out = {}
    for (const [k, v] of Object.entries(data)) {
      if (k === '*') {
        const arr = Array.isArray(v) ? v : []
        if (arr.map(String).includes('all')) {
          return { ok: true, jsonStr: JSON.stringify({ '*': ['all'] }) }
        }
        return { ok: false, msg: '通配键 * 仅支持 ["all"]' }
      }
      const path = String(k).trim()
      if (!path) return { ok: false, msg: '菜单 path 不能为空' }
      if (!Array.isArray(v) || v.length === 0) {
        return { ok: false, msg: `路径 ${path} 的操作列表不能为空数组` }
      }
      const acts = []
      for (const a of v) {
        const low = String(a).trim().toLowerCase()
        if (!allowed.has(low)) {
          return { ok: false, msg: `非法操作：${a}（允许 view/add/edit/delete/audit/all）` }
        }
        acts.push(low)
      }
      out[path] = [...new Set(acts)]
    }
    if (Object.keys(out).length === 0) {
      return { ok: true, jsonStr: '{}' }
    }
    return { ok: true, jsonStr: JSON.stringify(out) }
  }

  return { ok: false, msg: 'Permissions 必须是对象或数组' }
}
