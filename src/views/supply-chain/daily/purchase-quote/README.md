# 采购报价（UB_ERP_Buy_offer + UB_ERP_Buy_offer_list）

## 页面与菜单

- 路由/菜单 path：`supply-chain/daily/purchase-quote`
- 页面：`index.vue`

## 物理表

- `dbo.UB_ERP_Buy_offer`：主表（须 **单列主键**，一般为 `id`；业务单号 **`cgaa01`**；报价日期 **`cgaa02`**；有效期 **`cgaa07`**；币别码 **`cgaa05`**、币别名 **`rmb`**（前端下拉：001/002/003 与 人民币/美元/港元）；供应商/客户简称字段库中为 **`kehu`**（界面文案「供应商/外协商」）；备注 **`remark`**）
- `dbo.UB_ERP_Buy_offer_list`：明细；关联 **`cgab01` = 主表 `cgaa01`**；汇总金额 **`cgab04`**（不含税）、**`cgab05`**（含税）

列表接口在检测到上述列存在时，会 `LEFT JOIN` 明细聚合：行数、`SUM(cgab04)`、`SUM(cgab05)`、税点差额（含税−不含税）；报价日/有效期格式化为 **yyyy-MM-dd**。

列清单与类型仍通过 `INFORMATION_SCHEMA` / `sys.foreign_keys` 探测；明细外键候选含 **`cgab01`**。

## 接口一览（均需登录；按钮权限见 `server/apiPermissionGate.js`）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/supply-chain/purchase-quotations/list` | 主表分页列表 |
| GET | `/api/supply-chain/purchase-quotations/:id` | 主表 + 明细 |
| GET | `/api/supply-chain/purchase-quotations/:id/lines` | 仅明细（表格展开懒加载） |
| POST | `/api/supply-chain/purchase-quotations` | 新增；body `{ header, lines[] }` |
| PUT | `/api/supply-chain/purchase-quotations` | 保存；body `{ id, header, lines[] }` |
| PUT | `/api/supply-chain/purchase-quotations/audit` | body `{ id }` |
| PUT | `/api/supply-chain/purchase-quotations/unaudit` | body `{ id }` |
| PUT | `/api/supply-chain/purchase-quotations/restore` | body `{ id }` |
| DELETE | `/api/supply-chain/purchase-quotations/:id` | 软删 |
| DELETE | `/api/supply-chain/purchase-quotations/:id/permanent` | 彻底删除（仅回收站） |

## 业务规则摘要

- 默认列表：已审 `pass=1`；可切换「显示未审核」「回收站」（互斥逻辑与供应商等模块一致）。
- 已审禁止编辑、禁止软删；删除/彻底删除需二次确认文案（前端已实现）。
- 保存明细：**整批替换**（后端事务内 `DELETE` 旧明细再 `INSERT` 新行）。

## 权限配置

角色需在 `UB_ERP_System_role.Permissions` 中包含菜单 path `supply-chain/daily/purchase-quote`（及对应 `view`/`add`/`edit`/`audit`/`delete` 动作），否则接口 403、按钮由 `v-permission` 隐藏。

## 已知问题 / 下一步

- 物理表已由旧名 `Purchase_Quotation` / `Purchase_Quotation_list` 更名为 `UB_ERP_Buy_offer` / `UB_ERP_Buy_offer_list`；字段列名（`cgaa*`/`cgab*`）保持不变。

## 文档

- 总表映射：`docs/sql/database_map.md` 章节「UB_ERP_Buy_offer / UB_ERP_Buy_offer_list」
