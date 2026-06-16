# 外协报价（主从）

## 页面入口（双标签）

- 顶栏 **「管理外协报价」**：搜索、列表、分页、查看/审核/删除等（与改前列表能力一致）。
- 顶栏 **「外协报价添加」**：页内嵌表单（基础资料 + 明细两个 Tab），不再用大弹窗录单；需 `add` 权限。
- 列表点 **「编辑」**：自动切到添加侧表单区，标题为「编辑外协报价」；保存成功后回到管理列表并刷新。
- 从「添加」切回「管理」再切回「添加」时，**未保存的新增草稿会尽量保留**（与外协订单一致）。
- 「查看」「BOM 资料」仍为只读弹窗，本次未改。

- 主表：`UB_ERP_assist_offer`（单号 `wxaa01`）
- 明细：`UB_ERP_assist_offer_list`（关联列 `wxab01` = 主表 `wxaa01`；金额 `wxab04` 不含税、`wxab05` 含税）
- 后端：`server/outsourcingQuotationHandlers.js`，路由前缀 `/api/supply-chain/outsourcing-quotations`
- 路由/菜单 path：`supply-chain/daily/outsourcing-quote`
- 选材：复用 `../purchase-quote/MaterialSelector.vue`（BOM 列表权限与采购报价一致）
- 币别：下拉三项（001 人民币 / 002 美元 / 003 港元）；保存 **`wxaa05`**=码、**`rmb`**=名称。
- 物理表与外协订单「批量添加自动带单价」同源（`server/assistOrderBatchAdd.js` 读取同一对表）。

## 列表汇总

- 总项数：在册明细行数
- 含税总价 / 不含税总价 / 税点总价：对明细 `wxab05`、`wxab04` 按单号分组 `SUM`（多行时即为各金额之和，与「逐行累加」一致）

角色 `UB_ERP_System_role.Permissions` 中需包含本菜单 path 及 `view` / `add` / `edit` / `audit` / `delete` 动作，否则接口 403、按钮由 `v-permission` 隐藏。
