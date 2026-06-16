# 宿舍管理（v1.1.10）

## 已完成功能

- **房间管理**（`hr/dormitory/room-management`）
  - 分页列表：`GET /api/hr/dormitory/rooms`
  - **添加房间**：`POST /api/hr/dormitory/rooms`（房号 `s_code`、状态 `s_code1` 使用/闲置、类型 `code` 普通房/空调房/大房、床位 `in_bad`、备注 `info`；新建 `pass=0` 未审核）；权限：`add`
  - **查看房间**：`GET /api/hr/dormitory/rooms/:id`（弹窗展示与「添加房间」一致的字段及在住人数等）；权限：`view`
  - **审核**：`PUT /api/hr/dormitory/rooms/audit`，body `{ id }`；权限：`audit`
  - **反审**（默认已审核列表）：`PUT /api/hr/dormitory/rooms/unaudit`，body `{ id }`；权限：`audit`
  - 展示 `UB_ERP_Hr_room` 楼栋、房号（`s_code`）、房型、名称、**房间使用状态**（`s_code1`：使用/闲置）、床位数（`in_bad`）、**在住人数**（关联 `UB_ERP_Hr_room_in`，条件：`del=0` 且 `in_room=1` 且 `out_room=0`）
  - 「显示未审核」开关：切换查询 `pass=0` / `pass=1` 的房间主数据
  - 搜索：房号、楼栋、名称、房型（keyword 模糊）
- **住宿管理 / Tab 工作台**（`hr/dormitory/lodging-records`，实现目录 `src/views/dormitory/`）
  - **Tab1 房间列表**（`RoomList.vue`）：总览、办理入住、入住管理（在住/退宿）；`GET /api/hr/dormitory/lodging-overview` 等
  - **Tab2 审核入住申请**（`AuditList.vue`）：「显示已审核」联动 `pass`；列表 `GET /api/hr/dormitory/lodging-in/audit-center-list`；部门列仅展示 `UB_ERP_Hr_department.name`；**通过审核** `PUT /api/hr/dormitory/lodging-in/audit`；**反审核** `PUT /api/dorm/un-audit`；**彻底删除（仅未审核）** `DELETE /api/dorm/delete-checkin`（SQL 带 `pass='0'`）；驳回接口仍保留 `PUT /api/hr/dormitory/lodging-in/reject`（当前 Tab 未挂按钮）
  - **Tab3 住宿历史列表**（`HistoryList.vue`）：只读流水，**无**「仅未审核」开关、**无**审核状态列与审核按钮；**无设定日期（年/月）**，列表为全量（`del=0`），按入住时间倒序分页（默认 `pageSize=20`）
  - `POST /api/hr/dormitory/check-in`：弹窗办理入住；**写入 `UB_ERP_Hr_room_in` 默认 `pass=1`（自动过审）**；**INSERT 前**校验在住与历史区间时间重叠（与 `staff_code` 写入口径一致）；操作日志写入 **`UB_Date_ERP_Operation_log`**
  - 说明文档：`src/views/dormitory/README.md`

- **入住管理 & 退宿**（v1.1.3+）
  - 在房间列表点击【入住管理】，仅展示当前在住人员：`UB_ERP_Hr_room_in.del=0 AND out_room=0 AND room_code=房号`
  - 部门展示：`UB_ERP_Hr_staff.join_department`，关联键：`UB_ERP_Hr_staff.new_code = UB_ERP_Hr_room_in.staff_code`
  - 退宿：点击人员旁【退宿】→ 更新当前行 `out_room=1` 且写入 `out_time=YYYY-MM-DD HH:mm`（只更新该 id，不覆盖历史）
  - 操作日志：`act_name` 为办理了退宿，`act_info` 含「管理员[uname]办理了员工[姓名]的退宿，日期：[退宿时间]」（表 `UB_Date_ERP_Operation_log`）
- **宿舍电费情况统计报表**（`hr/dormitory/electric-report`，v1.1.6）
  - Tabs：宿舍维度报表 + **宿舍费用分摊**（人员维度，`GET /api/dorm/electric-allocation-report`，与电费弹窗 v1.1.9 按天权重一致）；导出 XLS / 打印；说明见 `electric-report/README.md`
- **住宿总览**（`GET /api/hr/dormitory/lodging-overview`，与页面「房间列表」Tab 对应）
  - **设定日期（年/月）**：与后端 `@mStart/@mEnd` 自然月一致。
  - **入住人数 / 入住人员**：显示“**当前在住**”（不按月份），统计 `UB_ERP_Hr_room_in` 中 `del=0`、`in_room=1`、`out_room=0`；名单为 **`staff_truename`**，若为空则显示 **`staff_code`**（逗号分隔）。
  - **电费(汇总)**：读 `UB_ERP_Hr_room_use`，**`room_code` = 房间 `s_code`**，且 **`tj_date` 落在同一自然月**；对该月所有行 **`c_sum_money` 求和**（`c_sum_money` 若为字符串会先去掉空格与英文逗号，再按数字解析；无法解析当 0）。

## 数据库说明

- 未改表结构，仅读写已有字段：`UB_ERP_Hr_room`、`UB_ERP_Hr_room_in`、`UB_ERP_Hr_room_use`（总览电费：`tj_date`、`c_sum_money`、`room_code`）。
- 办理入住时从 `UB_ERP_Hr_staff` 带出姓名、部门等写入入住行（便于旧系统展示）。

## 权限（RBAC）

- 房间列表：`hr/dormitory/room-management` → `view`
- 住宿管理（含 Tab 内审批）：`hr/dormitory/lodging-records` → `view`（总览/历史/待审列表）、`add`（办理入住/退宿）、`audit`（通过审核 / 反审核 / 彻底删除未审核申请）、`edit`（备注）
- 电费统计报表：`hr/dormitory/electric-report` → `view`

## 已知问题 / 下一步

- 若 `c_sum_money` 含**人民币符号、中文「元」、千分位全角逗号**等，当前解析可能当 0；可在库端规范为纯数字串或再扩展 REPLACE。
- `tj_date` / `in_time`：列为 **datetime** 时直接按月区间比较；为 **字符** 时先尝试标准 10 位与 8 位数字，再 **`ISDATE` 兜底**（兼容 `2026-4-1` 等非零补写法，否则「入住人员」会因整月无匹配行而全空）；「仅年月」等其它格式需再约定。
- 退房、换宿等可在后续版本扩展。
- 若同一 `s_code` 存在多条 `UB_ERP_Hr_room` 行，后端会拒绝办理以避免错分房间。
