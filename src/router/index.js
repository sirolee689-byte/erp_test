import { createRouter, createWebHistory } from 'vue-router'
import menuStructure from '../../erp_structure_dump.json'
import ErpLayout from '@/layout/ErpLayout.vue'

const viewModules = import.meta.glob('../views/**/index.vue')

/**
 * @param {any[]} nodes
 * @param {string} base
 */
function walkRoutes(nodes, base = '') {
  const out = []
  for (const n of nodes) {
    const full = base ? `${base}/${n.name}` : n.name
    const modPath = `../views/${full}/index.vue`
    const comp = viewModules[modPath]
    if (comp) {
      out.push({
        path: full,
        name: full.replace(/\//g, '-'),
        component: comp,
        meta: { title: n.title },
      })
    }
    if (n.children?.length) {
      out.push(...walkRoutes(n.children, full))
    }
  }
  return out
}

/**
 * @param {any[]} nodes
 * @param {string} prefix
 */
function firstLeafPath(nodes, prefix = '') {
  for (const n of nodes) {
    const p = prefix ? `${prefix}/${n.name}` : n.name
    if (!n.children?.length) return `/${p}`
    const sub = firstLeafPath(n.children, p)
    if (sub) return sub
  }
  return '/system'
}

const childRoutes = walkRoutes(menuStructure)

/**
 * 登录态判断（前端最简版）
 * 小白版解释：
 * - 我们把登录成功后拿到的 token 存到浏览器本地（localStorage）
 * - 以后每次切页面，就检查这个 token 在不在
 * - 在：认为“已登录”
 * - 不在：认为“未登录”
 */
function isLoggedIn() {
  // 关键：localStorage 是浏览器自带的“小仓库”，关掉浏览器再打开数据还在
  const token = localStorage.getItem('erp_token')
  // 关键：只要 token 是非空字符串，就当作已登录
  return !!String(token ?? '').trim()
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    // =========================
    // 登录页（独立路由，不放在后台布局里）
    // =========================
    {
      path: '/login',
      name: 'login',
      component: viewModules['../views/login/index.vue'],
      meta: { title: '登录' },
    },
    {
      path: '/',
      component: ErpLayout,
      redirect: firstLeafPath(menuStructure),
      children: childRoutes,
    },
  ],
})

/**
 * 路由守卫：简单拦截未登录访问后台页面
 * 小白版解释：
 * - 你直接在地址栏输入 /system/operator 想“跳过登录”
 * - 我们在这里把你拦下来，送回 /login
 */
router.beforeEach((to) => {
  // 关键：如果要去登录页，就不拦截
  if (to.path === '/login') {
    // 关键：如果你已经登录了，还想去登录页，就直接送回系统首页（避免重复登录）
    if (isLoggedIn()) {
      return { path: '/' }
    }
    return true
  }

  // 关键：访问任何非 /login 的页面，都要求“已登录”
  if (!isLoggedIn()) {
    // 关键：把你原本要去的页面地址带上，登录成功后可以跳回去
    return { path: '/login', query: { redirect: to.fullPath } }
  }

  // 关键：已登录就放行
  return true
})

export default router
