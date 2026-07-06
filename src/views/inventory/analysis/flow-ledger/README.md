# 材料流水账

路径：`/inventory/analysis/flow-ledger`

## 功能说明

- 材料流水账用于查询某一个具体物料在指定日期范围、指定仓库下的库存流水变化。
- 本页不是入库统计表、出库统计表，也不是库存余额表；核心是第一行显示上期结存，后续按时间顺序显示每笔入库、出库后的结存。
- 顶部按钮对齐出库统计表：打印统计报表、查询内容、列设置、导出信息。

## 查询条件

- 必填：开始日期、结束日期、仓库、物料编码。
- 仓库默认取“货仓”，只支持具体仓库，不支持全部仓库。
- 弹窗不显示物料唯一码；物料编码用远程联想选择，候选只显示物料编码，后端按明细 `kcaa01` 精确匹配。
- 物料名称、规格、单位由所选物料带出，只读展示。
- 材料分类支持多选；入库侧筛 `UB_ERP_Stocks_Storage_list.kcaa05`，出库侧筛 `UB_ERP_Stocks_out_list.kcaa05`。
- “包含采购在途”默认否；选择是时只显示采购在途行，不参与结存计算。

## 数据口径

- 入库来源：`UB_ERP_Stocks_Storage h` + `UB_ERP_Stocks_Storage_list l`，关联 `h.kcan01 = l.kcao01`。
- 出库来源：`UB_ERP_Stocks_out h` + `UB_ERP_Stocks_out_list l`，关联 `h.kcap01 = l.kcaq01`。
- 入库、出库均只统计主表已审核 `pass=1`、主从未删除 `del=0` 的数据；明细表不再按 `pass=1` 过滤，确保截止到同一天时结存能对齐库存统计表“账存数量”。
- 入库日期用 `h.kcan02`，入库数量用 `l.kcao03`。
- 出库日期用 `h.kcap02`，出库数量用 `l.kcaq03`。
- 不使用旧系统真实中间表 `UB_ERP_Stocks_acc`，也不会清空或写入该表。
- 上期结存 = 查询开始日期之前已审入库合计 - 查询开始日期之前已审出库合计。
- 区间流水按日期升序、方向、单号、明细 id 排序，结束日期按次日零点前统计，后端逐行滚动计算结存。
- 注释列统一显示 `单号、类别、PO/PI、关联单号`，不拼接备注内容。

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/material-flow-ledger/print-header` | 读取打印抬头 |
| GET | `/api/material-flow-ledger/warehouse-options` | 仓库候选 |
| GET | `/api/material-flow-ledger/material-options` | 物料编码候选 |
| GET | `/api/material-flow-ledger/category-options` | 材料分类候选 |
| GET | `/api/material-flow-ledger/report` | 拉取材料流水账 |

## 权限

- 查看接口走 `inventory/analysis/flow-ledger:view`。
- 导出按钮走 `inventory/analysis/flow-ledger:export`。
- 第一版不显示单价、金额，不做 `price` 权限。

## 已知边界

- 第一版必须选择物料编码后才能查询，不做默认全物料流水。
- 第一版采购在途只作为附加展示行，不改变实际结存。
- 第一版不新增数据库表、字段、索引。
