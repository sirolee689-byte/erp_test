# 外协订单（outsourcing-order）



## 页面与模式



- 主路径：`/supply-chain/daily/outsourcing-order`

- 顶部 **管理外协订单 / 外协订单添加** 模式条；编辑与添加共用整页表单 `AssistOrderEditForm.vue`（基础资料 / 明细 / 额外费用）。



## 明细 Tab 按钮



| 按钮 | 行为 |

|------|------|

| 操作列「查看」 | 新页打开该行款号对应的 PI-BOM（`/inventory/basic/pi-bom-data-window?mode=edit&orderId=…&kcaa01=款号`） |

| 操作列「删除」 | 橘色按钮标记待删；再点变灰「已选择」可取消标记（对齐 BOM 配件表） |

| 删除选定明细 | 二次确认后移除操作列已标记（`_lineMarked`）的行；无标记时提示 |

| 删除全部明细 | 二次确认后清空 `editForm.lines` |

| 批量添加 | 见下节；新行插入表顶 |



- **序号倒序**：顶行序号最大；批量添加的新明细出现在最上方。

- **PI 号列**：编辑/查看明细表不展示 PI 列（关联 PI 在表头「关联单号」）；`line.piNo` 仍保留在数据层供批量选材与保存。

- **表单布局**：添加/编辑面板固定视口高度，底栏「立即提交」始终可见；三个 Tab 中间区域各自滚动或铺满。

- **表格高度**：明细/费用表由容器 `ResizeObserver` 驱动 `height`，自动占满 Tab 剩余区域。

- **横向滚动**：编辑明细表接 `ErpTableViewportHScroll`，横条固定在底栏「立即提交」正上方（`bottom-offset` 跟底栏实测高度联动）；DIY 见下节「列宽调整」。

- **操作列按钮 DIY**：`AssistOrderEditForm.vue` → `.assist-line-mark-btn` → `--assist-line-mark-btn-min-width`。



删行仅影响当前编辑内存；保存时明细仍整批重写，`_lineMarked` / `referenceOrderId` 不入库。



## 额外费用 Tab



- **默认 5 行**：新建/重置时展示 5 行空占位；编辑加载时保留全部已存费用，不足 5 行则补空行至 5 行；可点「增行」继续追加。

- **行内选材**：「费用编码及名称」为 `el-select` 下拉（`===请选择===`），远程搜索 `GET /api/assist-order/fee-options`；选中显示 `编码, 名称`（如 `FEE-0001/-, 染色费`），实现见 `AssistOrderEditForm.vue` → `formatFeeLabel`。

- **增行 / 重置**：工具栏「增行」追加一行空占位；「重置」清空为默认 5 行（`index.vue` → `addFeesRow` / `resetFeesTab`）。

- **保存**：仅已选 `feeCode` 的行入库；占位空行由前端提交前过滤 + 后端 `normalizeAssistOrderFees` 双重过滤，不入 `UB_ERP_assist_order_money`。

- **列表展开**：管理页点「+」展开子表时，额外费用行接在明细行之后；名称 / 含税金额 / 税点 / 备注有值，其余列留空（`index.vue` → `buildExpandedDisplayRows`）。



### 额外费用 DIY



| 要调的项 | 改什么 |

|----------|--------|

| 默认行数 | `index.vue` → `ASSIST_FEE_ROW_COUNT`（默认 5） |

| 下拉展示格式 | `AssistOrderEditForm.vue` → `formatFeeLabel` |

| 表格铺满高度 | 由 `.assist-fees-table-wrap` 容器自动计算，一般无需手调 |



## 管理列表汇总

- **外协订单数据列**（每单）：列表接口 `GET /api/assist-order/list` 实时聚合，非主表存储字段。
  - 总项数 / 总数量 / 含税·不含税·税点总价：明细表 `UB_ERP_assist_order_list`，`del=0`
  - 额外费用：费用表 `UB_ERP_assist_order_money`，`del=0`
- **展开子表「小计：」**（每单）：点「+」展开后，明细+费用表底部一行；`el-table` `show-summary`；「小计：」在名称列，数量/单价/金额列对齐汇总。
- **页底「小计：」**（当前页）：在主表与底部分页之间，汇总本页所有订单；口径与展开子表一致，**含展开区接在明细后的额外费用行**。
  - 数量：`SUM(明细 wxak03)`
  - 金额：`SUM(明细 wxak05)`（费用行展开区不含税金额为空，不计入）
  - 金额（含税）：`SUM(明细 wxak051) + SUM(费用 money)`
  - 单价 / 单价（含税）：金额 ÷ 数量（数量>0 时，否则显示 `-`）
