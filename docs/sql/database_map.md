# 数据库表映射（Database Map）

本文件用于记录 **ERP_TEST** 项目当前版本实际依赖的物理表、关键字段、表关系、对应的接口/页面，以及相关迁移脚本与环境变量，避免“代码已改但数据库/文档断更”。

> 约定：本文只维护“项目当前明确使用到”的表与字段；如需扩展，请同时补充迁移脚本（见 `docs/sql/` 与 `scripts/migrations/`）和相关设计文档。

## 1. 全局概览（当前确认：19 张表）

- **HR_Departments**：部门 / 岗位（旧系统表接管）
- **Hr_staff**：人事档案资料（精简字段查询）
- **Hr_room**：宿舍房间主数据（v1.1.3 起）
- **Hr_room_in**：宿舍入住记录（v1.1.3 起）
- **Hr_room_use**：宿舍电费/用量等（`room_code` 与 `Hr_room.s_code` 对应；住宿总览按 `tj_date` 所在月汇总 `c_sum_money`，v1.1.4 起）
- **Sys_OperationLogs**：全局操作审计日志（新增）
- **Sys_Roles**：角色管理（含菜单权限 `Permissions`）
- **Sys_Users**：用户/操作员（通过 `RoleID` 关联角色）
- **bom_000**：BOM 主档 / 物料清单头（v1.1.7 列表查询；约 6.8W 行量级，**必须分页**）
- **Bom_colorcode**：库存基本资料 — 颜色编码（v1.0.0 列表分页）
- **Bom_unit**：库存基本资料 — 使用单位（列表分页；审核/软删/恢复）
- **Bom_unit_change**：库存基本资料 — 单位转换率（列表分页；审核/软删/恢复）
- **Bom_material**：库存基本资料 — 材料分类（列表分页；审核/软删/恢复）
- **Bom_Stocks_workshop**：库存基本资料 — 车间与部门编码（列表分页；审核/软删/恢复）
- **System_supplier**：销售/采购/外协管理 — 基本资料 — 供应商资料（列表分页；审核/反审/软删/恢复）
- **System_sales_customer**：销售/采购/外协管理 — 基本资料 — 销售客户（列表分页；审核/反审/软删/恢复）
- **Purchase_Quotation**：销售/采购/外协管理 — 日常工作 — 采购报价主表（列表分页；主从保存；审核/反审/软删/恢复/彻底删）
- **Purchase_Quotation_list**：采购报价明细表（通过外键或 `pid` 等列关联主表；保存时先删后插整批替换）
- **Outsourcing_Quotation**：销售/采购/外协管理 — 日常工作 — 外协报价主表（与采购报价同一套主从/审核/回收站接口形态；字段列名 `wxaa*`）
- **Outsourcing_Quotation_list**：外协报价明细表（与主表 `wxaa01` = 明细 `wxab01` 业务关联；汇总 `wxab04`/`wxab05`）
- **System_uplod_file**：纸格资料上传记录（旧系统表；管理页只读列表，见 `docs/System_uplod_file.txt`）

## 2. 表关系（ER 摘要）

- **`Sys_Users.RoleID` → `Sys_Roles.RoleID`**
  - 说明：用户属于某个角色；列表接口会 `LEFT JOIN` 返回 `RoleName`。
  - 设计文档：`src/views/system/rbac_design.md`

> 备注：`HR_Departments` 与 `Hr_staff` 在当前版本 **没有数据库级外键** 约束（至少在仓库脚本/设计文档中未定义）。`Hr_staff.in_bm` 与部门关系属于“业务字段”层面的关联。

- **`Purchase_Quotation_list` → `Purchase_Quotation`**
  - 业务关联：**`Purchase_Quotation.cgaa01` = `Purchase_Quotation_list.cgab01`**
  - 说明：后端在首次访问时通过 `sys.foreign_keys` 解析外键列；若无约束，则候选含 **`cgab01`**（及 `pid` 等）。列表接口对明细按 `cgab01` 分组汇总 **`cgab04`/`cgab05`**（在册明细：`del` 为空/`0`）。

- **`Outsourcing_Quotation_list` → `Outsourcing_Quotation`**
  - 业务关联：**`Outsourcing_Quotation.wxaa01` = `Outsourcing_Quotation_list.wxab01`**
  - 说明：实现见 `server/outsourcingQuotationHandlers.js`；列表汇总明细 **`wxab04`（不含税）/`wxab05`（含税）**，税点合计为二者之差（SQL `SUM`）。

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
  - `DELETE /api/hr/staff/:code`：逻辑删除（写 `del='1'`；`pass='1'` 禁止）
  - `PUT /api/hr/staff/restore`：恢复（写 `del='0'`；`pass='1'` 禁止）
  - `PUT /api/hr/staff/audit`、`PUT /api/hr/staff/unaudit`
  - `PUT /api/hr/staff/leave/:id`：办理离职（事务：写 `status='离职'` + `leave_date`，并封禁账号 `Sys_Users.is_active=0`）
  - 下拉辅助：`GET /api/hr/staff/department-options`、`GET /api/hr/staff/department-posts`
- **本模块“允许使用的字段”**（性能约束，见 `hr_staff_design.md`）
  - `code`（工号，业务主键）
  - `name`、`sex`、`in_bm`
  - `card_number`、`meal_type`、`yn_history`
  - `remark`（`nvarchar(500)`）
  - `intime`
  - `uid`、`uname`（数据库真实表已存在，可用于写入当前操作人）
  - `pass`（`'1'` 已审核锁定；`'0'`/空 未审核）
  - `del`（逻辑删除：`'0'` 在册；`'1'` 删除）
  - `status`（`在职/离职`，默认 `在职`）
  - `leave_date`（离职日期）
  - `leave_reason`（离职原因）
  - `is_blacklist`（是否黑名单：0/1）
  - `blacklist_reason`（黑名单原因）
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
  - `pass`（审核状态：`'1'` 已审核/启用，`'0'` 未审核/禁用；统一约定字段名，避免使用 `Status`）
  - `Status`（历史兼容列：1 启用 / 0 禁用；如存在则应映射到 `pass`，新逻辑优先按 `pass`）
  - `Permissions`（NVARCHAR(MAX)；JSON 数组字符串；`["*"]` 表示全部菜单）
  - `uid` / `uname` / `utruename`（操作人审计：录入人 ID / 账号 / 真实姓名）
  - `addtime` / `edittime` / `deltime`（业务时间串；全局审计 6 人组）
- **迁移脚本**
  - 增加 `Permissions` 列：`docs/sql/erp_v1.0.7_permissions_column.txt`（或 `scripts/migrations/sqlserver_v1.0.7_permissions_column.txt`）

### 3.5 `Hr_room` / `Hr_room_in`（宿舍：房间与入住，v1.1.3）

- **Schema**：`dbo`
- **模块/页面**
  - 前端：`src/views/hr/dormitory/room-management/index.vue`、`src/views/hr/dormitory/lodging-records/index.vue`（封装 `src/views/dormitory/index.vue` + `RoomList.vue` / `AuditList.vue` / `HistoryList.vue`）
  - 说明：`src/views/hr/dormitory/README.md`、`src/views/dormitory/README.md`
