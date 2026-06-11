# 颜色编码（库存基本资料）

## 已完成功能

- 列表：`GET /api/inventory/color-code/list`，物理表 `Bom_colorcode`；`ROW_NUMBER()` 分页（SQL Server 2008 R2）；默认 **每页 20**、按物理列 **`intime` 降序**（接口字段名仍为 `in_time` 供前端展示）；每行返回 **`ename`、`info`**（供未审列表编辑回填）。
- 新增：`POST /api/inventory/color-code`，body `{ code, name, ename?, info? }`；**`intime`** 写入**当天本地日历日 00:00:00**（`datetime`）；列表 **`in_time`** 格式为 **`yyyy/M/d`**（月日不补零，如 **`2017/9/1`**）。**`addtime`** 为业务时间串（示例 **`2026-4-23 11:44:51`**）。**`pass='0'`、`del='0'`**；**`uid` / `uname` / `utruename`** 由 **`getActorAuditTripletFromReq(req)`** 从登录态写入（禁止前端传参）。插入前在册 **`code` 唯一**校验。
- 编辑（仅「显示未审核」视图）：`PUT /api/inventory/color-code`，body `{ code, name, ename?, info? }`；仅 **在册且 `pass=0`** 可保存；写入 **`edittime`**（同上时间格式）。颜色编码只读不可改。
- 搜索：顶部关键字，对 **`code` / `name`** 参数化 `LIKE`（防注入）；空关键字则只分页列表。
- 审核视图：默认 **`pass=1`（已审核）**；开关「显示未审核」查询 **`pass=0`**（与回收站互斥）。
- 回收站：查询参数 **`recycled=1`**，仅 **`del=1`** 的记录；前端「回收站」开关打开时启用；支持同一套关键字搜索。
- 审核 / 反审：`PUT /api/inventory/color-code/audit`、`PUT /api/inventory/color-code/unaudit`，body `{ code }`；更新 **`pass`** 并写 **`edittime`**（业务表审计字段，见 `CONTEXT.md` 第三节）。
- 逻辑删除 / 恢复：`DELETE /api/inventory/color-code/:code` 将 **`del` 置为 `1`** 并写入 **`deltime`**；`PUT /api/inventory/color-code/restore` body `{ code }` 将 **`del` 置为 `0`** 并写入 **`edittime`**。**已审核（`pass=1`）不可软删**。
- 回收站彻底删除：`DELETE /api/inventory/color-code/:code/permanent`，**仅当 `del=1`** 时物理删除该行。
- 表格列：录入时间、颜色编码（加粗）、名称(中文)、审核状态、操作列（未审视图含「编辑」）。

## 数据库说明

- 列表与写操作均依赖 **`del`、`pass`** 约定。若旧库缺列，请在 Navicat 补齐。
- **时间业务列**（建议 **`NVARCHAR(50)`**，存服务端生成的展示串）：
  - **`addtime`**：新增时写入；
  - **`edittime`**：未审保存、审核、反审、回收站恢复时写入；
  - **`deltime`**：逻辑删除时写入；
  - 格式示例：`2026-4-23 11:44:51`（与后端 `formatBomColorcodeTimestamp` 一致）。
- 物理录入时间列 **`intime`**（**datetime**，建议存日历日零点）用于排序；列表 **`in_time`** 由服务端格式化为 **`yyyy/M/d`**（如 `2017/9/1`）。与 **`addtime`** 业务串并存。

### Navicat：缺列补齐脚本（列已存在则跳过该句）

```sql
-- 审计三列（若已执行过可跳过）
ALTER TABLE dbo.[Bom_colorcode] ADD uid INT NULL;
ALTER TABLE dbo.[Bom_colorcode] ADD uname NVARCHAR(50) NULL;
ALTER TABLE dbo.[Bom_colorcode] ADD utruename NVARCHAR(50) NULL;
-- 业务时间串
ALTER TABLE dbo.[Bom_colorcode] ADD addtime NVARCHAR(50) NULL;
ALTER TABLE dbo.[Bom_colorcode] ADD edittime NVARCHAR(50) NULL;
ALTER TABLE dbo.[Bom_colorcode] ADD deltime NVARCHAR(50) NULL;
```

## 权限（按钮级）

- 菜单 path：`inventory/basic/color-code`
- `view`：`GET /api/inventory/color-code/list`
- `add`：`POST /api/inventory/color-code`
- `edit`：`PUT /api/inventory/color-code`（未审保存）、`PUT .../restore`（回收站恢复）
- `audit`：`PUT .../audit`、`PUT .../unaudit`
- `delete`：`DELETE .../:code`（逻辑删）、`DELETE .../:code/permanent`（彻底删）

若角色为细粒度 JSON 权限，请为 **`inventory/basic/color-code`** 勾选 **`edit`**，否则「编辑」不显示且保存接口 403。

## 操作日志

新增/审核/反审/删除/恢复/彻底删除由 `operationAuditMiddleware` 写入 **`UB_Date_ERP_Operation_log`**，`act_info` 为可读中文。

## 已知问题 / 下一步

- 已审核行的名称修改若需支持，需单独产品与权限策略（当前仅未审可改）。
