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

export default createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      component: ErpLayout,
      redirect: firstLeafPath(menuStructure),
      children: childRoutes,
    },
  ],
})
