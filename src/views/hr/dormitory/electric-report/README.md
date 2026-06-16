# 宿舍电费情况统计报表（v1.1.7）

## 已完成功能

- 侧栏菜单：`宿舍管理` → `宿舍电费情况统计报表`，路由 `hr/dormitory/electric-report`。
- **Tabs**：Tab1「宿舍电费统计报表」；Tab2「宿舍费用分摊情况」。顶部共享**统计年月 + 查询**（温馨提示：需完成抄表）。
- Tab1：`GET /api/dorm/electric-report-data`；汇总宿舍间数、住宿总人数；明细与电费落库一致；支持 XLS 导出与打印。
- Tab2：`GET /api/dorm/electric-allocation-report`；人员维度分摊表；**在住人员**与 `UB_ERP_Hr_room_in` 左联 `UB_ERP_Hr_staff`（不按 pass 剔除），未审或无档案在姓名后标 **`(档案未审)`**，**分摊电量/金额为 0**（已审人员单独占分母，防误扣款）；**部门/职务**均为 `UB_ERP_Hr_department.name`，无档案或联不到时为 **「未设定」**；算法与电费弹窗 **v1.1.9 按天权重**一致（仅已审人员参与分母）；表下 **「异常说明」** 展示 `allocation_anomaly_hint`（未参与摊费人数、入住表与明细行数对账）；支持 **XLS** 与 **PDF**。
- **导出 XLS**：使用 `exceljs` 生成 `.xlsx`。
- **打印**：浏览器打印（隐藏工具栏与 Tabs；可按当前 Tab 分别打印）。

## 接口与数据说明

- 后端：`server/index.js` → `GET /api/dorm/electric-report-data`、`GET /api/dorm/electric-allocation-report`。
- 权限：`apiPermissionGate.js` 绑定菜单路径 `hr/dormitory/electric-report` 的 `view`。
- 角色需在 `UB_ERP_System_role.Permissions` 中为该路径分配 `view`（或 `*` / `all`），否则菜单与接口会被拦截。

## 已知限制 / 后续

- 「备注」列当前占位为空字符串（库表若后续增加抄表备注字段可再映射）。
- 房间数量极大时建议再加分页或异步导出（当前一次拉全量已审房间）。
- 若库中暂无 `pass!=1` 的在住样本，异常说明可能为空；可用 `scripts/e2e-dormitory-electric-allocation-pass-display-v1.1.6.mjs` 在含未审人员的月份回归。
