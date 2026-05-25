# 06 — PI 销售 BOM 查看与维护

**Status:** `done`  
**Type:** AFK  

## Parent

`.scratch/sales-order/PRD.md`

## What to build

在销售订单编辑上下文中，用户可 **按款查看并修改 PI 销售 BOM**（`UB_ERP_Bom_Sales` / `UB_ERP_Bom_Sales_list`），以支持「PI 内改用量、保存不被主 BOM 覆盖」的日常作业（如 0.1→0.2）。

端到端：`GET /api/sales-order/:id/pi-bom?kcaa01=`（或按款列表）；`PUT` 或专用接口保存某款 PI BOM 子件变更（未审、未运算或运算后改 BOM 须另定：改 PI BOM 后应标 **未运算** 若影响物料单——按 CONTEXT，改 PI BOM 用量后须重新运算；本单至少保存 PI BOM 行并将订单标未运算）。前端：订单弹窗内 **PI BOM** Tab 或从明细行钻取，树/表展示子件与用量，可编辑允许字段。

**主 BOM 门禁**：本 UI 仅改 PI 表，**不** 提供从主 BOM 拉取（拉取走 04 同步 BOM）。

## Acceptance criteria

- [x] 可查看当前 PI 下指定款的 `UB_ERP_Bom_Sales_list` 结构
- [x] 未审单可修改子件用量等约定字段并保存到 PI BOM
- [x] 保存 PI BOM 变更后订单为 **未运算**（物料单与运算状态一致）
- [x] 已审单禁止修改 PI BOM
- [ ] 手工验收：改 TEST2 子件 0.1→0.2 → 保存订单（02）后仍为 0.2；与 04、05 联调 CONTEXT 示例
- [x] 权限与审计登记

## Blocked by

- `02-save-order-pi-bom-align.md`

## User stories

54, 30（与保存门禁联调）, 23

## Comments
