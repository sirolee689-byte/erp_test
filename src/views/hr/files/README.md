# 人力资源 — 档案管理（`hr/files`）

## 已完成功能

### 部门资料（`department/index.vue`）

- **数据源**：部门物理表由根目录 `.env` 中 **`HR_LEGACY_DEPT_TABLE`** 指定（仅字母、数字、下划线），**默认 `HR_Departments`**。
- **字段**：与旧库一致，接口返回小写键：`code`、`name`、`manager`、`pass`、`flag`、`passutruename`、`passtime`、`del` 等（详见 `src/views/system/hr_department_design.md`）。
- **分页**：`GET /api/hr/departments`，默认 **`pageSize=20`**；搜索关键字模糊匹配 **`name`、`code`**。
- **审核**：`pass === '1'` 为已审核；已审核行 **禁用编辑、删除**；后端改删前同样校验，提示「该记录已审核锁定，请反审后再操作」。**`flag` 仅展示**，不参与列表筛选。
- **删除**：**逻辑删除**（更新 `del`、`deltime`、`delid`/`delname`/`deltruename` 等），不物理删行。
- **权限**：菜单 path `hr/files/department`；含 `view` / `add` / `edit` / `delete` / `audit`。

### 员工档案资料

- 占位：`employee-files/index.vue`。

## 配置提示

- 若实际表名不是 `HR_Departments`，在 `.env` 增加一行：`HR_LEGACY_DEPT_TABLE=你的表名`，重启 `npm run dev:server`。
- 审核写入 `passutruename` 等依赖登录 token 中的用户信息，**改代码后建议重新登录一次**。

## 相关文档

- `src/views/system/hr_department_design.md`
