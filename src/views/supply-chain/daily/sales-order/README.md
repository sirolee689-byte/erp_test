# 销售订单模块

供应链 → 日常工作 → 销售订单。领域规则以根目录 **`CONTEXT.md` 第七节** 为准。

- **顶栏/内容区无框**（2026-07-23）：与出入库一致——管理列表卡片与添加/编辑面板均不加外框线。

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
| `UB_ERP_Sales_order_list` | 订货明细 | **`xsak01`** = PI 号；行 **`kcaa01`** + **`plan_quantity`**（订货数量）；`xsak04` 单价、`xsak05` 金额；保存时按 `kcaa01` 精确匹配 `UB_ERP_Bom_000`，`xsak02` 取 `UB_ERP_Bom_000.GUID`，`kcac01` 取销售订单主表 `GUID/systemcode`，`kcac02` / `GUID` / `systemcode` 同 `xsak02`，`kcac03` 取 `UB_ERP_Bom_000.kcaa25`（采购单位），`pass` / `kcaa26` / `remark` 同样从 `UB_ERP_Bom_000` 抄快照；另抄 **`kcaa02_en`**、**`kcaa12`**、**`kcaa32`～`kcaa35`**、**`sale_price`** / **`cost_price`**（空写 NULL）、**`type`**（`UB_ERP_Bom_000.type` 有值则抄，空则 `1`） |
| `UB_ERP_Bom_Sales` | PI 销售 BOM 头（每款成品一行） | **`sid`** = PI 号；**`kcaa01`** = 成品编码；保存/对齐建款或 **同步 BOM** 时 **`GUID`** 与 **`systemcode`** **两列同值**（均取自 `UB_ERP_Bom_000.[GUID]`）；`kcaa09`～`kcaa11`、`kcaa14`～`kcaa15`、`kcaa25`～`kcaa31`、`location`、`version`、`remark`、`pass` 从 `UB_ERP_Bom_000` 抄快照；另抄 **`kcaa02_en`**、**`kcaa12`**、**`kcaa32`～`kcaa35`**、**`sale_price`** / **`cost_price`**（空写 NULL）、**`type`**（有值抄、空则 `1`）；**已在单上的款**保存不回头，须 **同步 BOM** 或删款再保存才刷新头快照 |
| `UB_ERP_Bom_Sales_list` | PI BOM 配件行 | **`sid`** = PI 号；从主 BOM 建款/同步 BOM 时按 `UB_ERP_Bom_parts` 旧系统口径展开：从订单明细 `kcaa01` 对应 `UB_ERP_Bom_000.GUID` 起，按 `UB_ERP_Bom_parts.kcac01 = 当前父级`、下一层用本行 `kcac02/systemcode` 递归；写入 list 时 **不按 `kcaa01/systemcode/kcac02/Describe` 合并**，`UB_ERP_Bom_parts.id` 不同即不同源行；**方案 A**：主 BOM 实际存在的结构子编码（BAG/TAG/RMP 等）均写入 list，**仅 `RP-PQ` 结构前缀不写入**；**保存**仅对明细**新款**建 PI BOM，已有款不自动重写（少行请 **同步 BOM**）；再按行 **`kcaa01`** 查 `UB_ERP_Bom_000` 覆盖若干字段；**`pkcaa01`** = 订单明细顶级成品；审计字段由服务端写入 |
| `UB_ERP_Bom_pi_cost` | 一键运算 — 物料明细 | **`sid`** = PI 号；读 **PI BOM**（`UB_ERP_Bom_Sales_list`）并按 BOM **一键运算（旧）**计算，`CUT-` 中间层参与路径逐层乘算；含隐藏前缀规则，普通 `RP-` 材料必须写入，仅 `RP-PQ` 结构行不写入；搭配字段为 **`Describe`** |
| `UB_ERP_Bom_pi_consumption` | 一键运算 — 子件汇总（表不存在时查询内存合并） | **`sid`** = PI 号 |

