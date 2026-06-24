# 采购单 PRD

标签：ready-for-agent

## Problem Statement

当前新系统里的采购订单页面仍是占位页，无法承接企业向供应商下达正式采购指令的业务。采购员需要在新系统中创建、审核、打印并管理采购单，仓库后续采购入库也必须能稳定从已审核、未结案的采购单带出明细和价格。

旧系统已有采购单业务规则，但新系统不能照搬旧页面。新系统需要保留旧系统关键数据口径，同时按当前 ERP 的权限、回收站、操作日志、页面形态和入库关联方式重新实现。

## Solution

建设采购单第一版闭环：列表、筛选、新增、编辑、查看、软删除、回收站恢复、审核、反审核、结案、反结案、打印、操作日志、采购明细、额外费用、订单 BOM 快照，以及采购入库来源所需的数据口径。

采购单第一版以旧系统 `UB_ERP_Buy_order` 字段为准：采购单号使用 `kcaj01`，供应商编码使用 `kcaj05`，供应商名称快照使用 `kehu`。当前新系统中若仍有采购来源代码使用 `cgad01` / `cgad05`，后续实现时必须修正回 `kcaj01` / `kcaj05`。

## User Stories

1. As a 采购员, I want to see a 采购单列表, so that I can quickly find normal, audited, unaudited, and closed purchase orders.
2. As a 采购员, I want to filter purchase orders by 审核状态, 结案状态, 采购类型, 供应商, 日期范围, and keyword, so that I can locate the order I need.
3. As a 采购员, I want to switch to a 回收站 view, so that I can recover mistakenly deleted unaudited purchase orders.
4. As a 采购员, I want to create a purchase order with 基础资料, 采购明细, and 额外费用 tabs, so that one document contains the full purchase commitment.
5. As a 采购员, I want to choose a 采购单号类型, so that the system generates the correct business number.
6. As a 采购员, I want selecting `ZY` number type to default to 订单采购 while still allowing 请购采购, so that old numbering behavior is preserved.
7. As a 采购员, I want selecting `PO` number type to lock the order to 请购采购, so that PO-style documents follow the intended business type.
8. As a 采购员, I want selecting the current-year number type to default to 请购采购 while allowing the other types, so that year-style documents remain flexible.
9. As a 采购员, I want the year number button to show the current year, so that users do not need to understand internal numbering rules.
10. As a 采购员, I want deleted purchase order numbers to remain occupied, so that historical document numbers are never reused.
11. As a 采购员, I want 订单采购 to require an 关联单号, so that the purchase order keeps its business source.
12. As a 采购员, I want 关联单号 to accept manual business text, so that values such as `S2400201` or `UB26-006 B2奥迪` can be preserved.
13. As a 采购员, I want to select a single PI for 订单采购, so that PI-based purchase orders can be created quickly.
14. As a 采购员, I want 请购采购 to keep its displayed name, so that users see familiar wording.
15. As a 采购员, I want 请购采购 to allow multiple PI selections, so that one purchase order can cover multiple PI sources.
16. As a 采购员, I want selected multiple PIs to be saved as a comma-separated `kcaj04`, so that the main document remains searchable and readable.
17. As a 采购员, I want 其他采购 to allow an empty 关联单号, so that miscellaneous purchase orders can be created without a PI.
18. As a 采购员, I want to choose a supplier from approved, active purchase/shared suppliers, so that invalid suppliers are not used.
19. As a 采购员, I want the system to snapshot supplier name from supplier code, so that historical purchase orders keep the supplier name at save time.
20. As a 采购员, I want to choose an approved active currency, so that purchase orders carry a valid currency.
21. As a 采购员, I want the system to snapshot currency name and exchange rate on save, so that historical documents have stable currency information.
22. As a 采购员, I want to freely select BOM materials into purchase details, so that purchase details are not forced to match PI detail rows.
23. As a 采购员, I want PI batch-add quantities to be suggestions, so that I can adjust purchase quantity according to real purchasing needs.
24. As a 采购员, I want duplicate BOM materials to be allowed in one purchase order, so that business lines can stay separate when needed.
25. As a 采购员, I want each detail quantity to be greater than 0, so that invalid purchase rows cannot be saved.
26. As a 采购员 with price permission, I want to enter tax-included unit price and tax point, so that the system calculates untaxed price and amounts.
27. As a 采购员, I want no-tax mode to force tax point to 0, so that tax-included and untaxed amounts stay consistent.
28. As a 采购员, I want extra fees to be recorded in a separate tab, so that freight and other fees are included in purchase amount.
29. As a 采购员, I want extra fee items to come from approved active `FEE` BOM records, so that fees remain standardized.
30. As a 采购员, I want fee amount, tax point, and remark to be editable, so that each purchase order can capture actual fee details.
31. As a 采购员, I want editing a purchase order to rewrite current details, fees, and BOM snapshots, so that stale rows are not left behind.
32. As a 采购员, I want saved purchase orders to write order BOM snapshots up to 6 levels, so that the purchase document has traceable BOM context.
33. As a 审核员, I want to audit a purchase order manually, so that only reviewed purchase commitments become valid for inbound receipt.
34. As a 审核员, I want audited purchase orders to lock editing and deletion, so that approved purchase basis cannot be changed silently.
35. As a 审核员, I want to reverse-audit with a required reason, so that there is a traceable reason for reopening an approved purchase order.
36. As a 采购员, I want purchase orders linked by active inbound receipts to block reverse-audit, so that upstream purchase basis cannot change after downstream receiving.
37. As a 采购员, I want purchase orders linked by active inbound receipts to block deletion, so that received purchase orders remain traceable.
38. As a 管理员, I want to close an audited purchase order after at least one active inbound receipt exists, so that no new purchase inbound can use it.
39. As a 管理员, I want closing not to require full quantity inbound, so that business can manually stop further receiving.
40. As a 超级管理员, I want reverse-close as an exception repair action, so that wrongly closed purchase orders can be corrected.
41. As a 采购员, I want only unaudited, unreferenced purchase orders to enter the recycle bin, so that valid business documents are not hidden accidentally.
42. As a 超级管理员, I want hard delete limited to unaudited, unreferenced purchase orders, so that permanent deletion remains safe.
43. As a user without price permission, I want price fields hidden in list, detail, print, and future export, so that sensitive purchase amounts are protected.
44. As a user without price permission, I want my save requests not to overwrite prices, so that hidden fields are not accidentally erased.
45. As a user with view permission, I want to print purchase orders, so that purchase documents can be shared or archived.
46. As a user with view permission but without price permission, I want printing to hide price fields, so that printing cannot bypass permissions.
47. As a 仓库收货人员, I want purchase inbound to select only audited, unclosed purchase orders, so that receiving uses valid purchase basis.
48. As a 仓库收货人员, I want purchase inbound to link by `kcan04 = kcaj01`, so that inbound receipts point to the purchase order business number.
49. As a 仓库收货人员, I want purchase inbound detail `kcao02` to use purchase detail `kcak02`, so that receiving follows the old system's BOM material `systemcode` contract.
50. As a 仓库收货人员, I want purchase inbound to aggregate duplicate material rows by purchase order and BOM material `systemcode`, so that available quantity matches the old data model.
51. As a 仓库收货人员, I want purchase inbound to bring untaxed price, tax-included price, and tax point from purchase detail, so that inbound pricing has complete source data.
52. As a 管理员, I want operation logs for create, edit, audit, reverse-audit, close, delete, restore, hard delete, and print, so that purchase order operations are traceable.

