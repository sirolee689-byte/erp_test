# 出库单模块

## 页面范围

- 管理出库单：查询、查看、编辑、审核、反审核、删除、回收站恢复、彻底删除、打印数据入口。
- **列表默认只显示已审核**（`pass='1'`）；打开「显示未审核」或点顶部「审核申请」才看待审核单。
- **列表筛选区两行布局**与入库单一致：第一行「供应商/外协商 + 出库类型」，第二行「关键词 + 查询 + 回收站/显示未审核开关 + 重置」；输入框宽度 240 / 160 / 420 px。
- 出库单添加：分为“出库单基础资料”和“出库单明细”两个区域，布局参考入库单。
- **基础资料行序**（2026-06-24）：①出库单号 ②出库日期 ③出库类型 ④关联单号 ⑤关联单位 ⑥仓库+纸质单号+预留单号（同行三框等宽）⑦是否含税 ⑧备注。
- **出库类型按钮**与入库单一致：`size="large"` + `stock-type-btn`（高 42px、字号 16px、间距 10px）。
- **表单无「返回列表」**：回列表用顶部「管理出库单」；保留「重置」「保存」。
- **出库日期**新增默认本机当前时间（与入库单 `nowText` 一致，不用 UTC `toISOString`）。
- **纸质单号 / 预留单号**：分别落库 `kcap08` / `kcap09`（原 `kcap08` 上的 PI/PO 类旧数据会显示在纸质单号）。
- 第一版开放类型：0 其他出库、1 采购退货、2 外协领料、3 外协退货、4 生产领料、5 生产返修、6 成品出库、7 生产领料计划外、8 生产领料补数、9 盘亏出库、10 销售出库。
- **列表状态列**仅显示「已审核 / 待审核」，不再单独展示「只读类型」等标签。
- **不做财务复核**：出库主表 `UB_ERP_Stocks_out` 无 `sp_flag` 字段，界面与接口均不提供复核入口。

## 关键业务规则

- 新增默认未审核，系统不支持自动审核。
- 出库单号 `kcap01` 在保存时生成，前端只展示，不允许手工改。
- 明细不能任意手填物料，必须来自库存或来源单据选择。
- 未审核出库占用可用库存；审核后变成正式出库；反审核后重新回到未审核占用。
- 已结案旧数据仍禁止编辑、审核、反审核、删除（操作列可能显示「只读」）；界面状态列不单独展示结案标签。
- 审核/反审核会同步来源明细已出数量：
  - 采购退货：`UB_ERP_Buy_order_list.kcak07`
  - 外协领料/外协退货：`UB_ERP_assist_order_list.wxak08`
  - 生产领料：`UB_ERP_Dispatch_order_list.scak04`
  - 生产返修：`UB_ERP_Dispatch_order_list.scak05`
  - 成品出库：`UB_ERP_Sales_order_list.xsak06`

## 主要接口

- `GET /api/stock-out/list`
- `GET /api/stock-out/detail/:id`
- `GET /api/stock-out/suggest-no`
- `GET /api/stock-out/warehouse-options`
- `GET /api/stock-out/list-related-party-options`
- `GET /api/stock-out/related-party-options`
- `GET /api/stock-out/material-options`
- `GET /api/stock-out/inventory-summary`
- `GET /api/stock-out/source-lines`
- `GET /api/stock-out/print-data`
- `POST /api/stock-out`
- `PUT /api/stock-out/:id`
- `POST /api/stock-out/:id/audit`
- `POST /api/stock-out/:id/unaudit`
- `POST /api/stock-out/:id/restore`
- `DELETE /api/stock-out/:id`
- `DELETE /api/stock-out/:id/hard`

## SQL 兼容约束

本模块 SQL 必须兼容 SQL Server 2008 R2：

- 分页使用 `ROW_NUMBER()`。
- 不使用 `OFFSET`、`TRY_CONVERT`、`FORMAT`、`IIF`、`CONCAT`、`SEQUENCE`。

## 当前注意点

- 来源选择页第一版已保留接口入口，复杂的来源弹窗和 Excel 样式打印可继续单独增强。
- 改后端后需要用户手动重启 API 服务，Agent 不自动重启。
