# 04 - 委外派工选货与生产车间合并统计规则

**Status:** `ready-for-agent`  
**Type:** AFK

## Parent

`docs/issue/dispatch-order/PRD.md`

## What to build

交付委外派工的批量选货路径：用户创建委外派工时，主表保存供应商 code，但明细仍然关联销售订单 PI。选货弹窗读取销售订单明细并按旧系统规则计算已派工数量，保证委外派工与旧系统口径一致。

本工单重点是委外特殊规则：如果当前车间名称 `cj` 包含“生产”，已派工数量统计所有 `cj like '%生产%'` 的派工单；否则只统计当前车间 code `scaj05` 的派工单。这个规则看起来特殊，但 PRD 已定稿为第一版保留。

本工单不做审核、回收站、打印、反审核下游限制。

## Acceptance criteria

- [ ] 委外派工主表 `scaj04` 和 `kid` 保存供应商 code，不把 `scaj04` 当 PI 使用。
- [ ] 委外派工明细 `pi` 字段仍从 `UB_ERP_Sales_order_list.xsak01` 带入，表示关联销售订单 PI。
- [ ] 委外选货弹窗默认每页 100 条，按 PRD 不提供“查询全部”按钮。
- [ ] 委外选货只展示源销售订单满足 `del=0`、`closed=0`、`pass=1` 的货品。
- [ ] 当当前车间名称包含“生产”时，已派工数量按所有 `cj like '%生产%'` 的派工单合并统计。
- [ ] 当当前车间名称不包含“生产”时，已派工数量按当前车间 code `scaj05` 统计。
- [ ] 委外选中的货品同样回填货品快照，`scak03` 默认可派工数量，`scak04` 为已派工快照，`scak05` 为返修数量快照。
- [ ] 委外详情页能展示供应商信息，并能从明细 `pi` 看出关联 PI。

## Blocked by

- `02-create-header-and-number.md`
- `03-base-goods-selection-and-quantity.md`

## User stories

13, 14, 16, 32, 33, 34, 35, 36, 37

## Testing notes

- 建议覆盖车间名包含“生产”和不包含“生产”两种统计口径。
- 手工验证委外主表显示供应商、明细显示 PI，不混淆 `scaj04` 和 `pi`。

