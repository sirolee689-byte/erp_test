# 宿舍管理（v1.1.9）

## 已完成功能

- **房间管理**（`hr/dormitory/room-management`）
  - 分页列表：`GET /api/hr/dormitory/rooms`
  - **添加房间**：`POST /api/hr/dormitory/rooms`（房号 `s_code`、状态 `s_code1` 使用/闲置、类型 `code` 普通房/空调房/大房、床位 `in_bad`、备注 `info`；新建 `pass=0` 未审核）；权限：`add`
  - **查看房间**：`GET /api/hr/dormitory/rooms/:id`（弹窗展示与「添加房间」一致的字段及在住人数等）；权限：`view`
  - **审核**：`PUT /api/hr/dormitory/rooms/audit`，body `{ id }`；权限：`audit`
  - **反审**（默认已审核列表）：`PUT /api/hr/dormitory/rooms/unaudit`，body `{ id }`；权限：`audit`
  - 展示 `Hr_room` 楼栋、房号（`s_code`）、房型、名称、**房间使用状态**（`s_code1`：使用/闲置）、床位数（`in_bad`）、**在住人数**（关联 `Hr_room_in`，条件：`del=0` 且 `in_room=1` 且 `out_room=0`）
  - 「显示未审核」开关：切换查询 `pass=0` / `pass=1` 的房间主数据
  - 搜索：房号、楼栋、名称、房型（keyword 模糊）
- **住宿办理**（`hr/dormitory/lodging-records`）
  - `POST /api/hr/dormitory/check-in`（v1.1.3-final）：弹窗办理入住
    - **入住人员**：远程搜索下拉（仅显示 `Hr_staff.status='在职'` 且 `is_blacklist=0` 且当前未在宿的员工；服务端仍会二次拦截）
    - **入住日期**：默认当天（写入 `Hr_room_in.in_time`）
    - **优惠电量**：默认 0（写入 `Hr_room_in.electric`，用于月底电费扣除）
    - **备注**：写入 `Hr_room_in.room_info`
  - 校验：房间存在且唯一、`s_code1` 为「使用」、在宿人数未满（按 `Hr_room.BedCount` 或 `in_bad`）、员工为在职且非黑名单、员工无重复在宿（`status=1` 或 `in_room=1/out_room=0`）
  - 写入 `Hr_room_in`：默认 `pass=0`、`del=0`，并保持兼容字段 `in_room=1`、`out_room=0`；若旧库存在 `status` 列则同时写入 `status=1`
  - 操作审计：`Sys_OperationLogs` 中 Action 为「办理了入住」（见 `server/action_map.js`）

- **入住管理 & 退宿**（v1.1.3+）
  - 在房间列表点击【入住管理】，仅展示当前在住人员：`Hr_room_in.del=0 AND out_room=0 AND room_code=房号`
  - 部门展示：`Hr_staff.join_department`，关联键：`Hr_staff.new_code = Hr_room_in.staff_code`
  - 退宿：点击人员旁【退宿】→ 更新当前行 `out_room=1` 且写入 `out_time=YYYY-MM-DD HH:mm`（只更新该 id，不覆盖历史）
  - 审计：`Sys_OperationLogs.Action=办理了退宿`，Content 含「管理员[uname]办理了员工[姓名]的退宿，日期：[退宿时间]」
- **住宿总览**（`GET /api/hr/dormitory/lodging-overview`，与页面「房间列表」Tab 对应）
  - **设定日期（年/月）**：与后端 `@mStart/@mEnd` 自然月一致。
  - **入住人数 / 入住人员**：显示“**当前在住**”（不按月份），统计 `Hr_room_in` 中 `del=0`、`in_room=1`、`out_room=0`；名单为 **`staff_truename`**，若为空则显示 **`staff_code`**（逗号分隔）。
  - **电费(汇总)**：读 `Hr_room_use`，**`room_code` = 房间 `s_code`**，且 **`tj_date` 落在同一自然月**；对该月所有行 **`c_sum_money` 求和**（`c_sum_money` 若为字符串会先去掉空格与英文逗号，再按数字解析；无法解析当 0）。

## 数据库说明

- 未改表结构，仅读写已有字段：`Hr_room`、`Hr_room_in`、`Hr_room_use`（总览电费：`tj_date`、`c_sum_money`、`room_code`）。
- 办理入住时从 `Hr_staff` 带出姓名、部门等写入入住行（便于旧系统展示）。

## 权限（RBAC）

- 房间列表：`hr/dormitory/room-management` → `view`
- 办理入住：`hr/dormitory/lodging-records` → `add`

## 已知问题 / 下一步

- 若 `c_sum_money` 含**人民币符号、中文「元」、千分位全角逗号**等，当前解析可能当 0；可在库端规范为纯数字串或再扩展 REPLACE。
- `tj_date` / `in_time`：列为 **datetime** 时直接按月区间比较；为 **字符** 时先尝试标准 10 位与 8 位数字，再 **`ISDATE` 兜底**（兼容 `2026-4-1` 等非零补写法，否则「入住人员」会因整月无匹配行而全空）；「仅年月」等其它格式需再约定。
- 退房、换宿等可在后续版本扩展。
- 若同一 `s_code` 存在多条 `Hr_room` 行，后端会拒绝办理以避免错分房间。
