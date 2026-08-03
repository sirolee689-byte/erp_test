# 人力资源 · 档案管理

## 部门资料

- 页面：`department/index.vue`；“管理部门资料 / 部门资料添加”两个状态，操作列固定左侧，宽表通过视口底部横向滚动条浏览。
- 列表：状态、部门编码、部门名称、负责人、备注、操作时间；单关键词搜索编码、名称、负责人、备注。
- 筛选：默认在册已审核；“显示未审核”显示 `pass='0'`；“回收站”仅显示 `del='1'` 的未审核部门。
- 新增/编辑字段：部门编码、部门名称、负责人、备注。服务端新增 `systemcode` GUID，并记录当前操作人、时间、IP。
- `code` 和 `name` 在未删除部门中均不可重复；已审核记录需先反审才可编辑或删除。
- 删除为软删除；有在职员工以 `UB_ERP_Hr_staff.in_bm_systemcode` 关联时拒绝删除。恢复仅适用于回收站未审核记录。
- 不做：部门层级、岗位树、打印、导入、物理删除。

## 员工档案资料

- 页面：`employee-files/index.vue`；列表直接接搜索栏，**已去掉「批量更新」按钮及 Excel 弹窗**（不再单独占一行工具栏）。后端 `POST /api/hr/staff/batch-update` 仍保留，界面暂不入口。
- 筛选：部门下拉（搜索框左侧，默认「全部部门」，选项为在册已审核部门）+ 关键词（姓名/工号/卡号）+ 显示未审核 + 显示离职员工；部门与关键词均需点「查询」才刷新；重置清空部门与关键词。
- 列表接口 `GET /api/hr/staff` 可选参数 `in_bm`：有值时按员工档案**部门名称**精确匹配（兼容旧数据 GUID 空/错）。

## 员工档案关联

- 部门下拉只读取在册且已审核部门。
- 员工保存部门时同时写入：`in_bm=部门名称`、`in_bm_systemcode=部门 GUID`。
- `join_department=部门编码`保留给历史宿舍/报表读取；岗位由员工档案自由录入，不再读取部门岗位树。
- 历史员工缺少 GUID 时，可执行 `docs/sql/sqlserver_v1.1.3_hr_staff_department_systemcode_backfill.txt`；脚本只补空值，不覆盖已有数据。

## 接口与权限

- `GET/POST/PUT/DELETE /api/hr/departments`，审核、反审、恢复分别使用 `/audit`、`/unaudit`、`/restore`。
- 权限菜单：`hr/files/department` 的 `view/add/edit/delete/audit/unaudit`。
- 成功的新增、修改、审核、反审、删除、恢复由中央操作日志写入 `UB_Date_ERP_Operation_log`；读取和失败请求不记日志。
