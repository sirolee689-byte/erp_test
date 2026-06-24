# 10 - 价格权限与打印

**Status:** `ready-for-agent`  
**Type:** AFK

## Parent

`docs/issue/Stocks_Storage_out/PRD.md`

## What to build

交付出库单价格权限和打印路径：有价格权限的用户可以查看和编辑价格、税点、金额；无价格权限的用户在页面和打印中看不到价格字段，且服务端不能让其覆盖价格字段。打印包含主表、明细和合计。

## Acceptance criteria

- [ ] 出库单列表、详情、新增、编辑、打印中的价格、税点、金额字段受 `price` 权限控制。
- [ ] 有 `price` 权限的用户可查看和编辑单价、税点、金额。
- [ ] 无 `price` 权限的用户看不到价格、税点、金额字段。
- [ ] 无 `price` 权限的用户提交保存或编辑时，服务端不得让其覆盖价格相关字段。
- [ ] 打印入口受 `view` 权限控制。
- [ ] 打印页包含出库单号、出库日期、出库类型、仓库、关联方、关联单号、经手人、含税模式、备注、明细和合计。
- [ ] 打印页价格相关字段同样受 `price` 权限控制。
- [ ] 打印不兼容旧 IE 页眉页脚设置。
- [ ] 真实 Excel 导出不在本工单实现，只保留待开发入口。

## Blocked by

- `03-edit-amounts-and-material-snapshots.md`
- `08-audit-reverse-inventory-writeback.md`

## User stories

39, 40, 41, 42, 43, 51, 52

## Testing notes

- 建议用有价格权限和无价格权限两类用户验证页面、接口、打印。
- 手工验证：无价格权限用户抓包改价格字段，服务端不能保存覆盖。

