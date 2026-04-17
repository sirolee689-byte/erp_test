# 数据库表映射（Database Map）

本文件用于记录 **ERP_TEST** 项目当前版本实际依赖的物理表、关键字段、表关系、对应的接口/页面，以及相关迁移脚本与环境变量，避免“代码已改但数据库/文档断更”。

> 约定：本文只维护“项目当前明确使用到”的表与字段；如需扩展，请同时补充迁移脚本（见 `docs/sql/` 与 `scripts/migrations/`）和相关设计文档。

## 1. 全局概览（当前确认：5 张表）

- **HR_Departments**：部门 / 岗位（旧系统表接管）
- **Hr_staff**：人事档案资料（精简字段查询）
- **Sys_OperationLogs**：全局操作审计日志（新增）
- **Sys_Roles**：角色管理（含菜单权限 `Permissions`）
- **Sys_Users**：用户/操作员（通过 `RoleID` 关联角色）

## 2. 表关系（ER 摘要）

- **`Sys_Users.RoleID` → `Sys_Roles.RoleID`**
  - 说明：用户属于某个角色；列表接口会 `LEFT JOIN` 返回 `RoleName`。
  - 设计文档：`src/views/system/rbac_design.md`

> 备注：`HR_Departments` 与 `Hr_staff` 在当前版本 **没有数据库级外键** 约束（至少在仓库脚本/设计文档中未定义）。`Hr_staff.in_bm` 与部门关系属于“业务字段”层面的关联。

## 3. 表明细

### 3.1 `HR_Departments`（部门 / 岗位，旧系统表接管）

- **Schema**：通常为 `dbo`（实际由数据库决定）
- **表名来源**：环境变量 `HR_LEGACY_DEPT_TABLE`，默认 `HR_Departments`
- **模块/页面**
  - 前端：`src/views/hr/files/department/index.vue`
  - 设计：`src/views/system/hr_department_design.md`
- **接口（后端：`server/index.js`）**
  - `GET /api/hr/departments`：分页 + keyword（`name`/`code`）模糊；仅在册（`del` 为空/NULL/`'0'`）
  - `POST /api/hr/departments`：新增（服务端生成 `code`），默认 `pass='0'`、`del='0'`
  - `PUT /api/hr/departments`：编辑（`pass='1'` 禁止）
  - `PUT /api/hr/departments/audit`、`PUT /api/hr/departments/unaudit`
  - `DELETE /api/hr/departments/:code`：逻辑删除（非物理 DELETE）
- **关键字段（接口 JSON 均为小写键）**（见 `hr_department_design.md`）
  - **主键（业务）**：`code`（字符串；新增按整表最大数字 code + 1 生成）
  - **常用字段**：`name`、`remark`、`manager`（历史列）、`flag`
  - **审计关联**：`uid`、`uname` 已存在于数据库真实表结构中，可用于记录当前操作人
  - **审核**：`pass`（`'1'` 已审核锁定；`'0'`/空 未审核）
  - **逻辑删除**：`del`（`''`/`NULL`/`'0'` 在册；`'1'` 删除）
  - **时间字符串**：`addtime`/`edittime`/`deltime`/`intime`
  - **审核人/时间**：`passid`/`passuname`/`passuid`/`passutruename`/`passtime`
- **迁移脚本（仓库已归档）**
  - 建表/补审核列（用于空库快速建表）：`docs/sql/sqlserver_v1.0.8_hr_departments.txt`
  - 增加备注列 `remark`：`docs/sql/sqlserver_v1.1.0_hr_departments_add_remark.txt`
  - 额外脚本：`docs/sql/sqlserver_v1.1.0_hr_departments_add_parentid.txt`（如需兼容旧接口字段 `ParentID`）
- **权限（按钮级）**
  - 菜单 path：`hr/files/department`
  - 操作：`view` / `add` / `edit` / `delete` / `audit`

### 3.2 `Hr_staff`（人事档案资料，精简管理 v1.0.9）

- **Schema**：`dbo`
- **表名来源**：环境变量 `HR_STAFF_TABLE`，默认 `Hr_staff`
- **模块/页面**
  - 前端：`src/views/hr/files/employee-files/index.vue`
  - 设计：`src/views/system/hr_staff_design.md`
