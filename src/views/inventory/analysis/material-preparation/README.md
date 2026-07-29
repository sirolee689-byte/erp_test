# 材料备料表

路径：`/inventory/analysis/material-preparation`

## 四种模式

- 物料单备料表（分PI）：按材料横向展示各 PI 的 BOM 备料数量和合计。
- 物料单备料表（分配件）：按 `PI + pq产品编码 + 材料` 显示一行，每个不同的 `top_kcaa02` 动态生成一个配件数量列；每列数量为 `SUM(kcac06 * temp)`，合计为所有配件列之和。
- 分配件模式提供“产品编码筛选”和“配件列筛选”。产品编码可模糊搜索并多选需要保留的 `pq` 产品；配件列可按 `top_kcaa02` 模糊搜索并多选需要显示的动态列。
- 两个筛选条件共同作用于页面、打印和 xlsx 导出：只保留所选产品编码的材料行及所选配件列，隐藏所选列数量全部为 0 的材料行，“筛选合计”按当前可见配件列重新计算。
- 出库单备料表（分PI）：按材料横向展示各 PI 的已审核实际出库数量和合计。
- 出库单备料表（分配件）：实际出库先按 `PI + 材料` 汇总，再按同 PI BOM 的配件需求占比分摊。

## 查询与数据口径

- 查询条件只有 PI 号，必填并支持多选。
- PI 候选只来自已审核、未删除销售订单，搜索框只按 PI 号模糊查询。
- 物料单来源为 `UB_ERP_Bom_pi_cost`，只取 `del=0/isok=1/kcaa12=1`。
- BOM 备料数量为 `SUM(kcac06 * temp)`；`temp` 为空或非法时按 `1`，不再乘销售订单数量。
- 物料单分配件模式按当前 PI、`pq` 产品编码、材料编码、`top_kcaa02` 配件名称分别汇总；同一材料属于多个配件时分别显示，不拆分、不合并到单一配件。
- 出库单来源为已审核、未删除出库主表及未删除、需备料的明细，不限制出库类别。
- 出库 PI 按 `kcap04` 或 `kcap08` 匹配，数量直接汇总 `kcaq03`。
- 分配件结果保留 6 位小数，最后一个配件承接尾差；无法匹配的数量进入“未匹配配件”。
- 报表不读取或扣减库存，不写入数据库或真实中间表。

## 接口与权限

- `GET /api/material-preparation/print-header`
- `GET /api/material-preparation/pi-options`
- `GET /api/material-preparation/report`
- 查看与打印：`inventory/analysis/material-preparation:view`
- 导出：`inventory/analysis/material-preparation:export`
