# 11 - 权限矩阵与操作日志补齐

**Status:** `ready-for-agent`  
**Type:** AFK

## Parent

`docs/issue/buy_order/PRD.md`

## What to build

交付采购单模块的权限和日志收口：所有入口、按钮、接口和敏感字段都按 `view/add/edit/audit/close/delete/price/export` 控制；所有关键操作都写入项目通用操作日志。

本工单不是新增某个业务动作，而是把前面各工单的权限和日志做统一补齐，避免前端隐藏了按钮但后端仍可绕过，或业务操作完成却没有追溯记录。

## Acceptance criteria

- [ ] `view` 权限控制列表、详情和打印读取。
- [ ] `add` 权限控制新增入口和新增保存接口。
- [ ] `edit` 权限控制未审核采购单编辑入口和编辑保存接口。
- [ ] `audit` 权限控制审核和反审核入口及接口。
- [ ] `close` 权限控制结案和反结案入口及接口。
- [ ] `delete` 权限控制软删除、恢复和硬删除入口及接口。
- [ ] `price` 权限控制列表、详情、编辑、打印中的价格、税点、金额字段。
- [ ] `export` 权限只控制第一版预留入口，不实现真实导出。
- [ ] 后端接口必须重新校验权限，不能只依赖前端按钮隐藏。
- [ ] 新增、编辑、审核、反审核、结案、反结案、软删除、恢复、硬删除、打印都写入操作日志。
- [ ] 操作日志记录模块码、操作人、操作动作、关键单号、原因摘要或关键变更说明。
- [ ] 无权限请求返回清晰错误，不产生数据变更。

## Blocked by

- `06-readonly-detail-and-print.md`
- `08-close-and-reverse-close.md`
- `09-recycle-bin-delete-restore-hard-delete.md`

## User stories

33, 34, 35, 40, 42, 43, 44, 45, 46, 52

## Testing notes

- 建议按每个权限写接口级测试，特别覆盖无 `price` 权限不能通过保存请求覆盖金额。
- 手工验证：用不同权限账号进入采购单模块，按钮显示和接口拦截结果一致。

