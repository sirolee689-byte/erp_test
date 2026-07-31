# 人力资源 · 岗位资料

- 表：`UB_ERP_Hr_position`；字段 `systemcode`（服务端 GUID）、`code`、`name`、`info`（备注）、`pass`、`del` 与通用审计字段。
- 页面路径：`hr/files/position`；管理列表与新增页采用员工档案同款布局，支持未审核和回收站筛选。
- `code`、`name` 在未删除岗位中唯一；编辑按 `systemcode` 定位，审核后须反审才能编辑或删除；删除仅软删除。
- 员工档案岗位下拉读取已审核且未删除岗位；员工表 `position` 只保存岗位名称，不保存岗位 GUID。
- 接口：`GET/POST/PUT/DELETE /api/hr/positions`，以及 `/audit`、`/unaudit`、`/restore`；所有写入由中央操作日志记录。
