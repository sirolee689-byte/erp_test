# 宿舍电费情况表

## 已完成功能

- 侧栏菜单：`宿舍管理` → `宿舍电费情况表`，路由 `hr/dormitory/electric-report`。
- **Tabs**：Tab1「宿舍电费情况表」；Tab2「宿舍费用分摊情况」。顶部共享**统计年月 + 查询**（温馨提示：需完成抄表）。
- 两张表均提供**列设置、导出信息、打印统计报表**。列设置分别保存在当前浏览器；屏幕、导出和打印使用同一列设置，支持恢复默认。
- Tab1：`GET /api/dorm/electric-report-data`；汇总宿舍间数、住宿总人数；明细与电费落库一致；导出 `.xlsx`。
- Tab2：`GET /api/dorm/electric-allocation-report`；人员维度分摊表；员工优先按入住记录的 `staff_systemcode` 关联 `UB_ERP_Hr_staff.systemcode`，旧记录没有该标识时才回退工号关联；部门直接取员工档案 `in_bm`，职务直接取 `position`，无档案或字段为空时显示「未设定」。算法与电费弹窗按天权重一致；表下「异常说明」展示 `allocation_anomaly_hint`。
- **导出信息**：使用 `exceljs` 生成当前页签的 `.xlsx`，列与列设置一致。
- **打印统计报表**：浏览器打印当前页签，隐藏工具栏与 Tabs；不提供单独 PDF 导出按钮。

## 接口与数据说明

- 后端：`server/index.js` → `GET /api/dorm/electric-report-data`、`GET /api/dorm/electric-allocation-report`。
- 权限：`apiPermissionGate.js` 绑定菜单路径 `hr/dormitory/electric-report` 的 `view`。
- 角色需在 `New_UB_ERP_System_role.Permissions` 中为该路径分配 `view`（或 `*` / `all`），否则菜单与接口会被拦截。

## 已知限制 / 后续

- 「备注」列当前占位为空字符串（库表若后续增加抄表备注字段可再映射）。
- 房间数量极大时建议再加分页或异步导出（当前一次拉全量已审房间）。
- 若库中暂无 `pass!=1` 的在住样本，异常说明可能为空；可用 `scripts/e2e-dormitory-electric-allocation-pass-display-v1.1.6.mjs` 在含未审人员的月份回归。