主数据：`UB_ERP_Bom_000` / `UB_ERP_Bom_parts`（主 BOM）；`UB_ERP_System_currency`（币别）；客户 `UB_ERP_System_sales_customer`（`s_code` / `s_name` 快照）。

> 表字段与接口细节见 `docs/sql/database_map.md` §3.16；PI 号、主 BOM 门禁、运算状态见 `CONTEXT.md` §七。

## 接口一览

| 方法 | 路径 | 权限 action | 说明 |
|------|------|-------------|------|
| GET | `/api/sales-order/currency-options` | view | 币别下拉（读 `UB_ERP_System_currency`） |
| GET | `/api/sales-order/list` | view | 分页列表（`recycled`、PI 号模糊、日期筛选） |
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
| POST | `/api/sales-order/:id/sync-bom` | edit | body `{ kcaa01 }`；主 BOM → 该款 PI BOM（单款） |
| POST | `/api/sales-order/:id/sync-bom-batch` | edit | body `{ kcaa01: string[] }`；三路并发准备主 BOM 树，逐款短事务串行写入；批量预读主 BOM 头/规则/列元数据，同款明细按安全批次写入；返回准备、删除、写入和提交耗时；遇错停后续；只覆盖点选款 |
| POST | `/api/sales-order/:id/calculate` | edit | 一键运算；含散件时同请求自动写散件自用量；纯散件单亦走本接口；可选 `{ syncedKcaa01: string[] }` 部分重算 |
| POST | `/api/sales-order/:id/add-spare-usage` | edit | 兼容保留（列表不再入口）；仅写散件 `pi_cost` 自用量 |
| GET | `/api/sales-order/:id/material-bill` | view | 物料单（未运算 409）；前端主入口在生产管理 → 统计分析 → 物料单 |
| GET | `/api/sales-order/:id/pi-bom?kcaa01=` | view | 无 `kcaa01`：款列表；有：树 + flat |
| PUT | `/api/sales-order/:id/pi-bom` | edit | body `{ kcaa01, lines: [{ id, kcac04, kcac05?, Describe? }] }` |

操作日志：`server/action_map.js` 登记各路由 `act_name`；HTTP 200 后由 `operationAuditMiddleware` 经 `operationLogWriter` 写入 **`UB_Date_ERP_Operation_log`**（与上表路由一一对应）。

> 审计三字段（与 `CONTEXT.md` 第三节一致，服务端 `resolveActorAuditTripletFromReq`）：`uid`=`UserID`，`uname`=`UserName`，`utruename`=`truename`（按登录 `usercode` 查库）。禁止把 `usercode` 写入 `uname`，禁止用工牌显示名写入 `utruename`。

## ERP 内核数据关联

系统内核 → ERP 内核 → 数据关联第一版展示本模块四项核心写库动作，目录由后端代码维护，页面只读：

| 业务动作 | 主要读取 | 主要写入与条件 |
|----------|----------|--------------|
| 新增/编辑保存 | 订单主从、客户、币别、主 BOM、已有 PI BOM | 保存订单主从；仅新增款/删款对齐 `UB_ERP_Bom_Sales*`；货品集合、数量变化或同步后再保存时才删除旧 `UB_ERP_Bom_pi_cost` |
| 保存 PI BOM | 订单主从、PI BOM 主从 | 只更新 `UB_ERP_Bom_Sales_list.kcac04/kcac05/Describe` 并标未运算；当下不删除 `pi_cost` |
| 同步 BOM | 订单主从、`UB_ERP_Bom_000`、`UB_ERP_Bom_parts`、分类规则 | 仅替换选中款的 `UB_ERP_Bom_Sales*` 并标未运算；当下不删除 `pi_cost` |
| 一键运算 | 订单主从、PI BOM、分类及材料规则 | 重写目标范围 `UB_ERP_Bom_pi_cost`；汇总表存在时重建 `UB_ERP_Bom_pi_consumption`；更新订单运算状态 |

该页面不代替本 README 和 `CONTEXT.md` 的业务定稿；数据流变化时三处必须同步更新。

