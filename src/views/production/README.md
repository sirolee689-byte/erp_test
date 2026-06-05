# 生产管理模块

菜单与路由以根目录 **`erp_structure_dump.json`** 为准（与侧栏、角色权限树同源）。

## 菜单结构

| 层级 | path 前缀 | 说明 |
|------|-----------|------|
| 一级 | `production` | 生产管理 |
| 二级 | `production/daily` | 日常工作 |
| 二级 | `production/analysis` | 统计分析 |

### 日常工作（`production/daily/*`）

| path | 页面 |
|------|------|
| `production/daily/reserve-order` | 预留单 |
| `production/daily/process-code` | 工序编码 |
| `production/daily/plan` | 生产计划 |
| `production/daily/dispatch` | 派工单 |
| `production/daily/work-hour-report` | 工时汇报（占位） |

### 统计分析（`production/analysis/*`）

| path | 页面 |
|------|------|
| `production/analysis/report-stats` | 生产领用统计表 |
| `production/analysis/pi-shortage-analysis` | PI欠料分析（占位） |
| `production/analysis/material-requirement-stats` | 物料需求统计（占位） |
| `production/analysis/labor-cost-analysis` | 工时工费分析（占位） |
| `production/analysis/material-sheet` | 物料单 |
| `production/analysis/production-status-report` | 生产情况表（占位） |
| `production/analysis/work-hour-status-report` | 工时情况表（占位） |

## 权限说明

角色「分配权限」中的 path 须与上表一致。若仍使用旧 path（如 `production/dispatch`），迁后需在角色管理中按新 path 重新勾选。

## 物料单

- 入口：生产管理 → 统计分析 → 物料单（`production/analysis/material-sheet`）。
- 数据来源：销售订单点击「一键运算」后写入的 `UB_ERP_Bom_pi_cost` / `UB_ERP_Bom_pi_consumption`。
- 页面顶部只按 PI 号搜索；`GET /api/sales-order/pi-suggest` 仅返回已审核在册销售订单的 PI 候选，候选下拉只显示 PI 号。
- 页面为报表形态；切换 ERP 顶栏其它页签再返回时，由 **keep-alive**（组件名 `production-analysis-material-sheet`）保留 PI 号、查询结果与明细/汇总子标签状态；右键标签「刷新」会清空缓存。
- **导出为 xls 信息**：仅导出**当前子标签**（明细或汇总），ExcelJS 生成 A4 纵向 `.xls`，默认文件名 `物料单-{PI号}.xls`；数值与屏上展示口径一致，不加表尾合计行。
- **打印统计报表**：仅打印**当前子标签**；A4 纵向、隐藏侧栏与工具条，左上角显示打印时间，页码 `当前页/总页数`（Chrome/Edge 较稳定）。打印预览、导出 PDF、保存报表仍为占位。
- 页面分两个标签页：`物料单统计表（明细）`、`物料单统计表（汇总）`。明细按成品款 `pq` 分段，每段抬头从销售订单主从表按 PI 号关联读取；每段内容对标 BOM 资料「成本BOM用量表」，读取 `UB_ERP_Bom_pi_cost`，按 `px` 有值优先、`px` 升序、`id` 稳定排序；汇总按整张 PI 合并展示，抬头仅 PI号 / PO号 / 日期（取订单首行，同主表字段 `xsak01`、`xsaj06`、`xsaj02`）。
- 明细抬头字段：PI号=`UB_ERP_Sales_order_list.xsak01`、PO号=`UB_ERP_Sales_order.xsaj06`、日期=`UB_ERP_Sales_order.xsaj02`、厂款号=`UB_ERP_Sales_order_list.kcaa09`、名称=`UB_ERP_Sales_order_list.kcaa02`、客款号=`UB_ERP_Sales_order_list.kcaa06`、组别=`UB_ERP_Sales_order_list.kcaa10`、订单量=`xsak03`（为空用 `plan_quantity`）；单品用量本期留空。
- 展示口径（库内 `pi_cost` 仍存单品用量，不乘订单量）：明细表「用量」「合计」= 单品值 × 该款订单量；「损耗」为损耗率不乘；「单物料合计」= 合计 ÷ 该款订单量（即单品合计 `kcac06`）。汇总表由接口按各款订单量缩放后全 PI 合并；「用量」「合计」为订料数，「单物料合计」= 合计 ÷ 全 PI 订单量之和。
- 未运算销售订单没有有效物料单；需要先回销售订单执行「一键运算」。
