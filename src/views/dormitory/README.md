# 宿舍 Tab 工作台（`src/views/dormitory/`）

## 结构

- `index.vue`：`住宿管理` 菜单入口，含 `el-tabs`：**房间列表** → **审核入住申请** → **住宿历史列表**。
- `RoomList.vue`：房间总览、办理入住（`POST /api/hr/dormitory/check-in`：**在住**与**历史退宿区间重叠**拦截）、入住管理（在住/退宿）。
- `ElectricManage.vue`：电费管理中心弹窗（从房间列表操作列进入）。左侧抄表表单、右侧在住人员分摊表；保存写入 `Hr_room_use`（`room_code`、`tj_date`、`c_sum_money` 等），并在 **`UB_Date_ERP_Operation_log`** 记录操作日志「管理员[uname]完成了[房间号]的电费核算」。
- `AuditList.vue`：「显示已审核」开关联动 `pass` 筛选；列含**状态**（已审/未审标签）、**入住时间**（`in_time`）；`pass=0` 显示【通过审核】+【删除】（`DELETE /api/dorm/delete-checkin`，仅未审核可物理删），`pass=1` 仅【反审核】（`PUT /api/dorm/un-audit`）；部门列仅 `HR_Departments.name`。
- `HistoryList.vue`：住宿历史只读查询（无审核操作、无审核状态列）；**无年月筛选**，默认全量 `GET /api/hr/dormitory/lodging-history`（`del='0'`，`in_time DESC` 分页，默认每页 20 条）。

路由仍注册为 `hr/dormitory/lodging-records`（见 `src/views/hr/dormitory/lodging-records/index.vue` 薄封装）。
