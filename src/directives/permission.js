/**
 * 按钮级权限指令
 * 用法：
 * - v-permission="'delete'" — 无权限则隐藏（display:none）
 * - v-permission.disable="'delete'" — 无权限则禁用按钮
 * - v-permission="{ action: 'edit', path: 'system/role' }" — 指定菜单 path（默认当前路由）
 */
import { watch } from 'vue'
import router from '@/router'
import { getPermissionModelFromStorage, hasPageAction } from '@/utils/menuPermission'

function normalizeBinding(binding) {
  const v = binding.value
  if (typeof v === 'string') {
    return { action: v.trim().toLowerCase(), path: undefined }
  }
  if (v && typeof v === 'object') {
    return {
      action: String(v.action ?? '').trim().toLowerCase(),
      path: v.path != null ? String(v.path).replace(/^\/+/, '') : undefined,
    }
  }
  return { action: '', path: undefined }
}

function apply(el, binding) {
  const { action, path: pathOverride } = normalizeBinding(binding)
  if (!action) {
    return
  }
  const routePath = router.currentRoute.value.path.replace(/^\/+/, '').replace(/\/+$/, '')
  const menuPath = pathOverride || routePath
  const model = getPermissionModelFromStorage()
  const ok = hasPageAction(model, menuPath, action)
  const useDisable = binding.modifiers.disable

  if (ok) {
    el.style.removeProperty('display')
    if (el.classList?.contains('is-disabled')) {
      el.classList.remove('is-disabled')
    }
    if (typeof el.disabled === 'boolean') {
      el.disabled = false
    }
    return
  }

  if (useDisable) {
    el.style.removeProperty('display')
    if (typeof el.disabled === 'boolean') {
      el.disabled = true
    }
    el.setAttribute?.('aria-disabled', 'true')
    el.classList?.add('is-disabled')
  } else {
    el.style.display = 'none'
  }
}

export const permissionDirective = {
  mounted(el, binding) {
    apply(el, binding)
    const stop = watch(
      () => router.currentRoute.value.fullPath,
      () => apply(el, binding),
    )
    el.__permStop = stop
  },
  updated(el, binding) {
    apply(el, binding)
  },
  unmounted(el) {
    el.__permStop?.()
    el.__permStop = null
  },
}