- **接口（后端：`server/index.js`）**
  - `GET /api/hr/dormitory/rooms`：房间分页列表；`WHERE del='0' AND pass=@pass`；在住人数子查询统计 `Hr_room_in` 中 `del=0` 且 `in_room='1'` 且 `out_room='0'`（按 `room_systemcode` 汇总）
  - `GET /api/hr/dormitory/rooms/:id`：单条详情（`del=0`，不按 `pass` 限制）；含在住人数与创建/审核辅助字段
  - `POST /api/hr/dormitory/rooms`：新增房间（在册 `s_code` 不可重复）；写入 `s_code`、`s_code1`（使用/闲置）、`code`（普通房/空调房/大房）、`in_bad`、`info`，`name` 固定「宿舍」，默认 `pass='0'`
  - `PUT /api/hr/dormitory/rooms/audit`：按 `id` 审核房间（`pass='1'`，写入 `passuid`/`passuname`/`passutruename`/`passip`/`edittime` 等）
  - `PUT /api/hr/dormitory/rooms/unaudit`：按 `id` 反审（`pass='0'`，清空 `pass*` 审核人字段）
  - `POST /api/hr/dormitory/check-in`（v1.1.4+ 重叠校验）：办理入住（写入旧表 `Hr_room_in`）
    - **入参**：`staff_code`（员工工号）、`room_code`（房号= `Hr_room.s_code`）、`in_time`（入住日期，建议 `YYYY-MM-DD`）、`electric`（优惠电量，数字）、`room_info`（备注）、`pass`（匹配已审/未审房间资料）
    - **在住拦截（INSERT 前）**：解析出与写入一致的 `staff_link_code` 后，查 `Hr_room_in` 中 `del='0' AND out_room='0' AND staff_code` 匹配 → 返回「该员工当前处于在住状态，请先办理退宿后再重新申请」
    - **历史时间重叠（INSERT 前）**：对已退宿行 `out_room='1'`，用 `hrRoomDateTimeExprNullableSql` 将 `in_time` 与 `COALESCE(out_time, out_time2)` 转为 `datetime`，若 `@newInDt` 落在闭区间 `[in, out]` 内则 400，文案含「时间冲突…[disp_in] 至 [disp_out]…」
    - **满员拦截**：按 `Hr_room.BedCount`（若存在）或 `Hr_room.in_bad` 作为床位数，与当前在宿人数对比；满员提示固定为「该房间已满员，无法办理入住」
    - **写入字段**（v1.1.4+）：入住行 **`pass='1'`**（办理即自动过审）、`del='0'`、`in_room='1'`、`out_room='0'`；若旧库存在 `status` 列则同时写入 `status=1`；若存在 `electric/room_info` 列则写入对应值；**若表缺少 `pass` 列则接口会报错提示在 Navicat 补列**
    - **审计日志**：`Sys_OperationLogs.Content` 记录「管理员[uname]办理入住：房间[room_code], 员工[姓名], 优惠电量[electric]」
  - `GET /api/hr/dormitory/check-in/staff-options`（v1.1.3+）：办理入住员工下拉；只返回 `Hr_staff` 中 `del=0 AND status='在职' AND is_blacklist=0` 且当前不在住（`Hr_room_in` 里 `in_room=1 AND out_room=0`）的员工
  - `GET /api/hr/dormitory/room-occupants`（v1.1.3+）：入住管理-当前在住人员（`del=0 AND out_room=0`），按 `room_code` 查询；部门取 `Hr_staff.join_department`（`Hr_staff.new_code = Hr_room_in.staff_code`）
    - v1.1.3+：部门中文名：`HR_Departments.code = Hr_staff.join_department`，展示 `HR_Departments.name`
  - `PUT /api/hr/dormitory/check-out`（v1.1.3+）：办理退宿：仅更新当前行 `id`，设置 `out_room='1'` + `out_time='YYYY-MM-DD HH:mm'`，并写入操作审计（Action：办理了退宿）
  - `PUT /api/hr/dormitory/room-in/room-info`（v1.1.3+）：入住管理-备注编辑：仅更新 `Hr_room_in.room_info`，并写入操作审计（Action：修改入住备注）
  - `GET /api/hr/dormitory/lodging-overview`（v1.1.10+）：房间总览分页；**入住人数/名单**显示“当前在住”（不按月份，按 `del=0`、`in_room=1`、`out_room=0` 汇总）；**电费**按参数 `tj_date`（格式 `YYYY-M`，如 `2026-3`）精确匹配 `Hr_room_use.tj_date`（该列为 `nvarchar(50)`）；同房同月取 **`MAX(c_sum_money)`** 防止重复累加（并过滤 `del=0`）；`c_sum_money` 为 nvarchar 时先清洗再转 decimal；入住名单优先 `staff_truename`，空则回退 `staff_code`
  - `GET /api/dorm/electric-report-data`（**v1.1.6**）：宿舍电费情况统计报表；`Hr_room`（`pass=1`）为主表；`OUTER APPLY` 取当月 `Hr_room_use`（`tj_date` 主/备选格式，同房同月多条取 `id` 最大）；`Hr_room_in` 子查询按与总览一致的月窗口（`in_time < mEnd` 且退宿时间空或 `>= mStart`）统计**入住人数**与**优惠电量合计**（`electric` 数值化后仅累计 >0）；用电量/单价/电费取自 `Hr_room_use` 落库字段（与 `POST /api/hr/dormitory/electric/settle` 一致）
  - `GET /api/dorm/electric-allocation-report`（**v1.1.7**）：宿舍费用分摊（人员维度）；以当月 `Hr_room_use`（每房 `ROW_NUMBER` 取最新一条）为入口，联查 `Hr_room_in` **`LEFT JOIN Hr_staff`**（`new_code`=`staff_code` 且 `del=0`；**不在 WHERE 中按 pass 剔除**，保证在住行「一个都不能少」）；`staff_pass` 回传后由 Node 计算：仅 **pass=1 且已匹配档案** 的人员参与用电量分母与金额，其余行 **分摊电量/金额为 0**（规则 18，防误扣款）；姓名展示带 **`(档案未审)`** / **`(住宿天数异常)`**；**部门/职务**：`LEFT JOIN HR_Departments`（`s` 无匹配时部门职务为 **`未设定`**）；**住宿天数**与 v1.1.7 在住窗一致；接口另返回 **`allocation_anomaly_hint`**（入住表人数对账、未参与摊费人数说明）
  - `GET /api/hr/dormitory/lodging-history`（**v1.1.4**）：住宿历史**全量**（`WHERE del='0'`，不再按 year/month 过滤 `in_time`）；`ROW_NUMBER() OVER (ORDER BY i.in_time DESC, i.id DESC)` 分页；`PUT /api/hr/dormitory/lodging-in/audit*`：入住单审核
  - `GET /api/hr/dormitory/lodging-in/audit-center-list`（**v1.1.4**）：审核入住申请分页列表；`WHERE del='0' AND pass=@pass`；三表联查同上；分页 **`ROW_NUMBER()`**；入参 `page`、`pageSize`、`pass`（0/1）、可选 `keyword`
  - `PUT /api/hr/dormitory/lodging-in/reject`（**v1.1.4**）：驳回入住申请（**逻辑删除** `del='1'`）；仅允许 `pass='0'` 且 `del='0'`；可选更新 `edittime`（列存在时）；操作审计见 `req.__auditDormLodgingInRejectContent`
  - `PUT /api/dorm/un-audit`（**v1.1.4**）：入住单反审核（`pass` 从 `'1'` 改回 `'0'`）；仅 `del='0'` 且 `pass='1'`；`Sys_OperationLogs` 可读文案见 `req.__auditDormUnAuditContent`（含管理员与员工展示名）
  - `DELETE /api/dorm/delete-checkin`（**v1.1.4**）：**物理删除**未审核入住行；SQL 为 `DELETE FROM dbo.[Hr_room_in] WHERE id=@id AND … pass … = N'0'`（与代码一致，禁止删已审）；成功时 `Sys_OperationLogs.Content` 见 `req.__auditDormDeleteCheckinContent`（「管理员 [uname] 彻底删除了员工 [姓名] 的未审核入住申请」）