- 计算逻辑：`src/utils/assistOrderPageSubtotal.js`；展示与样式：`index.vue` → `.assist-page-subtotal`

## 列宽调整（DIY）



均在 `AssistOrderEditForm.vue` 修改，保存后切到明细 Tab 或刷新页面让 `doLayout` 重算。



| 要调的列/区域 | 改什么 |

|---------------|--------|

| 操作列宽 | 脚本常量 `assistLineActionsColWidth`（默认 118px，约两钮宽 + 间距） |

| 物料编码列宽 | `label="物料编码"` 的 `min-width="150"` |

| 其它数据列 | 各 `el-table-column` 的 `width`（固定宽）或 `min-width`（可撑开） |

| 查看/删除按钮等宽 | 样式 `.assist-line-action-btn` → `--assist-line-action-btn-min-width`（默认 52px，两钮共用） |

| 表单面板顶留白 | `index.vue` → `.assist-order-page--form` → `--assist-page-chrome`（默认 48px，对齐 ERP 顶栏） |

| 底栏高度 / 横条位置 | `index.vue` → `.assist-form-footer` 的 padding；横条 `bottom-offset` 随底栏 `ResizeObserver` 自动同步 |



Element Plus 约定：固定列（操作、序号）用 `width`；数据列优先 `min-width`。



## 批量添加（订单外协）



- 条件：`assistType=1` 且已填关联 PI。

- 打开：`window.open` → `/supply-chain/daily/outsourcing-order-batch-window?sessionId=…&piNo=…`

- 权限：`meta.permissionPath` 沿用 `/supply-chain/daily/outsourcing-order`

- 接口：`GET /api/assist-order/batch-add-tree?piNo=&excludeOrderNo=&currentLines=`（JSON 字符串）



### 父子页通信



1. 父页写入 `sessionStorage` 键 `assist-order-batch:{sessionId}`（PI、当前明细、编辑时排除单号等）；子页开窗时复制读取。

2. 子页点「保存已选数据」：主通道 `postMessage`（`assist-order-batch-apply`）把 `openedPiNo`（开窗快照）与选中行发给父页；父页校验当前「关联单号」与 `openedPiNo` 一致后 `applyBatchAddLines`，再 `postMessage` 回 `accepted` / `rejected`；子页收到 `accepted` 后关窗。

3. PI 变更拦截：弹窗打开后若父页改了关联 PI，保存时父页拒绝合并并在子页提示「关联 PI 已变更，请重新打开批量选材」。

4. 兜底：子页仍写入 `assist-order-batch-result:{sessionId}`；父页 `storage` 事件解析 **`event.newValue`**（非本页 `sessionStorage`）合并明细。



### 子行展示规则



- 同一款式下 `kcaa01` 去重：BOM 顺序第一条为准，后续同码行不显示。

- `kcaa13=0` 不可外协物料直接隐藏，不渲染灰色按钮。

- 展开后子表相对父行左缩进（`--assist-batch-child-indent`），嵌套独立子表头。

- 子表头「操作」列有棕色「全选」，仅勾选该款可入物料；子行另有「查看」打开 PI-BOM 新页。

- **款号/编码颜色**：红色 = 编码未命中 `UB_ERP_Bom_code` 分类前缀；蓝色 = 编码命中 `UB_ERP_Bom_code.flag5-` 前缀（`copen=1`；`OUT` 为 `-OUT` 后缀口径，与旧系统 `bomstr` 一致）。父行款号与子行物料同一规则。

- **子行排序**：①红 pi_cost → `px`；②蓝 `kcaa03=款号` 半成品 → `seq`；③蓝 pi_cost 余量 → `px`。

- **父行边框 DIY**：`batch-add-window.vue` → `.assist-batch-row--style` → `--assist-batch-style-border`。

- **子表操作列宽 DIY**：`batch-add-window.vue` → `.assist-batch-subtable .col-action` → `--assist-batch-sub-action-width`（默认 128px）；选择按钮最小宽 `--assist-batch-pick-btn-min-width`。



### 数量口径



| 物料类型 | BOM 用量 |

|----------|----------|

| 有 `pi_cost` 匹配（`kcaa13=1` 且 `isok=1`，`px` 最小第一条） | `kcac06 × xsak03` |

