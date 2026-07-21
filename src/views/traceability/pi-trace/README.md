# PI追溯管理

左侧菜单：**追溯系统 → PI追溯管理**（路由 `/traceability/pi-trace`，权限键 `traceability/pi-trace`，动作 `view`）。

## 已完成功能

- **正向追溯**：输入含 `PI`/`pi` 的 PI 号（必填）与可选成品编码，查询 `UB_ERP_Bom_Sales`；无数据提示「无此PI数据。」
- 每个成品一块区域：销售数量/单位（`Sales_order_list`，多行取 `id desc` 首条）、PI 头六类业务单数量与可点击单号
- BOM 缩进树表（分列对齐，非 Element 树表；`Bom_Sales_list`，`kcac01→kcac02`）：默认顶层；点三角/编码单独展开；CUT 编码完整；展开全部/收起全部；点行可高亮
- 物料侧追溯单据：仅展示有数据的类别（如只有采购则只显示「采购(1)：单号」）；全无则该行不显示追溯块
- **反向追溯**：物料关键字模糊分页（默认 10 条）；点行加载向上追溯（至 `PQ-`）与对应 PI/销售；销售日期只筛销售主表
- 物料用量读 `Bom_pi_consumption`（表不存在或列不同则显示 `-`）；计价用量 `SUM(Bom_pi_cost.kcac06)`，不乘销售数量
- **不做**：打印、导出、横向/纵向、U8、关务

## 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/traceability/pi-trace/forward` | `pi` 必填，`productCode` 选填 |
| GET | `/api/traceability/pi-trace/reverse/list` | `keyword`、`page`、`pageSize` |
| GET | `/api/traceability/pi-trace/reverse/detail` | `id`、可选 `startDate`/`endDate` |

权限：上述接口均要求 `traceability/pi-trace:view`。

## pass / del 口径（勿统一）

| 场景 | 条件 |
|------|------|
| PI 头：采购/外协/派工 | `del=0` 且 `pass=1` |
| PI 头：生产领料 | `kcap03 in (2,4,7,8)`，`del=0`，**不加 pass** |
| PI 头：成品入库 | `kcan03=4`，`del=0`，`pass=1` |
| PI 头：成品出库 | `kcap03=6`，`del=0`，**不加 pass** |
| 物料级成品出库明细 | 同上且 **pass=1** |
| BOM 树 | `del=0`（首层/下级均不强制 pass） |
| 反向物料列表 | `del=0` 且 `pass=1` |
| 反向向上父行 | `del=0`，**不限 pass** |

## 已知问题 / 下一步

- 当前内网库可能尚无 `UB_ERP_Bom_pi_consumption` 物理表：物料用量列显示 `-`；有表时按列探测 `kcac06+pq` 或回退 `sumby`。
- 大 PI 首次正向查询会批量拉 BOM+单据，耗时与数据量相关；已避免逐节点 SQL。
- 非管理员需在角色权限中勾选「PI追溯管理」的查看后重新登录。

## 后端重启

改了 `server/**`：请手动 `taskkill /F /IM node.exe /T` → `npm run dev:server`，并重新登录。
