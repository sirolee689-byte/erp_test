# 12 - 权限、文档与端到端验收

**Status:** `ready-for-agent`  
**Type:** AFK

## Parent

`docs/issue/Stocks_Storage_out/PRD.md`

## What to build

交付出库单模块上线前收尾：补齐权限动作、模块文档、验收记录和端到端检查，确保第一版边界清楚、功能可跑通、后续开发不会误改已定稿业务口径。

本工单不新增核心业务功能，主要负责把已实现能力固定成可维护、可验收的模块。

## Acceptance criteria

- [ ] 出库单 `view`、`add`、`edit`、`audit`、`review`、`delete`、`price`、`export` 权限动作接入项目权限体系。
- [ ] 超级管理员拥有正常操作权限，并且彻底删除仅超级管理员开放。
- [ ] 模块 README 记录页面入口、主要接口、状态流转、出库类型、字段口径、数量校验、金额规则、库存占用、来源反写、权限和第一版不做范围。
- [ ] 文档明确第一版不做自动审核、审核不通过、真实 Excel 导出、类型 `7`/`8`/`10` 新增编辑、结案/反结案、批次库存、外协 `wxak08` 拆分。
- [ ] `CONTEXT.md` 如有实现中新增的最终约定，需要同步补充。
- [ ] 端到端验收覆盖：其他出库新增保存、盘亏出库新增保存、采购退货保存、外协领料保存、生产领料保存、成品出库保存、审核、反审核、复核、编辑、软删除、恢复、打印。
- [ ] 验收覆盖未审核占用库存、审核转正式出库、反审核回待审核占用、删除释放占用、恢复重新占用。
- [ ] 验收覆盖来源反写字段：`kcak07`、`wxak08`、`scak04`、`scak05`、`xsak06`。
- [ ] 验收覆盖无价格权限用户看不到价格字段且不能覆盖价格字段。
- [ ] 验收覆盖已复核、已结案、类型 `7`、`8`、`10` 只读。
- [ ] 验收记录说明 SQL 兼容 SQL Server 2008 R2，没有使用项目禁止的新语法。
- [ ] 若修改了后端服务，按项目规则提醒用户手动重启 API，并记录验证情况。

## Blocked by

- `01-list-read-shell.md`
- `02-stock-availability-and-free-outbound.md`
- `03-edit-amounts-and-material-snapshots.md`
- `04-purchase-return-source.md`
- `05-outsourcing-issue-return-source.md`
- `06-production-issue-repair-source.md`
- `07-finished-goods-sales-source.md`
- `08-audit-reverse-inventory-writeback.md`
- `09-review-delete-recycle.md`
- `10-price-permission-and-print.md`
- `11-unavailable-types-and-close-readonly.md`

## User stories

All user stories, with emphasis on 25, 26, 39, 40, 41, 46, 51, 52, 53, 54, 55

## Testing notes

- 本工单应以最终验收为主，确认每张前置工单的用户路径都能跑通。
- 如果自动化暂时覆盖不了全部路径，必须留下清晰的手工验收步骤和结果。

