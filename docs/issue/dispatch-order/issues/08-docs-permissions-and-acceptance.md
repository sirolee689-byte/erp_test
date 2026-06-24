# 08 - 派工单权限、文档与端到端验收

**Status:** `ready-for-agent`  
**Type:** AFK

## Parent

`docs/issue/dispatch-order/PRD.md`

## What to build

交付派工单模块上线前的收尾工作：补齐权限动作、操作日志中文名、模块 README、`CONTEXT.md` 业务术语和规则，并做一轮端到端验收，确保第一版边界清楚、功能能跑通、后续 agent 不会误改已定稿规则。

本工单不新增业务功能，主要负责把已经实现的功能固定成可维护、可验收的模块。

## Acceptance criteria

- [ ] 派工单列表、查看、新增、编辑、选货、审核、反审核、软删除、恢复、彻底删除等动作纳入项目权限体系。
- [ ] 操作日志或 `action_map` 中有清晰中文动作名，方便审计。
- [ ] `CONTEXT.md` 补充派工单核心业务术语：派工单、派工单明细、PI、生产车间、派工类型、可派工数量、已派工快照、返修数量。
- [ ] 模块 README 记录页面入口、主要接口、状态流转、字段口径、数量计算、委外特殊规则、第一版不做范围。
- [ ] 文档明确：第一版不做打印、作废、审核不通过、关闭、库存占用、生产进度、完工入库、反审核下游限制。
- [ ] 端到端手工或自动验收覆盖：新增派工单、选货、保存、回到未审核列表、审核进入已审核列表、反审核回到未审核列表、编辑、删除到回收站、恢复、彻底删除。
- [ ] 验收记录说明 SQL 兼容 SQL Server 2008 R2，没有使用项目禁止的新语法。
- [ ] 若修改了后端服务，按项目规则完成 API 重启确认并记录启动指纹。

## Blocked by

- `01-list-read-shell.md`
- `02-create-header-and-number.md`
- `03-base-goods-selection-and-quantity.md`
- `04-outsourced-goods-selection.md`
- `05-save-edit-and-validation.md`
- `06-audit-and-reverse-audit.md`
- `07-recycle-bin-delete-restore.md`

## User stories

All user stories, with emphasis on 30, 31, 34, 35, 36, 37, 38

## Testing notes

- 本工单应以最终验收为主，确认每张前置工单的用户路径都能跑通。
- 如果自动化暂时覆盖不了全部路径，必须留下清晰的手工验收步骤和结果。

