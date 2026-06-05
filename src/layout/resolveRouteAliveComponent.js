import { defineComponent, h } from 'vue'

/** @type {Map<string, import('vue').Component>} */
const wrapperByRouteName = new Map()

/**
 * 为路由页包一层与 route.name 同名的壳组件，供布局 keep-alive :include 按标签缓存。
 * 避免每个 index.vue 手写 defineOptions({ name })。
 *
 * @param {import('vue').Component | null | undefined} Component
 * @param {string | symbol | null | undefined} routeName
 */
export function resolveRouteAliveComponent(Component, routeName) {
  if (!Component) return null
  const name = routeName != null ? String(routeName).trim() : ''
  if (!name) return Component

  const hit = wrapperByRouteName.get(name)
  if (hit) return hit

  const wrapper = defineComponent({
    name,
    setup() {
      return () => h(Component)
    },
  })
  wrapperByRouteName.set(name, wrapper)
  return wrapper
}
