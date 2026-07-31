# 人力资源 — 人事档案精简管理模块设计（v1.0.9）

## 1. 物理表

- 表名：`dbo.[UB_ERP_Hr_staff]`（可用 `.env` 覆盖：`HR_STAFF_TABLE`）。
- 由于字段很多，本模块 **严禁** 查询无用字段，仅使用下列字段，提升几十万数据量下的查询性能。

| 字段 | 说明 |
|------|------|
| `code` | 工号（业务主键） |
| `new_code` | 新工号 |
| `name` | 姓名 |
| `in_bm` | 部门 |
| `position` | 岗位 |
| `card_number` / `new_card_number` | 旧卡号 / 新卡号 |
| `sfz_number` | 身份证号 |
| `birth` | 出生日期（列表显示完整日期并计算年龄） |
| `password` | 报餐密码 |
| `meal_type` | 饭餐类型（如：员工餐、管理餐） |
| `intime` | 入职时间 |
| `addtime` / `edittime` | 录入时间 / 修改时间（列表操作时间优先显示修改时间） |
| `del` / `pass` | 在职状态用 `del`：`'0'` 在职、`'1'` 离职；审核用 `pass`：`'1'` 已审核、`'0'`/空 未审核（列表合并为“状态”） |
| `pass` | 审核状态：`'1'` 已审核（锁定编辑资料），`'0'`/空 未审核 |

## 2. 搜索优先级（按需求固定）

查询参数同时存在时，后端按以下优先级生效：

`keyword` 同时模糊匹配 **`name`**、**`code`**、**`card_number`**。

## 3. 接口（`server/index.js`）

返回结构：`{ code, msg, data }`；列表返回 `data: { list, total }`。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/hr/staff` | 分页：`page`、`pageSize`；`pass`；`del`（`0` 在职 / `1` 离职）；`keyword` |
| POST | `/api/hr/staff` | 新增：仅写入有效字段；`pass` 默认 `'0'` |
| PUT | `/api/hr/staff` | 编辑：仅更新有效字段；若 `pass='1'` 返回审核锁定 |
| DELETE | `/api/hr/staff/:code` | **办理离职**：`del='1'`；已审核也可；不封系统账号 |
| PUT | `/api/hr/staff/restore` | **恢复在职**：`del='0'`；已审核也可 |
| PUT | `/api/hr/staff/audit` | 审核：`{ code }`，写 `pass='1'` |
| PUT | `/api/hr/staff/unaudit` | 反审：`{ code }`，写 `pass='0'` |

## 4. 分页性能

- 采用 `ORDER BY code OFFSET ... FETCH NEXT ...`。
- 若遇到旧版本/兼容级别不支持 `OFFSET/FETCH`，自动降级为 `ROW_NUMBER()` 分页。

## 5. 权限（`server/apiPermissionGate.js`）

菜单 path：`hr/files/employee-files`，操作：`view` / `add` / `edit` / `delete` / `audit`。办理离职走 `delete`；恢复在职走 `edit`。

## 6. 前端页面

- 路径：`src/views/hr/files/employee-files/index.vue`
- 列表仅显示：操作、状态、姓名、旧/新工号、旧/新卡号、部门、岗位、操作时间、身份证号、出生月日、年龄、入职日期、餐别；入职部门/岗位使用 **`GET /api/hr/staff/department-options`**、**`GET /api/hr/staff/department-posts`**（仅已审核；`pass` 用 `CAST` 比较，兼容数值型存储）。
- 新增/编辑/查看表单**无备注字段**（本库员工表通常无 `remark`；后端对 `remark` 按列探测兼容）。
- 默认分页：20
- 筛选：显示未审核 / 显示离职员工（无回收站）
- 已审核禁用编辑；办理离职/恢复在职不受审核锁
- 年龄：由前端按完整 `birth` 日期实时计算，旧数据日期不完整或不合法时留空。