- **接口（后端：`server/index.js`）**
  - `GET /api/hr/staff`：分页 + 搜索（优先级：`name` 模糊 > `code` 精确 > `card_number` 精确）
  - `POST /api/hr/staff`：新增（`pass` 默认 `'0'`）
  - `PUT /api/hr/staff`：编辑（`pass='1'` 禁止）
  - `DELETE /api/hr/staff/:code`：当前为物理删除（`pass='1'` 禁止）
  - `PUT /api/hr/staff/audit`、`PUT /api/hr/staff/unaudit`
  - 下拉辅助：`GET /api/hr/staff/department-options`、`GET /api/hr/staff/department-posts`
- **本模块“允许使用的字段”**（性能约束，见 `hr_staff_design.md`）
  - `code`（工号，业务主键）
  - `name`、`sex`、`in_bm`
  - `card_number`、`meal_type`、`yn_history`
  - `remark`（`nvarchar(500)`）
  - `intime`
  - `uid`、`uname`（数据库真实表已存在，可用于写入当前操作人）
  - `pass`（`'1'` 已审核锁定；`'0'`/空 未审核）
- **权限（按钮级）**
  - 菜单 path：`hr/files/employee-files`
  - 操作：`view` / `add` / `edit` / `delete` / `audit`

### 3.3 `Sys_OperationLogs`（全局操作审计日志）

- **Schema**：`dbo`
- **表用途**
  - 记录关键操作：新增、编辑、删除、审核等
  - **v1.1.1+ 全自动审计**：由 `server/operationAuditMiddleware.js` 两段组成：
    1. **`createOperationAuditPrepareMiddleware`**（在 `apiPermissionGate` 之后、业务路由之前）：对 `DELETE /api/hr/staff/:code` **删除前**查询 `name/code`；对 `PUT /api/hr/staff` **修改前**读取当前行，与 `req.body` 按字段中文映射比对，生成「修改了[字段]：由[旧]改为[新]」文案（挂到 `req`）。
    2. **`createOperationAuditMiddleware`**：`res.finish` 且 **HTTP 200** 后异步 `INSERT`（失败只打控制台）。
  - **操作人来源**：从登录态 `getCurrentUserFromReq`（Bearer Token → 内存 `tokenStore`）取 `userId` → 写入 `UserId`；`userName`（优先真实姓名，否则工号）→ 写入 `UserName`（列表接口别名 `uname` / `user_id`）。
  - **Action / TargetTable**：按路由映射为可读中文（如 `删除员工档案`、`修改员工档案`、`新增员工档案`）；未命中规则时用「新增/修改/删除 + path」截断，避免把裸 URL 当作业务动作名。
  - **Content（详情）**：
    - **员工删除 / 修改 / 新增**：详情句首带 **`操作人{姓名}`**；删除为「删除了员工档案…」；修改为「修改了员工档案：修改了[字段]…」；新增为「新增了员工档案，姓名[…]…」。
    - **部门/岗位（POST/PUT/DELETE/审核/批量审核）**：同样带 **`操作人{姓名}`**；**POST** 仅展示非空字段（`remark`、`ParentID` 等为空则不写入详情）；**审核** 在准备阶段读库补全「名称+编码」中文句，避免只记 `{"code":"1106"}`。
    - **其它接口**：仍为 **脱敏后的 `req.body` JSON**（密码类等替换为 `***`），超长截断至 `NVARCHAR(2000)`。
  - **IPAddress**：取 `X-Forwarded-For` 首段，否则取 `req.ip` / socket 地址（去掉 `::ffff:`）。
  - **不参与审计的路径**：`/api/login`、`/api/health`。
- **模块/页面**
  - 前端：`src/views/system/logs/index.vue`
- **关键字段**（已按数据库真实结构核对）
  - `LogID`（INT IDENTITY，主键）
  - `UserId`、`UserName`
  - `Action`（操作类型）
  - `TargetTable`（目标表名）
  - `Content`（操作详情 / SQL 快照 / 业务摘要）
  - `IPAddress`
  - `CreateTime`（`nvarchar(50)`，默认 `GETDATE()` 格式化字符串）
- **接口（后端：`server/index.js`）**
  - `GET /api/sys/logs`：分页查询；`action` 筛选为 **LIKE 模糊**；返回含 `user_id`（`UserId`）供核对
  - `DELETE /api/sys/logs/clear`：清空全表（仅工号 `admin` 不区分大小写，或角色名「系统管理员」）；成功后仍由上述中间件追加一条「清空操作日志」记录
- **迁移脚本**
  - 建表：`docs/sql/sqlserver_v1.1.0_create_sys_operationlogs.txt`

### 3.4 `Sys_Roles`（角色管理，RBAC Phase 1）

