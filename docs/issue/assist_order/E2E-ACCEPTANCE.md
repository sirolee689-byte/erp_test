# 外协订单模块第一版验收记录

日期：2026-06-09

## 验收范围

- 01-09 开发任务的第一版纵向闭环：列表读取、新增/编辑、明细金额、额外费用、审核/反审/结案/反结案、删除/恢复、列表筛选汇总展开、打印数据和权限映射。
- 数据库语法按 SQL Server 2008 R2 约束实现，分页使用 `ROW_NUMBER()`，未使用 `OFFSET/FETCH`。

## 已跑自动化命令

- `node --test server\assistOrderFeeSave.test.mjs server\assistOrderHandlers.test.mjs server\assistOrderPermission.test.mjs`
- `node --test server\assistOrderLifecycle.test.mjs server\assistOrderHandlers.test.mjs server\assistOrderPermission.test.mjs`
- `node --test server\assistOrderPrintData.test.mjs server\assistOrderPrintRoute.test.mjs server\assistOrderActionMap.test.mjs server\assistOrderPermission.test.mjs server\assistOrderListQuery.test.mjs`
- `node --check server\assistOrderPrintData.js; node --check server\assistOrderHandlers.js; node --check server\action_map.js`
- `npm run build`

结果：以上命令均通过。`npm run build` 仅出现项目已有的大 chunk 体积提示。

## 真实库冒烟

通过本地路由注册脚本直接调用真实数据库连接：

- `GET /api/assist-order/list?page=1&pageSize=3&sortBy=deliveryDate`
- `GET /api/assist-order/print-data?ids=1486&rowsPerPage=12&priceDecimals=2`

结果：

- 列表接口返回 `200`，总数 `4912`，首张单为 `WX17112102`。
- 打印数据接口返回 `200`，生成 1 张单的打印数据，自动分页为 5 页。

## 页面烟测

- 已启动 Vite 本地服务：`http://127.0.0.1:5173/`
- 使用 Playwright 打开 `http://127.0.0.1:5173/supply-chain/daily/outsourcing-order`
- 结果：当前无登录态，被路由守卫重定向到 `/login?redirect=/supply-chain/daily/outsourcing-order`，页面无前端控制台错误。

## 已覆盖的关键规则

- 默认列表查已审核、未删除；支持未审核、回收站、结案状态、外协商、外协类型、全字段关键词和排序。
- `wxaj03=0` 时关联单号可空；`wxaj03=1/2` 保存时必须填关联单号。
- 明细、额外费用保存采用整批重写。
- 额外费用不限 10 条，费用选项来自 `bom_000` 且 `kcaa05='FEE'`。
- 审核、反审、结案、反结案写 `UB_Date_ERP_Operation_log`。
- 已结案单据不能直接反审，必须先反结案。
- 打印第一版固定 `wxgs=0`，不显示 `Describe` 外协内容列。
- 打印颜色名称按 `Bom_colorcode.code/name` 查询。
- 打印金额按含税标记选择含税或不含税单价/金额，并把额外费用计入金额合计。
- 权限沿用 `view/add/edit/audit/delete`，打印归 `view`，结案/反结案归 `audit`。

## 未做或后续项

- 未接采购报价来源选材；第一版其他外协只做 `bom_000` 来源。
- 未做审核不通过。
- 未做浏览器原生新页打印；第一版使用当前页面弹窗预览和打印。
- 打印设置表目前读取每页行数；单价小数位第一版通过打印弹窗参数控制，后续可补按用户保存。
- 本记录未包含登录态下的完整浏览器人工流程截图，最终上线前建议用测试账号走一遍新增、保存、审核、结案、打印、反结案、反审、修改、删除、恢复。

## 测试账号

- 自动化和数据库冒烟未使用前端登录账号。
- 浏览器人工验收建议使用具备 `supply-chain/daily/outsourcing-order` 的 `view/add/edit/audit/delete` 权限账号，并在调整权限后重新登录。
