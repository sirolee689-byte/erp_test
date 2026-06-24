# 10 - 采购入库来源口径修正

**Status:** `ready-for-agent`  
**Type:** AFK

## Parent

`docs/issue/buy_order/PRD.md`

## What to build

交付采购单与采购入库的正确衔接：采购入库选择采购单时必须使用旧系统确认过的真实字段口径，入库头表通过 `kcan04 = kcaj01` 关联采购单，入库明细 `kcao02` 保存采购明细的 BOM 物料系统码 `kcak02`。

本工单重点修正当前新系统里可能还存在的 `cgad01` / `cgad05` 采购来源假字段，确保后续入库模块能稳定读取采购单。

## Acceptance criteria

- [ ] 采购入库来源查询使用 `UB_ERP_Buy_order.kcaj01` 作为采购单号。
- [ ] 采购入库来源查询使用 `UB_ERP_Buy_order.kcaj05` 作为供应商编码。
- [ ] 采购入库来源查询不再使用 `cgad01` / `cgad05` 作为采购单字段。
- [ ] 采购入库只能选择 `del=0`、`pass=1`、`closed=0` 的采购单。
- [ ] 入库头表保存关联采购单号时使用 `UB_ERP_Stocks_Storage.kcan04 = UB_ERP_Buy_order.kcaj01`。
- [ ] 入库明细 `kcao02` 保存 `UB_ERP_Buy_order_list.kcak02`，也就是 BOM 物料 `systemcode`。
- [ ] 不把 `UB_ERP_Buy_order_list.id` 保存到 `kcao02`。
- [ ] 可入库数量按采购单号 + BOM 物料 `systemcode` 聚合计算。
- [ ] 同一采购单存在重复 BOM 物料行时，采购入库按物料系统码汇总可入库数量。
- [ ] 采购入库带出 `kcak04`、`kcak041` 和 `tax`，供入库按自身规则计算金额。
- [ ] 采购单结案后不再出现在采购入库来源选择中。

## Blocked by

- `03-detail-materials-amounts-and-price-permission.md`
- `07-audit-and-reverse-audit.md`
- `08-close-and-reverse-close.md`

## User stories

47, 48, 49, 50, 51

## Testing notes

- 建议覆盖来源查询字段、未审核/已结案不可选、`kcao02` 保存 BOM `systemcode`、重复物料聚合、价格税点带出。
- 手工验证：采购单有两行同一物料时，采购入库按同一物料显示或校验汇总可入库数量。

