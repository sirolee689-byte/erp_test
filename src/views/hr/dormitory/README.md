# 宿舍管理

## 住宿管理

路由：`hr/dormitory/lodging-records`。页面有两个状态：**管理住宿**与**住/退宿记录**；不提供住宿记录审核、反审核或回收站。

- **管理住宿**按房间汇总，一行对应一个房间。列表前六列依次为操作、房号、入住人员、入住人数、剩余床位、`设定年月,电费`；其后显示楼号、名称、类型、状态。电费表头随年月筛选变化，例如设为 2026 年 5 月时显示 `2026年5月,电费`；支持年月、房间和员工关键词筛选、分页及视口底部横向滚动。搜索「入住员工」右侧提供 **一键录入（电费）**（Excel：A 房号、B 上期、C 本期；先预览再确认导入，可覆盖同月已有电费）。
- 每个房间固定提供四个入口：**增加入住**、**入住管理**、**电费管理**、**删除电费**。增加入住仅在指定房间下办理；退宿仅在“入住管理”中办理。
- **增加入住**弹窗只填写入住人员、自动带出的部门、入住时间、优惠电量和备注；不再填写床位信息。入住时间默认当天 `00:00`，优惠电量默认 `15`。
- **住/退宿记录**按 `UB_ERP_Hr_room_in` 一行一条展示，可按员工姓名、工号、部门、房间统一关键词筛选，并按全部、当前在住、已退宿切换。列表提供查看；当前在住记录才显示“办理退宿”。
- 当前在住的唯一条件为 `del=0 + out_room=0`。退宿只更新 `out_room`、`out_time`、`out_time2`，不删除历史；房间人数只由有效在住记录动态统计。
- 不提供打印及住宿登记审核流程；电费支持房间列表「一键录入（电费）」Excel 批量导入（见下方 `UB_ERP_Hr_room_use`）。

## 房间管理

路由：`hr/dormitory/room-management`。房间资料负责维护楼号、类型、名称、编码、床位数和备注；`s_code` 是入住及费用历史关联房号，存在关联记录后禁止修改。

- `in_sum` 是总床位数，`in_bad` 是损坏床位数；旧数据初始化时会将旧容量迁入 `in_sum`。
- `in_user` 不允许手工维护，由 `UB_ERP_Hr_room_in` 中 `del=0`、`out_room=0` 的记录自动汇总。

## UB_ERP_Hr_room_use（电费抄表）

- 单房核算：`POST /api/hr/dormitory/electric/settle`；删除：`POST /api/dorm/delete-electric`。
- 一键录入：`POST /api/hr/dormitory/electric/batch-preview`（解析校验不写库）、`POST /api/hr/dormitory/electric/batch-import`（确认后写库）。Excel A=`room_code`（房号/`s_code`）、B=`c_star`、C=`c_this`；上期须等于系统期望（该月已有记录则取其 `c_star`，否则取最近一条 `c_this`）；本期不得小于上期；确认导入时同月已有记录先删后插。
- 关键字段：`room_code`、`tj_date`、`c_star`、`c_this`、`c_electric`、`c_money`（单价）、`c_yh_electric`、`c_sum_money`、`del`、`pass`。