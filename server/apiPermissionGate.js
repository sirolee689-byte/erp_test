/**
 * API 级权限闸门：根据 Method + Path + Body 匹配「菜单 path + 操作」
 * 未匹配的接口：仅校验已登录（避免一次性改全站）；匹配到的必须满足角色 Permissions
 */
import { getPool } from './db.js'
import { parseRolePermissions, roleAllowsAction } from './permissions.js'
import { fetchSysUserPermissionSource } from './sysUsersDb.js'

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {number} userId
 * @param {string} menuPath
 * @param {string} action
 */
export async function assertUserHasAction(pool, userId, menuPath, action) {
  const raw = await fetchSysUserPermissionSource(pool, userId)
  const parsed = parseRolePermissions(raw)
  return roleAllowsAction(parsed, menuPath, action)
}

/**
 * 任一条件满足即可（如 GET /api/roles：操作员页与角色页都可能调用）
 */
export async function assertUserHasAnyAction(pool, userId, candidates) {
  for (const { menuPath, action } of candidates) {
    if (await assertUserHasAction(pool, userId, menuPath, action)) {
      return true
    }
  }
  return false
}

/**
 * @param {string} method
 * @param {string} path express req.path
 * @param {any} body
 * @param {Record<string, string>} params req.params
 */
export function matchApiPermissionRule(method, path, body, params) {
  const m = String(method || '').toUpperCase()

  if (m === 'GET' && path === '/api/users') {
    return { menuPath: 'system/operator', action: 'view' }
  }
  if (m === 'GET' && /^\/api\/users\/\d+$/.test(path)) {
    return { menuPath: 'system/operator', action: 'view' }
  }
  if (m === 'POST' && path === '/api/users') {
    return { menuPath: 'system/operator', action: 'add' }
  }
  if (m === 'PUT' && path === '/api/users') {
    if (body && (body.op === 'unpass' || body.op === 'soft_delete')) {
      return { menuPath: 'system/operator', action: 'delete' }
    }
    if (body && Number(body.Status) === 0) {
      return { menuPath: 'system/operator', action: 'delete' }
    }
    return { menuPath: 'system/operator', action: 'edit' }
  }
  if (m === 'PUT' && path === '/api/users/resume') {
    return { menuPath: 'system/operator', action: 'edit' }
  }
  if (m === 'PUT' && path === '/api/users/change-password') {
    return { menuPath: 'system/operator', action: 'edit' }
  }
  if (m === 'DELETE' && /^\/api\/users\/\d+$/.test(path)) {
    return { menuPath: 'system/operator', action: 'delete' }
  }

  if (m === 'GET' && path === '/api/roles') {
    return {
      anyOf: [
        { menuPath: 'system/role', action: 'view' },
        { menuPath: 'system/operator', action: 'view' },
      ],
    }
  }
  if (m === 'POST' && path === '/api/roles') {
    return { menuPath: 'system/role', action: 'add' }
  }
  if (m === 'PUT' && path === '/api/roles') {
    if (body && body.Status !== undefined && body.Status !== null && Number(body.Status) === 0) {
      return { menuPath: 'system/role', action: 'delete' }
    }
    return { menuPath: 'system/role', action: 'edit' }
  }
  if (m === 'PUT' && path === '/api/roles/resume') {
    return { menuPath: 'system/role', action: 'edit' }
  }
  if (m === 'PUT' && path === '/api/roles/permissions') {
    return { menuPath: 'system/role', action: 'audit' }
  }
  if (m === 'DELETE' && /^\/api\/roles\/\d+$/.test(path)) {
    return { menuPath: 'system/role', action: 'delete' }
  }

  if (m === 'GET' && path === '/api/sys/logs') {
    return { menuPath: 'system/logs', action: 'view' }
  }

  /* v1.0.8：人力资源 — 部门资料（菜单 path与 erp_structure_dump 一致：hr/files/department） */
  if (m === 'GET' && path === '/api/hr/departments') {
    return { menuPath: 'hr/files/department', action: 'view' }
  }
  if (m === 'GET' && path === '/api/hr/departments/tree') {
    return { menuPath: 'hr/files/department', action: 'view' }
  }
  if (m === 'GET' && path === '/api/hr/departments/options') {
    return { menuPath: 'hr/files/department', action: 'view' }
  }
  if (m === 'GET' && path === '/api/hr/departments/posts') {
    return { menuPath: 'hr/files/department', action: 'view' }
  }
  if (m === 'POST' && path === '/api/hr/departments') {
    return { menuPath: 'hr/files/department', action: 'add' }
  }
  /* 须先于泛化的 PUT /api/hr/departments 匹配（审核 / 反审共用 audit 权限） */
  if (m === 'PUT' && path === '/api/hr/departments/audit') {
    return { menuPath: 'hr/files/department', action: 'audit' }
  }
  if (m === 'PUT' && path === '/api/hr/departments/audit-batch') {
    return { menuPath: 'hr/files/department', action: 'audit' }
  }
  if (m === 'PUT' && path === '/api/hr/departments/unaudit') {
    return { menuPath: 'hr/files/department', action: 'audit' }
  }
  if (m === 'PUT' && path === '/api/hr/departments') {
    return { menuPath: 'hr/files/department', action: 'edit' }
  }
  /* 旧系统部门主键为字符串 code，路径段非纯数字 */
  if (m === 'DELETE' && /^\/api\/hr\/departments\/.+$/.test(path)) {
    return { menuPath: 'hr/files/department', action: 'delete' }
  }

  /* v1.0.9：人事档案精简管理（菜单 path 与 erp_structure_dump 一致：hr/files/employee-files） */
  if (m === 'GET' && path === '/api/hr/staff/department-options') {
    return { menuPath: 'hr/files/employee-files', action: 'view' }
  }
  if (m === 'GET' && path === '/api/hr/staff/department-posts') {
    return { menuPath: 'hr/files/employee-files', action: 'view' }
  }
  if (m === 'GET' && path === '/api/hr/staff') {
    return { menuPath: 'hr/files/employee-files', action: 'view' }
  }
  if (m === 'GET' && /^\/api\/hr\/staff\/.+$/.test(path)) {
    return { menuPath: 'hr/files/employee-files', action: 'view' }
  }
  if (m === 'GET' && path === '/api/hr/staff/debug-code') {
    return { menuPath: 'hr/files/employee-files', action: 'view' }
  }
  if (m === 'POST' && path === '/api/hr/staff') {
    return { menuPath: 'hr/files/employee-files', action: 'add' }
  }
  if (m === 'POST' && path === '/api/hr/staff/batch-update') {
    return { menuPath: 'hr/files/employee-files', action: 'edit' }
  }
  if (m === 'PUT' && path === '/api/hr/staff/audit') {
    return { menuPath: 'hr/files/employee-files', action: 'audit' }
  }
  if (m === 'PUT' && path === '/api/hr/staff/unaudit') {
    return { menuPath: 'hr/files/employee-files', action: 'audit' }
  }
  if (m === 'PUT' && path === '/api/hr/staff') {
    return { menuPath: 'hr/files/employee-files', action: 'edit' }
  }
  if (m === 'PUT' && path === '/api/hr/staff/restore') {
    return { menuPath: 'hr/files/employee-files', action: 'edit' }
  }
  if (m === 'PUT' && /^\/api\/hr\/staff\/leave\/.+$/.test(path)) {
    return { menuPath: 'hr/files/employee-files', action: 'edit' }
  }
  if (m === 'DELETE' && /^\/api\/hr\/staff\/.+$/.test(path)) {
    return { menuPath: 'hr/files/employee-files', action: 'delete' }
  }

  /* v1.1.3：宿舍 — 房间管理 / 住宿办理（菜单 path 与 erp_structure_dump 一致） */
  if (m === 'GET' && path === '/api/hr/dormitory/rooms') {
    return { menuPath: 'hr/dormitory/room-management', action: 'view' }
  }
  if (m === 'GET' && /^\/api\/hr\/dormitory\/rooms\/\d+$/.test(path)) {
    return { menuPath: 'hr/dormitory/room-management', action: 'view' }
  }
  if (m === 'POST' && path === '/api/hr/dormitory/rooms') {
    return { menuPath: 'hr/dormitory/room-management', action: 'add' }
  }
  if (m === 'PUT' && path === '/api/hr/dormitory/rooms/audit') {
    return { menuPath: 'hr/dormitory/room-management', action: 'audit' }
  }
  if (m === 'PUT' && path === '/api/hr/dormitory/rooms/unaudit') {
    return { menuPath: 'hr/dormitory/room-management', action: 'audit' }
  }
  if (m === 'POST' && path === '/api/hr/dormitory/check-in') {
    return { menuPath: 'hr/dormitory/lodging-records', action: 'add' }
  }
  if (m === 'GET' && path === '/api/hr/dormitory/check-in/staff-options') {
    return { menuPath: 'hr/dormitory/lodging-records', action: 'add' }
  }
  if (m === 'GET' && path === '/api/hr/dormitory/room-occupants') {
    return { menuPath: 'hr/dormitory/lodging-records', action: 'view' }
  }
  if (m === 'PUT' && path === '/api/hr/dormitory/check-out') {
    return { menuPath: 'hr/dormitory/lodging-records', action: 'add' }
  }
  if (m === 'PUT' && path === '/api/hr/dormitory/room-in/room-info') {
    return { menuPath: 'hr/dormitory/lodging-records', action: 'edit' }
  }
  if (m === 'GET' && path === '/api/hr/dormitory/lodging-overview') {
    return { menuPath: 'hr/dormitory/lodging-records', action: 'view' }
  }
  if (m === 'GET' && path === '/api/hr/dormitory/lodging-history') {
    return { menuPath: 'hr/dormitory/lodging-records', action: 'view' }
  }
  /* v1.1.5：电费历史联动（按月份回填） */
  if (m === 'GET' && path === '/api/dorm/get-electric-history') {
    return { menuPath: 'hr/dormitory/lodging-records', action: 'view' }
  }
  /* v1.1.6：宿舍电费情况统计报表（独立菜单页） */
  if (m === 'GET' && path === '/api/dorm/electric-report-data') {
    return { menuPath: 'hr/dormitory/electric-report', action: 'view' }
  }
  if (m === 'GET' && path === '/api/dorm/electric-allocation-report') {
    return { menuPath: 'hr/dormitory/electric-report', action: 'view' }
  }
  /* v1.1.5：电费管理中心（挂在房间总览操作列） */
  if (m === 'GET' && path === '/api/hr/dormitory/electric/context') {
    return { menuPath: 'hr/dormitory/lodging-records', action: 'view' }
  }
  if (m === 'POST' && path === '/api/hr/dormitory/electric/settle') {
    return { menuPath: 'hr/dormitory/lodging-records', action: 'add' }
  }
  /* v1.1.6：电费数据回滚（删除）- 审核级权限 */
  if (m === 'POST' && path === '/api/dorm/delete-electric') {
    return { menuPath: 'hr/dormitory/lodging-records', action: 'audit' }
  }
  /* v1.1.4：入住审批 Tab 并入「住宿管理」；列表/审核走 lodging-records 权限 */
  if (m === 'GET' && path === '/api/hr/dormitory/lodging-in/audit-center-list') {
    return { menuPath: 'hr/dormitory/lodging-records', action: 'view' }
  }
  if (m === 'PUT' && path === '/api/hr/dormitory/lodging-in/audit') {
    return { menuPath: 'hr/dormitory/lodging-records', action: 'audit' }
  }
  if (m === 'PUT' && path === '/api/hr/dormitory/lodging-in/reject') {
    return { menuPath: 'hr/dormitory/lodging-records', action: 'audit' }
  }
  if (m === 'PUT' && path === '/api/hr/dormitory/lodging-in/audit-batch') {
    return { menuPath: 'hr/dormitory/lodging-records', action: 'audit' }
  }
  /* 入住单反审核（独立路径，权限与 lodging-in/audit 一致） */
  if (m === 'PUT' && path === '/api/dorm/un-audit') {
    return { menuPath: 'hr/dormitory/lodging-records', action: 'audit' }
  }
  /* 未审核入住申请物理删除（与审核/反审核同级敏感操作） */
  if (m === 'DELETE' && path === '/api/dorm/delete-checkin') {
    return { menuPath: 'hr/dormitory/lodging-records', action: 'audit' }
  }

  /* BOM 配件明细（须先于泛化 GET /api/inventory/bom/:id，否则会被 /.+/ 误匹配；权限仍与详情 view / 保存 edit 一致） */
  if (m === 'GET' && /^\/api\/inventory\/bom\/parts\/.+$/.test(path)) {
    return {
      anyOf: [
        { menuPath: 'inv/bom', action: 'view' },
        { menuPath: 'inventory/basic/bom-data', action: 'view' },
      ],
    }
  }
  if (m === 'PUT' && /^\/api\/inventory\/bom\/parts\/.+$/.test(path)) {
    return {
      anyOf: [
        { menuPath: 'inv/bom', action: 'edit' },
        { menuPath: 'inventory/basic/bom-data', action: 'edit' },
      ],
    }
  }

  /* v1.1.7：BOM 列表（菜单在「存货 inv/bom」与「库存管理 inventory/basic/bom-data」两处均可调） */
  if (m === 'GET' && path === '/api/inv/bom/list') {
    return {
      anyOf: [
        { menuPath: 'inv/bom', action: 'view' },
        { menuPath: 'inventory/basic/bom-data', action: 'view' },
        { menuPath: 'supply-chain/daily/purchase-quote', action: 'view' },
        { menuPath: 'supply-chain/daily/outsourcing-quote', action: 'view' },
      ],
    }
  }
  /* BOM 主档详情（查看弹窗基础资料）；权限与列表 view 一致 */
  if (m === 'GET' && /^\/api\/inventory\/bom\/.+$/.test(path)) {
    return {
      anyOf: [
        { menuPath: 'inv/bom', action: 'view' },
        { menuPath: 'inventory/basic/bom-data', action: 'view' },
      ],
    }
  }

  /* 销售/采购/外协管理 — 基本资料：供应商资料（菜单 path 与 erp_structure_dump 一致） */
  if (m === 'GET' && path === '/api/supply-chain/suppliers/list') {
    return { menuPath: 'supply-chain/basic/suppliers', action: 'view' }
  }
  if (m === 'GET' && path === '/api/supply-chain/suppliers/suggest-code') {
    return { menuPath: 'supply-chain/basic/suppliers', action: 'add' }
  }
  if (m === 'POST' && path === '/api/supply-chain/suppliers') {
    return { menuPath: 'supply-chain/basic/suppliers', action: 'add' }
  }
  if (m === 'PUT' && path === '/api/supply-chain/suppliers') {
    return { menuPath: 'supply-chain/basic/suppliers', action: 'edit' }
  }
  if (m === 'PUT' && path === '/api/supply-chain/suppliers/audit') {
    return { menuPath: 'supply-chain/basic/suppliers', action: 'audit' }
  }
  if (m === 'PUT' && path === '/api/supply-chain/suppliers/unaudit') {
    return { menuPath: 'supply-chain/basic/suppliers', action: 'audit' }
  }
  if (m === 'PUT' && path === '/api/supply-chain/suppliers/restore') {
    return { menuPath: 'supply-chain/basic/suppliers', action: 'edit' }
  }
  /* 回收站彻底删除：须先于泛化 DELETE /:id 匹配（路径以 /permanent 结尾） */
  if (m === 'DELETE' && /^\/api\/supply-chain\/suppliers\/\d+\/permanent$/.test(path)) {
    return { menuPath: 'supply-chain/basic/suppliers', action: 'delete' }
  }
  if (m === 'DELETE' && /^\/api\/supply-chain\/suppliers\/\d+$/.test(path)) {
    return { menuPath: 'supply-chain/basic/suppliers', action: 'delete' }
  }

  /* 销售/采购/外协管理 — 基本资料：销售客户（菜单 path 与前端一致） */
  if (m === 'GET' && path === '/api/supply-chain/customers/list') {
    return { menuPath: 'supply-chain/basic/customers', action: 'view' }
  }
  if (m === 'GET' && /^\/api\/supply-chain\/customers\/\d+$/.test(path)) {
    return { menuPath: 'supply-chain/basic/customers', action: 'view' }
  }
  if (m === 'POST' && path === '/api/supply-chain/customers') {
    return { menuPath: 'supply-chain/basic/customers', action: 'add' }
  }
  if (m === 'PUT' && path === '/api/supply-chain/customers') {
    return { menuPath: 'supply-chain/basic/customers', action: 'edit' }
  }
  if (m === 'PUT' && path === '/api/supply-chain/customers/audit') {
    return { menuPath: 'supply-chain/basic/customers', action: 'audit' }
  }
  if (m === 'PUT' && path === '/api/supply-chain/customers/unaudit') {
    return { menuPath: 'supply-chain/basic/customers', action: 'audit' }
  }
  if (m === 'PUT' && path === '/api/supply-chain/customers/restore') {
    return { menuPath: 'supply-chain/basic/customers', action: 'edit' }
  }
  /* 回收站彻底删除：须先于泛化 DELETE /:id 匹配（路径以 /permanent 结尾） */
  if (m === 'DELETE' && /^\/api\/supply-chain\/customers\/\d+\/permanent$/.test(path)) {
    return { menuPath: 'supply-chain/basic/customers', action: 'delete' }
  }
  if (m === 'DELETE' && /^\/api\/supply-chain\/customers\/\d+$/.test(path)) {
    return { menuPath: 'supply-chain/basic/customers', action: 'delete' }
  }

  /* 销售/采购/外协管理 — 基本资料：结算方式（菜单 path 与前端一致） */
  if (m === 'GET' && path === '/api/supply-chain/settlement-methods/list') {
    return { menuPath: 'supply-chain/basic/payment-methods', action: 'view' }
  }
  if (m === 'GET' && path === '/api/supply-chain/settlement-methods/suggest-code') {
    return { menuPath: 'supply-chain/basic/payment-methods', action: 'add' }
  }
  if (m === 'POST' && path === '/api/supply-chain/settlement-methods') {
    return { menuPath: 'supply-chain/basic/payment-methods', action: 'add' }
  }
  if (m === 'PUT' && path === '/api/supply-chain/settlement-methods') {
    return { menuPath: 'supply-chain/basic/payment-methods', action: 'edit' }
  }
  if (m === 'PUT' && path === '/api/supply-chain/settlement-methods/audit') {
    return { menuPath: 'supply-chain/basic/payment-methods', action: 'audit' }
  }
  if (m === 'PUT' && path === '/api/supply-chain/settlement-methods/unaudit') {
    return { menuPath: 'supply-chain/basic/payment-methods', action: 'audit' }
  }
  if (m === 'PUT' && path === '/api/supply-chain/settlement-methods/restore') {
    return { menuPath: 'supply-chain/basic/payment-methods', action: 'edit' }
  }
  /* 回收站彻底删除：须先于泛化 DELETE /:id 匹配（路径以 /permanent 结尾） */
  if (m === 'DELETE' && /^\/api\/supply-chain\/settlement-methods\/\d+\/permanent$/.test(path)) {
    return { menuPath: 'supply-chain/basic/payment-methods', action: 'delete' }
  }
  if (m === 'DELETE' && /^\/api\/supply-chain\/settlement-methods\/\d+$/.test(path)) {
    return { menuPath: 'supply-chain/basic/payment-methods', action: 'delete' }
  }

  /* 销售/采购/外协管理 — 日常工作：采购报价（主从表） */
  if (m === 'GET' && path === '/api/supply-chain/purchase-quotations/bom-detail') {
    return { menuPath: 'supply-chain/daily/purchase-quote', action: 'view' }
  }
  if (m === 'GET' && path === '/api/supply-chain/purchase-quotations/list') {
    return { menuPath: 'supply-chain/daily/purchase-quote', action: 'view' }
  }
  if (m === 'GET' && path === '/api/supply-chain/purchase-quotations/suggest-doc-no') {
    return { menuPath: 'supply-chain/daily/purchase-quote', action: 'view' }
  }
  if (m === 'GET' && path === '/api/supply-chain/purchase-quotations/check-doc-no') {
    return { menuPath: 'supply-chain/daily/purchase-quote', action: 'view' }
  }
  if (m === 'GET' && path === '/api/supply-chain/purchase-quotations/supplier-options') {
    return { menuPath: 'supply-chain/daily/purchase-quote', action: 'view' }
  }
  if (m === 'GET' && /^\/api\/supply-chain\/purchase-quotations\/[^/]+\/lines$/.test(path)) {
    return { menuPath: 'supply-chain/daily/purchase-quote', action: 'view' }
  }
  if (m === 'GET' && /^\/api\/supply-chain\/purchase-quotations\/[^/]+$/.test(path)) {
    return { menuPath: 'supply-chain/daily/purchase-quote', action: 'view' }
  }
  if (m === 'POST' && path === '/api/supply-chain/purchase-quotations') {
    return { menuPath: 'supply-chain/daily/purchase-quote', action: 'add' }
  }
  if (m === 'PUT' && path === '/api/supply-chain/purchase-quotations') {
    return { menuPath: 'supply-chain/daily/purchase-quote', action: 'edit' }
  }
  if (m === 'PUT' && path === '/api/supply-chain/purchase-quotations/audit') {
    return { menuPath: 'supply-chain/daily/purchase-quote', action: 'audit' }
  }
  if (m === 'PUT' && path === '/api/supply-chain/purchase-quotations/unaudit') {
    return { menuPath: 'supply-chain/daily/purchase-quote', action: 'audit' }
  }
  if (m === 'PUT' && path === '/api/supply-chain/purchase-quotations/restore') {
    return { menuPath: 'supply-chain/daily/purchase-quote', action: 'edit' }
  }
  if (m === 'DELETE' && /^\/api\/supply-chain\/purchase-quotations\/[^/]+\/permanent$/.test(path)) {
    return { menuPath: 'supply-chain/daily/purchase-quote', action: 'delete' }
  }
  if (m === 'DELETE' && /^\/api\/supply-chain\/purchase-quotations\/[^/]+$/.test(path)) {
    return { menuPath: 'supply-chain/daily/purchase-quote', action: 'delete' }
  }

  /* 销售/采购/外协管理 — 日常工作：外协报价（主从表） */
  if (m === 'GET' && path === '/api/supply-chain/outsourcing-quotations/bom-detail') {
    return { menuPath: 'supply-chain/daily/outsourcing-quote', action: 'view' }
  }
  if (m === 'GET' && path === '/api/supply-chain/outsourcing-quotations/list') {
    return { menuPath: 'supply-chain/daily/outsourcing-quote', action: 'view' }
  }
  if (m === 'GET' && path === '/api/supply-chain/outsourcing-quotations/suggest-doc-no') {
    return { menuPath: 'supply-chain/daily/outsourcing-quote', action: 'view' }
  }
  if (m === 'GET' && path === '/api/supply-chain/outsourcing-quotations/check-doc-no') {
    return { menuPath: 'supply-chain/daily/outsourcing-quote', action: 'view' }
  }
  if (m === 'GET' && path === '/api/supply-chain/outsourcing-quotations/supplier-options') {
    return { menuPath: 'supply-chain/daily/outsourcing-quote', action: 'view' }
  }
  if (m === 'GET' && /^\/api\/supply-chain\/outsourcing-quotations\/[^/]+\/lines$/.test(path)) {
    return { menuPath: 'supply-chain/daily/outsourcing-quote', action: 'view' }
  }
  if (m === 'GET' && /^\/api\/supply-chain\/outsourcing-quotations\/[^/]+$/.test(path)) {
    return { menuPath: 'supply-chain/daily/outsourcing-quote', action: 'view' }
  }
  if (m === 'POST' && path === '/api/supply-chain/outsourcing-quotations') {
    return { menuPath: 'supply-chain/daily/outsourcing-quote', action: 'add' }
  }
  if (m === 'PUT' && path === '/api/supply-chain/outsourcing-quotations') {
    return { menuPath: 'supply-chain/daily/outsourcing-quote', action: 'edit' }
  }
  if (m === 'PUT' && path === '/api/supply-chain/outsourcing-quotations/audit') {
    return { menuPath: 'supply-chain/daily/outsourcing-quote', action: 'audit' }
  }
  if (m === 'PUT' && path === '/api/supply-chain/outsourcing-quotations/unaudit') {
    return { menuPath: 'supply-chain/daily/outsourcing-quote', action: 'audit' }
  }
  if (m === 'PUT' && path === '/api/supply-chain/outsourcing-quotations/restore') {
    return { menuPath: 'supply-chain/daily/outsourcing-quote', action: 'edit' }
  }
  if (m === 'DELETE' && /^\/api\/supply-chain\/outsourcing-quotations\/[^/]+\/permanent$/.test(path)) {
    return { menuPath: 'supply-chain/daily/outsourcing-quote', action: 'delete' }
  }
  if (m === 'DELETE' && /^\/api\/supply-chain\/outsourcing-quotations\/[^/]+$/.test(path)) {
    return { menuPath: 'supply-chain/daily/outsourcing-quote', action: 'delete' }
  }

  if (m === 'GET' && path === '/api/inventory/color-code/list') {
    return { menuPath: 'inventory/basic/color-code', action: 'view' }
  }
  if (m === 'POST' && path === '/api/inventory/color-code') {
    return { menuPath: 'inventory/basic/color-code', action: 'add' }
  }
  /* 颜色编码：未审在册保存（须与 /audit 等子路径区分：仅精确匹配根路径） */
  if (m === 'PUT' && path === '/api/inventory/color-code') {
    return { menuPath: 'inventory/basic/color-code', action: 'edit' }
  }
  /* 颜色编码：审核 / 反审（须先于其它 inventory 泛化规则） */
  if (m === 'PUT' && path === '/api/inventory/color-code/audit') {
    return { menuPath: 'inventory/basic/color-code', action: 'audit' }
  }
  if (m === 'PUT' && path === '/api/inventory/color-code/unaudit') {
    return { menuPath: 'inventory/basic/color-code', action: 'audit' }
  }
  if (m === 'PUT' && path === '/api/inventory/color-code/restore') {
    return { menuPath: 'inventory/basic/color-code', action: 'edit' }
  }
  /* 回收站彻底删除：须先于泛化 DELETE /:code 匹配（路径以 /permanent 结尾） */
  if (m === 'DELETE' && /^\/api\/inventory\/color-code\/.+\/permanent$/.test(path)) {
    return { menuPath: 'inventory/basic/color-code', action: 'delete' }
  }
  /* 逻辑删除：DELETE /api/inventory/color-code/:code（业务上禁止主键为 list，见后端校验） */
  if (m === 'DELETE' && /^\/api\/inventory\/color-code\/.+$/.test(path)) {
    return { menuPath: 'inventory/basic/color-code', action: 'delete' }
  }

  /* 使用单位 Bom_unit（须先于其它 inventory 泛化规则） */
  if (m === 'GET' && path === '/api/inventory/units/list') {
    return { menuPath: 'inventory/basic/units', action: 'view' }
  }
  if (m === 'POST' && path === '/api/inventory/units') {
    return { menuPath: 'inventory/basic/units', action: 'add' }
  }
  if (m === 'PUT' && path === '/api/inventory/units/audit') {
    return { menuPath: 'inventory/basic/units', action: 'audit' }
  }
  if (m === 'PUT' && path === '/api/inventory/units/unaudit') {
    return { menuPath: 'inventory/basic/units', action: 'audit' }
  }
  if (m === 'PUT' && path === '/api/inventory/units/restore') {
    return { menuPath: 'inventory/basic/units', action: 'edit' }
  }
  /* 回收站彻底删除：须先于泛化 DELETE /:id 匹配（路径以 /permanent 结尾） */
  if (m === 'DELETE' && /^\/api\/inventory\/units\/\d+\/permanent$/.test(path)) {
    return { menuPath: 'inventory/basic/units', action: 'delete' }
  }
  if (m === 'DELETE' && /^\/api\/inventory\/units\/\d+$/.test(path)) {
    return { menuPath: 'inventory/basic/units', action: 'delete' }
  }

  /* 单位转换率 Bom_unit_change（须先于其它 inventory 泛化规则） */
  if (m === 'GET' && path === '/api/inventory/unit-conversion/list') {
    return { menuPath: 'inventory/basic/unit-conversion', action: 'view' }
  }
  if (m === 'POST' && path === '/api/inventory/unit-conversion') {
    return { menuPath: 'inventory/basic/unit-conversion', action: 'add' }
  }
  if (m === 'PUT' && path === '/api/inventory/unit-conversion/audit') {
    return { menuPath: 'inventory/basic/unit-conversion', action: 'audit' }
  }
  if (m === 'PUT' && path === '/api/inventory/unit-conversion/unaudit') {
    return { menuPath: 'inventory/basic/unit-conversion', action: 'audit' }
  }
  if (m === 'PUT' && path === '/api/inventory/unit-conversion/restore') {
    return { menuPath: 'inventory/basic/unit-conversion', action: 'edit' }
  }
  /* 回收站彻底删除：须先于泛化 DELETE /:id 匹配（路径以 /permanent 结尾） */
  if (m === 'DELETE' && /^\/api\/inventory\/unit-conversion\/\d+\/permanent$/.test(path)) {
    return { menuPath: 'inventory/basic/unit-conversion', action: 'delete' }
  }
  if (m === 'DELETE' && /^\/api\/inventory\/unit-conversion\/\d+$/.test(path)) {
    return { menuPath: 'inventory/basic/unit-conversion', action: 'delete' }
  }

  /* 材料分类 Bom_material（须先于其它 inventory 泛化规则） */
  if (m === 'GET' && path === '/api/inventory/material-category/list') {
    return { menuPath: 'inventory/basic/material-category', action: 'view' }
  }
  if (m === 'POST' && path === '/api/inventory/material-category') {
    return { menuPath: 'inventory/basic/material-category', action: 'add' }
  }
  if (m === 'PUT' && path === '/api/inventory/material-category/audit') {
    return { menuPath: 'inventory/basic/material-category', action: 'audit' }
  }
  if (m === 'PUT' && path === '/api/inventory/material-category/unaudit') {
    return { menuPath: 'inventory/basic/material-category', action: 'audit' }
  }
  if (m === 'PUT' && path === '/api/inventory/material-category/restore') {
    return { menuPath: 'inventory/basic/material-category', action: 'edit' }
  }
  /* 回收站彻底删除：须先于泛化 DELETE /:id 匹配（路径以 /permanent 结尾） */
  if (m === 'DELETE' && /^\/api\/inventory\/material-category\/\d+\/permanent$/.test(path)) {
    return { menuPath: 'inventory/basic/material-category', action: 'delete' }
  }
  if (m === 'DELETE' && /^\/api\/inventory\/material-category\/\d+$/.test(path)) {
    return { menuPath: 'inventory/basic/material-category', action: 'delete' }
  }

  /* 车间与部门编码 Bom_Stocks_workshop（须先于其它 inventory 泛化规则） */
  if (m === 'GET' && path === '/api/inventory/workshop-dept/list') {
    return { menuPath: 'inventory/basic/workshop-dept', action: 'view' }
  }
  if (m === 'POST' && path === '/api/inventory/workshop-dept') {
    return { menuPath: 'inventory/basic/workshop-dept', action: 'add' }
  }
  if (m === 'PUT' && path === '/api/inventory/workshop-dept/audit') {
    return { menuPath: 'inventory/basic/workshop-dept', action: 'audit' }
  }
  if (m === 'PUT' && path === '/api/inventory/workshop-dept/unaudit') {
    return { menuPath: 'inventory/basic/workshop-dept', action: 'audit' }
  }
  if (m === 'PUT' && path === '/api/inventory/workshop-dept/restore') {
    return { menuPath: 'inventory/basic/workshop-dept', action: 'edit' }
  }
  /* 回收站彻底删除：须先于泛化 DELETE /:id 匹配（路径以 /permanent 结尾） */
  if (m === 'DELETE' && /^\/api\/inventory\/workshop-dept\/\d+\/permanent$/.test(path)) {
    return { menuPath: 'inventory/basic/workshop-dept', action: 'delete' }
  }
  if (m === 'DELETE' && /^\/api\/inventory\/workshop-dept\/\d+$/.test(path)) {
    return { menuPath: 'inventory/basic/workshop-dept', action: 'delete' }
  }

  return null
}

