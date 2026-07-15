# 出入库统计表

路径：`/inventory/analysis/stock-movement-stats`

- 按指定日期、仓库把已审核且未删除的入库、出库明细用 `UNION ALL` 合并为日期升序流水；不写入 `UB_ERP_Stocks_acc`。
- 查询条件为开始日期、结束日期、仓库、物料编码、按方向分组的收发类别多选和材料分类多选。仓库默认货仓并可选择全部仓库，日期默认最近三个月。物料编码可从联想列表选择，也可直接填写正确编码；前者按 `systemcode` 精确筛选，后者按入库、出库明细 `kcaa01` 精确筛选。
- 价格列受 `inventory/analysis/stock-movement-stats:price` 控制；导出受 `export` 控制；页面查询走 `view`。
- 打印、列设置、xlsx 导出均使用当前查询条件和可见列。
