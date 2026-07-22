/**
 * 装饰首页「常用快捷入口」本机存储（按账号隔离，不入库）
 * key：erp.home.quickMenus.v1.<UserCode|UserName>
 * value：JSON 字符串数组，元素为菜单 path（如 /inventory/basic/units）
 */

import menuStructure from '../../erp_structure_dump.json'
import { getPermittedLeafMenus } from '@/utils/menuPermission'

export const HOME_QUICK_MENU_MAX = 6
export const HOME_QUICK_STORAGE_PREFIX = 'erp.home.quickMenus.v1.'

/** 当前登录账号标识（与 erp_user 对齐；无则 _anonymous） */
export function getHomeQuickAccountKey() {
  try {
    const user = JSON.parse(localStorage.getItem('erp_user') || '{}')
    const code = String(user?.UserCode ?? '').trim()
    const name = String(user?.UserName ?? '').trim()
    return code || name || '_anonymous'
  } catch {
    return '_anonymous'
  }
}

function storageKey(accountKey = getHomeQuickAccountKey()) {
  return `${HOME_QUICK_STORAGE_PREFIX}${accountKey}`
}

/**
 * 读取本机自定义 path 列表；未设置过返回 null（表示走系统默认）
 * @returns {string[]|null}
 */
export function readHomeQuickMenuPaths(accountKey = getHomeQuickAccountKey()) {
  const raw = localStorage.getItem(storageKey(accountKey))
  if (raw == null) return null
  try {
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return null
    return arr.map((p) => String(p ?? '').trim()).filter(Boolean).slice(0, HOME_QUICK_MENU_MAX)
  } catch {
    return null
  }
}

/** @param {string[]} paths */
export function saveHomeQuickMenuPaths(paths, accountKey = getHomeQuickAccountKey()) {
  const list = (Array.isArray(paths) ? paths : [])
    .map((p) => String(p ?? '').trim())
    .filter(Boolean)
    .slice(0, HOME_QUICK_MENU_MAX)
  localStorage.setItem(storageKey(accountKey), JSON.stringify(list))
  return list
}

/** 清除自定义，恢复系统默认前 N 个 */
export function clearHomeQuickMenuPaths(accountKey = getHomeQuickAccountKey()) {
  localStorage.removeItem(storageKey(accountKey))
}

/**
 * 解析首页应展示的快捷入口
 * - 未自定义：默认前 HOME_QUICK_MENU_MAX 个有权限叶子
 * - 已自定义空数组：显示空（用户主动清空）
 * - 已自定义有项：只显示仍有权限的勾选项；若全部失效则回退默认
 * @returns {{ title: string, path: string }[]}
 */
export function resolveHomeQuickMenus() {
  const allPermitted = getPermittedLeafMenus(menuStructure, null)
  const byPath = new Map(allPermitted.map((m) => [m.path, m]))
  const defaults = allPermitted.slice(0, HOME_QUICK_MENU_MAX)

  const saved = readHomeQuickMenuPaths()
  if (saved == null) return defaults
  if (saved.length === 0) return []

  const custom = []
  for (const path of saved) {
    const hit = byPath.get(path)
    if (hit) custom.push(hit)
  }
  return custom.length > 0 ? custom : defaults
}

/** 编辑弹窗用的完整可勾选列表 */
export function listEditableHomeQuickMenus() {
  return getPermittedLeafMenus(menuStructure, null)
}
