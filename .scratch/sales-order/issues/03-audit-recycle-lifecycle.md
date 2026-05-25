# 03 — 审核、反审与回收站生命周期

**Status:** `done`  
**Type:** AFK  

## Parent

`.scratch/sales-order/PRD.md`

## What to build

在未审/已审/回收站之间完成 **单据生命周期** 的垂直切片：后端动作接口 + 前端按钮 + 已审锁定 UX。

- **审核** / **反审**：仅改 `pass` 及探测到的审核人/时间列；**不** 自动同步主 BOM、**不** 自动一键运算
- **软删**（仅 `pass='0'`）：主表 `del='1'`；订单明细与 PI BOM、物料单 **不改**
- **恢复**：`del='0'`
- **彻底删除**（仅回收站内、未审）：按 **PI 号** 物理 DELETE 主表、明细、`UB_ERP_Bom_Sales*`、`UB_ERP_Bom_pi_cost`、`UB_ERP_Bom_pi_consumption`；之后该 PI 号可复用
- **已审**禁止软删、禁止彻底删（须先反审）；已审禁止编辑（与 02 一致，本单强化前端锁）

前端：列表/详情工具栏审核、反审、删除、恢复、彻底删除；二次确认文案对齐采购报价风格；已审时明细 Tab 增删改禁用并提示先反审。

## Acceptance criteria

- [x] `POST .../approve`、`unapprove`、`soft-delete`、`restore`、`hard-delete` 行为符合 PRD
- [x] 软删后同 PI 号新建仍报重复；彻底删后同 PI 号可保存成功
- [x] 已审单软删/彻底删/PUT 均被拒绝（400 + 人话 msg）
- [x] 回收站列表仅 `del='1'`；恢复后回到删除前 `pass`
- [x] 权限与 `action_map` 审计覆盖各动作
- [x] 前端已审锁明细与保存按钮；反审后可再编辑保存

## Blocked by

- `02-save-order-pi-bom-align.md`（需已有可保存的未审订单用于验收）

## User stories

40–47, 14, 42–43, 48–49

## Comments