- **关键字段（与当前代码一致）**
  - **房间**：`s_code`（房号，与办理入住时 `room_code` 一致）、`s_code1`（使用/闲置）、`in_bad`（床位数）、`systemcode`（房间稳定关联键，写入入住行的 `room_systemcode`）
  - **入住行**：`staff_code`、`staff_truename`、`room_code`、`room_systemcode`、`in_room` / `out_room`（在住：`1`/`0`）、`in_time`、`pass` / `del`（沿用项目审核与逻辑删除约定）
  - **入住扩展**：`room_info`（备注）、`electric`（优惠电量）；部分旧库可能存在 `status`（1=在宿）用于在宿判定
  - **员工**：`Hr_staff.code`（工号）、`Hr_staff.name`（姓名）、`status`（在职/离职）、`is_blacklist`（黑名单 0/1）
  - **电费表 `Hr_room_use`**：`room_code`、`tj_date`（与总览「设定日期」年月对齐）、`c_sum_money`（同月多条则后端 `SUM`）
- **权限（按钮级）**
  - 菜单 path：`hr/dormitory/room-management`（`view` / `add` / **`audit` 审核房间**）、`hr/dormitory/lodging-records`（**Tab**：房间总览 + **审核入住申请** + 住宿历史；`view`/`add`/`audit`/`edit` 见 `apiPermissionGate.js`）

### 3.6 `bom_000`（BOM 主档，v1.1.7）

- **Schema**：`dbo`（实际由数据库决定）
- **表名来源**：环境变量 `INV_BOM_MASTER_TABLE`，默认 `bom_000`
- **币别下拉**：物理表 **`bom_currency`**（环境变量 **`INV_BOM_CURRENCY_TABLE`** 可覆盖），展示列 **`cn_name`**；接口 **`GET /api/inventory/bom/currency-options`** 返回 `{ rows: [{ cn_name }] }`；主档 **`kcaa34` / `kcaa35`** 存所选中文名称（与新增模块文档一致）
- **模块/页面**
  - 前端：`src/views/inv/bom/index.vue`（菜单 path：`inv/bom`）；**同一列表**亦由 `src/views/inventory/basic/bom-data/index.vue`（菜单 path：`inventory/basic/bom-data`，侧栏「BOM资料」）内嵌复用
- **接口（后端：`server/index.js`）**
  - `GET /api/inv/bom/list`：分页列表；**`recycled=1`** 时仅 `del=1`（回收站，不按 `pass` 过滤）；否则 `WHERE` 含在册 `del` 与 `pass=@pass`；返回 **`systemcode`**（主档键）；默认排序 **edittime DESC**，`edittime` 空则 **addtime DESC**，次级 `kcaa01 ASC`；分页 **仅** `ROW_NUMBER()`（SQL Server 2008 R2）；名称搜索为参数化 `LIKE`，且 **输入满 3 字符** 才生效；**物料编码 `code`（kcaa01）**：若以 **`CUT-`** 开头且不含 `<`，用右模糊 `LIKE '关键词%'`；若含 `<` 用 `%关键词%`；其它情况先按 `Bom_code.flag5` 剥离前缀得核心款号，核心长度≥3 时用 `LIKE '%核心'`，否则 `%关键字%`；入参 **`bom_cut`**：默认 `0` 时强制执行 `kcaa01 NOT LIKE N'CUT-%'`，`bom_cut=1` 时取消；**显式以 `CUT-` 搜索时临时取消该排除**以便命中裁片
  - 主档 CRUD（标准件）：**`POST /api/inventory/bom/save-main`** 新增主档（`INSERT` 字段列表含 **systemcode、[GUID]、dr_systemcode**，`VALUES` 三连同一绑定参数；**[version]** 写入 **100**（**sql.Int**）；若存在 **`type`** 列则 **`[type] = 1`**（新增默认）；若 `bom_000` 缺少 **systemcode / guid（物理列名 GUID）/ dr_systemcode / version** 任一列则返回 500）；**systemcode** 已存在于库则拒绝；**`POST /api/inventory/bom`** 与前者共用处理函数；`PUT /api/inventory/bom` 保存时同步 **[GUID]、dr_systemcode** 与 **systemcode**；其余同前（审核/删除/校验等）
- **关键字段（接口 JSON 映射）**
  - `kcaa01` → `code`，`kcaa02` → `name`，`kcaa03` → `spec`，`kcaa04` → `unit`
  - `kcaa12` → `isPurchase`，`kcaa13` → `isSubcontract`，`kcaa14` → `isSelfProduced`
  - `sign` → `status`（接口字段名 `status`，避免与前端「状态」文案混淆时在列表列标题标注 `sign`）
  - `version`：版本号（排序降序）；`pass` / `del`：沿用项目「审核 / 逻辑删除」约定
- **权限（按钮级）**
  - 菜单 path：`inv/bom` 或 `inventory/basic/bom-data`：`view`（列表/详情/校验/换算建议）、`add`（新增）、`edit`（保存主档、恢复）、`audit`（审核/反审）、`delete`（软删/彻底删）；见 `apiPermissionGate.js`
- **主档稳定键 `systemcode`（与配件子表关联）**
  - `GET /api/inventory/bom/:id` 的 `data.basic.systemcode` 来自 `bom_000.systemcode`，**`data.basic.pass`** 来自主档；配件子表 **`Bom_parts.kcac01`** 存父级 `systemcode`（与物料编码 `kcaa01` 不是同一列）；表名可由 `INV_BOM_PARTS_TABLE` 覆盖
  - 若历史行 `systemcode` 为空，则「配件明细」Tab 无法加载/保存，需在库内补齐主档或按实际库结构再调整

### 3.6.1 `Bom_parts`（BOM 配件明细，v1.1.8+）

- **Schema**：`dbo`；**表名来源**：环境变量 `INV_BOM_PARTS_TABLE`，默认 `Bom_parts`（仅字母数字下划线）；**列类型权威清单**：[`docs/bom_parts.txt`](../bom_parts.txt)（内网导出）；关联主档：**`kcac01` = `bom_000.systemcode`**（两表 `systemcode` 均为 **nvarchar**，主档来源见 [`docs/bom_000.txt`](../bom_000.txt)）
- **模块/页面**
  - 前端：`src/views/inv/bom/index.vue` 详情弹窗 **Tab「配件明细」**（与 `inventory/basic/bom-data` 内嵌复用同一页）
