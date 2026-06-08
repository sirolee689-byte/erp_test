# PI_BOM资料（库存基本资料）

## 入口

- 菜单：库存管理 → 基本资料 → BOM资料 → PI_BOM资料
- 前端路由 / 菜单 path：`inventory/basic/pi-bom-data`
- 页面：`src/views/inventory/basic/pi-bom-data/index.vue`
- 后端接口：
  - `GET /api/inventory/pi-bom-data/list`
  - `GET /api/inventory/pi-bom-data/detail`
- 权限：`view`

## 已完成功能

- 首页顶部有两个按钮：
  - `管理PI-BOM资料`：当前列表页。
  - `PI-BOM物料批量替换功能(待定)`：只做占位，暂不执行替换。
- 搜索框支持按 PI 号或编码查询。
- 默认只查在册订单，也就是销售订单主表 `del` 为空或 `0`，并默认只展示已审核订单。
- 列表按销售订单明细款展示：一行 = 一个 PI 号下的一个成品编码。
- 列顺序固定为：操作、状态(是否审核)、录入时间、PI号、编码、是否运算、成本用量、名称(中文)、客户款号、组别、单位、分类、工厂款号。
- 操作列第一期只做 `查看PI-BOM`：打开只读弹窗，查看该 PI + 编码对应的 PI BOM 资料。
- `查看PI-BOM` 弹窗为 4 个只读标签：
  - `基础资料`：读取当前 PI + 编码在 `UB_ERP_Bom_Sales` 的头表快照。
  - `配件明细`：读取当前 PI + 编码在 `UB_ERP_Bom_Sales_list` 的全部明细行，按平铺表展示。
  - `PI_BOM树形`：读取当前 PI + 编码在 `UB_ERP_Bom_Sales_list` 的层级关系，头部提供 `展开全部`、`关闭全部`。
  - `成本BOM用量表`：读取当前 PI + 编码在 `UB_ERP_Bom_pi_cost` 的已运算结果；未运算或无数据时显示暂无。
- `分类` 显示 `Bom_material.name`，通过销售订单明细快照 `kcaa05` 匹配 `Bom_material.code`。

## 数据来源

| 页面字段 | 来源 |
|---|---|
| 状态(是否审核) | `UB_ERP_Sales_order.pass` |
| 录入时间 | 优先 `UB_ERP_Sales_order_list.addtime`，为空取 `UB_ERP_Sales_order.addtime` |
| PI号 | `UB_ERP_Sales_order_list.xsak01` |
| 编码 | `UB_ERP_Sales_order_list.kcaa01` |
| 是否运算 | 销售订单主表运算状态列，沿用销售订单的 `isok` / `is_pur` 探测口径 |
| 成本用量 | `UB_ERP_Bom_pi_cost` 按 `sid = PI号`、`pq = 编码` 汇总 `kcac04` 和 `kcac06` |
| 名称(中文) | `UB_ERP_Sales_order_list.kcaa02` |
| 客户款号 | `UB_ERP_Sales_order_list.kcaa06` |
| 组别 | `UB_ERP_Sales_order_list.kcaa10` |
| 单位 | `UB_ERP_Sales_order_list.kcaa04` |
| 分类 | `Bom_material.name` |
| 工厂款号 | `UB_ERP_Sales_order_list.kcaa09` |

## 查看详情数据来源

| 标签页 | 来源 |
|---|---|
| 基础资料 | `UB_ERP_Bom_Sales`，按 `sid = PI号`、`kcaa01 = 编码` 查询 |
| 配件明细 | `UB_ERP_Bom_Sales_list`，按 `sid = PI号`、`pkcaa01 = 编码` 查询全部明细行 |
| PI_BOM树形 | `UB_ERP_Bom_Sales_list`，按 `kcac01` 父级键与 `systemcode/kcac02` 子级键展开 |
| 成本BOM用量表 | `UB_ERP_Bom_pi_cost`，按 `sid = PI号`、`pq = 编码` 查询已运算行 |

详情弹窗不读取 `bom_000`、`Bom_parts`、`bom_cost`，也不触发同步 BOM 或一键运算。

## 已知问题 / 下一步

- `PI-BOM物料批量替换功能(待定)` 还没有业务规则，暂不做任何写库动作。
- 本页是查询和查看入口，不修改销售订单、PI BOM、物料单或审核状态。
- 本次没有新增数据库表或字段。