## Implementation Decisions

- Build the purchase order module under the existing supply-chain daily purchase order menu, replacing the current placeholder page.
- Use the new-system page pattern: list first; add/edit as an in-module full-page form; readonly detail in a large dialog; print in a dedicated print view.
- The form has three tabs: 基础资料, 采购明细, 额外费用.
- Use旧系统字段 as the business contract:
  - Header table: `UB_ERP_Buy_order`
  - Detail table: `UB_ERP_Buy_order_list`
  - Purchase order number: `kcaj01`
  - Supplier code: `kcaj05`
  - Supplier name snapshot: `kehu`
  - Detail purchase order number: `kcak01`
  - Detail quantity: `kcak03`
- Fix any current purchase inbound code that reads `cgad01` / `cgad05`; those are not the final purchase order business fields.
- `kcaj04` is a business text field. It may be manually entered or filled by selecting PI values.
- `kcaj03=1` means 订单采购. It must have `kcaj04`; PI selection writes one PI, but manual text is also allowed.
- `kcaj03=2` displays as 请购采购. In the new system it means multi-PI purchase, not old-system requisition. It must have `kcaj04`; selected multiple PI values are saved comma-separated.
- `kcaj03=0` means 其他采购. It does not require `kcaj04`.
- Purchase details can be freely selected from BOM materials. They do not need to bind to PI detail rows.
- PI batch-add may keep source PI/source detail metadata for traceability, but this is not a hard line-level binding requirement.
- Purchase number type controls default purchase type:
  - `ZY`: default 订单采购; may switch to 请购采购.
  - `PO`: default and locked to 请购采购.
  - current-year number: default 请购采购; may switch to the other two types.
