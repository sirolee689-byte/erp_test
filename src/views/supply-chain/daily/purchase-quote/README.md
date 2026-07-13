# 采购报价（UB_ERP_Buy_offer + UB_ERP_Buy_offer_list）

## 页面与菜单

- 路由/菜单 path：`supply-chain/daily/purchase-quote`
- 页面：`index.vue`

## 已完成功能

- 顶栏 **「管理采购报价」** / **「采购报价添加」**：对齐外协报价与入库单；列表与录单页内切换，不再用搜索栏「新增报价」。
- 新增/编辑为 **页内嵌表单**（基础资料 + 明细两个 Tab）；「查看」仍用弹窗。
- 录单标题行右侧放 **取消 / 保存**（对齐入库单添加页头），无底部按钮条。
- 搜索栏单行：关键词 → 查询 → 重置 → 间隔符 → 回收站 → 间隔符 → 显示未审核（不换行）。
- 主列表列顺序：操作（左固定）→ 采购报价单号 → 状态 → 采购报价日期 → 采购报价数据 → 供应商/外协商 → 备注 → 客户报价单号 → 关联单号 → 有效期 → 币别。
- 报价单基础资料 5 行：①报价单号 ②报价日期+有效日期 ③供应商/外协商 ④客户报价单号+币别+小数点配置 ⑤备注；输入宽度 250 / 500（双倍）/ 约 83（三分之一）。
- 无「编码检测」按钮；点保存时自动调 `check-doc-no` 查重（编辑且单号未改则跳过前端查重），重复则中文提示并拦住保存。
- 客户报价单号 **`cgaa06`** 可在基础资料录入并随保存写入主表；关联单号 **`PI`** 仍仅列表只读。

## 物理表

- `dbo.UB_ERP_Buy_offer`：主表（须 **单列主键**，一般为 `id`；业务单号 **`cgaa01`**；报价日期 **`cgaa02`**；有效期 **`cgaa07`**；币别码 **`cgaa05`**、币别名 **`rmb`**（前端下拉：001/002/003 与 人民币/美元/港元）；供应商/客户简称字段库中为 **`kehu`**（界面文案「供应商/外协商」）；备注 **`remark`**；客户报价单号 **`cgaa06`**（表单可录可存）；关联单号 **`PI`**（列表只读））
- `dbo.UB_ERP_Buy_offer_list`：明细；关联 **`cgab01` = 主表 `cgaa01`**；汇总金额 **`cgab04`**（不含税）、**`cgab05`**（含税）

列表接口在检测到上述列存在时，会 `LEFT JOIN` 明细聚合：行数、`SUM(cgab04)`、`SUM(cgab05)`、税点差额（含税−不含税）；报价日/有效期格式化为 **yyyy-MM-dd**。

列清单与类型仍通过 `INFORMATION_SCHEMA` / `sys.foreign_keys` 探测；明细外键候选含 **`cgab01`**。

## 接口一览（均需登录；按钮权限见 `server/apiPermissionGate.js`）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/supply-chain/purchase-quotations/list` | 主表分页列表 |
| GET | `/api/supply-chain/purchase-quotations/:id` | 主表 + 明细 |
| GET | `/api/supply-chain/purchase-quotations/:id/lines` | 仅明细（表格展开懒加载） |
| GET | `/api/supply-chain/purchase-quotations/lines/batch` | 批量预取当前页展开明细（列表加载后静默调用） |
| GET | `/api/supply-chain/purchase-quotations/check-doc-no` | 单号查重（保存前前端调用） |
| POST | `/api/supply-chain/purchase-quotations` | 新增；body `{ header, lines[] }` |
| PUT | `/api/supply-chain/purchase-quotations` | 保存；body `{ id, header, lines[] }` |
| PUT | `/api/supply-chain/purchase-quotations/audit` | body `{ id }` |
| PUT | `/api/supply-chain/purchase-quotations/unaudit` | body `{ id }` |
| PUT | `/api/supply-chain/purchase-quotations/restore` | body `{ id }` |
| DELETE | `/api/supply-chain/purchase-quotations/:id` | 软删 |
| DELETE | `/api/supply-chain/purchase-quotations/:id/permanent` | 彻底删除（仅回收站） |

列表加载后后台批量预取当前页展开明细，点击展开优先读缓存秒开；预取失败时仍回退单条 `/:id/lines`。

## 业务规则摘要

- 默认列表：已审 `pass=1`；可切换「显示未审核」「回收站」（互斥逻辑与供应商等模块一致）。
- 已审禁止编辑、禁止软删；删除/彻底删除需二次确认文案（前端已实现）。
- 保存明细：**整批替换**（后端事务内 `DELETE` 旧明细再 `INSERT` 新行）。
- 保存前前端查重：新增或编辑改了单号时调 `check-doc-no`；编辑单号未变更则跳过（避免把自己判重）。
- 关联单号 `PI` 本期仍仅列表展示，基础资料暂未录入。

## 权限配置

角色需在 `UB_ERP_System_role.Permissions` 中包含菜单 path `supply-chain/daily/purchase-quote`（及对应 `view`/`add`/`edit`/`audit`/`delete` 动作），否则接口 403、按钮由 `v-permission` 隐藏。

## 已知问题 / 下一步

- 物理表已由旧名 `Purchase_Quotation` / `Purchase_Quotation_list` 更名为 `UB_ERP_Buy_offer` / `UB_ERP_Buy_offer_list`；字段列名（`cgaa*`/`cgab*`）保持不变。
- 若业务需要在录单时填写关联单号（`PI`），再扩展基础资料表单与保存字段。

## 文档

- 总表映射：`docs/sql/database_map.md` 章节「UB_ERP_Buy_offer / UB_ERP_Buy_offer_list」