- **接口（后端：`server/index.js`）**
  - **`GET /api/bom/tree?systemcode=...`**（**v1.2.7+**，用量表运算 Tab）：按 **`kcac01` → `kcac02`** 递归读 **`Bom_parts`**；**`WHERE` 仅按 `kcac01` 匹配**（与 **`GET /api/inventory/bom/parts`** 一致，**不在 SQL 中按 `del` 剔除**，避免旧库 `del` 为 NULL/空时子层查成 0 行）；**`kcac01`/`kcac02` 比较用 `CAST(… nvarchar(500))`**，避免 `CONVERT(100)` 截断长 `systemcode`；每层 **`ORDER BY Seq`**；返回 **嵌套 `children`** 树；**不写入** `bom_cost` / `Bom_consumption`；循环引用 **409**「检测到BOM循环引用」；权限同配件 **`view`**
  - `GET /api/inventory/bom/parts/:systemcode`：先 **TOP 1** 判断主档 `bom_000.systemcode` 存在且在册，再查 `Bom_parts`（`WHERE kcac01=@systemcode`，子行在册 `del`）；列表字段 **`kcaa01`/`kcaa02`/`kcaa03`/`kcaa11`** 优先通过 **`OUTER APPLY`**（按 `Bom_parts.kcaa01` = `bom_000.kcaa01` 匹配在册主档，`ORDER BY b.id DESC` **TOP 1**）取自 **`bom_000`**，无匹配时回退配件表同行；**不**对整表 `bom_000` 做大 JOIN；返回 **`kcac06`**（用量合计）
  - `PUT /api/inventory/bom/parts/:systemcode`：body `{ lines: [...] }` 批量处理；`id`+`pendingDelete=true` → 满足 **`id` + `kcac01`=主档 `systemcode`** 时物理删行；有 `id` 且未标记删除 → **`UPDATE … WHERE p.id=@id AND kcac01 匹配`**，写入 **`kcac04`/`kcac05`/`kcac06`**（若物理表存在 **`kcac06`** 列）及单价/备注等；无 `id` → `INSERT`。写入前 Node 侧对 **`kcac04`/`kcac05`/`kcac06`** 做 **6 位小数规整**（与 **decimal(18,6)** 对齐，§2）。成功更新用量类字段后写审计：`[更新]了配件用量，BOM：[主档 kcaa01]，配件：[kcaa01]，用量：[kcac04]，损耗：[kcac05]`
- **关键字段（与当前接口一致）**
  - `kcac01`：父级主档 `systemcode`；**`kcac02`**：子件关联编码（匹配下层 BOM 时优先用于关联 `bom_000.kcaa01`，空则回退 `kcaa01`）；`kcaa01`～`kcaa04`/`kcaa11`：配件编码、名称、规格、单位、颜色（GET 展示优先 **bom_000**）；`kcac04` 单位用量；`kcac05` 损耗率（**小数**，如 5% 存 `0.05`）；**`kcac06`** 用量合计（**kcac04 × (1 + kcac05)**，与前端一致）；`cost_price` 单价；`[Describe]` 行备注；`Seq` 排序；`del` 逻辑删除
- **权限（按钮级）**
  - `GET`：与 `GET /api/inventory/bom/:id` 相同（`view`）
  - `PUT`：菜单 `inv/bom` 或 `inventory/basic/bom-data` 的 `edit`

### 3.6.2 `Bom_cost` / `Bom_consumption`（历史表：曾用于用量运算）

- **说明**：部分库中仍存在上述物理表及历史数据。用量表 Tab 已恢复 **只读递归树**（`GET /api/bom/tree`，见 §3.6.1），**仍不读写** `Bom_cost` / `Bom_consumption`。
- **备注**：若需清理数据或重新规划功能，请在库侧另行评估；旧版算法说明曾归档于 [`docs/bom运算需求文档.md`](../bom运算需求文档.md)（仅供参考，与现行代码可能不一致）。

### 3.7 `Bom_colorcode`（颜色编码，v1.0.0+）

- **Schema**：`dbo`
- **模块/页面**
  - 前端：`src/views/inventory/basic/color-code/index.vue`（菜单 path：`inventory/basic/color-code`）
- **接口（后端：`server/index.js`）**
  - `GET /api/inventory/color-code/list`：分页（默认 `pageSize=20`）；在册时 `WHERE` 含 `del` 在册与 `pass=@pass`；**`recycled=1`** 时仅 `del=1`（不按 `pass` 过滤）；排序 **`intime DESC`**；`in_time` 展示为 **`yyyy/M/d`**（如 `2017/9/1`）；`keyword` 对 **`code`/`name`** 参数化 `LIKE`；分页 **`ROW_NUMBER()`**（SQL Server 2008 R2）；返回 `data.list[].del` 与 `data.recycled`
  - `POST /api/inventory/color-code`：body `{ code, name, ename?, info? }`；**`intime`** 为当天 **00:00:00**（`datetime`）；`pass='0'`，`del='0'`；**`addtime`** 业务时间串（示例 `2026-4-23 11:44:51`）；**`uid`/`uname`/`utruename`** 由 `getActorAuditTripletFromReq` 写入；在册 **`code` 唯一**校验
  - `PUT /api/inventory/color-code`：body `{ code, name, ename?, info? }`；仅 **在册且 `pass=0`** 可更新名称类字段并写 **`edittime`**（同上格式）
  - `PUT /api/inventory/color-code/audit`：body `{ code }`，在册且未审 → `pass='1'` 且 **`edittime`**
  - `PUT /api/inventory/color-code/unaudit`：body `{ code }`，在册且已审 → `pass='0'` 且 **`edittime`**
  - `DELETE /api/inventory/color-code/:code`：在册且**未审**可软删 → `del='1'` 且 **`deltime`** 业务时间串（已审拒绝）；路径主键 **`list` 为保留字**，后端拒绝
  - `DELETE /api/inventory/color-code/:code/permanent`：**仅 `del='1'`（回收站）** 时物理删除该行；在册则 400
  - `PUT /api/inventory/color-code/restore`：body `{ code }`，`del='1'` → `del='0'` 且 **`edittime`**
- **关键字段**
  - `code`：颜色编码；`name`：名称(中文)；`ename`：名称(英文，可空)；`info`：备注（可空）；`pass`：审核（`'1'` 已审 / `'0'` 未审）；`intime`：**datetime**（新增为当天零点）；接口 **`in_time`** 为 **`yyyy/M/d`**（如 `2017/9/1`）
  - `uid` / `uname` / `utruename`：录入人审计（分别对应 `Sys_Users.UserID`(int)、`UserCode`、`UserName`；新增接口自动填充）
  - `addtime` / `edittime` / `deltime`：业务时间串（`NVARCHAR` 建议 50；格式示例 `2026-4-23 11:44:51`）
  - `del`：逻辑删除（与项目约定一致）
- **权限（按钮级）**
  - 菜单 path：`inventory/basic/color-code`：`view`（列表）、`add`（新增）、`edit`（未审保存、恢复）、`audit`（审核/反审）、`delete`（软删/彻底删）

