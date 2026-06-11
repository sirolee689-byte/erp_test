# 使用单位（库存基本资料）

## 已完成功能

- 列表：`GET /api/inventory/units/list`，物理表 **`Bom_unit`**；`ROW_NUMBER()` 分页（SQL Server 2008 R2）；默认 **每页 20**、按 **`id` 降序**。
- 搜索：关键字对 **`name` / `info`** 参数化 `LIKE`（防注入）。
- 默认视图：**`pass=1`（已审核）**；「显示未审核」查询 **`pass=0`**（与回收站互斥）。
- 回收站：**`recycled=1`** 仅 **`del=1`**；支持同一关键字搜索；操作 **恢复**。
- 审核 / 反审：`PUT /api/inventory/units/audit`、`PUT /api/inventory/units/unaudit`，body **`{ id }`**；每次 **UPDATE 写 `edittime`**（业务表审计字段，见 `CONTEXT.md` 第三节）。
- 逻辑删除 / 恢复：`DELETE /api/inventory/units/:id` 将 **`del=1`** 并写 **`deltime`**；`PUT /api/inventory/units/restore` 将 **`del=0`** 并写 **`edittime`**。**已审核不可软删**（提示同颜色编码）。
- 新增：`POST /api/inventory/units`，body **`{ name, info? }`**；**`uid`/`uname`/`utruename`** 由 `getActorAuditTripletFromReq(req)` 从登录态写入；**`addtime`** 业务时间串；**`pass=0`、`del=0`**；**`id` 自增**（`OUTPUT INSERTED.id`）。**禁止前端传审计字段**。
- 前端路由：`inventory/basic/units`（与 `erp_structure_dump.json` 菜单 `units` 一致）。

## 数据库说明

- 必备业务列：**`id`**（主键 `IDENTITY`）、**`name`**、**`info`**（可空）、**`pass`**、**`del`**。
- **业务表审计列**（建议 `NVARCHAR(50)` 存时间串；`uid` 为 `INT`；见 `CONTEXT.md` 第三节）：
  - **`uid` / `uname` / `utruename`**：录入人（对应 `Sys_Users.UserID`、`UserCode`、`UserName`）；
  - **`addtime`**：新增时写入；
  - **`edittime`**：审核、反审、恢复时写入；
  - **`deltime`**：逻辑删除时写入；  
  时间格式与颜色编码一致，由后端 **`formatBomColorcodeTimestamp`** 生成（示例 `2026-4-23 11:44:51`）。

### Navicat：缺列补齐（列已存在则跳过该句）

```sql
ALTER TABLE dbo.[Bom_unit] ADD uid INT NULL;
ALTER TABLE dbo.[Bom_unit] ADD uname NVARCHAR(50) NULL;
ALTER TABLE dbo.[Bom_unit] ADD utruename NVARCHAR(50) NULL;
ALTER TABLE dbo.[Bom_unit] ADD addtime NVARCHAR(50) NULL;
ALTER TABLE dbo.[Bom_unit] ADD edittime NVARCHAR(50) NULL;
ALTER TABLE dbo.[Bom_unit] ADD deltime NVARCHAR(50) NULL;
```

## 权限（按钮级）

- 菜单 path：`inventory/basic/units`
- `view`：`GET /api/inventory/units/list`
- `add`：`POST /api/inventory/units`
- `audit`：`PUT .../audit`、`PUT .../unaudit`
- `delete`：`DELETE /api/inventory/units/:id`
- `edit`：`PUT .../restore`

细粒度 `Permissions` 须包含上述动作，否则对应按钮隐藏或接口 403。

## 操作日志

新增/审核/反审/删除/恢复由 `operationAuditMiddleware` 写入 **`UB_Date_ERP_Operation_log`**，`act_info` 为可读中文。

## 已知问题 / 下一步

- 未审行内编辑、回收站彻底删除：可按业务需要再迭代（当前与最小标准件一致）。