- **Schema**：通常为 `dbo`（实际由数据库决定）
- **模块/页面**
  - 前端：`src/views/system/role/index.vue`
  - 设计：`src/views/system/rbac_design.md`
- **接口（后端：`server/index.js`）**
  - `GET /api/roles`：分页（含回收站视图），支持 keyword（`RoleName`/`Description`）
  - `POST /api/roles`：新增
  - `PUT /api/roles`：编辑/禁用（`Status=0`）
  - `PUT /api/roles/resume`：恢复启用
  - `DELETE /api/roles/:id`：物理删除（需已禁用且无 `Sys_Users` 引用）
  - `PUT /api/roles/permissions`：仅更新 `Permissions`
- **关键字段**（见 `rbac_design.md`）
  - `RoleID`（INT IDENTITY，主键）
  - `RoleName`（唯一；英文业务标识：`Admin`/`Onduty`/`Viewer` 等）
  - `Description`（中文说明）
  - `Status`（1 启用 / 0 禁用）
  - `Permissions`（NVARCHAR(MAX)；JSON 数组字符串；`["*"]` 表示全部菜单）
- **迁移脚本**
  - 增加 `Permissions` 列：`docs/sql/erp_v1.0.7_permissions_column.txt`（或 `scripts/migrations/sqlserver_v1.0.7_permissions_column.txt`）

### 3.5 `Sys_Users`（用户 / 操作员）

- **Schema**：通常为 `dbo`（实际由数据库决定）
- **模块/页面**
  - 前端：`src/views/system/operator/index.vue`
  - 设计：`src/views/system/rbac_design.md`（含与角色表关系说明）
- **接口（后端：`server/index.js`）**
  - `GET /api/users`：列表（通过 `LEFT JOIN Sys_Roles` 返回 `RoleName` 等）
  - `POST /api/users` / `PUT /api/users` / `DELETE /api/users/...`：以实际后端实现为准（本文仅记录已确认的表关系）
- **关键字段（已确认）**
  - `RoleID`：外键指向 `Sys_Roles.RoleID`（约束名：`FK_Sys_Users_Sys_Roles_RoleID`）

## 4. 环境变量清单（与表名相关）

- `HR_LEGACY_DEPT_TABLE`：部门/岗位表名，默认 `HR_Departments`
- `HR_STAFF_TABLE`：员工档案表名，默认 `Hr_staff`

## 5. 维护指引（建议）

- 若你新增/修改了任一模块的 SQL 字段读写（INSERT/UPDATE/SELECT），请同步：
  - 对应迁移脚本（优先归档到 `docs/sql/`，并在 `scripts/migrations/` 保留可执行版本）
  - 本文件 `docs/sql/database_map.md` 的 **“关键字段/接口/表关系”**

## 6. 后端 SQL 扫描结果（`server/`）

以下清单来自对 `server/` 目录内 SQL 语句（`FROM/JOIN/INSERT/UPDATE/DELETE`）的扫描，用于“反向校验：后端实际用到了哪些表”。

- **`Sys_Users`**
  - 来源：`server/index.js`（登录、用户列表/增删改等）
  - 来源：`server/apiPermissionGate.js`（鉴权时读取当前用户角色权限）
- **`Sys_Roles`**
  - 来源：`server/index.js`（角色管理、用户列表 JOIN 角色名、登录返回权限）
  - 来源：`server/apiPermissionGate.js`（鉴权 JOIN 读取 `Permissions`）
- **`Sys_OperationLogs`**
  - 来源：`server/index.js`（列表、清空、底层 `writeOperationLog`）
  - 来源：`server/operationAuditMiddleware.js`（v1.1.1 起：POST/PUT/DELETE 成功后的自动审计写入）
- **`dbo.[${HR_LEGACY_DEPT_TABLE}]`（默认 `dbo.[HR_Departments]`）**
  - 来源：`server/index.js`
  - 说明：通过 `HR_LEGACY_DEPT_FROM = \`dbo.[${HR_LEGACY_DEPT_TABLE}]\`` 统一引用；同时被部门资料接口与员工档案“部门/岗位下拉”接口使用。
- **`dbo.[${HR_STAFF_TABLE}]`（默认 `dbo.[Hr_staff]`）**
  - 来源：`server/index.js`
  - 说明：通过 `HR_STAFF_FROM = \`dbo.[${HR_STAFF_TABLE}]\`` 统一引用；员工档案 CRUD/审核均走该表。

