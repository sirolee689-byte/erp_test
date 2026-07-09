import {
  buildAppUrl,
  buildErpDeepLinkUrl,
  buildErpModeLinkUrl,
} from '@/utils/erpOpenInNewTab'

/**
 * @typedef {{
 *   match: (normalizedPath: string) => boolean,
 *   skip?: boolean,
 *   permissionAction?: 'view' | 'edit' | 'add',
 *   buildUrl?: (row: Record<string, unknown>, ctx: { pathname: string, normalizedPath: string }) => string,
 *   isDisabled?: (row: Record<string, unknown>) => boolean,
 * }} ErpListRowContextMenuRule
 */

/** 去掉首尾斜杠，统一小写 */
export function normalizeErpRoutePath(path) {
  return String(path ?? '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .toLowerCase()
}

/**
 * @param {Record<string, unknown>} row
 */
function rowId(row) {
  const id = row?.id ?? row?.ID ?? row?.UserID
  if (id == null || String(id).trim() === '') return ''
  return String(id).trim()
}

/**
 * @param {string} pathname
 * @param {'view' | 'edit'} erpOpen
 */
function deepLink(pathname, erpOpen) {
  return (row, { pathname: p }) => {
    const id = rowId(row)
    return id ? buildErpDeepLinkUrl(p || pathname, erpOpen, id) : ''
  }
}

/** @type {ErpListRowContextMenuRule[]} */
const RULES = [
  {
    match: (p) => p === 'inventory/basic/bom-data' || p.endsWith('/inv/bom'),
    skip: true,
  },
  {
    match: (p) => p === 'inventory/basic/pi-bom-data',
    permissionAction: 'view',
    buildUrl: (row) => {
      const orderId = Number(row?.orderId)
      const code = String(row?.kcaa01 ?? '').trim()
      if (!Number.isFinite(orderId) || orderId <= 0 || !code) return ''
      return buildAppUrl('/inventory/basic/pi-bom-data-window', {
        mode: 'edit',
        orderId: String(orderId),
        kcaa01: code,
      })
    },
    isDisabled: (row) => {
      const orderId = Number(row?.orderId)
      const code = String(row?.kcaa01 ?? '').trim()
      return !Number.isFinite(orderId) || orderId <= 0 || !code
    },
  },
  {
    match: (p) =>
      [
        'supply-chain/daily/purchase-order',
        'supply-chain/daily/outsourcing-order',
        'supply-chain/daily/sales-order',
        'production/daily/dispatch',
        'inventory/daily/stock-in',
        'inventory/daily/stock-out',
      ].includes(p),
    permissionAction: 'view',
    buildUrl: deepLink('', 'view'),
    isDisabled: (row) => !rowId(row),
  },
  {
    match: (p) =>
      [
        'supply-chain/daily/purchase-quote',
        'supply-chain/daily/outsourcing-quote',
        'supply-chain/basic/customers',
        'system/operator',
        'hr/files/employee-files',
        'hr/dormitory/room-management',
      ].includes(p),
    permissionAction: 'view',
    buildUrl: deepLink('', 'view'),
    isDisabled: (row) => !rowId(row),
  },
  {
    match: (p) =>
      [
        'inventory/basic/units',
        'inventory/basic/color-code',
        'inventory/basic/material-category',
        'inventory/basic/workshop-dept',
        'inventory/basic/unit-conversion',
        'supply-chain/basic/suppliers',
        'supply-chain/basic/payment-methods',
        'system/role',
        'hr/files/department',
      ].includes(p),
    permissionAction: 'edit',
    buildUrl: deepLink('', 'edit'),
    isDisabled: (row) => !rowId(row),
  },
  {
    match: (p) => /\/(analysis|stats|report|ledger|import|preview|check|erp-workbench|kernel)/.test(`/${p}`),
    skip: true,
  },
  {
    match: (p) => p.includes('paper-pattern'),
    skip: true,
  },
  {
    match: () => true,
    permissionAction: 'view',
    buildUrl: deepLink('', 'view'),
    isDisabled: (row) => !rowId(row),
  },
]

/**
 * @param {string} routePath
 * @returns {ErpListRowContextMenuRule | null}
 */
export function resolveListRowContextMenuRule(routePath) {
  const normalizedPath = normalizeErpRoutePath(routePath)
  return RULES.find((rule) => rule.match(normalizedPath)) ?? null
}

/**
 * @param {Record<string, unknown>} row
 * @param {string} routePath
 */
export function buildListRowNewTabUrl(row, routePath) {
  const normalizedPath = normalizeErpRoutePath(routePath)
  const rule = resolveListRowContextMenuRule(routePath)
  if (!rule || rule.skip || !rule.buildUrl) return ''
  const pathname = `/${normalizedPath}`
  return rule.buildUrl(row, { pathname, normalizedPath }) || ''
}

/**
 * 模式条按钮 → 新标签 URL（采购/外协/销售等）
 * @type {Record<string, Record<string, string | ((pathname: string) => string)>>}
 */
export const ERP_MODE_BTN_URL_BUILDERS = {
  'supply-chain/daily/purchase-order': {
    manage: (pathname) => buildErpModeLinkUrl(pathname, 'manage'),
    create: (pathname) => buildErpModeLinkUrl(pathname, 'create'),
    'material-trace': () => buildAppUrl('/supply-chain/daily/purchase-order-material-trace-window'),
  },
  'supply-chain/daily/outsourcing-order': {
    manage: (pathname) => buildErpModeLinkUrl(pathname, 'manage'),
    create: (pathname) => buildErpModeLinkUrl(pathname, 'create'),
  },
  'supply-chain/daily/sales-order': {
    manage: (pathname) => buildErpModeLinkUrl(pathname, 'manage'),
    create: () => buildAppUrl('/supply-chain/daily/sales-order-window', { mode: 'create' }),
  },
}

/**
 * @param {string} routePath
 * @param {string} mode
 */
export function buildModeBtnNewTabUrl(routePath, mode) {
  const normalizedPath = normalizeErpRoutePath(routePath)
  const map = ERP_MODE_BTN_URL_BUILDERS[normalizedPath]
  const builder = map?.[mode]
  if (!builder) return ''
  const pathname = `/${normalizedPath}`
  return typeof builder === 'function' ? builder(pathname) : builder
}

/**
 * @param {string} routePath
 * @param {string} mode
 * @returns {'view' | 'edit' | 'add'}
 */
export function modeBtnPermissionAction(routePath, mode) {
  return mode === 'create' ? 'add' : 'view'
}
