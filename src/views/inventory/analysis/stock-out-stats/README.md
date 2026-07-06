# 出库统计表

路径：`/inventory/analysis/stock-out-stats`

## 功能说明

- 出库统计表按出库单明细逐条展示，不是库存结存表，也不按物料汇总余额。
- 顶部按钮对齐入库统计表：打印统计报表、查询内容、列设置、导出信息。
- 查询条件包含统计开始日期、统计结束日期、仓库、出库类别、材料代码、材料名称、材料规格、材料分类、关联单位。
- 开始日期、结束日期、仓库必填；仓库默认货仓，也可以选择全部仓库。
- 页面只展示真实明细行和底部总计行，不显示仓库分组首行，也不生成仓库小计行。
- 材料代码候选显示材料编码，但实际提交物料唯一码 `systemcode` 做精确过滤。
- 材料分类支持多选，后端按多个分类编码过滤。

## 数据口径

- 来源表：`UB_ERP_Stocks_out` + `UB_ERP_Stocks_out_list`。
- 关联关系：明细 `kcaq01 = kcap01`。
- 基础条件：主表 `del=0`、明细 `del=0`、出库日期 `kcap02` 落在开始日 00:00:00 到结束日 23:59:59。
- 本报表不强制 `pass=1`，未审核和反审未审记录都展示，状态列按 `pass` 显示。
- 数量列取实际出库数量 `kcaq03`。
- 单价、金额、含税单价、含税金额取 `kcaq04/kcaq05/kcaq041/kcaq051`。
- 备注优先取明细 `Describe`，为空时取主表 `remark`。
- 出库类别只显示已确认编号：`1` 采购退货、`2` 外协出库、`3` 外协退货、`4` 生产领料、`6` 销售出库、`7` 生产领料、`8` 报损、`9` 盘亏；`0/5` 暂显示未知类别，不擅自命名。

## 权限

- 查看接口走 `inventory/analysis/stock-out-stats:view`。
- 单价、金额、含税单价、含税金额走 `inventory/analysis/stock-out-stats:price`；管理员始终可见。
- 导出按钮走 `inventory/analysis/stock-out-stats:export`。
- 无价格权限时，页面、打印、导出不显示价格列，后端也不返回金额字段。

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/stock-out-stats/print-header` | 读取打印抬头 |
| GET | `/api/stock-out-stats/warehouse-options` | 仓库候选 |
| GET | `/api/stock-out-stats/material-options` | 物料编码候选 |
| GET | `/api/stock-out-stats/category-options` | 材料分类候选 |
| GET | `/api/stock-out-stats/related-party-options` | 关联单位候选 |
| GET | `/api/stock-out-stats/report` | 拉取出库统计表 |

## 已知边界

- 第一阶段不做分页虚拟滚动，和入库统计表一样一次查询生成完整报表。
- 第一阶段不新增数据库表、字段、索引。
- 旧系统提到仓库分组和小计，本页第一阶段只保留总计，跟入库统计表保持一致。
