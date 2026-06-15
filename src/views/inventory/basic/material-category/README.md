# 材料分类（库存基本资料）

## 已完成功能

- 列表：`GET /api/inventory/material-category/list`，物理表 **`UB_ERP_Stocks_material`**（旧表名 `Bom_material`）；`ROW_NUMBER()` 分页（SQL Server 2008 R2）；默认 **每页 20**、按 **`id` 降序**。
- 搜索：关键字对 **`code` / `name` / `customs_code`** 参数化 `LIKE`（防注入）。
- 默认视图：**`pass=1`（已审核）**；「显示未审核」查询 **`pass=0`**（与回收站互斥）。
- 回收站：**`recycled=1`** 仅 **`del=1`**；支持同一关键字搜索；操作 **恢复**。
- 审核 / 反审：`PUT /api/inventory/material-category/audit`、`PUT /api/inventory/material-category/unaudit`，body **`{ id }`**；每次更新写 **`edittime`**（业务表审计字段，见 `CONTEXT.md` 第三节）。
- 逻辑删除 / 恢复：`DELETE /api/inventory/material-category/:id` 将 **`del=1`** 并写 **`deltime`**；`PUT /api/inventory/material-category/restore` 将 **`del=0`** 并写 **`edittime`**。**已审核（`pass=1`）不可软删**，提示同员工档案锁定。
- 新增：`POST /api/inventory/material-category`，body **`{ code, name, customs_code?, stocks_in?, stocks_out? }`**；`uid`/`uname`/`utruename` + `addtime` 由后端从登录态写入；`pass=0`、`del=0`；`id` 自增（`OUTPUT INSERTED.id`）。
- 前端路由：`inventory/basic/material-category`（与 `erp_structure_dump.json` 菜单一致）。

## 字段说明

- `code`：分类编码（必填）
- `name`：分类名称（必填）
- `customs_code`：海关商品编码（可空）
- `stocks_in`：入库浮动率（可空，建议字符串存原始录入，如 `0.05` 或 `5%`）
- `stocks_out`：出库浮动率（可空，建议字符串存原始录入，如 `0.05` 或 `5%`）
- `pass` / `del`：项目约定

## 数据库说明

- 必备业务列：`id`（主键 `IDENTITY`）、`code`、`name`、`customs_code`、`stocks_in`、`stocks_out`、`pass`、`del`。
- 审计列（建议 `NVARCHAR(50)` 存时间串；`uid` 为 `INT`）：`uid`、`uname`、`utruename`、`addtime`、`edittime`、`deltime`。
- 时间格式与其它基础资料一致，由后端 `formatBomColorcodeTimestamp` 生成（示例 `2026-4-23 11:44:51`）。

### Navicat：缺列补齐（列已存在则跳过该句）

```sql
ALTER TABLE dbo.[UB_ERP_Stocks_material] ADD uid INT NULL;
ALTER TABLE dbo.[UB_ERP_Stocks_material] ADD uname NVARCHAR(50) NULL;
ALTER TABLE dbo.[UB_ERP_Stocks_material] ADD utruename NVARCHAR(50) NULL;
ALTER TABLE dbo.[UB_ERP_Stocks_material] ADD addtime NVARCHAR(50) NULL;
ALTER TABLE dbo.[UB_ERP_Stocks_material] ADD edittime NVARCHAR(50) NULL;
ALTER TABLE dbo.[UB_ERP_Stocks_material] ADD deltime NVARCHAR(50) NULL;
```

## 权限（按钮级）

- 菜单 path：`inventory/basic/material-category`
- `view`：`GET /api/inventory/material-category/list`
- `add`：`POST /api/inventory/material-category`
- `audit`：`PUT .../audit`、`PUT .../unaudit`
- `delete`：`DELETE /api/inventory/material-category/:id`
- `edit`：`PUT .../restore`

细粒度 `Permissions` 须包含上述动作，否则对应按钮隐藏或接口 403。

## 操作日志

新增/审核/反审/删除/恢复由 `operationAuditMiddleware` 写入 **`UB_Date_ERP_Operation_log`**，`act_info` 为可读中文（不带“操作人”前缀）。

