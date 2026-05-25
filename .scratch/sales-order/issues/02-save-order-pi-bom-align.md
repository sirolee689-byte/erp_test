# 02 — 新建/保存销售订单（含 PI BOM 对齐）

**Status:** `done`  
**Type:** AFK  

## Parent

`.scratch/sales-order/PRD.md`

## What to build

交付 **录单主路径**：新建或编辑未审单，保存主表 + 明细，并在 **同一事务** 内完成 **PI BOM 对齐**（禁止整 PI 先删后插）。

**保存行为（后端）**

- 校验：PI 号必填且全表唯一（含软删）、销售日期必填、交货日期不早于销售日期、明细 `kcaa01` 与订货数量 >0、客户须在册且已审、币别来自 `bom_currency` 全表
- 新增：写入 PI 号、按销售日期生成系统单号 `PI-YYYYMMDD-XXX`（同日 +1，满 999 失败）；编辑不改 PI 号/系统单号
- 明细：同 PI + 同 `kcaa01` 合并数量；明细表事务内整批替换
- **PI BOM 对齐**：删款 → 物理删 `UB_ERP_Bom_Sales` 头及该款全部 `UB_ERP_Bom_Sales_list`；仍在单上的款 **不得** 被主 BOM 覆盖；新款或删后同码再加 → 从主 BOM 建款（展开 ≤4 层，循环/超限失败并提示货品编码）
- 若明细 `kcaa01` 集合或订货数量变化 → 主表标 **未运算**；**不** 写物料单表
- 审计字段与 IP 写入规则对齐采购报价；子表操作人仅服务端写入

**前端**

- 列表「新增」、详情「保存」；主表 Tab（PI 号仅新增可填、客户/币别/日期/备注/小数位）；明细 Tab 选材 + 订货数量、只读展示字段、删行二次确认（说明保存后落库）
- 保存成功后刷新详情；列表可见运算状态为未运算

## Acceptance criteria

- [x] `POST /api/sales-order`、`PUT /api/sales-order/:id` 实现上述流水线；失败整单回滚
- [x] 集成测试或手工验收：**删明细款保存** 后 PI BOM 仅余在单款（例：删 TEST1 后 TEST1 的 Sales 头与 list 全删）
- [x] 集成测试：**PI 内改子件用量后保存**（未同步）用量不变
- [x] 集成测试：**新款入单** 自动从主 BOM 生成 `UB_ERP_Bom_Sales*`
- [x] 集成测试：**仅改订货数量** 保存后运算状态为未运算
- [x] 已审单 `PUT` 返回 400，前端拦截保存
- [x] 权限 `add`/`edit`；保存类审计含 PI 号与明细款数类人话

## Blocked by

- `01-list-and-read.md`（建议先有可用的 list/get；若并行开发，至少自测 POST 后 GET 详情）

## User stories

5–20, 21–27, 50–51, 56–58, 59–60

## Comments

- 纯函数：`server/salesOrderSaveLogic.js`
- PI BOM：`server/salesOrderPiBom.js`
- 保存服务：`server/salesOrderSaveService.js`
- 路由：`server/salesOrderHandlers.js`（POST/PUT、`GET /currency-options`）
- 集成测试：`server/salesOrderSave.integration.test.mjs`
- 前端：`src/views/supply-chain/daily/sales-order/index.vue`（新增/编辑弹窗 + MaterialSelector）
