# PI_BOM资料（库存基本资料）

## 入口

- 菜单：库存管理 → 基本资料 → BOM资料 → PI_BOM资料
- 前端路由 / 菜单 path：`inventory/basic/pi-bom-data`
- 页面：`src/views/inventory/basic/pi-bom-data/index.vue`
- 独立编辑窗口（浏览器原生新页）：`/inventory/basic/pi-bom-data-window`（权限沿用 `inventory/basic/pi-bom-data`）
- 后端接口：
  - `GET /api/inventory/pi-bom-data/list`
  - `GET /api/inventory/pi-bom-data/detail`
  - `GET /api/inventory/pi-bom-data/node-basic`
  - `GET /api/inventory/pi-bom-data/parts`
  - `PUT /api/inventory/pi-bom-data/basic`
  - `PUT /api/inventory/pi-bom-data/parts`
  - `POST /api/inventory/pi-bom-data/replace-material`
- 权限：列表和查看为 `view`，保存主档、配件明细与物料批量替换为 `edit`

## 已完成功能

- 首页顶部有两个模式按钮：
  - `管理PI-BOM资料`：列表查询、查看与编辑入口。
  - `PI-BOM物料批量替换`：按 PI 批量替换配件明细中的物料档案（见下节）。
- 搜索框支持按 PI 号或编码查询。
- 默认只查在册订单，也就是销售订单主表 `del` 为空或 `0`，并默认只展示已审核订单。
- 列表按销售订单明细款展示：一行 = 一个 PI 号下的一个成品编码。
- 列顺序固定为：操作、状态(是否审核)、录入时间、PI号、编码、是否运算、成本用量、名称(中文)、客户款号、组别、单位、分类、工厂款号。
- 操作列提供 **查看** 与 **编辑** 两个按钮。
- **查看**：打开只读弹窗（4 标签：基础资料、配件明细、PI_BOM树形、成本BOM用量表）；配件明细可下钻查看下级，不可修改。
- **编辑**：打开 2 标签编辑弹窗（基础资料 + 配件明细）；基础资料点「保存主档」写入 `UB_ERP_Bom_Sales`；配件明细点「保存配件明细」写入 `UB_ERP_Bom_Sales_list`。
- 编辑弹窗配件行点 **编辑配件**：以浏览器原生新页打开 `/inventory/basic/pi-bom-data-window?mode=parts-edit`（无侧栏）；下层页基础资料只读，配件明细可维护；继续下钻仍用「编辑配件」新页。进入编辑后，单位用量、损耗率、单价、备注默认可直接改，无需逐行点「编辑」。
- `分类` 显示 `UB_ERP_Stocks_material.name`，通过销售订单明细快照 `kcaa05` 匹配 `UB_ERP_Stocks_material.code`（旧表名 `Bom_material`）。

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
| 分类 | `UB_ERP_Stocks_material.name` |
| 工厂款号 | `UB_ERP_Sales_order_list.kcaa09` |

## 查看详情数据来源

| 标签页 | 来源 |
|---|---|
| 基础资料 | `UB_ERP_Bom_Sales`，按 `sid = PI号`、`kcaa01 = 编码` 查询 |
| 配件明细 | `UB_ERP_Bom_Sales_list`，按 `sid = PI号`、`KCAC01 = 基础资料.systemcode` 查询当前成品直接子件 |
| PI_BOM树形 | `UB_ERP_Bom_Sales_list`，按 `kcac01` 父级键与 `systemcode/kcac02` 子级键展开 |
| 成本BOM用量表 | `UB_ERP_Bom_pi_cost`，按 `sid = PI号`、`pq = 编码` 查询已运算行 |

详情弹窗不读取 `bom_000`、`Bom_parts`、`bom_cost`，也不触发同步 BOM 或一键运算。

## 编辑与维护口径

- 主档保存只更新 `UB_ERP_Bom_Sales`；**PI号、系统编码、成品编码** 只读（销售订单明细键）。
- 配件明细当前层读取条件为：`UB_ERP_Bom_Sales_list.sid = PI号`、`pkcaa01 = 当前成品编码`、`kcac01 = 当前层父级 systemcode`。
- 新增配件使用现有物料选择器，只在 PI 自己的 `UB_ERP_Bom_Sales_list` 建立层级关系，不读取也不写入库存 BOM 的 `bom_000`、`Bom_parts`。
- 可修改字段：单位用量、损耗率、单价、备注；保存时重算当前行 `kcac06 = kcac04 * (1 + kcac05)`。
- 删除为页面先移除、保存后物理删除；已保存行删除时，后端会在当前 PI + 当前成品的树内找到该行下级子孙行并一并物理删除。
- 保存主档或配件明细后只把销售订单标为未运算，不自动重算 `UB_ERP_Bom_pi_cost`；成本BOM用量表需要重新一键运算后才更新。
- **已审核销售订单仍允许维护 PI BOM**（本页特例，不代表销售订单编辑页放开已审核订单维护）。

## PI-BOM 物料批量替换

- 入口：首页顶部 `PI-BOM物料批量替换`；表单字段（每行一个）：PI号、PQ编码（留空则全部款）、物料源编码、目标物料编码、搭配（留空则仅匹配 `Describe` 为空的行；有搭配如「叻色」须填写后才能替换）。
- 体验优化：PI/PQ/物料源/目标/搭配输入框均支持“输入触发下拉联想”；下拉仅显示编码，降低误输风险。
- 立即执行：先预检命中行数并二次确认，再从 `bom_000`（旧系统称 UB_ERP_Bom_000）读取目标物料档案，批量更新 `UB_ERP_Bom_Sales_list` 中匹配行的物料属性（`kcaa01`~`kcaa35` 及同名快照列）。
- 筛选：`sid`=PI号；`kcaa01`=源编码；`pkcaa01`=PQ（可选）；`Describe`=搭配（精确匹配，留空只命中搭配为空的行；同款同码多行靠搭配区分）。
- 不修改：`kcac01`/`kcac02`/`systemcode`（树键）、`kcac04`/`kcac05`/`kcac06`（用量损耗）、`Describe`（搭配）、`UB_ERP_Bom_Sales` 主档、`UB_ERP_Bom_pi_cost` 成本表。
- 副作用：对应销售订单标为 **未运算**；须到销售订单对该 PI 执行 **一键运算** 后物料单才更新。

## 已知问题 / 下一步

- 本次没有新增数据库表或字段。
