# 08 - 权限接入与操作入口收口

**Status:** `ready-for-agent`  
**Type:** AFK  

## Parent

`docs/issue/assist_order/PRD.md`

## What to build

把外协订单所有接口、按钮和菜单入口接入 ERP 标准权限模型，确保用户看到的按钮和后端允许的动作一致。

权限沿用标准 `view/add/edit/audit/delete`：打印归 `view`，结案和反结案归 `audit`，删除、恢复、彻底删除归 `delete`。

## Acceptance criteria

- [ ] 外协订单菜单、列表、详情、打印入口归入 `view` 权限。
- [ ] 新增归入 `add` 权限。
- [ ] 编辑和保存归入 `edit` 权限。
- [ ] 审核、反审、结案、反结案归入 `audit` 权限。
- [ ] 删除、恢复、彻底删除归入 `delete` 权限。
- [ ] 前端按钮根据权限隐藏或禁用，状态限制和权限限制同时生效。
- [ ] 后端接口全部经过权限校验，不能只靠前端隐藏按钮。
- [ ] `action_map` 或项目等价配置中有可读的中文动作名称，便于审计和排查。
- [ ] 无权限访问时返回统一错误结构，前端显示人能看懂的提示。

## Blocked by

- `05-lifecycle-delete-and-logs.md`
- `07-print-outsourcing-order.md`

## User stories

32

## Testing notes

- 建议模拟不同权限用户，验证按钮和接口拒绝一致。
- 手工验证打印只有 `view` 权限即可进入，结案没有 `audit` 权限不能操作。

