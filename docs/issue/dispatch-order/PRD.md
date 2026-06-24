# 派工单模块 PRD

triage: ready-for-agent

## Problem Statement

销售订单（PI）审核通过后，生产管理人员需要把某批货品安排给指定车间或外协对象生产。旧系统通过派工单承载这件事，但规则分散在 ASP 页面、弹窗和旧表字段里，存在几个容易误解的点：派工类型不同导致 `scaj04` 含义不同，可派工数量是实时计算不是落库字段，`scak03` 和 `scak04` 容易混淆，委外派工又有“生产车间合并统计”的特殊口径。

新系统需要接管旧系统派工单主表 `UB_ERP_Dispatch_order` 和明细表 `UB_ERP_Dispatch_order_list`，做出一版能真正下达生产指令的派工单闭环。第一版要保留旧系统关键业务口径，同时修正已确认的不合理点，比如编辑当前派工单时不能让这张单反过来占用自己的可派工数量。

## Solution

建设“派工单”模块，供生产管理人员在 PI 审核后创建派工单，选择派工类型、生产车间或外协商、关联 PI，并从销售订单明细批量选择货品生成派工明细。系统生成 `PGyyMMddxx` 格式派工单号，保存后进入未审核状态，审核后锁定，作为正式生产指令。

第一版支持本厂派工、大板派工、委外派工三种类型，支持列表查询、新增、查看、编辑、审核、反审核、软删除、回收站、恢复、彻底删除和批量选货。不做打印、作废、关闭、库存占用、生产进度回写和完工入库。

## Goals

1. 让生产管理人员能从已审核 PI 中选择货品，生成一张明确车间、数量、交货日期的派工单。
2. 让派工单生命周期符合项目通用规则：未审核可编辑，已审核锁定，删除进入回收站。
3. 让可派工数量口径清楚，避免超额派工。
4. 让委外、本厂、大板三种旧系统派工类型在第一版都能闭环。
5. 把已定稿规则写入 `CONTEXT.md` 和派工单模块 README，避免后续开发遗忘口径。

## User Stories

