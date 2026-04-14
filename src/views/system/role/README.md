# 角色管理（`views/system/role`）

## 已完成功能（v1.0.7）

- **查**：`Sys_Roles` 分页列表，`GET /api/roles`（支持 `status` 双视图、`keyword` 模糊搜角色名与描述）。
- **增**：弹窗新增角色，`POST /api/roles`，默认 `Status=1`。
- **改**：弹窗编辑角色名与描述，`PUT /api/roles`（带 `RoleID`）。
- **禁用**：在职列表中「禁用」→ `Status=0`（软删除，进回收站视图）。
- **恢复**：回收站中「恢复」→ `PUT /api/roles/resume`。
- **删**：回收站中「删除」→ `DELETE /api/roles/:id`（要求已禁用且无操作员绑定该 `RoleID`）。

## 界面说明

- 布局与 **操作员资料**（`system/operator`）一致：大按钮工具栏、橙色激活态视图切换、`el-table` + `el-pagination`、表格上方独立搜索栏。

## 菜单与路由

- 菜单项定义在根目录 `erp_structure_dump.json` → `系统管理` → **角色管理**。
- 访问路径：`/system/role`（由 `src/router/index.js` 根据 JSON 自动生成子路由）。

## 数据库

- 表：`Sys_Roles`（字段见上级目录 `rbac_design.md`）。
- 若尚未建表，请先执行仓库内迁移脚本：`scripts/migrations/sqlserver_v1.0.7_rbac_phase1.txt`。

## 已知说明

- 删除前必须先禁用；若 `Sys_Users` 中仍有用户引用该角色，数据库外键或接口校验会阻止删除。
- 角色名称 `RoleName` 有唯一约束，重复会返回中文错误提示。