- Current-year number button displays the current year and generates by save date. Deleted order numbers are not reused.
- Supplier options come from approved, active `UB_ERP_System_supplier` records whose category is 采购 or 共用.
- Currency options come from approved, active `UB_ERP_Finance_currency` records.
- Server-side save re-queries supplier name, currency name, and currency rate, then writes snapshots. Frontend-provided names/rates are not trusted.
- Purchase detail amount calculation uses tax-included unit price `kcak041` as the main input, with `tax` to calculate `kcak04`, `kcak05`, and `kcak051`.
- No-tax mode forces `tax=0`, making tax-included and untaxed price/amount equivalent.
- `price` permission controls all price, tax, and amount visibility and editability. Server-side save must prevent users without `price` permission from overwriting price fields.
- Extra fees are first-version scope. Fee items must be selected from approved, active BOM records with category `FEE`.
- Extra fees are part of purchase amount and are rewritten on edit based on the current page content.
- Purchase save writes detail material snapshots in `UB_ERP_Buy_order_list`.
- Purchase save also writes order BOM snapshot tables `UB_ERP_Bom_buy_order` and `UB_ERP_Bom_buy_order_list`.
- Order BOM snapshots expand up to 6 levels and are for traceability only, not purchase quantity validation.
- Edit save rewrites purchase details, extra fees, and order BOM snapshots as one current-document replacement.
- First version does not enforce a maximum purchasable quantity. Detail quantity only requires `kcak03 > 0`; PI quantities are suggestions.
- Purchase detail duplicate BOM materials are allowed.
- Purchase order lifecycle:
  - New save always creates `pass=0`.
  - No auto approval.
  - Single audit changes to `pass=1`.
  - No reject/passno state in first version.
  - `pass=1` locks direct edit and deletion.
  - Reverse-audit requires reason and writes `UB_ERP_Buy_order_sp`.
  - Reverse-audit is blocked when any non-deleted inbound receipt references the purchase order.
- Closing lifecycle:
  - `closed=1` means no new purchase inbound may reference the purchase order.
  - Close requires `pass=1` and at least one non-deleted inbound receipt reference.
  - Close does not require all purchase quantity to be inbound.
  - Reverse-close is a super-admin exception repair action.
- Recycle-bin lifecycle:
  - Soft delete only unaudited, unreferenced purchase orders.
  - Restore only `del=1` unaudited purchase orders.
  - Hard delete only super admin, and only for unaudited, unreferenced purchase orders.
