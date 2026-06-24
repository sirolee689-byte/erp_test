# 04 - 额外费用 Tab 与 FEE 物料约束

**Status:** `ready-for-agent`  
**Type:** AFK

## Parent

`docs/issue/buy_order/PRD.md`

## What to build

交付额外费用 Tab：采购员可以把运费、手续费等费用记录在采购单中，费用项目必须来自已审核、未删除且分类为 `FEE` 的 BOM 记录，保存后写入采购单额外费用表。

本工单让采购单金额信息更完整，但不实现真实 Excel 导出和超 30000 RMB 邮件发送。

## Acceptance criteria

- [ ] 新增/编辑页包含额外费用 Tab。
- [ ] 费用项目只能从 `UB_ERP_Bom_000` 中已审核、未删除、分类为 `FEE` 的记录选择。
- [ ] 不允许保存手工输入但 BOM 中不存在的费用项目。
- [ ] 每条费用支持费用编码、名称、规格、金额、税点、备注等字段。
- [ ] 费用保存到 `UB_ERP_Buy_order_money`，并关联当前采购单号。
- [ ] 编辑采购单时，额外费用按当前页面内容整体重写，不保留已删除的旧费用行。
- [ ] 费用金额和税点受 `price` 权限控制；无 `price` 权限时不可查看或覆盖费用金额。
- [ ] 采购单查看和打印数据中能读取额外费用，并参与展示合计。
- [ ] 保存、修改费用写入操作日志或纳入采购单保存日志详情。

## Blocked by

- `02-create-header-number-and-source.md`
- `03-detail-materials-amounts-and-price-permission.md`

## User stories

28, 29, 30, 31, 43, 44, 52

## Testing notes

- 建议覆盖非 `FEE` BOM 被拒、已删除或未审核 FEE 被拒、编辑后删除旧费用行、无 `price` 权限不覆盖金额。
- 手工验证：新增费用后查看采购单能看到费用；编辑删除一条费用后重新打开不再出现。