| 无 `pi_cost`、命中 Bom 前缀半成品 | `xsak03 × Bom_Sales_list.kcac04` |



已外协数量：`SUM(wxak03)`，键为 `pi + pq(款号，优先 pq 列否则 Product) + kcaa01`，`del=0`（含未审主单）。

可入数量 = BOM 用量 − 已外协 − 父页当前行（编辑时另排除本单已存行）；下限 0。出库数量列：占位「待开发」。



## 订单外发批量添加

- 条件：`assistType=2` 且已填关联 PI。
- 显示：直接读取 `UB_ERP_Sales_order_list`，一行就是一个销售订单款式/成品，不展开 BOM 物料。
- 销售订单过滤：明细 `xsak01=PI`、`del=0`、`pass=1`；主单 `UB_ERP_Sales_order` 必须 `del=0` 且 `closed=0`，不检查主单是否审核。
- 可选数量：`未外发数量 = xsak03 - 已外协数量 - 当前页面未保存数量`；已外协数量来自 `UB_ERP_assist_order_list` 按 `pi + kcaa01` 汇总 `wxak03`，只统计 `del=0`。
- 可选限制：不判断物料档案 `kcaa13` 外协标记，只要未外发数量大于 0 即可选择。
- 单价来源：不查外协报价；按销售订单明细 `systemcode` 去 `UB_ERP_Buy_offer_list.cgab02` 找最新一条已审核未删除报价，带出 `cgab04 -> wxak04`、`cgab05 -> wxak041`、`tax -> tax`；查不到时三项为 0。
- 合并保存：仍走批量弹窗的 PI/外协商快照校验，父页外协商或 PI 被改动时拒绝合并，提示重新打开批量选材。

## 其他外协批量添加

- 条件：`assistType=0`；须已选外协商；关联单号可空（可选 PI 联想手填，不影响选材范围）。
- 来源：已审核未删除 `UB_ERP_Bom_000`；接口同 `GET /api/assist-order/batch-add-tree`（`assistType=0`），支持分类 `bomCodeId`、关键词 `keyword`、分页。
- 批量窗 UI：第一行「分类」下拉 +「货品已选数」（本次勾选数）；第二行「查询条件」输入框（宽约 30%）+「立即查询」。
- 表格列（从左到右）：操作、编码、名称(中文)、名称(英文)、名称(开票名)、规格、单位。
- 编码列完整展示；操作列仅「选择 / 选择成功」，列宽紧凑（DIY：`--assist-batch-other-action-width`、`--assist-batch-other-code-min-width`）。
- 保存：默认 `wxak03=0`；`product` 为空；经 `sessionStorage` / `postMessage` 回传父页；父页对「其他外协」不校验 PI 必填与 PI 快照一致（`requirePi=false`）。

## 关联单号（其他外协）

- 基础资料「关联单号」与订单外协同源 PI 联想（`el-autocomplete` + `pi-suggest`），可空、可手填非 PI 文本。
- 从下拉选 PI 只填关联单号，**不**自动改交货日期（交货日期自动带入仅订单外协/订单外发）。



## 相关文件



- `index.vue` — 列表与表单宿主

- `AssistOrderEditForm.vue` — 三 Tab 表单

- `batch-add-window.vue` — 批量选材独立页

- `server/assistOrderBatchAdd.js` — 树形数据与数量计算


## 批量添加自动带单价

- 打开“批量添加”前必须先选择外协商；批量窗口会锁定当时的 PI 和外协商。
- 子窗口保存时，如果父页面的 PI 或外协商已经被改动，父页面会拒绝合并并提示重新打开批量选材。
- 自动带价只用于给新明细填默认值，用户仍可在明细里手动修改单价和税点。
- 报价来源（外协报价物理表 `UB_ERP_assist_offer` / `UB_ERP_assist_offer_list`）：
  - 第一层：按「外协商 + 物料编码」取最新已审核、未删除报价。
  - 第二层：第一层没有时，从 `UB_ERP_assist_offer_list` 按「物料编码」兜底取最新已审核、未删除报价。
  - 两层都没有时，不含税单价、含税单价、税点都为 0。
- 批量选材返回的 `wxab04` / `wxab05` / `tax` 会落到订单明细的 `wxak04` / `wxak041` / `tax`，金额按现有数量直接计算；不会把含税单价强制重算成“不含税单价 × (1 + tax)”。
