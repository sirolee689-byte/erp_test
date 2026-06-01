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
| `UB_ERP_Sales_order_list` | 订货明细 | **`xsak01`** = PI 号；行 **`kcaa01`** + **`plan_quantity`**（订货数量）；`xsak04` 单价、`xsak05` 金额；保存时按 `kcaa01` 精确匹配 `bom_000`，`xsak02` 取 `bom_000.GUID`，`kcac01` 取销售订单主表 `GUID/systemcode`，`kcac02` / `GUID` / `systemcode` 同 `xsak02`，`kcac03` 取 `bom_000.kcaa25`（采购单位），`pass` / `kcaa26` / `remark` 同样从 `bom_000` 抄快照 |
| `UB_ERP_Bom_Sales` | PI 销售 BOM 头（每款成品一行） | **`sid`** = PI 号；**`kcaa01`** = 成品编码；保存/对齐建款时 **`GUID`** 与 **`systemcode`** **两列同值**（均取自 `bom_000.[GUID]`，不是各抄各的列名）；`kcaa09`～`kcaa11`、`kcaa14`～`kcaa15`、`kcaa25`～`kcaa31`、`type`、`location`、`version`、`remark`、`pass` 从 `bom_000` 抄快照 |
| `UB_ERP_Bom_Sales_list` | PI BOM 配件行 | **`sid`** = PI 号；从主 BOM 建款时按 `Bom_parts` **同名列快照**写入（`kcac01`～`kcaa35`、`type`、`sale_price`/`cost_price` 等，两表共有列自动对齐）；`kcac01` 为 PI 树父键（首层挂 `UB_ERP_Bom_Sales.systemcode`）；审计列由服务端写 |
| `UB_ERP_Bom_pi_cost` | 一键运算 — 物料明细 | **`sid`** = PI 号 |
| `UB_ERP_Bom_pi_consumption` | 一键运算 — 子件汇总（表不存在时查询内存合并） | **`sid`** = PI 号 |

主数据：`bom_000` / `Bom_parts`（主 BOM）；`bom_currency`（币别）；客户 `System_sales_customer`（`s_code` / `s_name` 快照）。

> 表字段与接口细节见 `docs/sql/database_map.md` §3.16；PI 号、主 BOM 门禁、运算状态见 `CONTEXT.md` §七。

## 接口一览

| 方法 | 路径 | 权限 action | 说明 |
|------|------|-------------|------|
| GET | `/api/sales-order/currency-options` | view | 币别下拉（读 `bom_currency`） |
| GET | `/api/sales-order/list` | view | 分页列表（`recycled`、PI/客户/日期筛选） |
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
| POST | `/api/sales-order/:id/calculate` | edit | 一键运算；可选 `{ syncedKcaa01: string[] }` 部分重算 |
| GET | `/api/sales-order/:id/material-bill` | view | 物料单（未运算 409） |
| GET | `/api/sales-order/:id/pi-bom?kcaa01=` | view | 无 `kcaa01`：款列表；有：树 + flat |
| PUT | `/api/sales-order/:id/pi-bom` | edit | body `{ kcaa01, lines: [{ id, kcac04, kcac05?, Describe? }] }` |

审计中文名见 `server/action_map.js`（与上表路由一一对应）。

> 审计三字段（与 `CONTEXT.md` 第三节一致，服务端 `resolveActorAuditTripletFromReq`）：`uid`=`UserID`，`uname`=`UserName`，`utruename`=`truename`（按登录 `usercode` 查库）。禁止把 `usercode` 写入 `uname`，禁止用工牌显示名写入 `utruename`。

## 推荐操作顺序（新人调通）

