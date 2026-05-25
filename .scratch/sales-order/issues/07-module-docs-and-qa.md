# 07 — 模块文档与端到端验收清单

**Status:** `done`  
**Type:** AFK  

## Parent

`.scratch/sales-order/PRD.md`

## What to build

在前序切片已落地的前提下，补齐 **可维护性文档** 与 **跨切片验收**，不新增业务功能。

- `docs/sql/database_map.md`：补充 `UB_ERP_Sales_order`、`UB_ERP_Sales_order_list`、`UB_ERP_Bom_Sales*`、`UB_ERP_Bom_pi_*` 及 PI 号关联说明
- 模块 `README.md`（建议路径：`src/views/supply-chain/daily/sales-order/README.md`）：表名、接口列表、保存/同步/运算顺序、运算状态规则
- 核对 `apiPermissionGate`、`action_map` 无遗漏路由
- 编写 **端到端验收清单**（Markdown checklist），覆盖 PRD 业务示例 PI-002 全流程：录单 → 改 PI 用量 → 保存 → 同步 → 部分运算 → 删款 → 审核/回收站

可选：补充 1 条集成测试脚本或 `docs/` 下测试步骤，串联 01–06 关键断言。

## Acceptance criteria

- [x] `database_map.md` 含销售订单相关表及 PI 号外键关系
- [x] 模块 README 与 PRD/API 一致；新人可按 README 调通 list → save → sync → calculate
- [x] 验收清单全部条目可勾选执行，并与 CONTEXT 第七节无冲突
- [x] 权限闸门表与路由一一对应；审计动作有中文描述
- [x] PRD「交付物清单」对应项全部勾选

## Blocked by

- `01-list-and-read.md`
- `02-save-order-pi-bom-align.md`
- `03-audit-recycle-lifecycle.md`
- `04-sync-bom-per-line.md`
- `05-calculate-material-bill.md`
- `06-pi-bom-maintain-ui.md`（文档可并行起草，验收清单需 06 完成后定稿）

## User stories

（跨切片）49；PRD Further Notes 交付物

## Comments

- 权限/审计：14 条销售订单路由均已登记（`apiPermissionGate.js` L552–595，`action_map.js` L163–268）。
- 文档：`docs/sql/database_map.md` §3.16；`src/views/supply-chain/daily/sales-order/README.md`；`.scratch/sales-order/E2E-ACCEPTANCE.md`。
- 自动化回归：`npm run test:sales-order`（01–06 集成测试已覆盖关键断言，未另增串联脚本）。
