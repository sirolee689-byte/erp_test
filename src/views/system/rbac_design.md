# RBAC 设计说明（v1.0.7 第一阶段）

本文档描述当前版本已落地的**角色表**与**用户—角色关联**，供后续菜单/按钮级权限扩展时对照。

## 1. 表结构

### 1.1 `Sys_Roles`（角色）

| 列名 | 类型 | 说明 |
|------|------|------|
| `RoleID` | `INT` IDENTITY | 主键 |
| `RoleName` | `NVARCHAR(50)` | 角色英文名（业务代码中可稳定引用：`Admin` / `Onduty` / `Viewer`） |
| `Description` | `NVARCHAR(200)` | 中文描述 |
| `Status` | `INT` | 1=启用，0=禁用（预留） |

唯一约束：`RoleName` 唯一。

### 1.2 `Sys_Users`（操作员）扩展

| 列名 | 类型 | 说明 |
|------|------|------|
| `RoleID` | `INT NOT NULL` | 外键 → `Sys_Roles.RoleID` |

约束名：`FK_Sys_Users_Sys_Roles_RoleID`。

## 2. 预设角色数据

| RoleName | Description |
|----------|-------------|
| `Admin` | 系统管理员 |
| `Onduty` | 值班人员 |
| `Viewer` | 仅查看 |

**注意**：`RoleID` 由数据库自增生成，应用层应通过接口查询 `RoleID`，不要写死数字。

## 3. 与应用的对应关系

- **列表**：`GET /api/users` 通过 `LEFT JOIN Sys_Roles` 返回 `RoleName`（及 `RoleID`）。
- **操作员弹窗角色下拉**：`GET /api/roles?page=1&pageSize=500&status=1`，取分页结果中的 `list`（仅启用角色）。
- **登录**：`POST /api/login` 在 `data.user` 中返回 `RoleID`、`RoleName`；前端写入 `localStorage` 的 `erp_user`，供路由守卫以外的**前端权限判断**使用（第二阶段可在此字段上扩展菜单显隐等）。

## 4. 角色管理模块（页面：`src/views/system/role/index.vue`）

面向 `Sys_Roles` 的完整维护能力，与操作员页的交互范式一致（启用/回收站双视图、先禁用再删除）。

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/roles` | GET | 分页查询；`status`=1 在职 / 0 回收站；`keyword` 模糊匹配 `RoleName`、`Description`；返回 `list`、`total`。 |
| `/api/roles` | POST | 新增：`RoleName`、可选 `Description`。 |
| `/api/roles` | PUT | 禁用：`{ RoleID, Status: 0 }`；编辑：`{ RoleID, RoleName, Description }`。 |
| `/api/roles/resume` | PUT | 恢复启用：`{ RoleID }`。 |
| `/api/roles/:id` | DELETE | 物理删除（要求已禁用且无 `Sys_Users` 引用）。 |

详细交互与路由说明见 `role/README.md`。

## 5. 数据库迁移脚本路径

执行：`scripts/migrations/sqlserver_v1.0.7_rbac_phase1.txt`（内容为 T-SQL，在 SSMS 中针对目标 ERP 库运行；仓库因 `.gitignore` 忽略 `*.sql` 故使用 `.txt` 保存）。