1. **列表** `GET /list` → **详情** `GET /:id`
2. **新建/保存** `POST` 或 `PUT`：事务内写主表、明细整批替换（**明细可为空**，仅主表 PI/客户/币别等）、**按款** PI BOM 删/建（禁止整 PI 先删后插）
3. **PI BOM 维护** `GET/PUT /:id/pi-bom`：改用量/损耗/备注（不从主 BOM 拉）
4. **同步 BOM** `POST /:id/sync-bom`：仅当需要以主 BOM 覆盖该款
5. **一键运算** `POST /:id/calculate` → **物料单** `GET /:id/material-bill`
6. 需要时：**审核** / **软删** / **恢复** / **彻底删除**

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
- **一键运算** 只读 **PI BOM**，写入 `UB_ERP_Bom_pi_*`，**不乘订货数量**；展示备料量 = 用量 × 订货数量
- **已审**（`pass='1'`）：禁止保存订单、PI BOM PUT、同步 BOM、软删、彻底删

## 主 BOM 门禁（保存 vs 同步）

- **保存订单**：已在单且已有 PI BOM 的款 **不得** 被主 BOM 覆盖
- **允许** 从主 BOM 写入：`同步 BOM`、明细 **新款**、删款后 **同码再加**
- **PI BOM Tab 保存**：只改 `UB_ERP_Bom_Sales_list` 的 `kcac04`/`kcac05`/`Describe`

## 前端 Tab

| Tab | 能力 |
|-----|------|
| 主表 | PI 号（新建可填）、客户、币别、日期、运算状态 |
| 明细 | 选材、合并同码数量、编辑数量/单价、自动显示金额、同步 BOM、跳转 PI BOM；选材带入 `kcaa06` 客款号、`remark` 备注、`kcaa10` 组别、`kcaa09` 工厂款号、`version` 版本；数量和单价为纯输入框数字录入；备注为 `bom_000.remark` 快照只读展示，不作为输入框；列顺序固定为：序号、操作、编码、数量、单价、金额、客款号、备注、用料名称(中文)、组别、工厂款号、版本 |
| 物料单 | 已运算后可查；备料量展示 |
| PI BOM | 按款树表编辑用量/损耗/备注 |

## 新增页交互

- 列表【新增销售订单】在当前页面直接打开新增弹窗，不再新开浏览器页（不使用 `target="_blank"`）。
- 列表按钮文案固定为 **「新增销售订单」**（与页面标题一致）。
- 新增弹窗初始化时，PI 号默认填 `PI-`，小数位数默认 `6`；编辑已有订单时仍以接口返回值为准。
- 主表新增 `PO号` 输入框；保存时写入主表字段 `UB_ERP_Sales_order.xsaj06`。
- 客户保存时写入 `xsaj05 = System_sales_customer.s_code`；客户名称仍写入 `kehu` 快照。
- 币别下拉显示为 `001,人民币`、`002,美元` 这类格式；保存时写入 `xsaj07 = bom_currency.id`，币别名称仍写入 `rmb` 快照。
- 新增保存自动生成 `GUID`，并同步写入 `systemcode`；`syscode` 与 `d_code` 保存为空值，`type` 固定写 `1`。
- PI 号查重时机：**输入框失焦即校验**（`GET /api/sales-order/check-pi`）；点击保存前后端都会再做一次兜底校验，避免并发撞号。
- 新增弹窗默认客户不写死假选项：打开时调用 `GET /api/supply-chain/customers/list?pass=1&keyword=PQD`，仅当接口返回真实存在的 `s_code=7001` 且 `s_name=PQD` 记录时，才默认选中该客户。
- 新增保存仍走现有 `POST /api/sales-order`；保存成功后关闭弹窗并刷新当前列表。

## 列表交互

- 顶部只保留一个关键词搜索框，同时匹配 PI 号、系统单号、客户名称；日期范围仍独立筛选。
- 列表列调整：新增 `PO号` 列，移除 `系统单号` 列（系统单号仍保留在详情接口中）。
- 默认显示已审核销售订单（`pass=1`）；打开“显示未审核”后只查未审核（`pass=0`）。
- “回收站”和“显示未审核”互斥；进入回收站后不再传审核状态，只查已逻辑删除数据。
- 主表操作列固定在第一列，按钮风格与 BOM 资料列表保持一致，便于先处理操作再横向查看业务字段。

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