## 推荐操作顺序（新人调通）

1. **列表** `GET /list` → **详情** `GET /:id`
2. **新建/保存** `POST` 或 `PUT`：事务内写主表、明细整批替换（**明细可为空**，仅主表 PI/客户/币别等）、**按款** PI BOM 删/建（禁止整 PI 先删后插）
3. **PI BOM 维护** `GET/PUT /:id/pi-bom`：改用量/损耗/备注（不从主 BOM 拉）
4. **同步 BOM**：明细行点「同步 BOM」标记为「已选择」，再点「批量同步 BOM」（编辑明细在「批量添加」旁）；一次调用 `POST /:id/sync-bom-batch`（三路并发准备主 BOM 树；准备完成后逐款短事务串行删除并写入，避免读树期间长期占用 PI BOM 写锁；批量开始时预读主 BOM 头、分类规则、列元数据；同款 `UB_ERP_Bom_Sales_list` 明细按 SQL Server 参数上限分批写入；主表 `is_pur=0` 只改一次；死锁自动退避重试；遇错停后续；已启动的款允许跑完），**只覆盖点选编码**的 PI BOM，**当下不删** `pi_cost`；接口返回总耗时和逐款准备、删除、写入、提交耗时，单款接口 `POST /:id/sync-bom` 仍保留
5. **同步后再保存**：`PUT` body 带 `syncedKcaa01`（本会话已同步款）→ 删除该 PI **全部** `UB_ERP_Bom_pi_cost`，主表用量清空并回到未运算；保存成功后前端清空本会话同步标记，下次一键运算为整单重算
6. **一键运算** `POST /:id/calculate`（含散件时自动补散件自用量；纯散件单也点本按钮）→ **物料单** `GET /:id/material-bill`；查看入口在生产管理 → 统计分析 → 物料单
7. 需要时：**审核** / **软删** / **恢复** / **彻底删除**

```text
保存订单 ──► PI BOM 对齐（删款物理删 PI；在单款不动；新款从主 BOM 建）
     │
     ├─► 改 PI 用量（PUT pi-bom）──► 未运算
     ├─► 同步 BOM（仅点选款 PI BOM）► is_pur=0；pi_cost 仍保留
     │         └─► 再点保存（body.syncedKcaa01）──► 清空该 PI 全部 pi_cost → 未运算
     └─► 改货品行/订货数量（保存）──► 未运算，并清空该 PI 的 pi_cost

未运算 ──► 一键运算（整款读 PI BOM；含散件则同请求写散件自用量）──► 已运算 ──► 物料单有效
已运算 + 仅部分款同步后、尚未保存就运算 ──► 只重算 syncedKcaa01 中的整款，并仍自动补散件用量
同步后再保存（已清整单 pi_cost）──► 下次一键运算为整单重算
```

## 运算状态规则

- 展示“已运算/未运算”以 `UB_ERP_Bom_pi_cost` 为准：当前 PI 只要存在 `isok=1` 的运算行，就显示 **已运算**；没有 `isok=1` 行则显示 **未运算**。
- 展开明细用量、物料单、PI-BOM资料里的成本用量只读取 `UB_ERP_Bom_pi_cost.isok=1` 的有效行。

- 展示字段 **`calcStatus`**：`已运算` / `未运算`；列表页先查当前页主表，再按当前页 PI 批量读取 `UB_ERP_Bom_pi_cost.isok=1` 回填状态，避免分页 SQL 对大表逐行 `EXISTS`。
- 下列操作后标 **未运算**（`is_pur='0'` 或等价）：
  - 保存时变更明细 **货品编码集合** 或 **订货数量**：同时删除该 PI 在 `UB_ERP_Bom_pi_cost` 中的旧运算结果；不清 `UB_ERP_Bom_pi_consumption`
  - **同步 BOM**（按行勾选后「批量同步 BOM」走 `sync-bom-batch`：并发 3 写各款 PI BOM，主表 `is_pur` 结束后改一次；死锁退避重试；**不立刻删** pi_cost）
  - **同步后再保存**：body 带非空 `syncedKcaa01` 时，删除该 PI **全部** `UB_ERP_Bom_pi_cost`，用量清空并显示未运算
  - **保存 PI BOM**（PUT pi-bom）
