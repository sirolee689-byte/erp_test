# 销售订单模块

供应链 → 日常工作 → 销售订单。领域规则以根目录 **`CONTEXT.md` 第七节** 为准。

## 路由与权限

| 项 | 值 |
|---|---|
| 前端路由 / 菜单 path | `supply-chain/daily/sales-order` |
| 页面 | `src/views/supply-chain/daily/sales-order/index.vue` |
| 后端注册 | `server/salesOrderHandlers.js`（`registerSalesOrderRoutes`） |
| 角色权限 | `view` / `add` / `edit` / `audit` / `delete`（与标准件一致） |

## 数据表与 PI 号关联

| 表 | 作用 | 关联键 |
|---|---|---|
| `UB_ERP_Sales_order` | 订单主表 | **`xsaj01`** = 用户录入 **PI 号**（全表唯一，含软删）；**`xsaj05`** = 客户代码；**`xsaj06`** = PO 号；**`xsaj07`** = 币别 id；**`GUID`** 与 **`systemcode`** 同值；**`syscode`** / **`d_code`** 保存为空值；**`type`** 固定 `1` |
| `UB_ERP_Sales_order_list` | 订货明细 | **`xsak01`** = PI 号；行 **`kcaa01`** + **`plan_quantity`**（订货数量）；`xsak04` 单价、`xsak05` 金额；保存时按 `kcaa01` 精确匹配 `bom_000`，`xsak02` 取 `bom_000.GUID`，`kcac01` 取销售订单主表 `GUID/systemcode`，`kcac02` / `GUID` / `systemcode` 同 `xsak02`，`kcac03` 取 `bom_000.kcaa25`（采购单位），`pass` / `kcaa26` / `remark` 同样从 `bom_000` 抄快照；另抄 **`kcaa02_en`**、**`kcaa12`**、**`kcaa32`～`kcaa35`**、**`sale_price`** / **`cost_price`**（空写 NULL）、**`type`**（`bom_000.type` 有值则抄，空则 `1`） |
| `UB_ERP_Bom_Sales` | PI 销售 BOM 头（每款成品一行） | **`sid`** = PI 号；**`kcaa01`** = 成品编码；保存/对齐建款或 **同步 BOM** 时 **`GUID`** 与 **`systemcode`** **两列同值**（均取自 `bom_000.[GUID]`）；`kcaa09`～`kcaa11`、`kcaa14`～`kcaa15`、`kcaa25`～`kcaa31`、`location`、`version`、`remark`、`pass` 从 `bom_000` 抄快照；另抄 **`kcaa02_en`**、**`kcaa12`**、**`kcaa32`～`kcaa35`**、**`sale_price`** / **`cost_price`**（空写 NULL）、**`type`**（有值抄、空则 `1`）；**已在单上的款**保存不回头，须 **同步 BOM** 或删款再保存才刷新头快照 |
| `UB_ERP_Bom_Sales_list` | PI BOM 配件行 | **`sid`** = PI 号；从主 BOM 建款/同步 BOM 时按 `Bom_parts` 旧系统口径展开：从订单明细 `kcaa01` 对应 `bom_000.GUID` 起，按 `Bom_parts.kcac01 = 当前父级`、下一层用本行 `kcac02/systemcode` 递归；写入 list 时 **不按 `kcaa01/systemcode/kcac02/Describe` 合并**，`Bom_parts.id` 不同即不同源行；**方案 A**：主 BOM 实际存在的结构子编码（BAG/TAG/RMP 等）均写入 list，**仅 `RP-PQ` 结构前缀不写入**；**保存**仅对明细**新款**建 PI BOM，已有款不自动重写（少行请 **同步 BOM**）；再按行 **`kcaa01`** 查 `bom_000` 覆盖若干字段；**`pkcaa01`** = 订单明细顶级成品；审计字段由服务端写入 |
| `UB_ERP_Bom_pi_cost` | 一键运算 — 物料明细 | **`sid`** = PI 号；读 **PI BOM**（`UB_ERP_Bom_Sales_list`）运算，规则同 BOM **成本用量表**（含隐藏前缀 `CUT-/BAG-/TAG-…` 不落库）；普通 `RP-` 材料必须写入，仅 `RP-PQ` 结构行不写入；搭配字段为 **`Describe`** |
| `UB_ERP_Bom_pi_consumption` | 一键运算 — 子件汇总（表不存在时查询内存合并） | **`sid`** = PI 号 |

