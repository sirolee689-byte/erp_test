# 03 - 采购明细选料、金额计算与价格权限

**Status:** `ready-for-agent`  
**Type:** AFK

## Parent

`docs/issue/buy_order/PRD.md`

## What to build

交付采购明细 Tab 的可用闭环：采购员可以从 BOM 物料中选择采购物料，填写数量、含税单价、税点、交货日期和行备注，系统计算不含税单价、不含税金额和含税金额，并保存到 `UB_ERP_Buy_order_list`。

本工单只处理采购明细本身，不处理额外费用和订单 BOM 展开快照。明细要能独立创建、编辑和读取，为后续整单保存和入库来源打基础。

## Acceptance criteria

- [ ] 采购明细 Tab 支持从 `UB_ERP_Bom_000` 选择未删除 BOM 物料。
- [ ] 采购明细保存到 `UB_ERP_Buy_order_list`，采购单号使用 `kcak01 = UB_ERP_Buy_order.kcaj01`。
- [ ] 明细物料系统码保存到 `kcak02` / `systemcode`，其值为 BOM 物料 `systemcode`。
- [ ] 明细数量保存到 `kcak03`，且必须大于 0。
- [ ] 允许同一采购单存在重复 BOM 物料行。
- [ ] 明细可自由选择 BOM 物料，不强制绑定 PI 明细行。
- [ ] PI 批量带入的数量只作为建议值，用户可编辑。
- [ ] 有 `price` 权限时可编辑含税单价 `kcak041` 和税点 `tax`。
- [ ] 金额计算以含税单价 `kcak041` 为主输入，计算不含税单价 `kcak04`、不含税金额 `kcak05`、含税金额 `kcak051`。
- [ ] 单价按采购单小数位处理，第一版默认 4 位；金额保留 2 位。
- [ ] 不含税模式下强制 `tax=0`，含税与不含税价格、金额保持一致。
- [ ] 无 `price` 权限时页面隐藏或禁用价格、税点、金额字段。
- [ ] 无 `price` 权限时后端保存不得覆盖已有价格、税点、金额字段。
- [ ] 保存明细时复制 BOM 物料属性快照到明细表对应 `kcaa` 字段。

## Blocked by

- `02-create-header-number-and-source.md`

## User stories

22, 23, 24, 25, 26, 27, 43, 44, 49, 51

## Testing notes

- 建议覆盖数量大于 0、重复物料允许、含税金额计算、不含税模式、无 `price` 权限不能覆盖价格。
- 手工验证：新增采购单选择两行相同物料，保存后重新打开仍保留两行，金额计算正确。