- **一键运算** 只读 **PI BOM**（`UB_ERP_Bom_Sales_list`），写入 `UB_ERP_Bom_pi_*`，**不乘订货数量**；**无 BOM 层数上限**（与主 BOM 用量树一致；循环引用仍失败）；隐藏前缀与 BOM 资料内置列表一致（`server/bomCostHidePrefixes.js`）；下游订料时 **用量 × 订货数量**
- **一键运算写 `UB_ERP_Bom_pi_cost`**：按 BOM 资料**一键运算（旧）**口径平铺，`CUT-` 中间层参与路径逐层乘算；平铺不合并、隐藏前缀一致、跳过成品根行。普通 `RP-` 材料写入，`RP-PQ` 结构行不写入；**不**再按 `UB_ERP_Bom_Sales_list.id` 去重。验收：同款 PI BOM 一致时，`pi_cost` 用量应对齐 BOM 旧运算结果（仅 `sid` 为 PI 号）。历史 PI 需要手动再次一键运算才会刷新。
- **`pi_cost` 专用字段**（用量 `kcac04/05/06` 不变）：`top_kcaa01/02` = PI BOM **第一层**命中 `UB_ERP_Bom_code flag5`（排除 OUT/CUT）的锚点，子树继承（裁片下 `RP-*` 等材料不新建锚点）；**散件单**第一层即散件时 `top` 可为自身；`t_kcaa01/02` = 直接父（父即锚点时 **留空**）；`t_kcaa03~11/14/15/25~27` = 直接父行在 `UB_ERP_Bom_Sales_list` 的同名 `kcaa*`（树遍历复制，等价 `sid`+`t_kcaa01` 查父行；父留空时 t 扩展字段亦空）；**`kcaa13`**：先按 `UB_ERP_Bom_000` enrich，若该行对应 `UB_ERP_Bom_Sales_list` 的 `kcaa13` **有值（含 0）** 则照抄覆盖；`temp` = 该款销售明细 `xsak03`（同 `pq` 下各行相同）；`isok=1`、`pass='1'`、`kcac07=0`、`kcac08=kcac06+kcac07`、`kcaa07/08=0`。实现：`server/salesOrderPiCostFields.js`。
- **一键运算入口** 只放在列表第一列「操作」；查看整页与编辑页不放入口。已审核、未审核在册订单都可以点（含纯散件单）；回收站订单不可运算。列表**不再**显示「增加散件单用量」。
- **散件判定**（`hasSpareParts`）：`UB_ERP_Bom_code` 全部 `copen=1` 且 `flag5` 非空的前缀为「排除前缀」；明细 `kcaa01` **不命中**任一排除前缀 → 散件行。
- **订单类型与一键运算**：
  - **纯整款**（无散件）：只算整款 PI BOM。
  - **纯散件单**（`isPureSpareOrder`）：点「一键运算」即写散件自用量（与原 `add-spare-usage` 同口径）。
  - **混单**（整款 + 散件）：先算整款，**同请求**再写散件自用量；全部明细有 `pi_cost` 后标 **已运算**。整单运算与部分重算（`syncedKcaa01`）只要含散件都会自动补散件。
