# 车间与部门编码（库存基本资料）

## 已完成功能

- 列表：`GET /api/inventory/workshop-dept/list`，物理表 **`UB_ERP_Stocks_workshop`**（旧名：`Bom_Stocks_workshop`）；`ROW_NUMBER()` 分页（SQL Server 2008 R2）；默认 **每页 20**、按 **`id` 降序**。
- 搜索：关键字对 **`code` / `name` / `info`** 参数化 `LIKE`（防注入）。
- 默认视图：**`pass=1`（已审核）**；「显示未审核」查询 **`pass=0`**（与回收站互斥）。
- 回收站：**`recycled=1`** 仅 **`del=1`**；支持同一关键字搜索；操作 **恢复**。
- 回收站强删除：`DELETE /api/inventory/workshop-dept/:id/permanent`（仅 `del=1` 可物理删除，删除后不可恢复）。
- 审核 / 反审：`PUT /api/inventory/workshop-dept/audit`、`PUT /api/inventory/workshop-dept/unaudit`，body **`{ id }`**；每次 **UPDATE 写 `edittime`**（业务表审计字段，见 `CONTEXT.md` 第三节）。
- 逻辑删除 / 恢复：`DELETE /api/inventory/workshop-dept/:id` 将 **`del=1`** 并写 **`deltime`**；`PUT /api/inventory/workshop-dept/restore` 将 **`del=0`** 并写 **`edittime`**。**已审核不可软删**（提示同员工档案锁定文案）。
- 新增：`POST /api/inventory/workshop-dept`，body **`{ code, name, info? }`**；后端做 **code 唯一性校验**（`del=0` 下不允许重复）；**`uid`/`uname`/`utruename`** 由 `getActorAuditTripletFromReq(req)` 从登录态写入；**`addtime`** 业务时间串；**`pass=0`、`del=0`**；**`id` 自增**（`OUTPUT INSERTED.id`）。**禁止前端传审计字段**。
- 前端路由：`inventory/basic/workshop-dept`（与 `erp_structure_dump.json` 菜单一致）。

## 操作日志

由 `operationAuditMiddleware` 写入 **`UB_Date_ERP_Operation_log`**，`act_info` 为可读中文（前端不传日志内容）：

- 新增：`录入成功,等待审核！车间与部门编码：[编码]，车间/部门名称：[名称]`
- 审核：`申请通过审核！车间与部门编码：[编码]，车间/部门名称：[名称]`
- 反审：`反审核操作！车间与部门编码：[编码]，车间/部门名称：[名称]`
- 删除：`编码删除！车间与部门编码：[编码]，车间/部门名称：[名称]`
- 强删除：`彻底删除操作！车间与部门编码：[编码]，车间/部门名称：[名称]`
- 恢复：`恢复操作！车间与部门编码：[编码]，车间/部门名称：[名称]`

## 数据库说明

- 必备业务列：**`id`**（主键 `IDENTITY`）、**`code`**、**`name`**、**`info`**（可空）、**`pass`**、**`del`**。
- **业务表审计列**（建议 `NVARCHAR(50)` 存时间串；`uid` 为 `INT`；见 `CONTEXT.md` 第三节）：
  - **`uid` / `uname` / `utruename`**：录入人（对应 `Sys_Users.UserID`、`UserCode`、`UserName`）；
  - **`addtime`**：新增时写入；
  - **`edittime`**：审核、反审、恢复时写入；
  - **`deltime`**：逻辑删除时写入；  
  时间格式由后端 `formatBomColorcodeTimestamp` 生成（示例 `2026-4-23 11:44:51`）。

### Navicat：缺列补齐（列已存在则跳过该句）

```sql
ALTER TABLE dbo.[UB_ERP_Stocks_workshop] ADD uid INT NULL;
ALTER TABLE dbo.[UB_ERP_Stocks_workshop] ADD uname NVARCHAR(50) NULL;
ALTER TABLE dbo.[UB_ERP_Stocks_workshop] ADD utruename NVARCHAR(50) NULL;
ALTER TABLE dbo.[UB_ERP_Stocks_workshop] ADD addtime NVARCHAR(50) NULL;
ALTER TABLE dbo.[UB_ERP_Stocks_workshop] ADD edittime NVARCHAR(50) NULL;
ALTER TABLE dbo.[UB_ERP_Stocks_workshop] ADD deltime NVARCHAR(50) NULL;
```

## 权限（按钮级）

- 菜单 path：`inventory/basic/workshop-dept`
- `view`：`GET /api/inventory/workshop-dept/list`
- `add`：`POST /api/inventory/workshop-dept`
- `audit`：`PUT .../audit`、`PUT .../unaudit`
- `delete`：`DELETE /api/inventory/workshop-dept/:id`、`DELETE /api/inventory/workshop-dept/:id/permanent`
- `edit`：`PUT .../restore`

细粒度 `Permissions` 须包含上述动作，否则对应按钮隐藏或接口 403。

## 已知问题 / 下一步

- 暂无。

