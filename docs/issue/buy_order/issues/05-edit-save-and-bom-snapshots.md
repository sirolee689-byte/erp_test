# 05 - 编辑保存、明细重写与 6 层 BOM 快照

**Status:** `ready-for-agent`  
**Type:** AFK

## Parent

`docs/issue/buy_order/PRD.md`

## What to build

交付采购单编辑保存闭环：未审核采购单可以修改基础资料、采购明细和额外费用，保存时以当前页面为准重写明细、费用和订单 BOM 快照，避免旧行残留。

本工单补齐采购单保存的核心一致性：`UB_ERP_Buy_order_list` 写物料快照，`UB_ERP_Bom_buy_order` 与 `UB_ERP_Bom_buy_order_list` 写订单 BOM 快照，配件最多展开 6 层，仅作追溯，不参与采购数量校验。

## Acceptance criteria

- [ ] 未审核 `pass=0` 且未删除 `del=0` 的采购单可以进入编辑。
- [ ] 已审核 `pass=1` 的采购单禁止直接编辑，前端禁用入口，后端拒绝保存。
- [ ] 编辑页采购单号 `kcaj01` 只读，不允许修改业务单号。
- [ ] 保存时基础资料按当前表单更新，并重新按供应商/币别编码写入名称和汇率快照。
- [ ] 保存时采购明细按当前页面内容重写，旧明细不残留。
- [ ] 保存时额外费用按当前页面内容重写，旧费用不残留。
- [ ] 保存时写入 `UB_ERP_Buy_order_list` 的物料属性快照。
- [ ] 保存时写入 `UB_ERP_Bom_buy_order` 订单 BOM 主快照。
- [ ] 保存时写入 `UB_ERP_Bom_buy_order_list` 订单 BOM 配件快照。
- [ ] 订单 BOM 配件从 `UB_ERP_Bom_parts` 展开，最多 6 层。
- [ ] BOM 快照仅用于追溯，不做最大采购数量校验。
- [ ] 编辑保存成功写入修改时间和操作日志。
- [ ] 任一关键写入失败时整单保存应回滚或返回失败，不能留下半张单。

## Blocked by

- `03-detail-materials-amounts-and-price-permission.md`
- `04-extra-fees-tab.md`

## User stories

31, 32, 34, 52

## Testing notes

- 建议覆盖编辑后旧明细/旧费用/旧快照被清理，6 层 BOM 快照写入，已审核单据保存被拒。
- 手工验证：编辑删掉一条明细和一条费用，保存后重新打开确认不再出现；检查快照随当前明细重建。