- **散件自用量口径**（由一键运算串联，或兼容接口 `POST /:id/add-spare-usage`）：**仅**对散件明细写 `UB_ERP_Bom_pi_cost` 自用量行（`pq`=散件自身、`kcac04=1`、`kcac06=1`、`top_kcaa01`=自身、`temp`=该款 `xsak03`；其余扩展字段照 `UB_ERP_Bom_000` enrich）；**不写** `pi_consumption`。
- **一键运算与散件**：整款运算范围仍 **排除散件明细**；散件在同请求内由 `writeSalesOrderSparePiCostInTx` 补写。实现：`server/salesOrderCalculateService.js` / `server/salesOrderSpareUsageService.js`。
- **一键运算 PX**：`UB_ERP_Bom_pi_cost.px` 照 BOM 资料规则补入，子件 `kcaa01` → `UB_ERP_Bom_000.kcaa05` → `UB_ERP_Stocks_material.code` → `UB_ERP_Stocks_material.px`；无匹配则留空。
- **已审**（`pass='1'`）：禁止保存订单、PI BOM PUT、同步 BOM、软删、彻底删；但允许在列表执行一键运算

## 主 BOM 门禁（保存 vs 同步）

- **保存订单**：已在单且已有 PI BOM 的款 **不得** 被主 BOM 覆盖
- **允许** 从主 BOM 写入：`同步 BOM`、明细 **新款**、删款后 **同码再加**
- **PI BOM Tab 保存**：只改 `UB_ERP_Bom_Sales_list` 的 `kcac04`/`kcac05`/`Describe`

## 前端 Tab

| Tab | 能力 |
|-----|------|
| 主表 | PI 号（新建可填）、销售客户、币别、日期、小数点配置、运算状态；布局左对齐分行（参考派工单） |
| 明细 | 工具栏对齐采购订单：`删除选定明细` / `删除全部明细` / `批量添加`（原「增行」），其后保留 `批量同步 BOM`；「选择」列橙钮标记待删行（`_lineMarked` 不入库），删行仅内存、点保存才落库；选材合并同码、编辑数量/单价、同步 BOM；维护用量走顶部 **PI BOM** 页签（明细行不再放「PI BOM」按钮）；选材带入 `kcaa06` 客款号、`remark` 备注、`kcaa10` 组别、`kcaa09` 工厂款号、`version` 版本；数量和单价为纯输入框；备注只读快照；列顺序：选择、序号、操作（仅编辑已保存单显示「同步 BOM」）、编码、数量、单价、金额、客款号、备注、用料名称(中文)、组别、工厂款号、版本；只读数量/单价/金额去尾 0（`formatErpQty/Price/MoneyDisplay`）；**2026-07-23** 工具栏高度/字号 DIY：`--so-line-toolbar-btn-height` / `--so-line-toolbar-btn-font-size`（默认 36px / 16px） |
| PI BOM | 按款树表编辑用量/损耗/备注 |

> 物料单不再放在销售订单详情/编辑 Tab 内展示。销售订单仍负责「一键运算」，但入口只在销售订单列表操作列；运算后的明细/汇总统一到生产管理 → 统计分析 → 物料单查看。

## 新增页交互

