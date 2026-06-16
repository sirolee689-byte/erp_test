# 人力资源 — 档案管理（`hr/files`）

## 已完成功能

### 部门资料（`department/index.vue`）

- **数据源**：部门物理表由根目录 `.env` 中 **`HR_LEGACY_DEPT_TABLE`** 指定（仅字母、数字、下划线），**默认 `UB_ERP_Hr_department`**。
- **字段**：与旧库一致：`code`、`name`、`manager`（历史列，新增写入为 NULL）、**`remark`（备注，v1.1.0 迁移新增）**、`pass`、`del` 等；组织关系字段 **`ParentID`**（岗位必须填写所属部门的 `code`；顶级部门 `ParentID` 为空）。
- **编码**：新增部门/岗位时 **`code` 由后端** 按表中「**纯数字** `code`」取最大值 **+1** 生成（兼容 **SQL Server 2008 R2**：不用 `TRY_CONVERT`，用 `PATINDEX` + `CAST`）；前端不再手填编码。
- **名称规则**：部门与岗位共用一张表，但查重规则按业务口径区分：
  - **部门**（顶级，`ParentID` 为空/0）：名称全局不可重复
  - **岗位**（`ParentID` 非空）：**同一部门下**岗位名称不可重复；不同部门允许同名（例如不同部门都有“经理”）
- **分页**：`GET /api/hr/departments`，默认 **`pageSize=20`**；搜索关键字模糊匹配 **`name`、`code`、`remark`**。
- **树形展示**：部门资料页默认“树形显示”，通过 `GET /api/hr/departments/tree` 获取全量（上限 5000）并组装为 **部门（父）→岗位（子）**，让岗位归属一眼清晰；需要分页时可关闭树形显示回到平铺列表。
- **默认只看已审核**：列表接口默认只返回 `pass='1'` 的数据；前端提供“显示未审核”开关，打开后传 `pass='0'` 只看待审核数据。
- **批量审核（仅当前页）**：打开“显示未审核”后出现【批量审核（仅当前页）】按钮；为避免误操作，只审核**当前分页页**的记录（例如 20 条/页仅审核这 20 条），并走后端 `PUT /api/hr/departments/audit-batch`。
- **审核**：`pass === '1'` 为已审核；已审核行 **禁用编辑、删除**；后端改删前同样校验，提示「该记录已审核锁定，请反审后再操作」。**`flag` 仅展示**，不参与列表筛选。
- **删除**：**逻辑删除**（更新 `del`、`deltime`、`delid`/`delname`/`deltruename` 等），不物理删行。
- **权限**：菜单 path `hr/files/department`；含 `view` / `add` / `edit` / `delete` / `audit`。
- **岗位**：页面顶部提供【新增岗位】；岗位新增/修改时必须选择“所属部门”（`ParentID` 不能为空）；已审核岗位禁止修改所属部门。
- **新增写入创建人**：新增部门/岗位时，把登录用户的 **ID/名称** 写入部门表字段 **`uid` / `uname`**（便于追溯创建人）。

### 员工档案资料

- **数据源**：旧系统员工表 `dbo.[UB_ERP_Hr_staff]`（可用 `.env` 覆盖：`HR_STAFF_TABLE`）。
- **只查有效字段**：`code`、`new_code`、`name`、`sex`、`nation`、`highest`、`yn_firend`、`birth`、`in_bm`、`card_number`、`join_department`、`position`、`meal_type`、`yn_history`、`remark`、`intime`、`pass`（避免 SELECT *）。
- **分页**：`GET /api/hr/staff`，默认 **`pageSize=20`**；支持 `OFFSET/FETCH`，不支持时自动降级 `ROW_NUMBER()`；**`pass`** 与部门页一致（默认已审核 `1`，「显示未审核」传 `0`）。
- **搜索优先级**：先 `name` 模糊，再 `code` 精确，再 `card_number` 精确。
- **审核**：`pass === '1'` 为已审核；已审核行 **禁用编辑、删除**；审核/反审互斥且带确认弹窗。
- **卡号提醒**：列表显示时，`card_number` 非空且不足 10 位，前端红字提示「不足10位」。 

#### v1.1.2 批量更新（Excel）

- **入口**：员工档案资料页新增按钮【批量更新】。
- **文件限制**：仅支持上传 **xlsx/xls**；第一行必须是表头三列：**姓名 / 部门 / 岗位**。
- **关联规则（重点）**：
  - 用 **姓名** 在 `UB_ERP_Hr_staff` 精确匹配员工（必须唯一；同名会提示失败）。
  - 用 **部门名称** 在 `UB_ERP_Hr_department` 精确匹配 **已审核的顶级部门**（必须唯一、且未删除）。
  - 用 **岗位名称** 在 `UB_ERP_Hr_department` 精确匹配 **该部门下的已审核岗位**（必须唯一、且未删除）。
  - 更新字段：`UB_ERP_Hr_staff.in_bm = 部门名称`（展示用）、`join_department = 部门code`、`position = 岗位code`。
  - **仅更新已审核员工（pass='1'）**；未审核（pass!=1）会在结果中显示为「跳过」。
- **接口**：`POST /api/hr/staff/batch-update`（权限按 `hr/files/employee-files` 的 `edit`）。
- **已知注意**：Excel 走 base64 传输，文件过大可能会慢；建议一批几百行以内。

#### v1.1.2 恢复员工档案（逻辑删除）

- **删除方式调整**：员工档案删除改为 **逻辑删除**（更新 `del='1'`，不再物理删除行）。
- **默认不显示已删除**：列表接口默认只查 `del='0'`；页面新增开关【显示已删除】可切换查看 `del='1'` 的记录。
- **恢复入口**：已删除行提供【恢复】按钮，调用 `PUT /api/hr/staff/restore` 把 `del` 改回 `0`。
- **审核锁定一致**：若员工 `pass='1'`（已审核），删除/恢复均提示「该记录已审核锁定，请反审后再操作」。

