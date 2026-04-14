# 人力资源 — 部门资料模块设计（接管旧系统表）

## 1. 物理表

- 物理表名由环境变量 **`HR_LEGACY_DEPT_TABLE`** 指定，**默认 `HR_Departments`**（仅字母数字下划线，防 SQL 拼接注入）。
- **严禁**在应用层改名：接口 JSON 与下列列名一致（小写键）。

| 列名 | 说明 |
|------|------|
| `code` | 部门编码（业务主键） |
| `name` | 名称 |
| `manager` | 负责人 |
| `addtime` / `edittime` / `deltime` / `intime` | 时间（旧表均为 nvarchar，按字符串读写） |
| `del` | 逻辑删除：`''`/`NULL`/`'0'` 为在册；删除操作置 `'1'` |
| `flag` | 标志位：**仅列表展示**，默认不参与 WHERE |
| `info` / `systemcode`等 | 随 SELECT 返回，不在本页表单中编辑 |
| `pass` | 审核状态：**`'1'` = 已审核**（锁定改删），**`'0'` 或空 = 未审核** |
| `passid` / `passuname` / `passuid` / `passutruename` / `passtime` | 审核人及时间；审核时写入，`passutruename` 用当前登录用户姓名 |
| `uploadtime` / `ip` | 原样返回 |
| `delid` / `delname` / `deltruename` | 逻辑删除时写入当前操作者 |

## 2. 接口（`server/index.js`）

`data.list` 中每条对象均含上表全部键（缺省为 `null`），**字段名小写**。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/hr/departments` | `page`（默认1）、`pageSize`（**默认20**）、`keyword`（模糊 **`name`、`code`**）；仅 `del` 在册行；返回 `{ list, total }` |
| POST | `/api/hr/departments` | body：`code`,`name`,`manager`；`pass=N'0'`,`del=N'0'`，`addtime`/`edittime` 填当前时间字符串 |
| PUT | `/api/hr/departments` | body：`code`,`name`,`manager`；**`pass='1'` 禁止** |
| PUT | `/api/hr/departments/audit` | body：`{ code }` |
| PUT | `/api/hr/departments/unaudit` | body：`{ code }` |
| DELETE | `/api/hr/departments/:code` | **逻辑删除**（非物理 DELETE） |

## 3. 权限

见 `rbac_design.md` §6；`DELETE` 路径参数为 **字符串 code**。

## 4. 前端

`src/views/hr/files/department/index.vue`：`row-key="code"`；`pass === '1'` 时禁用编辑/删除；审核/反审带确认框。

## 5. 与 `HR_Departments` 迁移脚本

`docs/sql/sqlserver_v1.0.8_hr_departments.txt` 可为空库建 **`HR_Departments`**；若表已存在且列结构为旧系统（`code`/`name`/`pass` 等），直接设默认表名即可。其它表名用 **`HR_LEGACY_DEPT_TABLE`** 覆盖。