主数据：`bom_000` / `Bom_parts`（主 BOM）；`bom_currency`（币别）；客户 `System_sales_customer`（`s_code` / `s_name` 快照）。

> 表字段与接口细节见 `docs/sql/database_map.md` §3.16；PI 号、主 BOM 门禁、运算状态见 `CONTEXT.md` §七。

## 接口一览

| 方法 | 路径 | 权限 action | 说明 |
|------|------|-------------|------|
| GET | `/api/sales-order/currency-options` | view | 币别下拉（读 `bom_currency`） |
| GET | `/api/sales-order/list` | view | 分页列表（`recycled`、PI/客户/日期筛选） |
| GET | `/api/sales-order/pi-suggest?keyword=` | view | 生产管理物料单页 PI 候选；只按 PI 号相近匹配已审核在册订单 |
| GET | `/api/sales-order/check-pi?piNo=&excludeId=` | add | PI 号重复校验（新增页失焦校验） |
| GET | `/api/sales-order/:id` | view | 主表 + 明细 |
| POST | `/api/sales-order` | add | 新建保存 `{ header, lines[] }` |
| PUT | `/api/sales-order/:id` | edit | 编辑保存 + **PI BOM 对齐**（已审 400） |
| POST | `/api/sales-order/:id/approve` | audit | 审核 |
| POST | `/api/sales-order/:id/unapprove` | audit | 反审 |
| POST | `/api/sales-order/:id/soft-delete` | delete | 软删（未审） |
| POST | `/api/sales-order/:id/restore` | edit | 回收站恢复 |
| POST | `/api/sales-order/:id/hard-delete` | delete | 彻底删除（回收站且未审） |
| POST | `/api/sales-order/:id/sync-bom` | edit | body `{ kcaa01 }`；主 BOM → 该款 PI BOM |
| POST | `/api/sales-order/:id/calculate` | edit | 一键运算；已审核/未审核在册订单均可执行；可选 `{ syncedKcaa01: string[] }` 部分重算 |
| GET | `/api/sales-order/:id/material-bill` | view | 物料单（未运算 409）；前端主入口在生产管理 → 统计分析 → 物料单 |
| GET | `/api/sales-order/:id/pi-bom?kcaa01=` | view | 无 `kcaa01`：款列表；有：树 + flat |
| PUT | `/api/sales-order/:id/pi-bom` | edit | body `{ kcaa01, lines: [{ id, kcac04, kcac05?, Describe? }] }` |

审计中文名见 `server/action_map.js`（与上表路由一一对应）。

> 审计三字段（与 `CONTEXT.md` 第三节一致，服务端 `resolveActorAuditTripletFromReq`）：`uid`=`UserID`，`uname`=`UserName`，`utruename`=`truename`（按登录 `usercode` 查库）。禁止把 `usercode` 写入 `uname`，禁止用工牌显示名写入 `utruename`。

## 推荐操作顺序（新人调通）

1. **列表** `GET /list` → **详情** `GET /:id`
2. **新建/保存** `POST` 或 `PUT`：事务内写主表、明细整批替换（**明细可为空**，仅主表 PI/客户/币别等）、**按款** PI BOM 删/建（禁止整 PI 先删后插）
3. **PI BOM 维护** `GET/PUT /:id/pi-bom`：改用量/损耗/备注（不从主 BOM 拉）
4. **同步 BOM** `POST /:id/sync-bom`：仅当需要以主 BOM 覆盖该款
5. **一键运算** `POST /:id/calculate` → **物料单** `GET /:id/material-bill`；查看入口在生产管理 → 统计分析 → 物料单
6. **增加散件单用量** `POST /:id/add-spare-usage`（订单含散件时列表显示；**纯散件单**可独立操作；**混单**须先一键运算整款）
7. 需要时：**审核** / **软删** / **恢复** / **彻底删除**