### 3.8 `Bom_unit`（使用单位）

- **Schema**：`dbo`
- **模块/页面**
  - 前端：`src/views/inventory/basic/units/index.vue`（菜单 path：`inventory/basic/units`）
- **接口（后端：`server/index.js`）**
  - `GET /api/inventory/units/list`：分页（默认 `pageSize=20`）；在册 `del`+`pass`；**`recycled=1`** 仅 `del=1`；`keyword` 对 **`name`/`info`** 参数化 `LIKE`；排序 **`id DESC`**；`ROW_NUMBER()`（SQL Server 2008 R2）
  - `POST /api/inventory/units`：body `{ name, info? }`；**`uid`/`uname`/`utruename`** 与 **`addtime`**（`getActorAuditTripletFromReq` + 时间串）；`pass='0'`，`del='0'`；**`id` 自增**
  - `PUT /api/inventory/units/audit` / **`unaudit`**：body `{ id }`；更新 **`pass`** 并写 **`edittime`**
  - `DELETE /api/inventory/units/:id`：在册且**未审** → **`del='1'`** 且 **`deltime`**
  - `PUT /api/inventory/units/restore`：body `{ id }`；**`del='0'`** 并写 **`edittime`**
- **关键字段**
  - `id`：主键（整型，建议 `IDENTITY`）；`name`；`info`（可空）；`pass` / `del`
  - `uid` / `uname` / `utruename`；`addtime` / `edittime` / `deltime`（业务时间串，规则 16）
- **权限（按钮级）**
  - 菜单 path：`inventory/basic/units`：`view`、`add`、`audit`、`delete`、`edit`（恢复）

### 3.9 `Bom_unit_change`（单位转换率）

- **Schema**：`dbo`
- **模块/页面**
  - 前端：`src/views/inventory/basic/unit-conversion/index.vue`（菜单 path：`inventory/basic/unit-conversion`）
- **接口（后端：`server/index.js`）**
  - `GET /api/inventory/unit-conversion/list`：分页（默认 `pageSize=20`）；在册 `del`+`pass`；**`recycled=1`** 仅 `del=1`；`keyword` 对 **`unit_name`/`unit_name_tow`** 参数化 `LIKE`；排序 **`id DESC`**；`ROW_NUMBER()`（SQL Server 2008 R2）
  - `POST /api/inventory/unit-conversion`：body `{ unit_name, unit_name_tow, change_bl }`；**`uid`/`uname`/`utruename`** 与 **`addtime`**（规则 16）；`pass='0'`，`del='0'`；**`id` 自增**
  - `PUT /api/inventory/unit-conversion/audit` / `unaudit`：body `{ id }`；更新 `pass` 并写 **`edittime`**
  - `DELETE /api/inventory/unit-conversion/:id`：在册且**未审** → `del='1'` 且 **`deltime`**（已审拒绝）
  - `PUT /api/inventory/unit-conversion/restore`：body `{ id }`；`del='0'` 且 **`edittime`**
- **关键字段**
  - `id`：主键（整型 `IDENTITY`）；`unit_name`：使用单位；`unit_name_tow`：转换单位；`change_bl`：转换率；`pass`/`del`：项目约定
  - `uid` / `uname` / `utruename`；`addtime` / `edittime` / `deltime`（业务时间串，规则 16）
- **权限（按钮级）**
  - 菜单 path：`inventory/basic/unit-conversion`：`view`、`add`、`audit`、`delete`、`edit`（恢复）

### 3.10 `Bom_material`（材料分类）

- **Schema**：`dbo`
- **模块/页面**
  - 前端：`src/views/inventory/basic/material-category/index.vue`（菜单 path：`inventory/basic/material-category`）
- **接口（后端：`server/index.js`）**
  - `GET /api/inventory/material-category/list`：分页（默认 `pageSize=20`）；在册 `del`+`pass`；**`recycled=1`** 仅 `del=1`；`keyword` 对 **`code`/`name`/`customs_code`** 参数化 `LIKE`；排序 **`id DESC`**；`ROW_NUMBER()`（SQL Server 2008 R2）
  - `POST /api/inventory/material-category`：body `{ code, name, customs_code?, stocks_in?, stocks_out? }`；**`uid`/`uname`/`utruename`** 与 **`addtime`**（规则 16）；`pass='0'`，`del='0'`；**`id` 自增**
  - `PUT /api/inventory/material-category/audit` / `unaudit`：body `{ id }`；更新 `pass` 并写 **`edittime`**
  - `DELETE /api/inventory/material-category/:id`：在册且**未审** → `del='1'` 且 **`deltime`**（已审拒绝）
  - `PUT /api/inventory/material-category/restore`：body `{ id }`；`del='0'` 且 **`edittime`**
- **关键字段**
  - `id`：主键（整型 `IDENTITY`）；`code`：分类编码；`name`：分类名称；`customs_code`：海关商品编码；`stocks_in`：入库浮动率；`stocks_out`：出库浮动率；`pass`/`del`：项目约定
  - `uid` / `uname` / `utruename`；`addtime` / `edittime` / `deltime`（业务时间串，规则 16）
- **权限（按钮级）**
  - 菜单 path：`inventory/basic/material-category`：`view`、`add`、`audit`、`delete`、`edit`（恢复）

### 3.11 `Bom_Stocks_workshop`（车间与部门编码）

- **Schema**：`dbo`
- **模块/页面**
  - 前端：`src/views/inventory/basic/workshop-dept/index.vue`（菜单 path：`inventory/basic/workshop-dept`）
- **接口（后端：`server/index.js`）**
  - `GET /api/inventory/workshop-dept/list`：分页（默认 `pageSize=20`）；在册 `del`+`pass`；**`recycled=1`** 仅 `del=1`；`keyword` 对 **`code`/`name`/`info`** 参数化 `LIKE`；排序 **`id DESC`**；`ROW_NUMBER()`（SQL Server 2008 R2）
  - `POST /api/inventory/workshop-dept`：body `{ code, name, info? }`；**`uid`/`uname`/`utruename`** 与 **`addtime`**（规则 16）；`pass='0'`，`del='0'`；**`id` 自增**
  - `PUT /api/inventory/workshop-dept/audit` / `unaudit`：body `{ id }`；更新 `pass` 并写 **`edittime`**
  - `DELETE /api/inventory/workshop-dept/:id`：在册且**未审** → `del='1'` 且 **`deltime`**（已审拒绝）
  - `DELETE /api/inventory/workshop-dept/:id/permanent`：回收站（`del='1'`）物理删除（不可恢复）
  - `PUT /api/inventory/workshop-dept/restore`：body `{ id }`；`del='0'` 且 **`edittime`**
- **关键字段**
  - `id`：主键（整型 `IDENTITY`）；`code`：车间与部门编码；`name`：车间/部门名称；`info`：备注；`pass`/`del`：项目约定
  - `uid` / `uname` / `utruename`；`addtime` / `edittime` / `deltime`（业务时间串，规则 16）
- **权限（按钮级）**
  - 菜单 path：`inventory/basic/workshop-dept`：`view`、`add`、`audit`、`delete`、`edit`（恢复）

### 3.12 `System_supplier`（供应商资料）