- 页面顶部为 **管理销售订单 / 销售订单添加** 双模式；默认进入管理列表。
- 管理列表工具栏不再放「新增销售订单」按钮，新增入口统一使用顶部 **销售订单添加**。
- **销售订单添加** 在当前页面整页显示新增表单，不再使用新增弹窗，也不新开浏览器页（不使用 `target="_blank"`）。
- 行内 **编辑** 进入与新增同一套整页表单；**查看**（2026-07）同样复用该整页表单（主表 / 明细 / PI BOM 三页签），全程只读；无保存、批量添加、同步 BOM、删除明细；明细无行内「PI BOM」按钮，用量树在 **PI BOM** 页签浏览。
- **标题行操作钮（2026-07）**：对齐采购订单添加——「取消 / 保存」或查看态「返回列表」放在「新增/编辑/查看销售订单」标题行右侧，不再使用底栏。**2026-07-23** 表单头 DIY：标题字号 `--so-form-head-title-font-size`；按钮高度/字号 `--so-form-head-btn-height` / `--so-form-head-btn-font-size`（默认 18px / 36px / 16px）。
- **基础资料输入高度**（2026-07-23）：单行输入对齐出库单，DIY `--so-base-input-height`；备注 DIY `--so-remark-input-height`。
- 新增表单初始化时，PI 号默认填 `PI-`，小数位数默认 `6`；编辑/查看打开时强制拉取完整详情回填主表与明细（PI 号只读展示真实值）；展开行预取明细时不再把「空主表」写入详情缓存，避免编辑读到空表单。
- **主表布局（2026-07）**：参考派工单左对齐分行；行序为 PI 号 → 销售日期+交货日期 → 销售客户 → PO 号+币别+小数点配置 → 备注。输入框三档宽度：基准约 250px（PI/日期/PO/币别）、宽约 500px（销售客户/备注）、窄约 83px（小数点配置）。DIY：`index.vue` 搜 `--so-field-width`。
- 主表新增 `PO号` 输入框；保存时写入主表字段 `UB_ERP_Sales_order.xsaj06`。
- 客户保存时写入 `xsaj05 = UB_ERP_System_sales_customer.s_code`；客户名称仍写入 `kehu` 快照。
- 币别下拉显示为 `001,人民币`、`002,美元` 这类格式；新增时默认选中接口真实返回的 `002,美元`；保存时写入 `xsaj07 = UB_ERP_System_currency.id`，币别名称仍写入 `rmb` 快照。
- 新增保存自动生成 `GUID`，并同步写入 `systemcode`；`syscode` 与 `d_code` 保存为空值，`type` 固定写 `1`。
- PI 号查重时机：**输入框失焦即校验**（`GET /api/sales-order/check-pi`）；点击保存前后端都会再做一次兜底校验，避免并发撞号。
- 新增表单默认客户不写死假选项：打开时调用 `GET /api/supply-chain/customers/list?pass=1&keyword=PQD`，仅当接口返回真实存在的 `s_code=7001` 且 `s_name=PQD` 记录时，才默认选中该客户。
- 新增明细行时，数量和单价默认显示 `0`，输入框不强制显示固定小数位；保存仍走原字段，不改写入规则。
- 新增保存仍走现有 `POST /api/sales-order`；保存成功后返回管理列表并刷新当前列表。

## 列表交互

- **操作列 / 状态列对齐 BOM（2026-07）**：操作钮复用 BOM 紧凑尺寸变量（`--erp-bom-list-action-*`，类名 `so-order-actions`）；「状态 / 结案 / 运算状态」为方框徽章（已审/已运算/未结案=绿，未审/未运算=红，已结案=蓝）；列数据字号走 `--erp-table-data-size`。DIY：全局样式见 `src/styles/element-override.scss` 搜 `so-order-actions`；徽章色见 `index.vue` 搜 `so-status-badge`。
- **主列表操作列宽（2026-07）**：按当前页每行实际可见按钮文案 + 权限实时估宽（`getErpTableActionsColWidthByRows` / `getSalesOrderRowActionLabels`）；仅「查看」权限时不再预留大片空白。展开明细/编辑行内操作列仍用窄固定宽。

### 转向物料查询

- 顶部模式栏在“销售订单添加”右侧提供“转向物料查询”；只要具备销售订单 `view` 权限即可进入。页面为当前页只读模式，首次进入不自动查询。
- 工具栏提供“立即查询、重置、列设置、导出信息”。重置会清空全部筛选条件后重新查询；分类来自 `UB_ERP_Bom_code` 的 `copen=1` 行，按 `px` 排序并显示 `flag1`；实际按 `flag5 + '-'` 过滤明细编码，`OUT` 按 `-OUT` 特例过滤。
- 筛选区另提供组别和销售日期范围：组别是明细快照 `kcaa10` 的精确匹配输入框（自动忽略首尾空格），不提供模糊或下拉匹配；开始、结束日期默认均为空，填写后按主表 `xsaj02` 过滤，结束日期包含当天。分页和导出沿用同一组筛选条件。
- 查询来源为 `UB_ERP_Sales_order_list`，主从表均要求 `del=0/pass=1`；明细按 `id desc` 分页，默认 10 条，支持 10/25/50/100/200/300/500。关键词覆盖销售明细快照字段；分类和关键词同时填写时需同时命中。
- 表格仅操作、状态固定显示。销售日期、销售订单单号、数量、单价、含税单价、税点、关联 PI、供应商/外协商、编码及物料快照列均由“列设置”控制，默认全选；可一键全选或全不选，设置保存在当前浏览器；导出当前查询条件下的全部结果，列与设置一致。
- 操作列只有“查看”，弹窗复用 PI-BOM 只读详情（基础资料、配件明细、**PI-BOM树形**、成本用量）；树形与 PI-BOM 资料查看一致：原生表 + ▶/▼、默认顶层、整支展开；不提供编辑、删除或保存。

