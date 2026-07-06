# 入库统计表

路径：`/inventory/analysis/stock-in-stats`

## 功能说明

- 入库统计表按入库单明细逐条展示，不是库存结存表，也不按物料汇总余额。
- 顶部按钮对齐库存统计表：打印统计报表、查询内容、列设置、导出信息。
- 查询条件包含统计开始日期、统计结束日期、仓库、入库类别、材料代码、材料名称、材料规格、材料分类、关联单位。
- 开始日期、结束日期、仓库必填；仓库默认货仓，也可以选择全部仓库。
- 查询结果不再显示单独的“仓库：001 货仓”分组首行，也不再生成仓库小计行；页面只展示真实明细行和底部总计行。
- 页面、打印和导出均不展示“调拨数量”列；后端返回字段暂保留，不扩大接口改动。

## 数据口径

- 来源表：`UB_ERP_Stocks_Storage` + `UB_ERP_Stocks_Storage_list`。
- 关联关系：明细 `kcao01 = kcan01`。
- 基础条件：主表 `del=0`、明细 `del=0`、入库日期 `kcan02` 落在开始日 00:00:00 到结束日 23:59:59。
- 本报表不强制 `pass=1`，未审核和反审未审记录都展示，审核状态列按 `pass` 显示。
- 数量列取实际入库数量 `kcao03`；`kcao031` 是原始数量/可入库上限，不作为报表展示数量。
- 调拨数量第一期不展示；如后续恢复，旧口径为 `kcao031 - kcao03`。
- 入库类别按旧系统编号显示，`0` 和 `9` 都显示其他入库。

## 权限

- 查看接口走 `inventory/analysis/stock-in-stats:view`。
- 单价、金额、含税单价、含税金额走 `inventory/analysis/stock-in-stats:price`；管理员始终可见。
- 导出按钮走 `inventory/analysis/stock-in-stats:export`。

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/stock-in-stats/print-header` | 读取打印抬头 |
| GET | `/api/stock-in-stats/warehouse-options` | 仓库候选 |
| GET | `/api/stock-in-stats/material-options` | 物料编码候选 |
| GET | `/api/stock-in-stats/category-options` | 材料分类候选 |
| GET | `/api/stock-in-stats/related-party-options` | 关联单位候选 |
| GET | `/api/stock-in-stats/report` | 拉取入库统计表 |