1. As a 生产管理人员, I want to view audited dispatch orders by default, so that I can quickly see formal production instructions.
2. As a 生产管理人员, I want to switch to the unaudited list, so that I can continue editing newly saved dispatch orders.
3. As a 生产管理人员, I want to search dispatch orders by dispatch number, PI or supplier, workshop, dispatch type, dispatch date, and delivery date, so that I can find the order I need.
4. As a 生产管理人员, I want to create a dispatch order after a PI is approved, so that I can arrange production for the PI goods.
5. As a 生产管理人员, I want the system to generate a dispatch number from the dispatch date, so that the business number matches the actual dispatch date.
6. As a 生产管理人员, I want deleted dispatch numbers to keep occupying their sequence, so that restored or historical orders do not collide with new orders.
7. As a 生产管理人员, I want to choose one dispatch type when creating an order, so that the system can use the correct goods selection rule.
8. As a 生产管理人员, I want saved dispatch type to become read-only, so that existing details do not become inconsistent with a changed type.
9. As a 生产管理人员, I want one dispatch order to link to one PI, so that the order has a clear business source.
10. As a 生产管理人员, I want all detail rows in one dispatch order to use the same PI, so that the dispatch order does not mix multiple sales orders.
11. As a 生产管理人员, I want the same goods code to appear only once in one dispatch order, so that quantities are not split into confusing duplicate rows.
12. As a 生产管理人员, I want batch goods selection to mark already selected goods, so that I do not add duplicate goods by mistake.
13. As a 生产管理人员, I want selected goods to default the current dispatch quantity to the available dispatch quantity, so that I can save input time.
14. As a 生产管理人员, I want to reduce the dispatch quantity manually, so that I can dispatch only part of the available quantity.
15. As a 生产管理人员, I want the system to reject zero or negative dispatch quantities, so that every saved detail row is meaningful.
16. As a 生产管理人员, I want the system to reject over-dispatching on save, so that dispatch quantity never exceeds the PI sales quantity.
17. As a 生产管理人员, I want existing detail snapshot fields to be read-only, so that names, specs, units, and versions stay aligned with the selected source goods.
18. As a 生产管理人员, I want to edit only `scak03` on existing detail rows, so that the dispatch quantity can be adjusted without corrupting source snapshots.
19. As a 生产管理人员, I want to delete detail rows while editing an unaudited order, so that I can clear wrong selections and reselect goods.
20. As a 生产管理人员, I want save to fail if all detail rows are removed, so that an empty dispatch order cannot be stored.
21. As a 生产管理人员, I want save and audit to be separate actions, so that data entry and formal production confirmation are clearly separated.
22. As a 生产管理人员, I want new and edited orders to return to the unaudited list, so that I can immediately find the order I just saved.
23. As a 生产管理人员, I want audited orders to move to the audited list, so that the list matches the order status after audit.
24. As a 生产管理人员, I want reverse-audited orders to move back to the unaudited list, so that I can edit them again.
25. As a 生产管理人员, I want audited orders to be view-only, so that formal production instructions cannot be changed by mistake.
26. As a 生产管理人员, I want to reverse audit an audited order in first version without downstream checks, so that wrong audited orders can still be corrected.
27. As a 生产管理人员, I want deleted orders to go to a recycle bin, so that accidental deletions can be recovered.
28. As a 生产管理人员, I want to restore orders from the recycle bin, so that deleted dispatch orders can return to normal use.
29. As a 生产管理人员, I want to permanently delete only unaudited orders from the recycle bin, so that formal audited orders are protected.
30. As a 生产管理人员, I want the system to update main and detail audit status together, so that the order does not have mismatched header and detail status.
31. As a 生产管理人员, I want workshop data to be chosen from `UB_ERP_Stocks_workshop`, so that the workshop code and name are valid.
32. As a 生产管理人员, I want unavailable goods to be disabled in the batch selection popup, so that I understand they cannot be selected.
33. As a 生产管理人员, I want source PI records that are deleted, closed, or unaudited to be hidden from selection, so that dispatching only uses valid sales orders.
34. As a 生产管理人员, I want the goods selection popup to show sales quantity, available dispatch quantity, received quantity, repaired quantity, and selected snapshot data, so that I can make a correct production decision.
35. As a 生产管理人员, I want outsourced dispatch to store the supplier code in the header while keeping PI in detail rows, so that old table meanings stay compatible.
36. As a 生产管理人员, I want outsourced dispatch view to show the linked PI from detail rows, so that I can still see which PI the outsourced dispatch belongs to.
37. As a 生产管理人员, I want outsourced dispatch to keep the old “workshop name contains 生产” merged-count rule, so that available quantity matches old-system expectations.
38. As a 生产管理人员, I want the first version not to trigger inventory, production progress, or finished goods storage, so that the module can land as a dispatch-order closed loop first.

## Functional Requirements

### List And Search

- Default list shows `del=0` and `pass=1`.
- The page provides a “显示未审核” switch. When enabled, the list shows `del=0` and `pass=0`.
- The recycle bin view shows `del=1`.
- Search conditions include dispatch number `scaj01`, PI or supplier value `scaj04`, workshop `scaj05`, dispatch type `scaj03`, dispatch date `scaj02` range, and delivery date `scaj06` range.
- List columns should include dispatch number, dispatch type, PI or supplier, workshop name, dispatch date, delivery date, audit status, creator, and remark.

### Create

- Create form fields include dispatch date, dispatch type, production workshop, delivery date, associated PI, supplier for outsourced dispatch, and remark.
- Dispatch number `scaj01` is generated as `PG + yyMMdd + daily sequence`.
- The date part uses the user-filled dispatch date `scaj02`.
- The sequence checks all orders on the same date, including deleted records, then uses max sequence plus one.
- The system checks duplicate dispatch number before saving.
- New orders write `pass=0`, `del=0`, `sign=101`, `closed=0`.
- New orders write one header row, N detail rows, and one operation log.

### Edit

- Only `pass=0` and `del=0` orders can be edited.
- Dispatch type, associated PI, supplier, and production workshop become read-only after first save.
- Editable header fields are dispatch date, delivery date, and remark.
- Detail rows can be added or deleted while editing.
- Existing detail rows allow editing only the current dispatch quantity `scak03`.
- All goods snapshot fields remain read-only.
- Editing can temporarily clear all detail rows, but save requires at least one detail row.
- Editing rewrites details as a whole: delete old details for the order and insert current page details.

### View

- View is read-only for all statuses.
- View content is close to create/edit content, but without editable controls.
- First version does not include print.

