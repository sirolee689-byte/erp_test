# 进销存统计报表

路径：`/inventory/analysis/stock-io-stats`

## 功能说明

- 进销存统计报表是期间汇总报表，按“仓库 + 物料”统计上期结存、本期入库、本期出库、本期补数、本期盈亏、本期结存。
- 本页不是库存实时余额表、不是入库/出库明细表，也不是材料流水账。
- 顶部按钮对齐出库统计表：打印统计报表、查询内容、列设置、导出信息。
- 查询条件：统计开始日期、统计结束日期、仓库、物料编码、物料名称、规格、材料分类。
- 开始日期、结束日期、仓库必填；物料条件为空时统计当前仓库和筛选条件下所有有发生或有结存的物料。
- 仓库默认“货仓”；第一期只支持具体仓库，不支持“全部仓库”。

## 数据口径

- 数据来源：`UB_ERP_Stocks_Storage` + `UB_ERP_Stocks_Storage_list`、`UB_ERP_Stocks_out` + `UB_ERP_Stocks_out_list`、`UB_ERP_Bom_000`、`New_UB_ERP_Stocks_material`、`UB_ERP_Stocks_colorcode`。
- 主表要求 `del=0/pass=1`；明细要求 `del=0`，不按明细 `pass` 过滤，保持与库存统计表“账存数量”口径一致。
- 日期按自然日：开始日 `00:00:00` 到结束日次日 `00:00:00` 之前。
- 行来源先从已审核入库/出库流水聚合出 `仓库 + kcaa01`，再反查最新有效物料资料、分类和颜色。
- 上期结存数量 = 开始日前历史已审核入库数量 - 历史已审核出库数量。
- 上期结存单价取开始日前最近一笔有效入库单价；找不到时按 0 并提示“缺少上期成本单价”。
- 本期入库数量 = 入库 `kcan03 in (1,2,0,5)` 数量 - 出库 `kcap03=1` 数量；金额同口径相减。
- 本期出库数量 = 出库 `kcap03 in (4,0,10,7,2)` 数量 - 入库 `kcan03 in (3,4)` 数量。
- 本期补数数量 = 出库 `kcap03=8` 数量。
- 本期盈亏数量 = 入库 `kcan03=7` 数量 - 出库 `kcap03=9` 数量；金额同口径相减。
- 本期结存数量 = 上期结存 + 本期入库 - 本期出库 - 本期补数 + 本期盈亏；结存数量小于等于 `0.01` 时结存数量、单价、金额按 0 显示。

## 权限

- 查看接口走 `inventory/analysis/stock-io-stats:view`。
- 单价、金额、结存金额等成本字段走 `inventory/analysis/stock-io-stats:price`；管理员始终可见。
- 导出按钮走 `inventory/analysis/stock-io-stats:export`。
- 无价格权限时，页面、打印、导出不显示价格/金额列，后端也不返回金额字段。

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/stock-io-stats/print-header` | 读取打印抬头 |
| GET | `/api/stock-io-stats/warehouse-options` | 仓库候选 |
| GET | `/api/stock-io-stats/material-options` | 物料编码候选 |
| GET | `/api/stock-io-stats/category-options` | 材料分类候选 |
| GET | `/api/stock-io-stats/report` | 拉取进销存统计报表 |

## 已知边界

- 本期不支持全部仓库；后续如支持，必须按仓库分组展示。
- 本期不新增表、不新增索引、不写月结成本、不更新历史统计结果。
- 异常提示只用于核对，不阻止报表显示。
