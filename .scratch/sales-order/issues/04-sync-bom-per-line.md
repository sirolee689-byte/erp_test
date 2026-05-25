# 04 — 按行同步 BOM

**Status:** `done`  
**Type:** AFK  

## Parent

`.scratch/sales-order/PRD.md`

## What to build

用户可在销售订单 **明细 Tab** 对指定款（`kcaa01`）执行 **同步 BOM**：从 **主 BOM** 覆盖该款 `UB_ERP_Bom_Sales*`，并将订单标为 **未运算**。

端到端：`POST /api/sales-order/:id/sync-bom`（body 指定 `kcaa01` 或行标识）；服务端校验订单未审、该款在明细中；展开主 BOM（≤4 层，循环/超限失败）；**按款覆盖** PI BOM（非整 PI 重插）；前端明细行「操作 → 同步 BOM」+ 成功/失败提示。

本单 **不包含** 一键运算写物料单（见 05）。

## Acceptance criteria

- [x] 同步后该款 PI BOM 与当前主 BOM 一致（可用 TEST2 用量 0.1 盖回场景验收）
- [x] 同步后主表运算状态为 **未运算**；未同步的其它款 PI BOM 不变
- [x] 未审以外状态、明细中不存在的款、无权限时请求失败且有人话提示
- [x] 同步过程 **不** 写入 `pi_cost` / `pi_consumption`
- [x] 前端同步前有确认（说明将覆盖 PI 内该款 BOM）；权限 `edit` 或独立 action（与菜单配置一致）
- [x] 审计日志可读（含 PI 号、款号）

## Blocked by

- `02-save-order-pi-bom-align.md`

## User stories

18, 28–30, 39（同步路径上的 BOM 错误提示）

## Comments
