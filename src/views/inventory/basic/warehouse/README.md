# 仓库编码（库存基本资料）

## 已完成功能

- 列表：`GET /api/inventory/warehouse/list`，物理表 `UB_ERP_Stocks_warehouse`；`ROW_NUMBER()` 分页（SQL Server 2008 R2）；默认 **每页 20**、按 **`code ASC, id ASC`**；默认只查 **`del=0` 且 `pass=1`**。
- 开关：「显示未审核」→ `pass=0`；「回收站」→ `del=1`（与未审互斥）。
- 搜索：关键字同时模糊 `code` / `name` / `info` / `ename`（参数化 `LIKE`）。
- 新增：`POST /api/inventory/warehouse`；后端生成 **`systemcode`**；**`code` 全表唯一**（含已逻辑删除）；默认 `pass=0`、`del=0`；未传 LOGO 时不写 `logo` 列（保留库默认值）。
- 编辑：`PUT /api/inventory/warehouse`；**仅未审在册**可改；`systemcode`/`code` 只读；**不覆盖 `addtime`**，只写 `edittime`/`ip`（真表无 `eid/euname/eutruename/uptime`）。
- 查看详细：`GET /api/inventory/warehouse/:systemcode`。
- 审核 / 反审：`PUT .../audit`、`PUT .../unaudit`（body `{ systemcode }`）；写 `pass` + `passuid`/`passuname`。
- 批量审核：`PUT .../audit-batch`，将全部 `del=0 AND pass=0` 一次审为 `pass=1`；二次确认并提示处理数量。
- 逻辑删除 / 恢复：`DELETE .../:systemcode`（已审禁止）、`PUT .../restore`；不做彻底删除、不做打印、**不做 Excel 导入**。
- 参管人员：`GET .../user-options`（`UB_ERP_User`：`del=0` `pass=1`）；保存 `ename`（`Usercode` 分号串）+ `etname`；列表批量解析姓名，禁止 N+1。
- **出入库联动（2026-07）**：`ename` 同时作为入库单/出库单「仓库」下拉与保存权限依据——只有参管名单里的账号能看见并选用该仓；**空参管仓对任何人都不可选**；逻辑在 `server/warehouseManagerAccess.js`，候选接口与保存共用。
- 导出：前端 ExcelJS 导出**当前页列表**（权限 `export`）。
- 操作日志：新增、修改、审核、反审、批量审核、删除、恢复登记为中央白名单，经 `operationAuditMiddleware` 写入 `UB_Date_ERP_Operation_log`。

## 权限（按钮级）

- 菜单 path：`inventory/basic/warehouse`
- `view`：列表 / 详情 / 参管人选
- `add`：新增
- `edit`：未审保存、回收站恢复
- `delete`：逻辑删除
- `audit`：单条审核、批量审核
- `unaudit`：反审
- `export`：导出当前列表

## 数据库说明

- 定位键一律用 **`systemcode`**，不用仓库名称。
- 布尔字段 `negative` / `pd` / `ks` 为 `int` 的 `0/1`。
- `logo` 默认 HTML：`<img src="/images/logo.png" border="0">`；界面用多行文本编辑 HTML + 预览，未新装富文本组件。
- 修改不写 `eid` 等列：当前物理表无这些字段，禁止擅自 DDL。

## 已知问题 / 下一步

- 本期不做 Excel 导入（旧规则「编码+名称」与手工新增「编码全表唯一」不一致，若以后要做须单独定稿）。
- 已审核行不可直接改；须先反审。
- 导出仅为当前页，非全库导出。
- 出入库选仓只认 `ename` 名单；仓库编码里不配参管，则出入库单下拉选不到该仓（含空参管的车间仓）。
