# 人力资源 — 人事档案精简管理模块设计（v1.0.9）

## 1. 物理表

- 表名：`dbo.[UB_ERP_Hr_staff]`（可用 `.env` 覆盖：`HR_STAFF_TABLE`）。
- 由于字段很多，本模块 **严禁** 查询无用字段，仅使用下列字段，提升几十万数据量下的查询性能。

| 字段 | 说明 |
|------|------|
| `code` | 工号（业务主键） |
| `name` | 姓名 |
| `sex` | 性别 |
| `in_bm` | 部门 |
| `card_number` | 10位卡号（显示时不足 10 位前端红字提醒） |
| `meal_type` | 饭餐类型（如：员工餐、管理餐） |
| `yn_history` | 是否曾在我司应聘（是/否；旧数据可能有 有/无） |
| `remark` | 备注（`nvarchar(500)`，迁移脚本添加；员工档案表单多行输入） |
| `intime` | 入职时间 |
| `pass` | 审核状态：`'1'` 已审核（锁定改删），`'0'`/空 未审核 |

## 2. 搜索优先级（按需求固定）

查询参数同时存在时，后端按以下优先级生效：

1. **`name` 模糊**（`LIKE %name%`）
2. **`code` 精确**
3. **`card_number` 精确**

## 3. 接口（`server/index.js`）

返回结构：`{ code, msg, data }`；列表返回 `data: { list, total }`。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/hr/staff` | 分页：`page`（默认1）、`pageSize`（默认20）；搜索：`name`（模糊）、`code`（精确）、`card_number`（精确） |
| POST | `/api/hr/staff` | 新增：仅写入有效字段；`pass` 默认 `'0'` |
| PUT | `/api/hr/staff` | 编辑：仅更新有效字段；若 `pass='1'` 返回「该记录已审核锁定，请反审后再操作」 |
| DELETE | `/api/hr/staff/:code` | 删除：若 `pass='1'` 禁止（当前为物理删除；若旧表有逻辑删除字段，可后续改为软删） |
| PUT | `/api/hr/staff/audit` | 审核：`{ code }`，写 `pass='1'` |
| PUT | `/api/hr/staff/unaudit` | 反审：`{ code }`，写 `pass='0'` |

## 4. 分页性能

- 采用 `ORDER BY code OFFSET ... FETCH NEXT ...`。
- 若遇到旧版本/兼容级别不支持 `OFFSET/FETCH`，自动降级为 `ROW_NUMBER()` 分页。

## 5. 权限（`server/apiPermissionGate.js`）

菜单 path：`hr/files/employee-files`，操作：`view` / `add` / `edit` / `delete` / `audit`。

## 6. 前端页面

- 路径：`src/views/hr/files/employee-files/index.vue`
- 新增/编辑弹窗：双列栅格 + 分组标题；入职部门/岗位使用 **`GET /api/hr/staff/department-options`**、**`GET /api/hr/staff/department-posts`**（仅已审核；`pass` 用 `CAST` 比较，兼容数值型存储）。
- 默认分页：20
- 已审核禁用：`pass === '1'` 时禁用编辑/删除；审核/反审互斥且带确认框
- 卡号提示：`card_number` 非空且长度 < 10 显示红字「不足10位」