```text
保存订单 ──► PI BOM 对齐（删款物理删 PI；在单款不动；新款从主 BOM 建）
     │
     ├─► 改 PI 用量（PUT pi-bom）──► 未运算
     ├─► 同步 BOM（按行）──────────► 未运算
     └─► 改货品行/订货数量（保存）──► 未运算

未运算 ──► 一键运算（读 PI BOM）──► 已运算 ──► 物料单有效
已运算 + 仅部分款同步后运算 ──► 只重算 syncedKcaa01 中的款
```

## 运算状态规则

- 展示字段 **`calcStatus`**：`已运算` / `未运算`（库列探测顺序：`isok` → `is_pur`）
- 下列操作后标 **未运算**（`is_pur='0'` 或等价）：
  - 保存时变更明细 **货品编码集合** 或 **订货数量**
  - **同步 BOM**（按行）
  - **保存 PI BOM**（PUT pi-bom）
- **一键运算** 只读 **PI BOM**（`UB_ERP_Bom_Sales_list`），写入 `UB_ERP_Bom_pi_*`，**不乘订货数量**；**无 BOM 层数上限**（与主 BOM 用量树一致；循环引用仍失败）；隐藏前缀与 BOM 资料内置列表一致（`server/bomCostHidePrefixes.js`）；下游订料时 **用量 × 订货数量**
- **一键运算写 `UB_ERP_Bom_pi_cost`**：与 BOM 资料 **用量运算 → bom_cost** 同规则（平铺不合并、隐藏前缀一致、跳过成品根行）；普通 `RP-` 材料写入，`RP-PQ` 结构行不写入；**不**再按 `UB_ERP_Bom_Sales_list.id` 去重。验收：同款同步 BOM 后，`pi_cost` 行数与用量应对齐该款 `bom_cost`（仅 `sid` 为 PI 号）。历史脏 PI list 须先 **同步 BOM**。
- **`pi_cost` 专用字段**（用量 `kcac04/05/06` 不变）：`top_kcaa01/02` = PI BOM **第一层**命中 `Bom_code flag5`（排除 OUT/CUT）的锚点，子树继承（裁片下 `RP-*` 等材料不新建锚点）；**散件单**第一层即散件时 `top` 可为自身；`t_kcaa01/02` = 直接父（父即锚点时 **留空**）；`t_kcaa03~11/14/15/25~27` = 直接父行在 `UB_ERP_Bom_Sales_list` 的同名 `kcaa*`（树遍历复制，等价 `sid`+`t_kcaa01` 查父行；父留空时 t 扩展字段亦空）；`temp` = 该款销售明细 `xsak03`（同 `pq` 下各行相同）；`isok=1`、`pass='1'`、`kcac07=0`、`kcac08=kcac06+kcac07`、`kcaa07/08=0`。实现：`server/salesOrderPiCostFields.js`。
- **一键运算入口** 只放在列表第一列「操作」；查看/编辑弹窗不放入口。已审核、未审核在册订单都可以点；回收站订单不可运算。
- **散件判定**（`hasSpareParts`）：`Bom_code` 全部 `copen=1` 且 `flag5` 非空的前缀为「排除前缀」；明细 `kcaa01` **不命中**任一排除前缀 → 散件行；订单含至少一行散件 → 列表显示 **「增加散件单用量」**。
- **订单类型与按钮**：
  - **纯整款**（无散件）：仅 **一键运算**。
  - **纯散件单**（`isPureSpareOrder`）：仅 **增加散件单用量**，**不显示**一键运算。
  - **混单**（整款 + 散件）：两个按钮均显示；散件按钮须整款已有 `pi_cost`（`canAddSpareUsage`）才可点，否则置灰并提示「请先一键运算整款」。