#### v1.1.2 查看员工详情

- **入口**：员工档案资料列表行内新增【查看】按钮。
- **行为**：弹出只读详情弹窗（不允许修改），用于查看完整字段。
- **接口**：`GET /api/hr/staff/:code`（允许查看已删除记录）。

#### v1.1.2 员工离职/状态修改

- **字段（需迁移）**：
  - `UB_ERP_Hr_staff.status`：`nvarchar(20)`，默认 `在职`；离职后为 `离职`
  - `UB_ERP_Hr_staff.leave_date`：`datetime`，离职时写入当前时间
  - `UB_ERP_User.is_active`：`int`，默认 `1`；离职时置 `0`（账号封禁）
- **迁移脚本**：
  - SQL：`docs/sql/sqlserver_v1.1.2_hr_staff_leave_fields.txt`
  - 命令：`npm run migrate:hr-staff-leave-fields`
- **接口**：`PUT /api/hr/staff/leave/:id`（事务：更新员工状态 + 封禁账号；成功后 `writeLog` 写入 **`UB_Date_ERP_Operation_log`**）
- **前端**：员工列表新增「在职状态」标签，并提供【办理离职】按钮（danger，二次确认）。

#### v1.1.0 新增员工（Staff Profile）调整

- **档案编码**：新增时不再手填 `code`，后端按 **YYYYMMDD + 两位流水号** 自动生成（并发用事务锁保证不冲突）。
- **新档案编码**：对应旧表字段 `new_code`，可选手动输入。
- **卡号**：对应旧表字段 `card_number`，**必填且必须 10 位数字**。
- **入职部门/岗位**：对应旧表字段 `join_department` / `position`；员工页**专用接口**（避免与部门资料页共用下拉口径混淆）：
  - 已审顶级部门：`GET /api/hr/staff/department-options`（SQL 用 `CAST(pass AS nvarchar)` 判断 `= '1'`，兼容 pass 存为数值型）
  - 已审岗位：`GET /api/hr/staff/department-posts?parentId=部门code`
- **部门资料页**仍用：`GET /api/hr/departments/options`、`GET /api/hr/departments/posts`（**不按 pass 过滤**，便于未审部门下挂岗位维护）
- **新增/编辑弹窗 UI**：`el-row` + `el-col`（每格 `span=12`）双列；`el-divider` 分为「基本信息 / 岗位信息 / 背景调查」；**备注**为 `textarea` 独占一行（`span=24`），写入字段 **`remark`**（需先执行员工表备注列迁移，见下）。
- **入职时间**：默认当天（`YYYY-MM-DD` 字符串写入 `intime`）。
- **民族 / 文化程度 / 亲友在本司 / 出生日期**：分别对应旧表字段 **`nation`**、**`highest`**、**`yn_firend`**（表内历史拼写，勿改）、**`birth`**（`YYYY-MM-DD`）；表单与列表已展示，新增/编辑会写入。
- **饭餐类型**：界面文案为饭餐类型，对应字段 **`meal_type`**；默认 **员工餐**，可选 **管理餐**；接口未传或空时后端按 **员工餐** 写入。
- **是否曾在我司应聘**：对应字段 **`yn_history`**；表单选项为 **是 / 否**（旧数据「有/无」打开编辑时会映射为是/否）。
- **只读核验接口（RPA 用）**：`GET /api/hr/staff/debug-code?name=...&card_number=...`（仅查询，不写库）。

## 配置提示

- **v1.1.0 部门备注列迁移**：在项目根目录执行 `npm run migrate:hr-departments-remark`（或手动执行 `docs/sql/sqlserver_v1.1.0_hr_departments_add_remark.txt`）。若物理表名不是 `UB_ERP_Hr_department`，请先在 SQL 脚本里把表名改成与 **`HR_LEGACY_DEPT_TABLE`** 一致再执行。
- **v1.1.0 员工备注列迁移**：员工档案读写 **`remark`** 前，请在项目根目录执行 **`npm run migrate:hr-staff-remark`**（脚本按 **`HR_STAFF_TABLE`** 动态 `ALTER TABLE` 增加 `remark`，重复执行安全）。未迁移时接口会因缺列报错。
- 若实际表名不是 `UB_ERP_Hr_department`，在 `.env` 增加一行：`HR_LEGACY_DEPT_TABLE=你的表名`，重启 `npm run dev:server`。
- 审核写入 `passutruename` 等依赖登录 token 中的用户信息，**改代码后建议重新登录一次**。

## 自动化冒烟（Playwright）

- 脚本：`scripts/e2e-dept-office.mjs`（使用本机 **Chrome**，`chromium.launch({ channel: 'chrome' })`，避免内网镜像缺 headless_shell 包）。
- 命令：`npm run e2e:dept-office`
- 脚本：`scripts/e2e-staff-form-ui.mjs` — 登录后打开员工档案，点「新增员工」，**全页截图**输出到项目根目录 **`e2e-output/staff-dialog.png`**（用于双列表单 UI 自检）。
- 命令：`npm run e2e:staff-form-ui`
- 前置：根目录 `.env` 配置 **`E2E_USERCODE`**、**`E2E_PASSWORD`**（仅本机自动化用）；**Vite + 后端**已启动；若 Vite 不在 5173，设置 **`PLAYWRIGHT_BASE_URL`**（例如 `http://localhost:5174`）；员工接口需已存在 **`remark`** 列（见上迁移）。

## 相关文档

- `src/views/system/hr_department_design.md`
- `src/views/system/hr_staff_design.md`