- 列表默认每页 **10 条**；后端 `/api/sales-order/list` 也以 10 条作为缺省页大小。列表查询先完成主表分页，再只对当前页订单批量补运算状态、散件/按钮状态，避免打开页面时为大量历史订单提前计算操作状态。
- **UI 对齐 BOM 资料（2026-07）**：顶部「管理销售订单 / 销售订单添加」模式按钮、筛选区「查询 / 重置 / 刷新」字号与主列表列数据一致（`--erp-table-data-size` + `--erp-font-weight-body`）；主列表用 `ErpTableViewportHScroll` 视口底横滚（**仅主表**表内横条隐藏；展开行内嵌套明细表保留自身横滚条）；展开/收起后会 `doLayout` + `refreshErpTableViewportHScroll`；标题行操作钮、明细工具条与行操作钮走 `.so-unified-btn-font`；主表表单字段字号与列数据对齐。**主列表双分页**（头+底、`pagination-row`、左对齐，头部分页在 skeleton 外）对齐 BOM 资料。DIY：`index.vue` 搜 `.so-mode-btn`、`.so-filter-action-btn`、`.so-unified-btn-font`、`pagination-row--top`；全局变量 `element-override.scss` 搜 `--erp-table-data-size`。
- **筛选栏顺序（2026-07）**：单行 `关键词 → 查询 → 重置 → | → 回收站 → | → 显示未审核`（开回收站时隐藏未审核段）；竖线对齐 BOM。DIY：`index.vue` 搜 `so-filter-divider`。
- **数值去尾 0（2026-07）**：展开明细与编辑/查看只读列——数量最多 3 位、单价最多 4 位、金额最多 2 位，去掉末尾无意义 0（如 `0.00000` → `0`）；不改落库。实现：`formatOrderQty` / `formatPrice` / `formatMoney`（`erpNumberDisplay`）。
- 顶部只保留一个关键词搜索框，**仅**按 PI 号（`xsaj01`）模糊匹配；不再匹配系统单号、客户名称；日期范围仍独立筛选。
- 列表列调整：新增 `PO号` 列，移除 `系统单号` 列（系统单号仍保留在详情接口中）。
- 列表列顺序（主列）调整为：操作、状态、结案、运算状态、销售单号、销售日期、交货日期、PO号、销售数据、币别、客户、备注（展开列保留在末尾）。
- 新增“销售数据”汇总列（按当前行 `piNo` = `UB_ERP_Sales_order.xsaj01` 汇总）：
  - 第 1 行：总项数（`UB_ERP_Sales_order_list` 明细行数）、明细总量（`SUM(xsak03)`）、物品总金额（`SUM(xsak03 * xsak04)`）。
  - 第 2 行：总出库数量（`UB_ERP_Stocks_out.kcap03=6`、`kcap04=当前销售单号`、头表 `pass=1/del=0`，汇总 `UB_ERP_Stocks_out_list.kcaq03`）。
  - 第 3～5 行：关联采购/外协/派工订单数量（分别按销售单号关联主表字段 `kcaj04` / `wxaj04` / `scaj04`，过滤 `del=0`；后端保留已审/未审分项，前端显示合计张数）。