### Audit And Reverse Audit

- Audit changes header `pass` from `0` to `1` and writes `passuid` and `passuname`.
- Audit also updates all detail rows to `pass=1` and writes `passuid` and `passuname`.
- Reverse audit changes header and detail `pass` back to `0`.
- Reverse audit clears header and detail `passuid` and `passuname`.
- First version allows reverse audit as long as `pass=1` and `del=0`.
- Whether finished goods storage has a direct dispatch-order link is a later confirmation item.

### Delete, Recycle Bin, Restore, Permanent Delete

- Normal delete is soft delete: set header `del=1` and write delete actor and delete time.
- Audited orders cannot be deleted in the normal list. They must be reverse-audited first.
- Recycle bin provides view, restore, and permanent delete.
- Restore sets header `del=0`.
- Permanent delete physically deletes the header and related details.
- Permanent delete only allows `pass=0`.
- If historical abnormal data has `pass=1` inside the recycle bin, it can be viewed or restored but not permanently deleted.

### Batch Goods Selection

- First version supports all three dispatch types: 本厂派工, 大板派工, 委外派工.
- 本厂派工 and 大板派工 select from `UB_ERP_Sales_order_list` using the associated PI or large-board order口径.
- 委外派工 stores supplier code in `scaj04` and `kid`; detail `pi` still stores the associated sales order PI.
- Source sales orders must satisfy `del=0`, `closed=0`, and `pass=1`.
- Goods with available dispatch quantity less than or equal to 0 are shown as unavailable and cannot be selected.
- The batch selection popup returns goods snapshot data to detail rows.
- Selected detail `scak03` defaults to available dispatch quantity.
- Selected detail `scak04` stores the already-dispatched quantity snapshot at selection time.
- Selected detail `scak05` stores repair quantity snapshot at selection time.
- `scak04` is not refreshed automatically during edit and is not used for save validation.

### Quantity Rules

- Available dispatch quantity is a real-time value, not a stored field.
- Base formula: sales quantity `xsak03` minus summed dispatch quantity `scak03`.
- Summed dispatch quantity includes unaudited dispatch orders.
- Deleted dispatch orders do not count.
- For create, existing dispatch quantity counts all matching non-deleted orders.
- For edit, existing dispatch quantity excludes the current dispatch order.
- Back-end save validation must reject over-dispatching.
- Detail quantity `scak03` must be greater than 0.
- Same order cannot contain duplicate `kcaa01`.

### Outsourced Dispatch Special Rule

- For outsourced dispatch, if workshop name `cj` contains `生产`, already-dispatched quantity is summed across all dispatch orders where `cj like '%生产%'`.
- Otherwise, already-dispatched quantity is summed by current workshop code `scaj05`.
- This is an intentional old-system compatibility rule and must be documented.

## Data And Field Decisions

### Header Table

Header table: `UB_ERP_Dispatch_order`.

- `scaj01`: dispatch order number, generated by system.
- `scaj02`: dispatch date, filled by user.
- `scaj03`: dispatch type, `0=本厂`, `1=大板`, `2=委外`.
- `scaj04`: associated PI for 本厂/大板, supplier code for 委外.
- `scaj05`: workshop code.
- `scaj06`: delivery date.
- `scaj07`: unknown purpose, not used in first version.
- `cj`: workshop name snapshot.
- `kid`: supplier code for 委外.
- `remark`: remark.
- `systemcode`: generated unique system code.
- `sign`: fixed `101` on create, not displayed as business field.
- `closed`: fixed `0` on create; closed workflow is out of scope.
- `pass`, `passuid`, `passuname`: audit fields.
- `del`, `delid`, `delname`, `deltruename`, `deltime`: delete fields.
- `uid`, `uname`, `utruename`: creator or operator fields from session.

### Detail Table

Detail table: `UB_ERP_Dispatch_order_list`.

- `scak01`: associated dispatch number, links to header `scaj01`.
- `scak02`: goods unique code.
- `scak03`: current dispatch quantity, user editable.
- `scak04`: already-dispatched quantity snapshot at selection time.
- `scak05`: repair quantity snapshot at selection time.
- `pi`: associated sales order PI; all details in one order must match.
- `seq`: row sort.
- `version`, `kcaa01` to `kcaa35`, `location`, `sale_price`, `cost_price`, `Customer_supply`, `Customer_Name`, `kpname`, `remark`, `content`, `systemcode`, `GUID`: goods snapshot fields.
- `type`: fixed `1`.
- `pass`, `passuid`, `passuname`: synced with header on audit and reverse audit.
- `del`: detail delete mark.
- `uid`, `uname`, `utruename`, `addtime`, `ip`: audit and request metadata.

