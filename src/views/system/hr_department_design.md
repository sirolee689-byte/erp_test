# 人力资源 · 部门资料

## 数据与关联

- 表：`UB_ERP_Hr_department`（可用 `.env` 的 `HR_LEGACY_DEPT_TABLE` 覆盖）。
- `systemcode`：部门唯一 GUID，也是员工关联键；新增时由服务端生成，编辑不得修改。
- `code`：部门编码；`name`：部门名称；两者仅在未删除部门中唯一。
- `manager`、`remark`：负责人、备注。
- `pass`：`'0'` 未审核，`'1'` 已审核；已审核记录须反审后才可编辑或删除。
- `del`：软删除位；回收站仅显示 `del='1'` 的未审核部门。
- 员工表 `UB_ERP_Hr_staff` 同时保存 `in_bm=部门名称`、`in_bm_systemcode=部门 systemcode`；为不影响仍按编码读取的历史报表，同时保存 `join_department=部门编码`。

## 页面与接口

- 页面：`src/views/hr/files/department/index.vue`，使用“管理部门资料 / 部门资料添加”切换；列表操作列固定在左侧，并使用视口底部横向滚动条。
- 列表：状态、部门编码、部门名称、负责人、备注、操作时间；单关键词匹配编码、名称、负责人、备注。
- 接口：
  - `GET /api/hr/departments?page&pageSize&keyword&pass&recycle`
  - `POST /api/hr/departments`：`code`、`name`、`manager`、`remark`
  - `PUT /api/hr/departments`：须带 `systemcode`，可编辑编码、名称、负责人、备注
  - `PUT /api/hr/departments/audit|unaudit|restore`
  - `DELETE /api/hr/departments/:systemcode`：仅软删除；若有在职员工按 `in_bm_systemcode` 关联则拒绝。
- 所有写操作由 ERP 中央操作日志记录；写入人、时间、IP 由服务端当前登录态取得。

## 不做

不维护 ParentID 部门树、岗位树、打印、导入及物理删除。