- List defaults:
  - Normal list shows `del=0`, including unaudited, audited, and closed purchase orders.
  - Recycle bin shows `del=1`.
  - Filters include audit status, close status, purchase type, supplier, keyword, and date range.
- Permissions:
  - `view`: list, detail, print.
  - `add`: create.
  - `edit`: edit unaudited, unreferenced purchase orders.
  - `audit`: audit and reverse-audit.
  - `close`: close and reverse-close.
  - `delete`: soft delete, restore, hard delete.
  - `price`: price fields.
  - `export`: reserved future export.
- First version includes print with header, details, extra fees, and totals. Print obeys `price` permission.
- First version only reserves export entry. Real Excel export is out of scope and must later be generated server-side with `price` permission.
- First version does not send the old over-30000-RMB audit email. It may keep an over-threshold reminder or extension point.
- First version does not do batch audit.
- First version does not do over-receipt application/recheck; future over-receipt rules should be handled by inbound receipt over-limit configuration or exemption.
- Purchase inbound contract:
  - Inbound header links with `kcan04 = purchase.kcaj01`.
  - Inbound detail `kcao02` stores `UB_ERP_Buy_order_list.kcak02`, which is BOM material `systemcode`, not the purchase detail row `id`.
  - `UB_ERP_Buy_order_list.id` is the line's unique field, but old-system purchase inbound does not store it in `kcao02`.
  - Available inbound quantity is calculated by purchase order number plus BOM material `systemcode`, aggregating duplicate material rows.
  - Purchase inbound brings `kcak04`, `kcak041`, and `tax`; inbound then calculates amounts by its own rules.

## Testing Decisions

- Tests should cover external behavior and business outcomes, not private helper implementation details.
- Add pure unit tests for purchase number generation and number-type to purchase-type rules.
- Add pure unit tests for purchase amount calculation: tax-included input, no-tax mode, tax point handling, and rounding.
- Add lifecycle tests for audit, reverse-audit, close, reverse-close, soft delete, restore, and hard delete guards.
- Add permission tests for `view/add/edit/audit/close/delete/price/export`, especially price-field hiding and no-price save protection.
- Add save validation tests for supplier, currency, required `kcaj04` by purchase type, detail quantity greater than 0, fee item category `FEE`, and duplicate material allowance.
- Add integration-style service tests for saving a purchase order with details, extra fees, material snapshots, and 6-level order BOM snapshots.
- Add purchase inbound compatibility tests proving the source query uses `kcaj01/kcaj05`, not `cgad01/cgad05`.
- Add purchase inbound quantity tests for duplicate BOM material rows using purchase order number plus BOM material `systemcode` aggregation.
- Add print-data tests to verify price fields are present with `price` permission and absent without it.
- Similar prior art exists in stock-in tests for lifecycle, permission gate, list query, save logic, source linking, print data, and operation log behavior.

## Out of Scope

- Batch audit.
- Independent reject/audit-failed status.
- Auto approval.
- Real Excel export.
- Old over-30000-RMB email sending.
- Over-receipt application and recheck flow.
- New automatic approval configuration UI.
- Old-system iframe order-number detection page.
- Old-system recovery/search pages as standalone flows.
- Old申购单 module integration; 请购采购 remains the display name but means multi-PI purchase in the new system.
- Forcing purchase detail rows to bind to PI detail rows.
- Enforcing maximum purchasable quantity in purchase order save.

## Further Notes

- This PRD intentionally follows the confirmed `CONTEXT.md` purchase-order glossary and should be split into thin implementation issues before coding.
- SQL must remain compatible with SQL Server 2008 R2.
- Keep the new-system recycle-bin, operation-log, permission, and page-shell patterns instead of copying the old ASP page flow literally.
- The current purchase order page is a placeholder, while stock-in already has purchase-source assumptions that must be corrected during implementation.
