# 05 — 一键运算与物料单查询展示

**Status:** `done`  
**Type:** AFK  

## Parent

`.scratch/sales-order/PRD.md`

## What to build

完成 **订料口径** 闭环：基于 **PI BOM**（禁止偷拉主 BOM）一键运算，写入物料单，并可在界面查看。

**后端**

- `POST /api/sales-order/:id/calculate`  
  - 订单 **未运算**：按当前明细 **全部在单款** 重写整单 `UB_ERP_Bom_pi_cost`、`UB_ERP_Bom_pi_consumption`  
  - 订单 **已运算** 且 body 带 `syncedKcaa01[]`：仅重算这些款的 `pi_*`，其它款禁止改动  
  - 运算 **不乘订货数量**；`pi_consumption` 按子件编码+备注合并；成功后标 **已运算**
- `GET /api/sales-order/:id/material-bill`：返回 cost 明细 + consumption 汇总；**未运算** 时返回空或 409/人话说明不可订料
- 循环引用、超 4 层：失败并提示货品编码

**前端**

- 工具栏 **一键运算**；展示运算状态
- 物料单 Tab/区域：明细表 + 汇总表；展示列含结构用量，并提供 **用量 × 该款订货数量** 的备料展示（可在列或说明中体现）

## Acceptance criteria

- [x] 未运算单：保存含两款的订单 → 一键运算 → DB 有 `pi_*` 且状态已运算
- [x] 改订货数量保存后未运算 → 再运算整单覆盖旧 `pi_*`
- [x] 已运算 + 仅同步 TEST2 + 运算（带 synced 列表）→ 仅 TEST2 的 `pi_*` 变化，TEST1 不变
- [x] 运算过程不修改 `UB_ERP_Bom_Sales*` 内容（相对运算前快照）
- [x] 未运算时 material-bill 接口不暴露有效订料数据
- [x] 权限与审计；前端运算前对未保存变更有拦截或提示

## Blocked by

- `02-save-order-pi-bom-align.md`
- `04-sync-bom-per-line.md`（部分重算验收依赖同步；整单运算仅需 02）

## User stories

31–39, 52–53, 55, 35

## Comments

- 库中若无 `UB_ERP_Bom_pi_consumption` 表，汇总由 `pi_cost` 行内存合并；有表则落库。
- 同步 BOM 后主表为未运算，但若仍有旧 `pi_cost` 且请求带 `syncedKcaa01`，走部分重算。
