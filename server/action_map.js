/**
 * 业务动作映射：HTTP Method + Path → 中文 Action + 目标表
 * 新增接口时请在此补充映射；未命中时中间件兜底为「系统操作」。
 */

export const DEFAULT_UNKNOWN_ACTION = '系统操作'
export const DEFAULT_UNKNOWN_TARGET_TABLE = 'ERP'

/** @typedef {string | RegExp} PathMatcher */

/**
 * @typedef {{
 *   method: string,
 *   path: PathMatcher,
 *   action: string,
 *   targetTable: string,
 * }} OperationAuditRouteRule
 */

/**
 * 规则按「更具体的路径优先」自上而下匹配（同 Method 下先写子路径再写父路径）
 * @type {OperationAuditRouteRule[]}
 */
export const OPERATION_AUDIT_ROUTE_RULES = [
  { method: 'PUT', path: '/api/hr/staff/audit', action: '审核员工档案', targetTable: 'HR_staff' },
  { method: 'PUT', path: '/api/hr/staff/unaudit', action: '反审员工档案', targetTable: 'HR_staff' },
  { method: 'PUT', path: '/api/hr/staff/restore', action: '恢复员工档案', targetTable: 'HR_staff' },
  { method: 'PUT', path: /^\/api\/hr\/staff\/leave\/.+$/, action: '办理员工离职', targetTable: 'HR_staff' },
  { method: 'POST', path: '/api/hr/staff/batch-update', action: '批量更新员工档案', targetTable: 'HR_staff' },
  { method: 'POST', path: '/api/hr/staff', action: '新增员工档案', targetTable: 'HR_staff' },
  { method: 'PUT', path: '/api/hr/staff', action: '修改员工档案', targetTable: 'HR_staff' },
  { method: 'DELETE', path: /^\/api\/hr\/staff\/.+/, action: '删除员工档案', targetTable: 'HR_staff' },

  { method: 'POST', path: '/api/hr/dormitory/rooms', action: '新增宿舍房间', targetTable: 'Hr_room' },
  { method: 'PUT', path: '/api/hr/dormitory/rooms/audit', action: '审核宿舍房间', targetTable: 'Hr_room' },
  { method: 'PUT', path: '/api/hr/dormitory/rooms/unaudit', action: '反审宿舍房间', targetTable: 'Hr_room' },
  { method: 'POST', path: '/api/hr/dormitory/check-in', action: '办理了入住', targetTable: 'Hr_room_in' },
  { method: 'PUT', path: '/api/hr/dormitory/room-in/room-info', action: '修改入住备注', targetTable: 'Hr_room_in' },
  { method: 'PUT', path: '/api/hr/dormitory/check-out', action: '办理了退宿', targetTable: 'Hr_room_in' },
  { method: 'PUT', path: '/api/hr/dormitory/lodging-in/audit', action: '审核入住单', targetTable: 'Hr_room_in' },
  { method: 'PUT', path: '/api/hr/dormitory/lodging-in/reject', action: '驳回入住申请', targetTable: 'Hr_room_in' },
  { method: 'PUT', path: '/api/dorm/un-audit', action: '入住单反审核', targetTable: 'Hr_room_in' },
  { method: 'DELETE', path: '/api/dorm/delete-checkin', action: '彻底删除未审核入住申请', targetTable: 'Hr_room_in' },
  { method: 'PUT', path: '/api/hr/dormitory/lodging-in/audit-batch', action: '批量审核入住单', targetTable: 'Hr_room_in' },
  { method: 'POST', path: '/api/hr/dormitory/electric/settle', action: '电费核算', targetTable: 'Hr_room_use' },
  { method: 'POST', path: '/api/dorm/delete-electric', action: '删除电费记录', targetTable: 'Hr_room_use' },

  { method: 'PUT', path: '/api/hr/departments/audit-batch', action: '批量审核部门', targetTable: 'HR_Departments' },
  { method: 'PUT', path: '/api/hr/departments/audit', action: '审核部门', targetTable: 'HR_Departments' },
  { method: 'PUT', path: '/api/hr/departments/unaudit', action: '反审部门', targetTable: 'HR_Departments' },
  { method: 'POST', path: '/api/hr/departments', action: '新增部门', targetTable: 'HR_Departments' },
  { method: 'PUT', path: '/api/hr/departments', action: '修改部门', targetTable: 'HR_Departments' },
  { method: 'DELETE', path: /^\/api\/hr\/departments\/.+/, action: '删除部门', targetTable: 'HR_Departments' },

  { method: 'PUT', path: '/api/roles/permissions', action: '保存角色权限', targetTable: 'Sys_Roles' },
  { method: 'PUT', path: '/api/roles/resume', action: '恢复角色', targetTable: 'Sys_Roles' },
  { method: 'POST', path: '/api/roles', action: '新增角色', targetTable: 'Sys_Roles' },
  { method: 'PUT', path: '/api/roles', action: '修改角色', targetTable: 'Sys_Roles' },
  { method: 'DELETE', path: /^\/api\/roles\/\d+$/, action: '删除角色', targetTable: 'Sys_Roles' },

  { method: 'GET', path: /^\/api\/users\/\d+$/, action: '查看操作员', targetTable: 'Sys_Users' },
  { method: 'PUT', path: '/api/users/resume', action: '恢复操作员', targetTable: 'Sys_Users' },
  { method: 'PUT', path: '/api/users/change-password', action: '修改密码', targetTable: 'Sys_Users' },
  { method: 'POST', path: '/api/users', action: '新增操作员', targetTable: 'Sys_Users' },
  { method: 'PUT', path: '/api/users', action: '修改操作员', targetTable: 'Sys_Users' },
  { method: 'DELETE', path: /^\/api\/users\/\d+$/, action: '删除操作员', targetTable: 'Sys_Users' },

  { method: 'DELETE', path: '/api/sys/logs/clear', action: '清空操作日志', targetTable: 'Sys_OperationLogs' },

  { method: 'GET', path: '/api/inv/bom/list', action: '查询BOM资料列表', targetTable: 'bom_000' },
  { method: 'GET', path: '/api/inventory/bom/check-code', action: '校验BOM编码重复', targetTable: 'bom_000' },
  { method: 'GET', path: '/api/inventory/bom/unit-rate-suggest', action: '查询BOM单位换算建议', targetTable: 'Bom_unit_change' },
  { method: 'POST', path: '/api/inventory/bom/save-main', action: '保存BOM主资料(save-main)', targetTable: 'bom_000' },
  { method: 'POST', path: '/api/inventory/bom', action: '新增BOM主档', targetTable: 'bom_000' },
  { method: 'PUT', path: '/api/inventory/bom', action: '保存BOM主档', targetTable: 'bom_000' },
  { method: 'PUT', path: '/api/inventory/bom/audit', action: '审核BOM主档', targetTable: 'bom_000' },
  { method: 'PUT', path: '/api/inventory/bom/unaudit', action: '反审BOM主档', targetTable: 'bom_000' },
  { method: 'PUT', path: '/api/inventory/bom/restore', action: '恢复BOM主档', targetTable: 'bom_000' },
  {
    method: 'DELETE',
    path: /^\/api\/inventory\/bom\/systemcode\/.+\/permanent\/?$/,
    action: '彻底删除BOM主档',
    targetTable: 'bom_000',
  },
  { method: 'DELETE', path: /^\/api\/inventory\/bom\/systemcode\/[^/]+$/, action: '删除BOM主档', targetTable: 'bom_000' },
  {
    method: 'POST',
    path: '/api/bom/usage-calc',
    action: 'BOM用量运算并写入bom_cost明细',
    targetTable: 'bom_cost',
  },
  {
    method: 'GET',
    path: '/api/bom/tree',
    action: '查询BOM用量树(只读递归)+成本用量平铺(内存不落库)',
    targetTable: 'Bom_parts',
  },
  { method: 'GET', path: /^\/api\/inventory\/bom\/parts\/.+$/, action: '查询BOM配件明细', targetTable: 'Bom_parts' },
  { method: 'PUT', path: /^\/api\/inventory\/bom\/parts\/.+$/, action: '保存BOM配件明细', targetTable: 'Bom_parts' },
  { method: 'POST', path: '/api/inventory/bom/save-parts', action: '保存BOM配件明细(save-parts)', targetTable: 'Bom_parts' },
  {
    method: 'POST',
    path: '/api/paper-pattern/import/delete-bom-tree',
    action: '纸格导入按主BOM物理删除Bom_000与Bom_parts',
    targetTable: 'bom_000',
  },
  { method: 'GET', path: /^\/api\/inventory\/bom\/.+$/, action: '查看BOM主档详情', targetTable: 'bom_000' },

  { method: 'GET', path: '/api/supply-chain/suppliers/list', action: '查询供应商资料列表', targetTable: 'System_supplier' },
  { method: 'GET', path: '/api/supply-chain/suppliers/suggest-code', action: '获取供应商编码建议', targetTable: 'System_supplier' },
  { method: 'POST', path: '/api/supply-chain/suppliers', action: '新增供应商资料', targetTable: 'System_supplier' },
  { method: 'PUT', path: '/api/supply-chain/suppliers', action: '修改供应商资料', targetTable: 'System_supplier' },
  { method: 'PUT', path: '/api/supply-chain/suppliers/audit', action: '审核供应商资料', targetTable: 'System_supplier' },
  { method: 'PUT', path: '/api/supply-chain/suppliers/unaudit', action: '反审供应商资料', targetTable: 'System_supplier' },
  { method: 'PUT', path: '/api/supply-chain/suppliers/restore', action: '恢复供应商资料', targetTable: 'System_supplier' },
  { method: 'DELETE', path: /^\/api\/supply-chain\/suppliers\/\d+\/permanent$/, action: '彻底删除供应商资料', targetTable: 'System_supplier' },
  { method: 'DELETE', path: /^\/api\/supply-chain\/suppliers\/\d+$/, action: '删除供应商资料', targetTable: 'System_supplier' },

  { method: 'GET', path: '/api/supply-chain/customers/list', action: '查询销售客户列表', targetTable: 'System_sales_customer' },
  { method: 'GET', path: /^\/api\/supply-chain\/customers\/\d+$/, action: '查看销售客户', targetTable: 'System_sales_customer' },
  { method: 'POST', path: '/api/supply-chain/customers', action: '新增销售客户', targetTable: 'System_sales_customer' },
  { method: 'PUT', path: '/api/supply-chain/customers', action: '修改销售客户', targetTable: 'System_sales_customer' },
  { method: 'PUT', path: '/api/supply-chain/customers/audit', action: '审核销售客户', targetTable: 'System_sales_customer' },
  { method: 'PUT', path: '/api/supply-chain/customers/unaudit', action: '反审销售客户', targetTable: 'System_sales_customer' },
  { method: 'PUT', path: '/api/supply-chain/customers/restore', action: '恢复销售客户', targetTable: 'System_sales_customer' },
  {
    method: 'DELETE',
    path: /^\/api\/supply-chain\/customers\/\d+\/permanent$/,
    action: '彻底删除销售客户',
    targetTable: 'System_sales_customer',
  },
  { method: 'DELETE', path: /^\/api\/supply-chain\/customers\/\d+$/, action: '删除销售客户', targetTable: 'System_sales_customer' },

  { method: 'GET', path: '/api/supply-chain/settlement-methods/list', action: '查询结算方式列表', targetTable: 'System_settlement_method' },
  { method: 'GET', path: '/api/supply-chain/settlement-methods/suggest-code', action: '获取结算方式编码建议', targetTable: 'System_settlement_method' },
  { method: 'POST', path: '/api/supply-chain/settlement-methods', action: '新增结算方式', targetTable: 'System_settlement_method' },
  { method: 'PUT', path: '/api/supply-chain/settlement-methods', action: '修改结算方式', targetTable: 'System_settlement_method' },
  { method: 'PUT', path: '/api/supply-chain/settlement-methods/audit', action: '审核结算方式', targetTable: 'System_settlement_method' },
  { method: 'PUT', path: '/api/supply-chain/settlement-methods/unaudit', action: '反审结算方式', targetTable: 'System_settlement_method' },
  { method: 'PUT', path: '/api/supply-chain/settlement-methods/restore', action: '恢复结算方式', targetTable: 'System_settlement_method' },
  {
    method: 'DELETE',
    path: /^\/api\/supply-chain\/settlement-methods\/\d+\/permanent$/,
    action: '彻底删除结算方式',
    targetTable: 'System_settlement_method',
  },
  { method: 'DELETE', path: /^\/api\/supply-chain\/settlement-methods\/\d+$/, action: '删除结算方式', targetTable: 'System_settlement_method' },

  {
    method: 'GET',
    path: '/api/supply-chain/purchase-quotations/bom-detail',
    action: '采购报价明细查看BOM资料',
    targetTable: 'bom_000',
  },
  { method: 'GET', path: '/api/supply-chain/purchase-quotations/list', action: '查询采购报价列表', targetTable: 'Purchase_Quotation' },
  {
    method: 'GET',
    path: '/api/supply-chain/purchase-quotations/suggest-doc-no',
    action: '获取采购报价建议单号',
    targetTable: 'Purchase_Quotation',
  },
  {
    method: 'GET',
    path: '/api/supply-chain/purchase-quotations/check-doc-no',
    action: '检测采购报价单号是否可用',
    targetTable: 'Purchase_Quotation',
  },
  {
    method: 'GET',
    path: '/api/supply-chain/purchase-quotations/supplier-options',
    action: '采购报价供应商下拉',
    targetTable: 'System_supplier',
  },
  {
    method: 'GET',
    path: /^\/api\/supply-chain\/purchase-quotations\/[^/]+\/lines$/,
    action: '查询采购报价明细',
    targetTable: 'Purchase_Quotation_list',
  },
  {
    method: 'GET',
    path: /^\/api\/supply-chain\/purchase-quotations\/[^/]+$/,
    action: '查看采购报价',
    targetTable: 'Purchase_Quotation',
  },
  { method: 'POST', path: '/api/supply-chain/purchase-quotations', action: '新增采购报价', targetTable: 'Purchase_Quotation' },
  { method: 'PUT', path: '/api/supply-chain/purchase-quotations', action: '保存采购报价', targetTable: 'Purchase_Quotation' },
  { method: 'PUT', path: '/api/supply-chain/purchase-quotations/audit', action: '审核采购报价', targetTable: 'Purchase_Quotation' },
  { method: 'PUT', path: '/api/supply-chain/purchase-quotations/unaudit', action: '反审采购报价', targetTable: 'Purchase_Quotation' },
  { method: 'PUT', path: '/api/supply-chain/purchase-quotations/restore', action: '恢复采购报价', targetTable: 'Purchase_Quotation' },
  {
    method: 'DELETE',
    path: /^\/api\/supply-chain\/purchase-quotations\/[^/]+\/permanent$/,
    action: '彻底删除采购报价',
    targetTable: 'Purchase_Quotation',
  },
  { method: 'DELETE', path: /^\/api\/supply-chain\/purchase-quotations\/[^/]+$/, action: '删除采购报价', targetTable: 'Purchase_Quotation' },

  {
    method: 'GET',
    path: '/api/supply-chain/outsourcing-quotations/bom-detail',
    action: '外协报价明细查看BOM资料',
    targetTable: 'bom_000',
  },
  { method: 'GET', path: '/api/supply-chain/outsourcing-quotations/list', action: '查询外协报价列表', targetTable: 'Outsourcing_Quotation' },
  {
    method: 'GET',
    path: '/api/supply-chain/outsourcing-quotations/suggest-doc-no',
    action: '获取外协报价建议单号',
    targetTable: 'Outsourcing_Quotation',
  },
  {
    method: 'GET',
    path: '/api/supply-chain/outsourcing-quotations/check-doc-no',
    action: '检测外协报价单号是否可用',
    targetTable: 'Outsourcing_Quotation',
  },
  {
    method: 'GET',
    path: '/api/supply-chain/outsourcing-quotations/supplier-options',
    action: '外协报价供应商下拉',
    targetTable: 'System_supplier',
  },
  {
    method: 'GET',
    path: /^\/api\/supply-chain\/outsourcing-quotations\/[^/]+\/lines$/,
    action: '查询外协报价明细',
    targetTable: 'Outsourcing_Quotation_list',
  },
  {
    method: 'GET',
    path: /^\/api\/supply-chain\/outsourcing-quotations\/[^/]+$/,
    action: '查看外协报价',
    targetTable: 'Outsourcing_Quotation',
  },
  { method: 'POST', path: '/api/supply-chain/outsourcing-quotations', action: '新增外协报价', targetTable: 'Outsourcing_Quotation' },
  { method: 'PUT', path: '/api/supply-chain/outsourcing-quotations', action: '保存外协报价', targetTable: 'Outsourcing_Quotation' },
  { method: 'PUT', path: '/api/supply-chain/outsourcing-quotations/audit', action: '审核外协报价', targetTable: 'Outsourcing_Quotation' },
  { method: 'PUT', path: '/api/supply-chain/outsourcing-quotations/unaudit', action: '反审外协报价', targetTable: 'Outsourcing_Quotation' },
  { method: 'PUT', path: '/api/supply-chain/outsourcing-quotations/restore', action: '恢复外协报价', targetTable: 'Outsourcing_Quotation' },
  {
    method: 'DELETE',
    path: /^\/api\/supply-chain\/outsourcing-quotations\/[^/]+\/permanent$/,
    action: '彻底删除外协报价',
    targetTable: 'Outsourcing_Quotation',
  },
  { method: 'DELETE', path: /^\/api\/supply-chain\/outsourcing-quotations\/[^/]+$/, action: '删除外协报价', targetTable: 'Outsourcing_Quotation' },

  { method: 'GET', path: '/api/inventory/color-code/list', action: '查询颜色编码列表', targetTable: 'Bom_colorcode' },
  { method: 'POST', path: '/api/inventory/color-code', action: '新增颜色编码', targetTable: 'Bom_colorcode' },
  { method: 'PUT', path: '/api/inventory/color-code', action: '保存颜色编码', targetTable: 'Bom_colorcode' },
  { method: 'PUT', path: '/api/inventory/color-code/audit', action: '审核颜色编码', targetTable: 'Bom_colorcode' },
  { method: 'PUT', path: '/api/inventory/color-code/unaudit', action: '反审颜色编码', targetTable: 'Bom_colorcode' },
  { method: 'PUT', path: '/api/inventory/color-code/restore', action: '恢复颜色编码', targetTable: 'Bom_colorcode' },
  {
    method: 'DELETE',
    path: /^\/api\/inventory\/color-code\/.+\/permanent$/,
    action: '彻底删除颜色编码',
    targetTable: 'Bom_colorcode',
  },
  { method: 'DELETE', path: /^\/api\/inventory\/color-code\/.+/, action: '删除颜色编码', targetTable: 'Bom_colorcode' },

  { method: 'GET', path: '/api/inventory/units/list', action: '查询使用单位列表', targetTable: 'Bom_unit' },
  { method: 'POST', path: '/api/inventory/units', action: '新增使用单位', targetTable: 'Bom_unit' },
  { method: 'PUT', path: '/api/inventory/units/audit', action: '审核使用单位', targetTable: 'Bom_unit' },
  { method: 'PUT', path: '/api/inventory/units/unaudit', action: '反审使用单位', targetTable: 'Bom_unit' },
  { method: 'PUT', path: '/api/inventory/units/restore', action: '恢复使用单位', targetTable: 'Bom_unit' },
  { method: 'DELETE', path: /^\/api\/inventory\/units\/\d+\/permanent$/, action: '彻底删除使用单位', targetTable: 'Bom_unit' },
  { method: 'DELETE', path: /^\/api\/inventory\/units\/\d+$/, action: '删除使用单位', targetTable: 'Bom_unit' },

  { method: 'GET', path: '/api/inventory/unit-conversion/list', action: '查询单位转换率列表', targetTable: 'Bom_unit_change' },
  { method: 'POST', path: '/api/inventory/unit-conversion', action: '新增单位转换率', targetTable: 'Bom_unit_change' },
  { method: 'PUT', path: '/api/inventory/unit-conversion/audit', action: '审核单位转换率', targetTable: 'Bom_unit_change' },
  { method: 'PUT', path: '/api/inventory/unit-conversion/unaudit', action: '反审单位转换率', targetTable: 'Bom_unit_change' },
  { method: 'PUT', path: '/api/inventory/unit-conversion/restore', action: '恢复单位转换率', targetTable: 'Bom_unit_change' },
  { method: 'DELETE', path: /^\/api\/inventory\/unit-conversion\/\d+\/permanent$/, action: '彻底删除单位转换率', targetTable: 'Bom_unit_change' },
  { method: 'DELETE', path: /^\/api\/inventory\/unit-conversion\/\d+$/, action: '删除单位转换率', targetTable: 'Bom_unit_change' },

  { method: 'GET', path: '/api/inventory/material-category/list', action: '查询材料分类列表', targetTable: 'Bom_material' },
  { method: 'POST', path: '/api/inventory/material-category', action: '新增材料分类', targetTable: 'Bom_material' },
  { method: 'PUT', path: '/api/inventory/material-category/audit', action: '审核材料分类', targetTable: 'Bom_material' },
  { method: 'PUT', path: '/api/inventory/material-category/unaudit', action: '反审材料分类', targetTable: 'Bom_material' },
  { method: 'PUT', path: '/api/inventory/material-category/restore', action: '恢复材料分类', targetTable: 'Bom_material' },
  { method: 'DELETE', path: /^\/api\/inventory\/material-category\/\d+\/permanent$/, action: '彻底删除材料分类', targetTable: 'Bom_material' },
  { method: 'DELETE', path: /^\/api\/inventory\/material-category\/\d+$/, action: '删除材料分类', targetTable: 'Bom_material' },

  { method: 'GET', path: '/api/inventory/workshop-dept/list', action: '查询车间与部门编码列表', targetTable: 'Bom_Stocks_workshop' },
  { method: 'POST', path: '/api/inventory/workshop-dept', action: '新增车间与部门编码', targetTable: 'Bom_Stocks_workshop' },
  { method: 'PUT', path: '/api/inventory/workshop-dept/audit', action: '审核车间与部门编码', targetTable: 'Bom_Stocks_workshop' },
  { method: 'PUT', path: '/api/inventory/workshop-dept/unaudit', action: '反审车间与部门编码', targetTable: 'Bom_Stocks_workshop' },
  { method: 'PUT', path: '/api/inventory/workshop-dept/restore', action: '恢复车间与部门编码', targetTable: 'Bom_Stocks_workshop' },
  { method: 'DELETE', path: /^\/api\/inventory\/workshop-dept\/\d+\/permanent$/, action: '彻底删除车间与部门编码', targetTable: 'Bom_Stocks_workshop' },
  { method: 'DELETE', path: /^\/api\/inventory\/workshop-dept\/\d+$/, action: '删除车间与部门编码', targetTable: 'Bom_Stocks_workshop' },

  // 示例：仓储入库（路由落地后无需改中间件，只需保留/调整本行映射）
  { method: 'POST', path: '/api/warehouse/stock-in', action: '入库单新增', targetTable: 'Inv_StockIn' },
  { method: 'DELETE', path: /^\/api\/warehouse\/stock-in\/[^/]+$/, action: '入库单作废', targetTable: 'Inv_StockIn' },
]

/**
 * @param {PathMatcher} matcher
 * @param {string} path
 */
function pathMatches(matcher, path) {
  const p = String(path || '')
  if (matcher instanceof RegExp) return matcher.test(p)
  return matcher === p
}

/**
 * 根据 Method + Path 解析中文动作与目标表（未命中则兜底「系统操作」）
 * @param {string} method
 * @param {string} path express req.path
 * @returns {{ action: string, targetTable: string }}
 */
export function resolveAuditActionAndTable(method, path) {
  const m = String(method || '').toUpperCase()
  const p = String(path || '')
  for (const rule of OPERATION_AUDIT_ROUTE_RULES) {
    if (String(rule.method || '').toUpperCase() !== m) continue
    if (pathMatches(rule.path, p)) {
      return { action: rule.action, targetTable: rule.targetTable }
    }
  }
  return { action: DEFAULT_UNKNOWN_ACTION, targetTable: DEFAULT_UNKNOWN_TARGET_TABLE }
}