- **Schema**：`dbo`
- **模块/页面**
  - 前端：`src/views/supply-chain/basic/suppliers/index.vue`（菜单 path：`supply-chain/basic/suppliers`）
- **接口（后端：`server/index.js`）**
  - `GET /api/supply-chain/suppliers/list`：分页（默认 `pageSize=20`）；在册 `del`+`pass`；**`recycled=1`** 仅 `del=1`；`keyword` 对 **`s_code`/`s_name`/`s_sname`** 参数化 `LIKE`；排序 **`id DESC`**；`ROW_NUMBER()`（SQL Server 2008 R2）
  - `GET /api/supply-chain/suppliers/suggest-code`：返回建议编码（placeholder 用；优先纯数字最大值+1，兜底 `MAX(id)+1`）
  - `POST /api/supply-chain/suppliers`：新增（手动输入 `s_code`）；默认 `pass='0'`、`del='0'`；在列存在时写 `uid/uname/utruename/addtime`；编码在册唯一校验
  - `PUT /api/supply-chain/suppliers`：编辑（仅在册且未审核可改）；在列存在时写 `uid/uname/utruename/edittime`；编码在册唯一校验
  - `PUT /api/supply-chain/suppliers/audit`：body `{ id }`；在册且未审 → `pass='1'`，并在存在列时写入 `pass*`/`passtime`/`passip`/`edittime`
  - `PUT /api/supply-chain/suppliers/unaudit`：body `{ id }`；在册且已审 → `pass='0'`，并在存在列时清空 `pass*` 字段，写 `edittime`
  - `DELETE /api/supply-chain/suppliers/:id`：在册且**未审** → `del='1'`（存在列时写 `deltime`）
  - `PUT /api/supply-chain/suppliers/restore`：body `{ id }`；回收站 `del='1'` → `del='0'`（存在列时清空 `deltime`，写 `edittime`）
  - `DELETE /api/supply-chain/suppliers/:id/permanent`：回收站（`del='1'`）物理删除（不可恢复）
- **关键字段**
  - `id`：主键（整型）
  - `pass`：审核（`'1'` 已审 / `'0'` 未审）
  - `del`：逻辑删除（`'1'` 删除；`'0'`/空/NULL 在册）
  - 展示字段：`s_code`、`s_name`、`s_sname`、`s_sh`、`s_lb`、`s_lxr`、`s_mobile`、`s_tel`、`s_payfor`、`s_jh`、`s_wx_jh`、`sl`、`kplx`/`kplxx`/`kplxxx`、`s_info`
  - 新增补充：`s_address`（地址）、`s_business`（经营范围）、`s_bank`（开户行）、`s_bank_number`（银行账号）
- **权限（按钮级）**
  - 菜单 path：`supply-chain/basic/suppliers`：`view`（列表）、`audit`（审核/反审）、`delete`（软删）、`edit`（恢复）

### 3.13 `System_sales_customer`（销售客户）

- **Schema**：`dbo`
- **模块/页面**
  - 前端：`src/views/supply-chain/basic/customers/index.vue`（菜单 path：`supply-chain/basic/customers`）
- **接口（后端：`server/index.js`）**
  - `GET /api/supply-chain/customers/list`：分页（默认 `pageSize=20`）；在册 `del`+`pass`；**`recycled=1`** 仅 `del=1`；`keyword` 对 **`s_code`/`s_name`/`s_address`** 参数化 `LIKE`；排序 **`id DESC`**；`ROW_NUMBER()`（SQL Server 2008 R2）
  - `GET /api/supply-chain/customers/:id`：详情（不区分在册/回收站，用于“查看”）
  - `POST /api/supply-chain/customers`：新增（**手动输入 `s_code`**）；默认 `pass='0'`、`del='0'`；在列存在时写 `uid/uname/utruename/addtime`；编码在册唯一校验
  - `PUT /api/supply-chain/customers`：编辑（仅在册且未审核可改）；在列存在时写 `uid/uname/utruename/edittime`；编码在册唯一校验
  - `PUT /api/supply-chain/customers/audit`：body `{ id }`；在册且未审 → `pass='1'`，并在存在列时写入 `pass*`/`passtime`/`passip`/`edittime`
  - `PUT /api/supply-chain/customers/unaudit`：body `{ id }`；在册且已审 → `pass='0'`，并在存在列时清空 `pass*` 字段，写 `edittime`
  - `DELETE /api/supply-chain/customers/:id`：在册且**未审** → `del='1'`（存在列时写 `deltime`）
  - `PUT /api/supply-chain/customers/restore`：body `{ id }`；回收站 `del='1'` → `del='0'`（存在列时清空 `deltime`，写 `edittime`）
  - `DELETE /api/supply-chain/customers/:id/permanent`：回收站（`del='1'`）物理删除（不可恢复）
- **关键字段**
  - `id`：主键（整型）
  - `pass`：审核（`'1'` 已审 / `'0'` 未审）
  - `del`：逻辑删除（`'1'` 删除；`'0'`/空/NULL 在册）
  - 展示字段：`s_code`、`s_name`、`s_address`、`s_lxr`、`s_tel`、`s_mobile`、`s_payfor`、`lxr`、`s_info`
  - 新增补充：`s_business`（经营范围）、`s_lb`（类别：国内/国外/其他）
- **权限（按钮级）**
  - 菜单 path：`supply-chain/basic/customers`：`view`、`add`、`audit`、`delete`、`edit`（含恢复）

### 3.14 `System_settlement_method`（结算方式）

- **Schema**：`dbo`
- **模块/页面**
  - 前端：`src/views/supply-chain/basic/payment-methods/index.vue`（菜单 path：`supply-chain/basic/payment-methods`）
- **接口（后端：`server/index.js`）**
  - `GET /api/supply-chain/settlement-methods/list`：分页（默认 `pageSize=20`）；在册 `del`+`pass`；**`recycled=1`** 仅 `del=1`；`keyword` 对 **`code`/`name`/`info`** 参数化 `LIKE`；排序 **`id DESC`**；`ROW_NUMBER()`（SQL Server 2008 R2）
  - `GET /api/supply-chain/settlement-methods/suggest-code`：返回建议编码（打开新增时自动填入；优先纯数字最大值+1，兜底 `MAX(id)+1`）
  - `POST /api/supply-chain/settlement-methods`：body `{ code?, name, payfor, info? }`；`code` 为空则后端自动生成；默认 `pass='0'`、`del='0'`；在列存在时写 `uid/uname/utruename/addtime`；编码在册唯一校验
  - `PUT /api/supply-chain/settlement-methods`：编辑（仅在册且未审核可改）；写 `uid/uname/utruename/edittime`（列存在才写）；编码在册唯一校验；`code` 不允许修改
  - `PUT /api/supply-chain/settlement-methods/audit`：body `{ id }`；在册且未审 → `pass='1'`，并在存在列时写入 `pass*`/`passtime`/`passip`/`edittime`
  - `PUT /api/supply-chain/settlement-methods/unaudit`：body `{ id }`；在册且已审 → `pass='0'`，并在存在列时清空 `pass*` 字段，写 `edittime`
  - `DELETE /api/supply-chain/settlement-methods/:id`：在册且**未审** → `del='1'`（存在列时写 `deltime`）
  - `PUT /api/supply-chain/settlement-methods/restore`：body `{ id }`；回收站 `del='1'` → `del='0'`（存在列时清空 `deltime`，写 `edittime`）
  - `DELETE /api/supply-chain/settlement-methods/:id/permanent`：回收站（`del='1'`）物理删除（不可恢复）
