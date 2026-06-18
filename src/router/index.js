import { createRouter, createWebHistory } from 'vue-router'
import menuStructure from '../../erp_structure_dump.json'
import ErpLayout from '@/layout/index.vue'
import {
  getFirstPermittedRoutePath,
  getPermissionModelFromStorage,
  isRouteAllowed,
} from '@/utils/menuPermission'

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

/** 无权限提示页（不在 erp_structure_dump 中，单独注册） */
const exception403Route = {
  path: '403',
  name: 'page-403',
  component: () => import('@/views/exception/403/index.vue'),
  meta: { title: '无权限' },
}

/** 预览页不在菜单树中，单独注册；权限沿用父级 paper-pattern/import */
const paperPatternImportPreviewRoute = {
  path: 'paper-pattern/import/preview',
  name: 'paper-pattern-import-preview',
  component: () => import('@/views/paper-pattern/import/preview/index.vue'),
  meta: { title: '纸格资料导入预览' },
}

/** 数据校验步骤占位（不在菜单中） */
const paperPatternImportCheckRoute = {
  path: 'paper-pattern/import/check',
  name: 'paper-pattern-import-check',
  component: () => import('@/views/paper-pattern/import/check/index.vue'),
  meta: { title: '纸格资料导入数据校验' },
}

/** 智能校验（不在菜单中；权限沿用 paper-pattern/import） */
const paperPatternImportErpWorkbenchRoute = {
  path: 'paper-pattern/import/erp-workbench',
  name: 'paper-pattern-import-erp-workbench',
  component: () => import('@/views/paper-pattern/import/erp-workbench/index.vue'),
  meta: { title: '智能校验' },
}

const bomDataWindowRoute = {
  path: '/inventory/basic/bom-data-window',
  name: 'inventory-basic-bom-data-window',
  component: () => import('@/views/inv/bom/index.vue'),
  meta: { title: 'BOM资料窗口', permissionPath: '/inventory/basic/bom-data' },
}

const piBomDataWindowRoute = {
  path: '/inventory/basic/pi-bom-data-window',
  name: 'inventory-basic-pi-bom-data-window',
  component: () => import('@/views/inventory/basic/pi-bom-data/window.vue'),
  meta: { title: 'PI-BOM资料窗口', permissionPath: '/inventory/basic/pi-bom-data' },
}

const salesOrderWindowRoute = {
  path: '/supply-chain/daily/sales-order-window',
  name: 'supply-chain-daily-sales-order-window',
  component: () => import('@/views/supply-chain/daily/sales-order/index.vue'),
  meta: { title: '销售订单窗口', permissionPath: '/supply-chain/daily/sales-order' },
}

const assistOrderBatchWindowRoute = {
  path: '/supply-chain/daily/outsourcing-order-batch-window',
  name: 'supply-chain-daily-outsourcing-order-batch-window',
  component: () => import('@/views/supply-chain/daily/outsourcing-order/batch-add-window.vue'),
  meta: { title: '外协订单批量选材', permissionPath: '/supply-chain/daily/outsourcing-order' },
}

const purchaseOrderBatchWindowRoute = {
  path: '/supply-chain/daily/purchase-order-batch-window',
  name: 'supply-chain-daily-purchase-order-batch-window',
  component: () => import('@/views/supply-chain/daily/purchase-order/batch-add-window.vue'),
  meta: { title: '采购订单批量添加明细', permissionPath: '/supply-chain/daily/purchase-order' },
}

const childRoutes = [
  ...walkRoutes(menuStructure),
  paperPatternImportPreviewRoute,
  paperPatternImportCheckRoute,
  paperPatternImportErpWorkbenchRoute,
  exception403Route,
]

/**
 * 登录态判断（前端最简版）
 * 小白版解释：
 * - 我们把登录成功后拿到的 token 存到浏览器本地（localStorage）
 * - 以后每次切页面，就检查这个 token 在不在
 * - 在：认为“已登录”
 * - 不在：认为“未登录”
 */
function isLoggedIn() {
  const token = localStorage.getItem('erp_token')
  return !!String(token ?? '').trim()
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: viewModules['../views/login/index.vue'],
      meta: { title: '登录' },
    },
    bomDataWindowRoute,
    piBomDataWindowRoute,
    salesOrderWindowRoute,
    assistOrderBatchWindowRoute,
    purchaseOrderBatchWindowRoute,
    {
      path: '/',
      component: ErpLayout,
      // v1.0.7：按当前用户 Permissions 动态落到第一个有权的叶子菜单；全无则 /403
      redirect: () => ({ path: getFirstPermittedRoutePath(menuStructure) }),
      children: childRoutes,
    },
  ],
})

/**
 * 路由守卫：未登录拦截 + 无权限 URL 拦截
 */
router.beforeEach((to) => {
  if (to.path === '/login') {
    if (isLoggedIn()) {
      return { path: getFirstPermittedRoutePath(menuStructure) }
    }
    return true
  }

  if (!isLoggedIn()) {
    return { path: '/login', query: { redirect: to.fullPath } }
  }

  // v1.0.7：已登录访问具体页时，用 UB_ERP_System_role.Permissions 与目标 path 比对
  const model = getPermissionModelFromStorage()
  const permissionPath = to.meta?.permissionPath || to.path
  if (!isRouteAllowed(permissionPath, model)) {
    return { path: '/403', replace: true }
  }

  return true
})

export default router
