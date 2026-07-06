# 生产领用统计表

路径：`/production/analysis/report-stats`

## 功能说明

- 入口：生产管理 → 统计分析 → 生产领用统计表。
- 页面第一行是两个切换按钮：`生产领用统计表（明细）`、`生产领用统计表（汇总）`。
- 默认进入 `生产领用统计表（明细）`；`生产领用统计表（汇总）` 相当于同页面内的汇总标签页。
- 第二行工具栏统一为：`打印统计报表`、`查询内容`、`列设置`、`导出信息`。
- 打印抬头继续读取系统打印设定，不单独写死公司信息。

## 查询条件

| 字段 | 必填 | 说明 |
|------|------|------|
| 统计开始/结束日期 | 是 | 默认开始日期为三年前当天，默认结束日期为当天；明细视图按所选统计标准处理；汇总视图按销售订单日期筛 PI |
| 仓库 | 是 | 使用用户选择的仓库编码，不硬编码固定仓库 |
| 统计标准 `chooses` | 明细必填 | 默认 `1` 销售订单 PI 时间；`2` 出库单时间；汇总视图固定按销售订单 PI 时间 |
| PI/PO号 | 否 | 可输入多个 PI，多个 PI 用英文逗号分隔；为空时前端提示查询范围可能较大；选择弹窗只按 PI 号模糊查询，不按 PO号/客户搜索 |
| 物料编码 | 否 | 明细精确匹配；汇总按物料编码前缀过滤 |
| 只显示未领 | 汇总可选 | 默认否；开启后只显示 `未领数量 > 0` 的预算材料行 |

## 明细视图口径

- 来源：`UB_ERP_Stocks_out` + `UB_ERP_Stocks_out_list`，主从通过 `l.kcaq01 = h.kcap01` 关联。
- 主表 `del=0/pass=1`，明细 `del=0`。
- 出库类别固定 `kcap03 in (2,4,7,8)`。
- 仓库使用 `h.kcap06`。
- 物料编码按明细 `l.kcaa01` 精确匹配。
- `chooses=1`：日期作用在销售订单 `UB_ERP_Sales_order.xsaj02`，先取日期内 PI，再查 `h.kcap08` 匹配的出库明细。
- `chooses=2`：日期作用在出库主表 `h.kcap02`。
- 展示列：单号、日期、PI号、领用车间、材料编码、材料名称、材料规格、单位、领用数量、退料数量、实领数量、备注。
- 第一版明细里的退料数量固定 0，实领数量等于领用数量。

## 汇总视图口径

- 汇总视图不是逐条出库明细，而是按 `PI + 物料编码` 汇总。
- PI 来源：`UB_ERP_Sales_order`，只取 `pass=1/del=0`，销售订单日期 `xsaj02` 在开始日期到结束日期之间。
- 每个 PI 单独生成一张汇总表，表头显示 PI号、PO号、日期。
- 表头字段：PI号=`xsaj01`，PO号=`xsaj06`，日期=`xsaj02`。

### 预算数量

- 来源：`UB_ERP_Bom_pi_cost` + `UB_ERP_Sales_order_list`。
- 关联：`UB_ERP_Bom_pi_cost.sid = PI号`，`UB_ERP_Sales_order_list.xsak01 = sid`，`UB_ERP_Bom_pi_cost.pq = UB_ERP_Sales_order_list.kcaa01`。
- 预算数量：`SUM(UB_ERP_Bom_pi_cost.kcac06 * UB_ERP_Sales_order_list.xsak03)`。
- 汇总结果以预算数据为主表，所以预算有但还没领用的材料也会显示。

### 领用数量

- 来源：`UB_ERP_Stocks_out` + `UB_ERP_Stocks_out_list`。
- 出库类别：`kcap03 in (2,4,7,8)`。
- 出库单 `del=0`，审核状态包含已审核和未审核：`pass in (0,1)`。
- 仓库字段：`h.kcap06 = 当前选择仓库`。
- 日期字段：`h.kcap02` 在查询开始到结束日期内。
- PI字段：`h.kcap08 like 'PI%'`，且在当前 PI 范围内。
- 物料字段：`l.kcaa01` 按查询物料编码前缀过滤。

### 退料数量

- 来源：`UB_ERP_Stocks_Storage` + `UB_ERP_Stocks_Storage_list`。
- 入库类别：`kcan03 in (3,5)`。
- 入库单 `pass=1/del=0`，明细 `del=0`。
- 仓库字段：`h.kcan06 = 当前选择仓库`。
- 退料匹配：`h.kcan04 = PI号`，`l.kcaa01 = 物料编码`。
- 第一版按旧系统口径保留：退料统计不加日期范围过滤。

### 计算字段

- 实领数量：`领用数量 - 退料数量`。
- 未领数量：`预算数量 - 领用数量 - 退料数量`。
- 如果预算数量为 0，未领数量显示 0。
- 备注来源于符合领用口径的出库明细 `UB_ERP_Stocks_out_list.Describe`，多个备注用 `；` 分隔，展示时去掉英文逗号。

## 接口

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/api/production-issue-stats/print-header` | 打印抬头 |
| GET | `/api/production-issue-stats/warehouse-options` | 仓库候选 |
| GET | `/api/production-issue-stats/material-options` | 物料编码联想 |
| GET | `/api/production-issue-stats/pi-options` | PI 多选弹窗 |
| GET | `/api/production-issue-stats/report` | 明细/汇总主查询，靠 `viewMode=detail/summary` 区分 |

## 权限

- 菜单路径：`production/analysis/report-stats`
- 动作：`view`、`export`

## 已知边界

- 汇总视图第一版不分页，查询结果上限 50000 行。
- 退料数量按旧系统口径不加日期范围；如后续要改为按退料日期过滤，需要单独确认。
- 汇总视图只以预算材料为基础；没有预算但有领用的材料第一版不单独补行。
