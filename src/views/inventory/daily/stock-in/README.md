# 入库单

## 页面入口

- 菜单路径：`inventory/daily/stock-in`
- 页面文件：`src/views/inventory/daily/stock-in/index.vue`
- 后端接口前缀：`/api/stock-in`

## 已完成功能

- 列表查询：支持分页、关键词、入库单号、入库类型、仓库、待审核切换和回收站切换。
- 只读详情：可查看主表信息和明细清单。
- 新增/编辑：支持其他入库、采购入库、外协入库、外协退料、生产入库、生产退料、销售退货、盘盈入库。
- 明细录入：无来源类型可手工选料；有关联单据类型可从关联单据批量带入明细。
- 金额联动：按不含税单价、税点、数量计算含税单价和两套金额；不含税模式下税点强制为 0。
- 审核/反审核：审核后进入库存统计口径，反审核后退出库存统计口径。
- 删除/恢复/彻底删除：已审核单不能直接删除，必须先反审核；彻底删除只允许超级管理员。
- 打印：打印主表、明细和合计；价格字段受 `price` 权限控制。
- 待开发占位：导出信息、超量入库配置。

## 后端接口

- `GET /api/stock-in/list`：列表分页，SQL 使用 `ROW_NUMBER()`，兼容 SQL Server 2008 R2。
- `GET /api/stock-in/:id`：详情。
- `GET /api/stock-in/suggest-doc-no`：建议入库单号；最终单号仍以后端保存结果为准。
- `GET /api/stock-in/warehouse-options`：仓库候选。
- `GET /api/stock-in/related-party-options`：供应商、外协客户、车间、客户候选。
- `GET /api/stock-in/source-options`：关联单据候选。
- `GET /api/stock-in/source-lines`：关联单据明细。
- `GET /api/stock-in/material-options`：手工物料候选。
- `GET /api/stock-in/print-data`：打印数据。
- `GET /api/stock-in/inventory-summary`：入库库存统计口径。
- `POST /api/stock-in`：新增。
- `PUT /api/stock-in/:id`：编辑。
- `POST /api/stock-in/:id/audit`：审核。
- `POST /api/stock-in/:id/unaudit`：反审核。
- `POST /api/stock-in/:id/restore`：恢复。
- `DELETE /api/stock-in/:id`：软删除。
- `DELETE /api/stock-in/:id/hard`：彻底删除。

## 数据库口径

- 主表：`UB_ERP_Stocks_Storage`
- 明细表：`UB_ERP_Stocks_Storage_list`
- 操作日志：`UB_Date_ERP_Operation_log`
- 物料快照：保存明细时由后端按 `kcaa01` 重新查询 `UB_ERP_Bom_000`，但数量、价格、备注、关联订单明细键不被覆盖。
- 库存统计：只统计已审核且未删除的入库明细 `kcao03`，待审核、已删除、反审核后的单据不计入。

## 第一版边界

- 不做审核不通过。
- 不做财务复核入口，只尊重已有 `sp_flag=1` 的只读锁定。
- 不做真实 Excel 导出，只保留入口。
- 不做超量入库豁免，只保留配置占位。
- 不做上游单据已入库数量反写。
- 不开放类型 `8` 加工入库新增和编辑，旧数据只读展示。

## 已知问题 / 下一步

- 关联单据候选和明细字段按旧表常用字段接入；若内网实际字段名与当前环境不同，需要按真实表结构补一版兼容映射。
- 第一版批量添加在当前页弹窗完成，没有另开独立窗口。
- 后续真实导出需要由后端生成 Excel，并继续遵守价格权限。
