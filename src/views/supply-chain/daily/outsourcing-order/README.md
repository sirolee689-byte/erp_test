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

- **表格高度**：`max-height` 铺满可视区，行少时随内容收缩；DIY 调 `AssistOrderEditForm.vue` → `.assist-lines-pane` → `--assist-lines-offset`（默认 320px）。

- **横向滚动**：编辑明细表接 `ErpTableViewportHScroll`，横条固定在视口底部（表内横滚条隐藏）；DIY 底距见下节「列宽调整」。

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

| 表格铺满高度 | `AssistOrderEditForm.vue` → `.assist-fees-pane` → `--assist-fees-offset`（默认 268px） |



## 列宽调整（DIY）



均在 `AssistOrderEditForm.vue` 修改，保存后切到明细 Tab 或刷新页面让 `doLayout` 重算。



| 要调的列/区域 | 改什么 |

|---------------|--------|

| 操作列宽 | 脚本常量 `assistLineActionsColWidth`（默认 118px，约两钮宽 + 间距） |

| 物料编码列宽 | `label="物料编码"` 的 `min-width="150"` |

| 其它数据列 | 各 `el-table-column` 的 `width`（固定宽）或 `min-width`（可撑开） |

| 查看/删除按钮等宽 | 样式 `.assist-line-action-btn` → `--assist-line-action-btn-min-width`（默认 52px，两钮共用） |

| 表纵向可视高度 | `.assist-lines-pane` → `--assist-lines-offset`（默认 320px） |

| 底横条距视口底 | 脚本常量 `assistLinesHScrollBottom`（默认 64px，为底部「立即提交」留空） |



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

- **款号/编码颜色**：红色 = 编码未命中 `Bom_code` 分类前缀；蓝色 = 编码命中 `Bom_code.flag5-` 前缀（`copen=1`；`OUT` 为 `-OUT` 后缀口径，与旧系统 `bomstr` 一致）。父行款号与子行物料同一规则。

- **子行排序**：①红 pi_cost → `px`；②蓝 `kcaa03=款号` 半成品 → `seq`；③蓝 pi_cost 余量 → `px`。

- **父行边框 DIY**：`batch-add-window.vue` → `.assist-batch-row--style` → `--assist-batch-style-border`。

- **子表操作列宽 DIY**：`batch-add-window.vue` → `.assist-batch-subtable .col-action` → `--assist-batch-sub-action-width`（默认 128px）；选择按钮最小宽 `--assist-batch-pick-btn-min-width`。



### 数量口径



| 物料类型 | BOM 用量 |

|----------|----------|

| 有 `pi_cost` 匹配 | 第一条 `kcac06 × xsak03` |

| 无 `pi_cost`、命中 Bom 前缀半成品 | `xsak03 × Bom_Sales_list.kcac04` |



可入数量 = 上表 BOM 用量 − 已有外协（含未审）− 父页当前行；下限 0。出库数量列：占位「待开发」。



## 其它类型



订单外发 / 其他外协点「批量添加」仅提示后续版本；旧 `material-options` 弹窗已自订单外协明细入口移除。



## 相关文件



- `index.vue` — 列表与表单宿主

- `AssistOrderEditForm.vue` — 三 Tab 表单

- `batch-add-window.vue` — 批量选材独立页

- `server/assistOrderBatchAdd.js` — 树形数据与数量计算

