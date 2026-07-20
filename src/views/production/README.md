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
| `production/daily/dispatch` | 派工单 |

> 2026-07：已从菜单移除占位入口（预留单 / 工序编码 / 生产计划 / 工时汇报）。

### 统计分析（`production/analysis/*`）

| path | 页面 |
|------|------|
| `production/analysis/report-stats` | 生产领用统计表（明细报表，见本目录 README） |
| `production/analysis/pi-shortage-analysis` | PI欠料分析（占位） |
| `production/analysis/material-sheet` | 物料单 |

## 权限说明

角色「分配权限」中的 path 须与上表一致。若仍使用旧 path（如 `production/dispatch`），迁后需在角色管理中按新 path 重新勾选。

## 生产领用统计表

- 入口：生产管理 → 统计分析 → 生产领用统计表（`production/analysis/report-stats`）。
- 详见 [`analysis/report-stats/README.md`](analysis/report-stats/README.md)。

## 物料单

- 入口：生产管理 → 统计分析 → 物料单（`production/analysis/material-sheet`）。
- 数据来源：销售订单点击「一键运算」后写入的 `UB_ERP_Bom_pi_cost` / `UB_ERP_Bom_pi_consumption`。
- 查询入口：明细/汇总用「查询内容」打开选 PI 弹窗；外协清单 / 位置裁片清单用条件弹窗（日期必填，PI/PO 可选）。
- 工具栏：`打印统计报表 / 查询内容 / 列设置 / 导出信息`（外协清单与位置裁片清单隐藏列设置）。
- 第一行模式按钮：`物料单统计表（明细）`、`物料单统计表（汇总）`、**外协清单**、**位置裁片清单**；未选中白底，选中蓝色。
- **外协清单**：只读报表，按销售订单日期/PI/PO 取外协材料（`pi_cost.kcaa13=1`）；厂款号用销售明细 `kcaa01` 对 `pq`；支持打印与 Excel，不做 PDF。详见 [`analysis/material-sheet/README.md`](analysis/material-sheet/README.md)。
- **位置裁片清单**：只读报表，Part1 为 `pi_cost` 全材料（不限 `kcaa13`）+ CUT 位置匹配，Part2 追加销售 BOM 下级 `kcaa13=1`；厂款底部合计；支持打印与 Excel，不做 PDF。
- 报表列新增「颜色」（在编码右侧），并且列设置会同步影响明细/汇总屏幕、打印和导出。
- 页面为报表形态；切换 ERP 顶栏其它页签再返回时，由 **keep-alive**（组件名 `production-analysis-material-sheet`）保留状态；右键标签「刷新」会清空缓存。
- **导出信息**：仅导出**当前模式**（明细/汇总/外协清单/位置裁片清单），ExcelJS 生成文件；不做 PDF。
- **打印统计报表**：仅打印**当前模式**；A4 纵向、隐藏侧栏与工具条。
- 明细按成品款 `pq` 分段；汇总按整张 PI 合并；外协清单/位置裁片清单按 PI→厂款→材料分层。
- 字段口径补充：颜色列取 `UB_ERP_Bom_pi_cost.kcaa11`，再关联 `UB_ERP_Stocks_colorcode` 显示「编码,中文名」；搭配列优先 `bnfo` 再回退 `Describe`。
- 「单物料合计」仅明细页签有；汇总、外协清单与位置裁片清单不显示。
- 明细抬头厂款号仍为 `kcaa09`（与外协/裁片清单的厂款号=`kcaa01` 口径不同，刻意保留）。
- 未运算销售订单没有有效物料单；需要先回销售订单执行「一键运算」。
