import { inject } from 'vue'
import { useRoute } from 'vue-router'
import { getPermissionModelFromStorage, hasPageAction } from '@/utils/menuPermission'
import {
  buildListRowNewTabUrl,
  buildModeBtnNewTabUrl,
  modeBtnPermissionAction,
  normalizeErpRoutePath,
  resolveListRowContextMenuRule,
} from '@/utils/erpListRowContextMenuRegistry'
import { openInNewTab } from '@/utils/erpOpenInNewTab'
import { ERP_CONTEXT_MENU_KEY } from '@/composables/erpContextMenuKey'

const OPEN_IN_NEW_TAB_LABEL = '在新标签页中打开'

/**
 * @returns {{ open: (event: MouseEvent, items: Array<{ key: string, label: string, disabled?: boolean, onSelect?: () => void }>) => void } | null}
 */
function useErpContextMenuApi() {
  return inject(ERP_CONTEXT_MENU_KEY, null)
}

/** 与 v-permission / 菜单权限对齐的 path */
function getMenuPermissionPath(route) {
  const override = route.meta?.permissionPath
  if (override != null && String(override).trim() !== '') {
    return normalizeErpRoutePath(String(override))
  }
  return normalizeErpRoutePath(route.path)
}

function canPageAction(route, action) {
  const model = getPermissionModelFromStorage()
  return hasPageAction(model, getMenuPermissionPath(route), action)
}

/**
 * 列表行右键：按路由注册表打开新标签（BOM 等自管页面在注册表 skip）
 * @param {{ route?: import('vue-router').RouteLocationNormalizedLoaded, permissionPath?: string, buildUrl?: (row: Record<string, unknown>) => string, permissionAction?: 'view' | 'edit' | 'add' }} [options]
 */
export function useErpListRowContextMenu(options = {}) {
  const route = options.route ?? useRoute()
  const menuApi = useErpContextMenuApi()

  const rule = resolveListRowContextMenuRule(
    options.permissionPath ? normalizeErpRoutePath(options.permissionPath) : route.path,
  )

  /**
   * @param {Record<string, unknown>} row
   * @param {import('element-plus').TableColumnCtx<Record<string, unknown>> | undefined} _column
   * @param {MouseEvent} event
   */
  function onErpListRowContextMenu(row, _column, event) {
    if (!menuApi || rule?.skip) return

    const permissionAction = options.permissionAction ?? rule?.permissionAction ?? 'view'
    if (!canPageAction(route, permissionAction)) return

    const url = options.buildUrl
      ? options.buildUrl(row)
      : buildListRowNewTabUrl(row, options.permissionPath ?? route.path)

    const disabledByRule = rule?.isDisabled?.(row) ?? false
    const disabled = !url || disabledByRule

    const items = [
      {
        key: 'open-in-new-tab',
        label: OPEN_IN_NEW_TAB_LABEL,
        disabled,
        onSelect: disabled ? undefined : () => openInNewTab(url),
      },
    ]

    event?.preventDefault?.()
    menuApi.open(event, items)
  }

  return { onErpListRowContextMenu }
}

/**
 * 顶部模式按钮右键（采购单/外协单/销售单等）
 * @param {{ route?: import('vue-router').RouteLocationNormalizedLoaded }} [options]
 */
export function useErpModeBtnContextMenu(options = {}) {
  const route = options.route ?? useRoute()
  const menuApi = useErpContextMenuApi()

  /**
   * @param {string} mode
   * @param {MouseEvent} event
   */
  function onErpModeBtnContextMenu(mode, event) {
    if (!menuApi) return

    const action = modeBtnPermissionAction(route.path, mode)
    if (!canPageAction(route, action)) return

    const url = buildModeBtnNewTabUrl(route.path, mode)
    if (!url) return

    const items = [
      {
        key: 'open-mode-in-new-tab',
        label: OPEN_IN_NEW_TAB_LABEL,
        onSelect: () => openInNewTab(url),
      },
    ]

    event?.preventDefault?.()
    menuApi.open(event, items)
  }

  return { onErpModeBtnContextMenu }
}

/**
 * 左侧菜单叶子项右键
 */
export function useErpMenuContextMenu() {
  const menuApi = useErpContextMenuApi()

  /**
   * @param {string} menuPath 带前导 / 的菜单 index
   * @param {MouseEvent} event
   */
  function onErpMenuContextMenu(menuPath, event) {
    if (!menuApi) return
    const path = String(menuPath ?? '').trim()
    if (!path || path === '/') return

    const items = [
      {
        key: 'open-menu-in-new-tab',
        label: OPEN_IN_NEW_TAB_LABEL,
        onSelect: () => openInNewTab(path),
      },
    ]

    event?.preventDefault?.()
    menuApi.open(event, items)
  }

  return { onErpMenuContextMenu }
}
