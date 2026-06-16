# 角色管理（`views/system/role`）

## 已完成功能（v1.0.7）

- **查**：`UB_ERP_System_role` 分页列表，`GET /api/roles`（支持 `status` 双视图、`keyword` 模糊搜角色名与描述；含 `Permissions` 列）。
- **增**：弹窗新增角色，`POST /api/roles`，默认 `pass='1'`（同时兼容同步 `Status=1`）。
- **改**：弹窗编辑角色名与描述，`PUT /api/roles`（带 `RoleID`）。
- **分配权限**：`el-tree` 展示 `erp_structure_dump.json` 全树，勾选后 `PUT /api/roles/permissions` 写入 `Permissions`（JSON path 数组，或 `["*"]` 表示全部菜单）。
- **禁用**：在职列表中「禁用」→ `pass='0'`（软删除，进回收站视图；同时兼容同步 `Status=0`）。
- **恢复**：回收站中「恢复」→ `PUT /api/roles/resume`。
- **删**：回收站中「删除」→ `DELETE /api/roles/:id`（要求已禁用且无操作员绑定该 `RoleID`）。

## 界面说明

- 布局与 **操作员资料**（`system/operator`）一致：大按钮工具栏、橙色激活态视图切换、`el-table` + `el-pagination`、表格上方独立搜索栏。

## 菜单与路由

- 菜单项定义在根目录 `erp_structure_dump.json` → `系统管理` → **角色管理**。
- 访问路径：`/system/role`（由 `src/router/index.js` 根据 JSON 自动生成子路由）。

## 数据库

- 表：`UB_ERP_System_role`（字段见上级目录 `rbac_design.md`）。
- 若尚未建表，请先执行：`scripts/migrations/sqlserver_v1.0.7_rbac_phase1.txt`。
- **菜单权限列**：`scripts/migrations/sqlserver_v1.0.7_permissions_column.txt`（`Permissions NVARCHAR(MAX)`）。

## 已知说明

- 删除前必须先禁用；若 `UB_ERP_User` 中仍有用户引用该角色，数据库外键或接口校验会阻止删除。
- 角色名称 `RoleName` 有唯一约束，重复会返回中文错误提示。
- 修改某角色的 `Permissions` 后，**已登录**该角色的用户需**重新登录**，侧栏与路由守卫才会读到新权限。
