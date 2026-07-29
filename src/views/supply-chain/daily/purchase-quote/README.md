# 采购报价（UB_ERP_Buy_offer + UB_ERP_Buy_offer_list）

## 页面与菜单

- 路由/菜单 path：`supply-chain/daily/purchase-quote`
- 页面：`index.vue`

## 已完成功能

- 顶栏 **「管理采购报价」** / **「采购报价添加」**：对齐外协报价与入库单；列表与录单页内切换，不再用搜索栏「新增报价」。
- **顶栏/内容区无框**（2026-07-23）：去掉顶栏左侧蓝条与添加/编辑面板外框；列表卡片也不再套灰框，对齐出入库。
- 新增、编辑、查看共用 **页内嵌表单**（基础资料 + 明细两个 Tab）；「查看」只读，不显示保存、增行、选料和删除入口。
- 录单标题行右侧放 **取消 / 保存**（对齐入库单添加页头），无底部按钮条。
- 搜索栏：关键词 → 查询 → 重置 → 间隔符 → 回收站 → 间隔符 → 显示未审核，**强制同一行**（`flex-wrap: nowrap`；关键词固定 420px）；间隔符样式对齐采购订单（高度 22px、左右间距 20px）。
- 主列表列顺序：操作（左固定）→ 采购报价单号 → 状态 → 采购报价日期 → 采购报价数据 → 供应商/外协商 → 备注 → 客户报价单号 → 关联单号 → 有效期 → 币别。
- 报价单基础资料 5 行：①报价单号 ②报价日期+有效日期 ③供应商/外协商 ④客户报价单号+币别+小数点配置 ⑤备注；输入宽度 250 / 500（双倍）/ 约 83（三分之一）。
- 无「编码检测」按钮；点保存时自动调 `check-doc-no` 查重（编辑且单号未改则跳过前端查重），重复则中文提示并拦住保存。
- 客户报价单号 **`cgaa06`** 可在基础资料录入并随保存写入主表；关联单号 **`PI`** 仍仅列表只读。
- 管理列表、按物料查询、录单明细表均使用视口底部固定横向滚动条（`ErpTableViewportHScroll` / `v-erp-list-h-scroll` + `erp-list-table`），对齐采购订单；主列表与物料查询不设表格 `max-height`，避免双纵滚。
- 录单「采购报价明细」：税点按**小数**填写与落库（`0.13` = 百分十三，与采购订单/`UB_ERP_Buy_offer_list.Tax` 实数据一致）；列头可输入后点「应用」整列填充并重算含税价；工具栏含「删除选定明细 / 删除全部明细 / 批量添加」。新增页另有「Excel批量添加 / 下载模板」：模板工作表固定为“明细”，按“序号、编码、税点、含税价”表头读取；页面先逐行校验后一次按编码读取 BOM，成功行只加入当前页面，仍由原“保存”统一落库。单次最多 1000 条，不写报价、采购 BOM 快照或操作日志；录单明细不展示 MOQ；供货周期只在当前录单页面展示，保存后重新打开不会保留。**2026-07-23**：去掉工具栏 `size="small"`，高度/字号 DIY：`--pq-line-toolbar-btn-height` / `--pq-line-toolbar-btn-font-size`（默认 36px / 16px）。
- **表单头标题与取消/保存**（2026-07-23）：左上「新增/编辑/查看采购报价」字号 `--pq-form-head-title-font-size`；右上按钮高度/字号 `--pq-form-head-btn-height` / `--pq-form-head-btn-font-size`（默认 18px / 36px / 16px）。
- **基础资料输入高度**（2026-07-23）：单行输入对齐出库单，DIY `--pq-base-input-height`；备注 DIY `--pq-remark-input-height`。

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

列表先完成当前页展开明细预取，再显示可点击的报价单；点击展开直接读取页面缓存，预取失败时仍回退 `/:id/lines`。`lines/batch` 与 `/:id/lines` 只返回展开表展示列（约 10 余列）且过滤 `del=0`；采购报价批量预取主表只读取主键和报价单号，不读取全部主表字段。展开明细不设 `max-height`，数百条明细直接随页面向下铺开，由页面滚动，不在明细框内纵向滚动。

## 业务规则摘要

- 默认列表：已审 `pass=1`；可切换「显示未审核」「回收站」（互斥逻辑与供应商等模块一致）。
- 顶部「转向物料查询」进入同页只读视图：首次进入不加载任何报价数据，只有输入材料编码后才按包含式模糊匹配查询。以 `UB_ERP_Buy_offer_list` 为主、按 `cgab01=cgaa01` 关联主表，一条报价明细显示一行，不合并物料或供应商。只显示主表和明细均为 `del=0/pass=1` 的记录，不提供任何新增、编辑、审核、删除或日志写入入口。`mq`、`zq` 只在真实物理列存在时显示。
- 已审禁止编辑、禁止软删；删除/彻底删除需二次确认文案（前端已实现），彻底删除仅 `UB_ERP_User.is_admin=1` 的超级管理员可执行。
- 采购报价新增、修改、反审核、删除（移入回收站）、彻底删除保留业务事务日志；审核和恢复由中央白名单补齐。业务日志接口标记为 `business`，不会再由中央层重复记录。Excel 物料核验为只读 POST，不写日志。
- 保存明细：采购报价专用事务按物料 GUID 差量保存；已有行只更新价格、税点、备注、页面顺序和操作人，新增行才复制 BOM 物料快照与采购 BOM 快照，删除行软删报价明细及其最多四层快照树。明细税点 `Tax` 与采购订单一致按小数写入（`0.13`），计价公式为 `含税 = 未税 × (1 + Tax)`。
- 新增时界面生成主表 `systemcode`，后端写入同值 `GUID`；供应商提交 `供应商编码,供应商名称,供应商ID`，币别提交编码、名称组合值。后端校验有效期、供应商组合值、BOM GUID 和有效币别汇率，单号冲突时自动改用 `BJ-年份后两位+记录数`。
- `UB_ERP_Bom_Buy` 只写真实存在的根节点物料快照字段；父子关系、用量、损耗和顺序只写入 `UB_ERP_Bom_Buy_list`。报价明细 `Seq` 保留页面提交顺序，不从 `UB_ERP_Bom_000` 读取不存在的 `seq`。
- 保存前前端查重：新增或编辑改了单号时调 `check-doc-no`；编辑单号未变更则跳过（避免把自己判重）。
- 关联单号 `PI` 本期仍仅列表展示，基础资料暂未录入。

## 权限配置

角色需在 `NEW_UB_ERP_System_role.Permissions` 中包含菜单 path `supply-chain/daily/purchase-quote`（及对应 `view`/`add`/`edit`/`audit`/`delete` 动作），否则接口 403、按钮由 `v-permission` 隐藏。

## 已知问题 / 下一步

- 物理表已由旧名 `Purchase_Quotation` / `Purchase_Quotation_list` 更名为 `UB_ERP_Buy_offer` / `UB_ERP_Buy_offer_list`；字段列名（`cgaa*`/`cgab*`）保持不变。
- 若业务需要在录单时填写关联单号（`PI`），再扩展基础资料表单与保存字段。

## 文档

- 总表映射：`docs/sql/database_map.md` 章节「UB_ERP_Buy_offer / UB_ERP_Buy_offer_list」