- **增加散件单用量**（`POST /:id/add-spare-usage`）：**仅**对散件明细写 `UB_ERP_Bom_pi_cost` 自用量行（`pq`=散件自身、`kcac04=1`、`kcac06=1`、`top_kcaa01`=自身、`temp`=该款 `xsak03`；其余扩展字段照 `bom_000` enrich）；**不写** `pi_consumption`。混单时只覆盖散件款 `pi_cost`，整款不动；当全部明细款均有 `pi_cost` 时标 **已运算**。
- **一键运算与散件**：运算范围 **排除散件明细**（只算整款）；混单运算完成后若散件尚未补用量，主表仍为 **未运算**；纯散件单调用一键运算接口会拒绝并提示改用散件按钮。
- **一键运算 PX**：`UB_ERP_Bom_pi_cost.px` 照 BOM 资料规则补入，子件 `kcaa01` → `bom_000.kcaa05` → `Bom_material.code` → `Bom_material.px`；无匹配则留空。
- **已审**（`pass='1'`）：禁止保存订单、PI BOM PUT、同步 BOM、软删、彻底删；但允许在列表执行一键运算

## 主 BOM 门禁（保存 vs 同步）

- **保存订单**：已在单且已有 PI BOM 的款 **不得** 被主 BOM 覆盖
- **允许** 从主 BOM 写入：`同步 BOM`、明细 **新款**、删款后 **同码再加**
- **PI BOM Tab 保存**：只改 `UB_ERP_Bom_Sales_list` 的 `kcac04`/`kcac05`/`Describe`

## 前端 Tab

| Tab | 能力 |
|-----|------|
| 主表 | PI 号（新建可填）、客户、币别、日期、运算状态 |
| 明细 | 选材、合并同码数量、编辑数量/单价、自动显示金额、同步 BOM、跳转 PI BOM；选材带入 `kcaa06` 客款号、`remark` 备注、`kcaa10` 组别、`kcaa09` 工厂款号、`version` 版本；数量和单价为纯输入框数字录入；备注为 `bom_000.remark` 快照只读展示，不作为输入框；列顺序固定为：序号、操作、编码、数量、单价、金额、客款号、备注、用料名称(中文)、组别、工厂款号、版本 |
| PI BOM | 按款树表编辑用量/损耗/备注 |

> 物料单不再放在销售订单详情/编辑 Tab 内展示。销售订单仍负责「一键运算」，但入口只在销售订单列表操作列；运算后的明细/汇总统一到生产管理 → 统计分析 → 物料单查看。

## 新增页交互

- 列表【新增销售订单】在当前页面直接打开新增弹窗，不再新开浏览器页（不使用 `target="_blank"`）。
- 列表按钮文案固定为 **「新增销售订单」**（与页面标题一致）。
- 新增弹窗初始化时，PI 号默认填 `PI-`，小数位数默认 `6`；编辑已有订单时仍以接口返回值为准。
- 主表新增 `PO号` 输入框；保存时写入主表字段 `UB_ERP_Sales_order.xsaj06`。
- 客户保存时写入 `xsaj05 = System_sales_customer.s_code`；客户名称仍写入 `kehu` 快照。
- 币别下拉显示为 `001,人民币`、`002,美元` 这类格式；新增时默认选中接口真实返回的 `002,美元`；保存时写入 `xsaj07 = bom_currency.id`，币别名称仍写入 `rmb` 快照。
- 新增保存自动生成 `GUID`，并同步写入 `systemcode`；`syscode` 与 `d_code` 保存为空值，`type` 固定写 `1`。
- PI 号查重时机：**输入框失焦即校验**（`GET /api/sales-order/check-pi`）；点击保存前后端都会再做一次兜底校验，避免并发撞号。
- 新增弹窗默认客户不写死假选项：打开时调用 `GET /api/supply-chain/customers/list?pass=1&keyword=PQD`，仅当接口返回真实存在的 `s_code=7001` 且 `s_name=PQD` 记录时，才默认选中该客户。
- 新增明细行时，数量和单价默认显示 `0`，输入框不强制显示固定小数位；保存仍走原字段，不改写入规则。
- 新增保存仍走现有 `POST /api/sales-order`；保存成功后关闭弹窗并刷新当前列表。

## 列表交互