- **关键字段**
  - `id`：主键（整型）
  - `code`：编码（新增默认自动生成：max(code)+1）
  - `name`：名称
  - `payfor`：天数
  - `info`：备注
  - `pass` / `del`：审核/逻辑删除（标准件约定）
- **权限（按钮级）**
  - 菜单 path：`supply-chain/basic/payment-methods`：`view`、`add`、`audit`、`delete`、`edit`（恢复）

### 3.15 `Purchase_Quotation` / `Purchase_Quotation_list`（采购报价主从）

- **Schema**：`dbo`
- **实现文件**：`server/purchaseQuotationHandlers.js`（`server/index.js` 注册路由）
- **模块/页面**
  - 前端：`src/views/supply-chain/daily/purchase-quote/index.vue`（菜单 path：`supply-chain/daily/purchase-quote`）
- **接口**
  - `GET /api/supply-chain/purchase-quotations/list`：主表分页；`keyword` 对主表文本列 OR `LIKE`；`pass` / `recycled` 与标准件一致；`ROW_NUMBER()` 分页
  - `GET /api/supply-chain/purchase-quotations/:id`：主表一行 + 明细列表（排序优先 `xh`/行号类列）
  - `GET /api/supply-chain/purchase-quotations/:id/lines`：仅明细（展开行懒加载）
  - `GET /api/supply-chain/purchase-quotations/bom-detail`：按物料编码 `kcaa01` 读 `bom_000`（明细选材弹窗补全名称/规格/颜色/单位）
  - `POST /api/supply-chain/purchase-quotations`：body `{ header, lines[] }`；事务：`OUTPUT INSERTED` 取主键后批量插入明细；若存在 `systemcode`/`code`/`quotation_code`/`dh`/`djbh`/`bill_no` 之一则在册单号唯一校验
  - `PUT /api/supply-chain/purchase-quotations`：body `{ id, header, lines[] }`；**已审主表 `pass=1` 禁止保存**（400）；在册且未审；事务内 `DELETE` 旧明细再整批 `INSERT`；允许仅改明细（主表 `SET` 可为 PK 自赋值占位）
  - `PUT /api/supply-chain/purchase-quotations/audit` / `unaudit` / `restore`：body `{ id }`（与供应商等模块一致）
  - `DELETE /api/supply-chain/purchase-quotations/:id`：软删主表（已审禁止）
  - `DELETE /api/supply-chain/purchase-quotations/:id/permanent`：事务内先删明细再删主表（仅回收站且未审）
- **前端明细（v1.2.1）**：页内 `MaterialSelector` 调 `GET /api/inv/bom/list`（采购报价菜单 `view` 已放行）选编码，含税单价 **`cgab05` = `cgab04` × (1 + `Tax`/100)**，按主表小数位四舍五入；备注列 **`remark`**；删除行前二次确认；主表已审时明细区域禁用并与后端一致拦截。
- **明细关键字段（`Purchase_Quotation_list`）**
  - **`kcaa01`–`kcaa05`**：材料编码/名称/规格/颜色/单位（选材自 `bom_000`）
  - **`cgab04`**：单价（不含税）；**`Tax`**：税点 0–100（接口与库可能为小数税率，前端归一为百分比）
  - **`cgab05`**：单价（含税），只读计算字段
  - **`remark`**：行备注
- **审计**：`POST`/`PUT` 成功时日志含「明细共 N 项物料」类人话（见 `server/operationAuditMiddleware.js`）。
- **元数据探测**：首次请求时读取 `INFORMATION_SCHEMA` 列清单、`PRIMARY KEY`（主表须单列主键）、`IDENTITY` 列、以及 `sys.foreign_keys` 指向主表的明细外键列（无则按候选列名兜底）。
- **权限（按钮级）**
  - 菜单 path：`supply-chain/daily/purchase-quote`：`view`、`add`、`edit`、`audit`、`delete`

### 3.15b `Outsourcing_Quotation` / `Outsourcing_Quotation_list`（外协报价主从）

- **Schema**：`dbo`
- **实现文件**：`server/outsourcingQuotationHandlers.js`（`server/index.js` 注册 `registerOutsourcingQuotationRoutes`）
- **模块/页面**
  - 前端：`src/views/supply-chain/daily/outsourcing-quote/index.vue`（菜单 path：`supply-chain/daily/outsourcing-quote`）
  - 选材弹窗复用：`src/views/supply-chain/daily/purchase-quote/MaterialSelector.vue`
