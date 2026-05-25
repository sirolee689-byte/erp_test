# 01 — 销售订单列表与只读详情

**Status:** `done`  
**Type:** AFK  

## Parent

`.scratch/sales-order/PRD.md`

## What to build

交付销售订单模块的 **第一条可演示路径**：用户打开菜单看到真实列表，可按条件筛选，点进单据查看主表与明细（只读）。

端到端包含：路由注册、权限闸门（list/view）、操作审计（列表/查看类动作）、`GET` 列表分页与 `GET` 单笔详情（主表 + 明细数组）。前端替换占位页：表格列含 **系统单号、PI 号、客户、销售日期、审核状态（pass）、运算状态、del**；支持在册/回收站切换及 PI 号、系统单号、客户、销售日期区间筛选。编辑弹窗可 **仅查看**（保存/审核等按钮本单禁用或隐藏）。

本单 **不包含** 新建、保存、PI BOM、运算、审核删单。

## Acceptance criteria

- [x] `GET /api/sales-order/list` 分页返回主表字段（含 `pass`、`del`、运算状态）；`ROW_NUMBER()` 分页；`del` 筛选区分在册/回收站
- [x] `GET /api/sales-order/:id` 返回主表一行 + `lines[]` 明细（含 `kcaa01`、订货数量及 `bom_000` 展示快照字段）
- [x] `apiPermissionGate` 登记上述 GET；`action_map` 有可读中文审计
- [x] 前端列表页可筛选、分页、切换回收站；点击行打开只读详情（主表 Tab + 明细 Tab）
- [x] 未登录/无权限时接口与按钮行为与采购报价金标准一致
- [x] 手工或集成测试：有 seed 数据时能 list + get 一条完整主从（`npm run test:sales-order`；UI：`npm run e2e:sales-order`）

## Blocked by

None — 可立即开始

## User stories

1, 2, 3, 4（列表与运算状态展示）；48（view 权限）

## Comments

- 后端：`server/salesOrderListQuery.js`、`server/salesOrderHandlers.js`
- 前端：`src/views/supply-chain/daily/sales-order/index.vue`、`src/utils/salesOrderDisplay.js`
- E2E：`scripts/e2e-sales-order-list-read.mjs` → `e2e-output/sales-order-view-dialog.png`