/**
 * 创建 Express 中间件（需在 express.json() 之后注册，以便读取 body）
 * @param {{ getCurrentUserFromReq: (req: any) => any | null }} deps
 */
export function createApiPermissionGate(deps) {
  return async function apiPermissionGate(req, res, next) {
    const p = req.path || ''
    if (p === '/api/login' || p === '/api/health') {
      return next()
    }
    if (!p.startsWith('/api/')) {
      return next()
    }

    const user = deps.getCurrentUserFromReq(req)
    if (!user) {
      res.status(401).json({
        code: 401,
        msg: '未登录或 token 无效：请在请求头携带 Authorization: Bearer <token>',
        data: null,
      })
      return
    }

    // 供业务 INSERT（UID/uname）与 writeLog 等统一读取当前登录用户（与 Bearer 解析结果一致）
    req.user = user

    const rule = matchApiPermissionRule(req.method, p, req.body, req.params)
    if (!rule) {
      return next()
    }

    try {
      const pool = await getPool()
      let ok = false
      if (rule.anyOf?.length) {
        ok = await assertUserHasAnyAction(pool, user.userId, rule.anyOf)
      } else {
        ok = await assertUserHasAction(pool, user.userId, rule.menuPath, rule.action)
      }
      if (!ok) {
        res.status(403).json({ code: 403, msg: '无权限执行此操作', data: null })
        return
      }
    } catch (e) {
      console.error('API 权限校验异常：', e)
      res.status(500).json({ code: 500, msg: '权限校验失败', data: null })
      return
    }

    next()
  }
}
