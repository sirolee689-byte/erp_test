---
name: erp-master-detail-document
description: 指导 ERP 业务单据「主表 + 明细表」模块落地：主从同一事务保存、已审核锁明细、权限/审计/SQL2008 兼容、大弹窗明细表 UI。金标准参照采购报价。当用户提到主表明细、主从单据、一对多行表、出入库单、销售单、采购单、报价单式编辑、header+lines、明细增删行保存时使用；若同时涉及基本资料审核/回收站通用规则，叠加引用 skill erp-masterdata-standard。
---

# ERP 主从业务单据标准件（主表 + 明细）

## 与本仓库其它 Skill 的分工

- **`erp-masterdata-standard`**：偏「基本资料」**单表**（颜色编码、供应商档案等）：列表 CRUD、审核、回收站九件套接口形态。
- **本 Skill**：偏「业务单据」**主表 + 多行明细**（采购报价、出入库、销售单、采购订单等）：保存时 **header + lines[]** 同步、明细常见 **整批替换（事务内删旧插新）**、**已审主表锁定明细编辑**。

两套规则可叠加：单据若也有审核/软删/回收站，**二次确认文案、pass/del 语义**仍对齐主数据标准件。

## 金标准参照（开发时必须打开对照）

| 层级 | 路径 |
|------|------|
| 前端页面 | `src/views/supply-chain/daily/purchase-quote/index.vue` |
| 模块说明 | `src/views/supply-chain/daily/purchase-quote/README.md` |
| 后端路由注册 | `server/index.js` → `registerPurchaseQuotationRoutes` |
| 实现文件 | `server/purchaseQuotationHandlers.js` |
| 权限闸门 | `server/apiPermissionGate.js`（按 Method + Path → menuPath + action） |
| 审计 | `server/action_map.js` + `server/operationAuditMiddleware.js` |
| 库表文档 | `docs/sql/database_map.md`（主表/明细表章节） |

## 后端硬性要求

1. **事务**：`POST`/`PUT` 保存必须在 **同一 `BEGIN TRANSACTION`**（或 `mssql` `Transaction`）内完成主表写入与明细同步；失败 **完整回滚**。
2. **明细策略**：常见为 **DELETE 旧明细 + INSERT 新行**（整批替换）；行序用库内序号列或提交顺序 `Seq` 一致。
3. **已审核拦截**：主表 `pass=1` 时 **禁止** `PUT` 修改（含仅改明细）；返回 **400** 与人话 `msg`；与前端 `detailLocked` 一致。
4. **SQL Server 2008 R2**：分页 **`ROW_NUMBER()`**；禁止 **`OFFSET-FETCH`**；复杂查询 **参数化**，`LIKE` 通配符需转义（参见 `escapeSqlLikePattern`）。
5. **接口形状（建议）**：  
   - `GET .../list`：主表分页 + 汇总（可选 JOIN 明细聚合）。  
   - `GET .../:id`：主表一行 + **明细数组**。  
   - `GET .../:id/lines`：仅明细（可选，供表格展开懒加载）。  
   - `POST`：`{ header, lines[] }` 新增。  
   - `PUT`：`{ id, header, lines[] }` 保存。  
   - 审核/反审/软删/恢复/彻底删：与项目其它模块 **同一风格**（body `{ id }` 等）。
6. **审计（§13）**：`action_map` 登记动作；成功日志 **可读中文**；保存类建议含 **明细条数** 类人话（如「明细共 N 项物料」）。不改变审计字段写入规则的前提下扩展文案。

## 前端硬性要求

1. **编辑弹窗**：主表字段与明细 **分 Tab**（基础资料 / 明细）；大宽度弹窗（如 `width="85%"`）、`top="5vh"`、`draggable` 可按 §15 与金标准页面一致。
2. **明细表**：`max-height` 使用 **`calc(80vh - 约200px)`** 级自适应；横向 **`scrollbar-always-on`**；表体底部 **留白**（避免横滚条与行内按钮/搜索图标误触）。
3. **已审锁明细**：主表已审（如 `pass=1`）时，明细 **增行/删行/可编辑单元格** 一律 **disabled** 或前置拦截；切换至明细 Tab、点保存时提示：**「该报价单已审核，请先反审后再修改明细。」**（文案可按单据类型替换「报价单」）。
4. **删除明细行**：须 **`ElMessageBox.confirm`**，文案需说明 **保存后才落库**（金标准已有固定句，可按模块微调）。
5. **选材/物料**：若关联 `bom_000`，优先复用 **列表接口 + 详情补齐** 模式；权限上确保 `apiPermissionGate` 对本菜单 **view** 放行所需 **GET**（如 BOM list、bom-detail）。
6. **权限按钮**：`v-permission` 区分 `add` / `edit` 等与菜单配置一致；**不改动**已有计算与接口字段逻辑前提下改 UI。

## 每模块交付自检清单

- [ ] 主从保存单接口内事务完整  
- [ ] 已审主表无法改明细（前后端双保险）  
- [ ] 高风险操作二次确认（删单、删行、审核、反审、彻底删）  
- [ ] `apiPermissionGate` 覆盖新路由  
- [ ] `action_map` + 审计 middleware 人话  
- [ ] `docs/sql/database_map.md` 主表/明细表与接口  
- [ ] 模块目录下 `README.md`（表名、关联键、接口列表、规则摘要）

## 禁止事项

- 为「少写代码」而 **拆分两次请求** 保存主表与明细（除非产品明确要求且具备补偿/一致性说明）。  
- 在 **已审** 状态依赖 **仅前端隐藏** 保存按钮而无后端校验。  
- 引入 **仅 SQL 2012+** 的分页语法。
