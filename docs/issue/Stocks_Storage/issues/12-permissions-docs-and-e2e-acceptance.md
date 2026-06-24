# 12 - 权限、文档与端到端验收

**Status:** `ready-for-agent`  
**Type:** AFK

## Parent

`docs/issue/Stocks_Storage/PRD.md`

## What to build

交付入库单模块上线前收尾：补齐权限动作、模块文档、验收记录和端到端检查，确保第一版边界清楚、功能可跑通、后续开发不会误改已定稿业务口径。

本工单不新增核心业务功能，主要负责把已实现能力固定成可维护、可验收的模块。

## Acceptance criteria

- [ ] 入库单 `view`、`add`、`edit`、`audit`、`delete`、`price`、`export` 权限动作接入项目权限体系。
- [ ] 超级管理员拥有正常操作权限，并且彻底删除仅超级管理员开放。
- [ ] 模块 README 记录页面入口、主要接口、状态流转、入库类型、字段口径、数量校验、金额规则、库存统计、权限和第一版不做范围。
- [ ] 文档明确第一版不做审核不通过、财务复核入口、真实 Excel 导出、超量豁免、上游复杂反写、结案/反结案、类型 `8` 新增编辑。
- [ ] `CONTEXT.md` 如有实现中新增的最终约定，需要同步补充。
- [ ] 端到端验收覆盖：其他入库新增保存、采购入库批量添加保存、审核、反审核、编辑、软删除、恢复、打印。
- [ ] 验收覆盖生产入库必须有派工单、生产退料可无派工单。
- [ ] 验收覆盖无价格权限用户看不到价格字段。
- [ ] 验收覆盖已复核、已结案、类型 `8` 只读。
- [ ] 验收记录说明 SQL 兼容 SQL Server 2008 R2，没有使用项目禁止的新语法。
- [ ] 若修改了后端服务，按项目规则完成 API 重启确认并记录启动指纹。

## Blocked by

- `01-list-read-shell.md`
- `02-free-inbound-create-save.md`
- `03-edit-free-inbound-and-amounts.md`
- `04-purchase-inbound-source.md`
- `05-outsourcing-inbound-source.md`
- `06-production-inbound-return-source.md`
- `07-sales-return-source.md`
- `08-audit-reverse-and-inventory.md`
- `09-delete-recycle-permanent-delete.md`
- `10-price-permission-and-print.md`
- `11-auto-approval-logs-and-placeholders.md`

## User stories

All user stories, with emphasis on 40, 43, 44, 45, 48, 50, 51, 52, 53, 54, 55

## Testing notes

- 本工单应以最终验收为主，确认每张前置工单的用户路径都能跑通。
- 如果自动化暂时覆盖不了全部路径，必须留下清晰的手工验收步骤和结果。