- 默认显示已审核销售订单（`pass=1`）；打开“显示未审核”后只查未审核（`pass=0`）。
- “回收站”和“显示未审核”互斥；进入回收站后不再传审核状态，只查已逻辑删除数据。
- 主表操作列固定在第一列，按钮风格与 BOM 资料列表保持一致，便于先处理操作再横向查看业务字段。
- 主表参考外协报价支持**点行展开**明细（左边展开箭头列已全局隐藏）；点击操作列按钮不触发展开。**列表加载后**后台批量预取当前页展开明细（`GET /api/sales-order/expand-lines/batch`），点击展开优先读缓存秒开；预取失败时仍回退单条 `GET /api/sales-order/:id`。
- 展开明细只读展示，列顺序固定为：序号、操作、客款号、编码、名称、规格、组别、单位、数量、用量、单价、金额、备注；操作列「查看」按钮样式与主表「查看」一致（`ErpTableActions` + `type="info" plain`），以浏览器原生新标签打开全屏 PI-BOM 只读页（无侧栏）：`/supply-chain/daily/sales-order-pi-bom-window?mode=view&orderId=…&kcaa01=…&piNo=…`（权限挂销售订单 view；标题 `查看 PI-BOM  {PI号}  {编码}`；内容与 PI-BOM 资料「查看」一致：基础资料用 BOM 同款表单只读 / 配件 / 树形 / 成本用量）。缺订单 ID 或编码时不跳转并提示。「用量」按该行 `PI号 + kcaa01` 汇总 `UB_ERP_Bom_pi_cost.kcac04/kcac06`，显示为 `成本：SUM(kcac04),SUM(kcac06)`，未运算或无结果显示 `-`。

## 测试与验收

```bash
npm run test:sales-order    # 单元 + 集成（server/*.test.mjs）
npm run e2e:sales-order     # Playwright：列表 → 查看整页只读表单（需 Vite + API）
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

- **只读树**（PI-BOM 资料查看 / 销售订单物料追溯弹窗）：对齐 BOM「用量表运算」——原生 `<table>` + ▶/▼，默认顶层，点三角/编码整支全开。
- 销售订单编辑页「PI BOM」可编辑树（内嵌用量输入）仍为 `el-table` 树，待另开任务统一。
- 树形展示必须对标 BOM 资料的“BOM用量表运算”树形展示（只读口径已对齐；编辑树另议）。
- 子行 `kcac01` = 父行 **实例键**（保存/同步 BOM 写入时：`systemcode` 优先，否则 `kcac02`）。
- 展示向下展开同样用 **实例键**（`usageTreeChildParentKey`），不能只用共用 ERP 编码 `kcac02`，否则会出现「每个 BN-0005 下挂 3 行 BN-0008」。
- **一单多明细**：读树/运算/删款须 **`pkcaa01` = 当前款** 过滤 list（避免多款共用展开父键时串读，如 PI-TEST111 的 BLU4 与 GRN）。
- 前端树表行唯一键使用物理行 `id`，不要使用 `systemcode`。
- **不做**整棵树 `list.id` 去重（会把子件挂到先遍历到的裁片下）。
- 建款/同步写入：按 `UB_ERP_Bom_parts.kcac01 -> kcac02/systemcode` 递归；过滤 `UB_ERP_Bom_code.flag5 + '-'` 结构行但保留 `CUT-` 和 `RP-`，其中 `RP-PQ` 仍过滤；不按编码或 systemcode 合并。历史 PI 若少行，对该款点 **同步 BOM** 后刷新（仅保存不会重建已有款）。
- 一键运算写 `pi_cost` 与 BOM 资料 `usage-calc` 同落库链路（`buildPiCostInsertPayloadFromUsageTree`），不做 `list.id` 二次去重。
- **PI BOM 读树（方案 A）**：同步后 list 含 BAG/TAG/RMP 等物理结构行时，从订单头 `systemcode` 直接展开（用量取行内 `kcac04/05`）；**旧 PI list** 无头下结构行时仍走虚拟根回退（`info` 快照 + `resolvePiBomUsageTreeRootKeys` 反推父键 + 合成顶级节点）。实现：`server/salesOrderPiBomUsageTree.js`。