## Implementation Decisions

- Build a dispatch-order list page with standard pagination, standard search area, audited/unaudited switch, and recycle bin view.
- Build a create/edit/view form that shares layout but switches editability by mode and `pass`.
- Build a dispatch number generator that uses dispatch date and includes deleted records when calculating sequence.
- Build a quantity-calculation module that can be tested independently. It should expose create/edit calculation rules, include unaudited orders, exclude deleted orders, and exclude current order during edit.
- Build batch selection services for 本厂, 大板, and 委外. Keep the type-specific selection rules isolated so the UI does not duplicate quantity logic.
- Build back-end save validation for required header fields, at least one detail row, positive quantities, duplicate `kcaa01`, one PI per order, and no over-dispatching.
- Build audit/reverse-audit services that update header and details together.
- Build recycle-bin services for soft delete, restore, and permanent delete.
- Update operation logs through the project’s official operation-log mechanism.
- Keep SQL compatible with SQL Server 2008 R2. Do not use `TRY_CONVERT`, `OFFSET FETCH`, `FORMAT`, `IIF`, or other newer-only syntax.
- Do not add new table fields in first version unless implementation later proves old tables cannot represent a confirmed business rule.
- Document business terms and settled rules in `CONTEXT.md`.
- Document page behavior, field behavior, first-version boundaries, and known pending questions in the module README.

## Testing Decisions

- Quantity calculation should have focused tests because it controls over-dispatch prevention and has type-specific behavior.
- Save validation should have tests for empty details, duplicate goods, mixed PI details, zero quantity, and over-dispatch.
- Dispatch number generation should have tests for dispatch-date-based prefix, deleted records occupying sequence, and duplicate detection.
- Audit/reverse-audit should have tests confirming header and detail status update together.
- Recycle-bin behavior should have tests for soft delete, restore, permanent delete, and preventing permanent delete for audited records.
- API tests should cover SQL Server 2008-compatible paging and filtering behavior where practical.
- Front-end verification should cover the user-visible workflow: create, return to unaudited list, audit to audited list, reverse audit back to unaudited list, delete to recycle bin, restore, and permanent delete.

## Out Of Scope

- Printing dispatch orders.
- 作废功能.
- 审核不通过流程.
- Closed workflow using `closed`.
- Production progress write-back.
- Inventory occupation or reservation.
- Finished goods storage or inbound update.
- Batch import.
- Downstream restriction for reverse audit based on storage records.
- Adding a new header PI field for outsourced dispatch.
- Allowing saved dispatch type, associated PI, supplier, or workshop to be changed.
- Allowing duplicate goods code in one dispatch order.
- Supporting one dispatch order linked to multiple PI records.

## Boundary Conditions

- A dispatch order must have at least one detail row when saved.
- A dispatch order can only contain one PI.
- 委外派工 header `scaj04` and `kid` store supplier code; the associated PI is read from detail `pi`.
- Existing detail snapshot fields are read-only; wrong goods must be removed and reselected.
- `scak04` is only a snapshot and never the source of truth for save validation.
- Available dispatch quantity always uses real-time back-end calculation.
- Save must fail if any detail quantity exceeds the allowed quantity.
- Soft-deleted orders do not count in available dispatch quantity.
- Unaudited orders do count in available dispatch quantity.
- Current order is excluded when calculating available quantity during edit.
- Audited orders cannot be edited or soft deleted.
- Permanent delete requires recycle-bin state and `pass=0`.

## Further Notes

- Pending question: whether finished goods storage has a field directly linked to dispatch order number `scaj01`. First version does not block reverse audit based on storage records.
- Pending question: old source pages `s_search.asp`, `s_meg.asp`, and `s_sh.asp` were not fully available in this discussion, so list columns and some audit internals may need final codebase/source verification during implementation.
- The old-system `scaj07` purpose remains unknown and is not used in first version.
- The old-system “委外派工 + 生产车间名称包含生产” quantity rule is retained by decision, even though it looks unusual.
