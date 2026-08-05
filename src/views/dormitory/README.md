# 宿舍 Tab 工作台（`src/views/dormitory/`）

## 结构

- `index.vue`：`住宿管理` 菜单入口，含 `el-tabs`：**房间列表** → **审核入住申请** → **住宿历史列表**。
- `RoomList.vue`：房间总览、办理入住（`POST /api/hr/dormitory/check-in`：**在住**与**历史退宿区间重叠**拦截）、入住管理（在住/退宿）。列表「房号」列对应 `s_code`。搜索栏「搜索入住员工」右侧有 **一键录入（电费）**：弹窗选录入月份（默认取列表设定日期）、上传 Excel（A 房号 / B 上期 / C 本期；选中后拖拽区显示文件名与已选择状态），先 `POST /api/hr/dormitory/electric/batch-preview` 告知可导入/将覆盖/跳过，确认后再 `POST /api/hr/dormitory/electric/batch-import` 写库（同月已有则先删后插；上期须与系统期望一致；本期不得小于上期；无人在住跳过）。
- `ElectricManage.vue`：电费管理中心弹窗（从房间列表操作列进入）。左侧抄表表单、右侧在住人员分摊表；保存写入 `UB_ERP_Hr_room_use`（`room_code`、`tj_date`、`c_sum_money` 等），并在 **`UB_Date_ERP_Operation_log`** 记录操作日志「管理员[uname]完成了[房间号]的电费核算」。
- `AuditList.vue`：「显示已审核」开关联动 `pass` 筛选；列含**状态**（已审/未审标签）、**入住时间**（`in_time`）；`pass=0` 显示【通过审核】+【删除】（`DELETE /api/dorm/delete-checkin`，仅未审核可物理删），`pass=1` 仅【反审核】（`PUT /api/dorm/un-audit`）；部门列仅 `UB_ERP_Hr_department.name`。
- `HistoryList.vue`：住宿历史只读查询（无审核操作、无审核状态列）；**无年月筛选**，默认全量 `GET /api/hr/dormitory/lodging-history`（`del='0'`，`in_time DESC` 分页，默认每页 20 条）。

路由仍注册为 `hr/dormitory/lodging-records`（见 `src/views/hr/dormitory/lodging-records/index.vue` 薄封装）。