- **接口**：与采购报价路径对称，前缀改为 **`/api/supply-chain/outsourcing-quotations`**（`list`、`suggest-doc-no`、`check-doc-no?wxaa01=`、`supplier-options`、`bom-detail`、`POST`/`PUT`、`audit`/`unaudit`/`restore`、`DELETE` 软删与 `/permanent`）
- **主表常用字段**：**`wxaa01`** 外协单号；**`wxaa02`** 报价日期；**`wxaa07`** 有效期；**`rmb`** / **`wxaa05`** 币别代码与名称（与采购报价表单同一组合录入逻辑）；**`kehu`** 供应商/外协商；**`remark`** 备注
- **明细关键字段**：**`wxab01`** 关联主表单号；**`wxab04`**/**`wxab05`** 不含税/含税金额（列表按行 `SUM`）；选材字段 **`kcaa01`** 等与采购报价明细一致
- **权限（按钮级）**
  - 菜单 path：`supply-chain/daily/outsourcing-quote`：`view`、`add`、`edit`、`audit`、`delete`

### 3.13 `Sys_Users`（用户 / 操作员）

- **Schema**：通常为 `dbo`（实际由数据库决定）
- **模块/页面**
  - 前端：`src/views/system/operator/index.vue`
  - 设计：`src/views/system/rbac_design.md`（含与角色表关系说明）
- **接口（后端：`server/index.js` + `server/operatorUsersHandlers.js`）**
  - **旧版表结构**（`INFORMATION_SCHEMA` 判定为 legacy：`uid` + `username` + `usercode`，且存在 `del`、`pass`）时由 **操作员管理**（`server/operatorUsersHandlers.js`）接管：
    - `GET /api/users`：默认 `del=0`（`status=1`）或回收站 `del=1`（`status=0`）；**姓名列直接取 `Sys_Users.truename`**（不再 JOIN `Hr_staff`）；`LEFT JOIN Sys_Roles` 取 `RoleName`；`keyword` 可对 `usercode` / `username` / `truename` 模糊匹配；列表含 `Pass`；分页仅 `ROW_NUMBER()`（SQL Server 2008 R2）。
    - `GET /api/users/:id`：单条只读详情（同上 JOIN）。
    - `PUT /api/users`：`op=unpass` 将 `pass` 置 `0`（反审核）；`op=soft_delete` 将 `del` 置 `1` 并写 `deltime`；普通 body 为编辑（写 `edittime` 及存在的 `uid`/`uname`/`utruename` 审计列）；日志 Content 按规则 16 / 产品模版拼接。
    - `PUT /api/users/resume`：回收站恢复为 `del=0`（并清 `deltime` 若存在列）。
    - `POST /api/users`：初始密码 `123` **bcrypt**；写入前 **`password` 列不足 60 时 API 自动 ALTER 为 NVARCHAR(200)**；`PUT` 支持 `op=audit|unpass|disable`；列表默认 `pass=1`，`pass=0` 为未审核视图。
    - `DELETE /api/users/:id`：该结构下禁止物理删除，返回 400，请走软删除。
  - **ERP 标准列**（非 legacy）时仍以 `server/index.js` 内原有 `UserID`/`Status` 等分支为准。
- **关键字段（已确认）**
  - `del`：**逻辑删除 / 账号禁用**（与全库约定一致）。`'0'` 或空为启用、可登录；`'1'` 为禁用、不可登录。`GET /api/users` 与 `POST /api/login` 在存在该列时**优先**按 `del` 判断；若无该列再使用 `Status`。
  - `pass`：审核状态（与全库约定一致，`'1'`/`1` 已审核，`'0'`/`0` 未审核）；v1.1.9 列表「状态」列直接展示该字段。
  - **`UserID`**：业务主键（自增）；列表/编辑/反审/软删的 `WHERE` 均以 **`UserID=@UserID`** 为准（`server/getSysUsersEntityPkQb`：有 `UserID` 列优先，否则退回仅 `uid` 的极旧库）。
  - **`uid`**：与 `UserID` 并存时作**审计/人事关联**（`getSysUsersAuditUidQb`）；**禁止**再当作列表主键或 `WHERE` 定位行。
  - `usercode` / `username` / **`truename`**：旧版中 `username` 为登录账号展示列；**`truename` 为姓名**；编辑/新增时由后端按列元数据拼 SQL。
  - `RoleID`：外键指向 `Sys_Roles.RoleID`（约束名：`FK_Sys_Users_Sys_Roles_RoleID`）
  - `is_active`：账号可登录（1/0）；员工离职后置 0（用于封禁登录；与 `del` 并存时两者均会校验）

## 4. 环境变量清单（与表名相关）

- `HR_LEGACY_DEPT_TABLE`：部门/岗位表名，默认 `HR_Departments`
- `HR_STAFF_TABLE`：员工档案表名，默认 `Hr_staff`
- `INV_BOM_MASTER_TABLE`：BOM 主档表名，默认 `bom_000`（仅字母数字下划线）
- `INV_BOM_CURRENCY_TABLE`：BOM 币别表名，默认 `bom_currency`（仅字母数字下划线）
- `INV_BOM_PARTS_TABLE`：BOM 配件明细表名，默认 `Bom_parts`（仅字母数字下划线）
- `DB_REQUEST_TIMEOUT_MS`：SQL 请求超时（mssql/tedious），默认 `60000`；旧默认 15000ms 易在大查询时报「Timeout: Request failed to complete」

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
- **`dbo.[Hr_room]` / `dbo.[Hr_room_in]` / `dbo.[Hr_room_use]`**
  - 来源：`server/index.js`（宿舍列表、办理入住、住宿总览/历史/入住单审核）
- **`dbo.[bom_000]`（表名可由环境变量 `INV_BOM_MASTER_TABLE` 覆盖）**
  - 来源：`server/index.js`（`GET /api/inv/bom/list`、`GET /api/inventory/bom/:id`、`POST /api/inventory/bom/usage-calc/:systemcode`）
- **`dbo.[Bom_parts]`（表名可由 `INV_BOM_PARTS_TABLE` 覆盖）**
  - 来源：`server/index.js`（`GET`/`PUT /api/inventory/bom/parts/:systemcode`、`POST /api/inventory/bom/save-parts`、`POST /api/inventory/bom/usage-calc/:systemcode`）
  - **保存配件明细（PUT/POST）**：对每一行在事务内执行统一 **UPDATE**——**双重锁定** `p.id` + `p.kcac01`（当前主 BOM 的 `systemcode`）；通过 **`OUTER APPLY`** 按 `p.kcaa01` 关联 **`bom_000`** 在册最新一行（`ORDER BY b.id DESC`，与 GET 明细一致），将 **`kcaa01`～`kcaa35`**（仅写入表中存在的列）、**`kcac02`** 及 **`systemcode`**（若明细表存在该列，值同子 BOM `bom_000.systemcode`）从主档同步；**`kcac04`/`kcac05`/`kcac06`、`cost_price`、`remark`、`Seq`** 仍以请求体为准。无匹配子 BOM 时：`kcaa02`/`kcaa03`/`kcaa04`/`kcaa11` 回落到请求体，其余 `kcaa` 保留行内原值。新增行：`INSERT … OUTPUT INSERTED.id` 后立即同上 UPDATE。物理删除逻辑未改。
  - **审计**：若配件编码在 `bom_000` 存在在册子档，保存成功后额外写日志：`[同步]了BOM配件属性，主BOM：[systemcode]，配件：[kcaa01]，已同步kcaa01-kcaa35共35个字段。`（动作名：`同步BOM配件属性`）
- **`dbo.[Bom_cost]` / `dbo.[Bom_consumption]`**
  - 来源：`server/index.js`（`GET /api/inv/bom/list` 汇总、`GET /api/inventory/bom/usage-result/:systemcode`、`POST /api/inventory/bom/usage-calc/:systemcode`）
- **`dbo.[Bom_code]`**
  - 来源：`server/index.js`（BOM 用量运算规则：`copen=1`、`flag5` 动态匹配）
- **`dbo.[Bom_colorcode]`**
  - 来源：`server/index.js`（颜色编码列表、新增、审核、反审、软删、回收站彻底删、恢复）
- **`dbo.[Bom_unit]`**
  - 来源：`server/index.js`（使用单位列表、新增、审核、反审、软删、恢复）

- **`dbo.[Bom_unit_change]`**
  - 来源：`server/index.js`（单位转换率列表、新增、审核、反审、软删、恢复）

- **`dbo.[Bom_material]`**
  - 来源：`server/index.js`（材料分类列表、新增、审核、反审、软删、恢复）

- **`dbo.[Bom_Stocks_workshop]`**
  - 来源：`server/index.js`（车间与部门编码列表、新增、审核、反审、软删、恢复）

- **`dbo.[Purchase_Quotation]` / `dbo.[Purchase_Quotation_list]`**
  - 来源：`server/purchaseQuotationHandlers.js`（采购报价 REST）

- **`dbo.[Outsourcing_Quotation]` / `dbo.[Outsourcing_Quotation_list]`**
  - 来源：`server/outsourcingQuotationHandlers.js`（外协报价 REST）

- **`dbo.[System_uplod_file]`**
  - 来源：`server/paperPatternImportFilesList.js`（`GET /api/paper-pattern/import/files/list`）；列表范围 `filepath` 含 `ub_bom`；环境变量 `SYSTEM_UPLOAD_FILE_TABLE`
  - 磁盘：`PAPER_PATTERN_UPLOAD_DIR` / `PAPER_PATTERN_DOWNLOAD_ROOT`（`server/paperPatternFilePaths.js`）

