# 外协报价（主从）

- 主表：`Outsourcing_Quotation`（单号 `wxaa01`）
- 明细：`Outsourcing_Quotation_list`（关联列 `wxab01` = 主表 `wxaa01`；金额 `wxab04` 不含税、`wxab05` 含税）
- 后端：`server/outsourcingQuotationHandlers.js`，路由前缀 `/api/supply-chain/outsourcing-quotations`
- 路由/菜单 path：`supply-chain/daily/outsourcing-quote`
- 选材：复用 `../purchase-quote/MaterialSelector.vue`（BOM 列表权限与采购报价一致）
- 币别：下拉三项（001 人民币 / 002 美元 / 003 港元）；保存 **`wxaa05`**=码、**`rmb`**=名称。

## 列表汇总

- 总项数：在册明细行数
- 含税总价 / 不含税总价 / 税点总价：对明细 `wxab05`、`wxab04` 按单号分组 `SUM`（多行时即为各金额之和，与「逐行累加」一致）

角色 `Sys_Roles.Permissions` 中需包含本菜单 path 及 `view` / `add` / `edit` / `audit` / `delete` 动作，否则接口 403、按钮由 `v-permission` 隐藏。
