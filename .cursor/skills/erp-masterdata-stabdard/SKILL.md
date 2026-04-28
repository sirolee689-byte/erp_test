---
name: erp-masterdata-standard
description: 为ERP“基本资料/主数据”按标准件落地全套：前端页面 + 后端接口 + 权限门禁 + 全局操作审计 + 文档同步。参考金标准模块：src/views/inventory/basic/color-code（颜色编码）。当用户提到“按标准件”“标准件做XXX模块”“基本资料XXX模块”“回收站/彻底删除”“审核/反审”“软删/恢复”时使用。
---

# ERP 主数据标准件（全套）

## 金标准参照（必须对齐）
- 前端：src/views/inventory/basic/color-code/index.vue
- 模块说明：src/views/inventory/basic/color-code/README.md
- 后端接口：server/index.js（/api/inventory/color-code/*）
- 权限闸门：server/apiPermissionGate.js（menuPath=inventory/basic/color-code）
- 审计映射：server/action_map.js + server/operationAuditMiddleware.js
- 文档映射：docs/sql/database_map.md（表与模块/接口映射）

## 交付范围（必须全套）
- 前端：列表+搜索+分页+新增/编辑弹窗；查看（只读弹窗/抽屉）；审核/反审；回收站（恢复+彻底删除）；按钮权限控制
- 后端：list/getDetail/create/update/audit/unaudit/softDelete/restore/permanentDelete
- 权限：apiPermissionGate 映射到 menuPath + action（view/add/edit/audit/delete）
- 审计：Sys_OperationLogs 写入可读中文内容；永久删除与软删文案必须区分
- 文档：模块 README + docs/sql/database_map.md 同步

## 业务规则（标准件硬约束）
- 高风险操作二次确认（必须实现）：
  - 适用按钮：审核、反审、删除（软删）、彻底删除（物理删除）
  - 交互要求：
    - 必须弹出确认弹窗（Confirm）后才允许调用接口；不得“一键直接生效”
    - 弹窗文案必须明确：操作对象（名称/编号）、影响范围（状态变化/进入回收站/不可恢复）、是否可逆
    - “彻底删除”必须使用危险样式按钮（danger）并包含“不可恢复”提示
  - 文案建议（可直接复用）：
    - 审核：确认要审核【{name}】吗？审核后将允许在业务单据中选用。
    - 反审：确认要反审【{name}】吗？反审后将禁止在业务单据中选用，已引用的业务不受影响。
    - 删除(软删)：确认要删除【{name}】吗？删除后将移入回收站，可在回收站恢复。
    - 彻底删除：确认要彻底删除【{name}】吗？该操作不可恢复，请谨慎操作。
- 已审核禁止编辑（必须实现）：
  - 规则：pass=1（已审核）的记录禁止直接编辑；必须先反审(pass=0)才允许编辑并保存
  - 交互：已审核记录点击“编辑”必须弹窗提示，不得静默失败
  - 文案建议：该数据已审核，需先反审后才能编辑。是否前往反审？
- 已审核禁止删除（必须实现）：
  - 规则：pass=1（已审核）的记录禁止删除（含软删与彻底删除）；必须先反审(pass=0)才允许删除
  - 交互：已审核记录点击“删除/彻底删除”必须弹窗提示，不得静默失败
  - 文案建议：该数据已审核，需先反审后才能删除。是否前往反审？
- 状态位：pass(审核) + del(逻辑删除) 约定全模块统一
- 默认视图：只查 pass=1（已审）
- 切换：提供“显示未审核(pass=0)”开关；与“回收站(del=1)”互斥
- 删除策略：
  - 在册删除为软删：DELETE /:idOrCode → del=1（并写 deltime）
  - 回收站提供“彻底删除”：DELETE /:idOrCode/permanent → 仅当 del=1 才允许物理删除
- 审计字段：uid/uname/utruename/addtime/edittime/deltime 必须由后端生成，禁止前端传入覆盖
- SQL Server：分页必须兼容 2008 R2（ROW_NUMBER）

## 统一接口形状（建议与颜色编码一致）
- GET list：入参 page/pageSize + keyword + pass 或 recycled
- GET detail：入参 idOrCode
- 回收站：recycled=1 → 仅查 del=1（不按 pass 过滤）
- 返回：{ code:200, data:{ total, list, recycled } }
- detail 返回：{ code:200, data:{ ...record } }

## 必须改动/新增的文件清单（每次做模块都核对）
- 前端模块目录：src/views/<domain>/basic/<module-slug>/
  - index.vue（对齐颜色编码页面结构与交互）
  - README.md（记录接口、表、字段、规则、已知问题）
- 后端：server/index.js
  - 增加该模块的 9 个接口（list/getDetail/create/update/audit/unaudit/restore/softDelete/permanentDelete）
- 权限：server/apiPermissionGate.js
  - 按 Method+Path 映射 menuPath 与 action（/permanent 规则必须先于泛化 delete）
- 审计动作映射：server/action_map.js
  - 补全 GET/POST/PUT/DELETE（含 permanent）到中文 action + targetTable
  - 补全 GET detail 到中文 action（如：查看），并确保可区分于 list（列表查询）
- 审计可读文案：server/operationAuditMiddleware.js
  - prepare：DELETE/PUT 先查库补全名称/差异，写入 req.__audit...
  - finish：区分软删与彻底删除两种 content
- 文档：docs/sql/database_map.md
  - 增加/更新该模块对应物理表、关键字段、接口、页面路径、迁移脚本（如有）

## 颜色编码模式可直接复用的 UI/交互点
- 搜索：关键词输入支持回车；按钮“查询/重置/刷新”
- 开关：回收站开关；未审核开关（回收站打开时隐藏或强制关闭）
- 表格：任何视图都必须提供“查看”（只读，不受 pass/del 状态限制）；其余按钮按状态显示
  - 非回收站：查看 +（未审显示 编辑/审核/删除；已审显示 反审/删除但需拦截规则生效）
  - 回收站：查看 + 恢复/彻底删除
- 二次确认：审核/反审/删除/彻底删除必须走确认弹窗；彻底删除必须提示“不可恢复”
- 已审编辑拦截：pass=1 点击“编辑”弹窗提示“需反审后才能编辑”
- 已审删除拦截：pass=1 点击“删除/彻底删除”弹窗提示“需反审后才能删除”
- 分页：默认 20；sizes=[10,20,50,100]