- 列表默认每页 **10 条**；后端 `/api/sales-order/list` 也以 10 条作为缺省页大小。列表查询先完成主表分页，再只对当前页订单计算散件/按钮状态，避免打开页面时为大量历史订单提前计算操作状态。
- 顶部只保留一个关键词搜索框，同时匹配 PI 号、系统单号、客户名称；日期范围仍独立筛选。
- 列表列调整：新增 `PO号` 列，移除 `系统单号` 列（系统单号仍保留在详情接口中）。
- 默认显示已审核销售订单（`pass=1`）；打开“显示未审核”后只查未审核（`pass=0`）。
- “回收站”和“显示未审核”互斥；进入回收站后不再传审核状态，只查已逻辑删除数据。
- 主表操作列固定在第一列，按钮风格与 BOM 资料列表保持一致，便于先处理操作再横向查看业务字段。
- 主表参考外协报价支持点击行展开明细；点击操作列按钮不触发展开，操作列里的“查看”仍打开原查看弹窗。
- 展开明细只读展示，列顺序固定为：序号、操作、客款号、编码、名称、规格、组别、单位、数量、用量、单价、金额、备注；操作列仅放“查看”占位按钮，后续再接真实功能；“用量”按该行 `PI号 + kcaa01` 汇总 `UB_ERP_Bom_pi_cost.kcac04/kcac06`，显示为 `成本：SUM(kcac04),SUM(kcac06)`，未运算或无结果显示 `-`。

## 测试与验收

```bash
npm run test:sales-order    # 单元 + 集成（server/*.test.mjs）
npm run e2e:sales-order     # Playwright：列表 → 查看弹窗（需 Vite + API）
```

手工端到端清单：`.scratch/sales-order/E2E-ACCEPTANCE.md`（含 **PI-002** 全流程）。

## 实现工单索引

| Issue | 主题 |
|-------|------|
| 01 | 列表与只读详情 |
| 02 | 保存 + PI BOM 对齐 |
| 03 | 审核 / 回收站 |
| 04 | 按行同步 BOM |
| 05 | 一键运算与物料单 |
| 06 | PI BOM 维护 UI |
| 07 | 本文档 + database_map + 验收清单 |

## PI BOM 树形展示规则

- PI BOM 标签页的树形展示必须对标 BOM 资料的“BOM用量表运算”树形展示。
- 子行 `kcac01` = 父行 **实例键**（保存/同步 BOM 写入时：`systemcode` 优先，否则 `kcac02`）。
- 展示向下展开同样用 **实例键**（`usageTreeChildParentKey`），不能只用共用 ERP 编码 `kcac02`，否则会出现「每个 BN-0005 下挂 3 行 BN-0008」。
- **一单多明细**：读树/运算/删款须 **`pkcaa01` = 当前款** 过滤 list（避免多款共用展开父键时串读，如 PI-TEST111 的 BLU4 与 GRN）。
- 前端树表行唯一键使用物理行 `id`，不要使用 `systemcode`。
- **不做**整棵树 `list.id` 去重（会把子件挂到先遍历到的裁片下）。
- 建款/同步写入：按 `Bom_parts.kcac01 -> kcac02/systemcode` 递归；过滤 `Bom_code.flag5 + '-'` 结构行但保留 `CUT-` 和 `RP-`，其中 `RP-PQ` 仍过滤；不按编码或 systemcode 合并。历史 PI 若少行，对该款点 **同步 BOM** 后刷新（仅保存不会重建已有款）。
- 一键运算写 `pi_cost` 与 BOM 资料 `usage-calc` 同落库链路（`buildPiCostInsertPayloadFromUsageTree`），不做 `list.id` 二次去重。
- **PI BOM 读树（方案 A）**：同步后 list 含 BAG/TAG/RMP 等物理结构行时，从订单头 `systemcode` 直接展开（用量取行内 `kcac04/05`）；**旧 PI list** 无头下结构行时仍走虚拟根回退（`info` 快照 + `resolvePiBomUsageTreeRootKeys` 反推父键 + 合成顶级节点）。实现：`server/salesOrderPiBomUsageTree.js`。
