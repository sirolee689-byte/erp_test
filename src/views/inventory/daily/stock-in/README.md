# 入库单

## 页面入口

- 菜单路径：`inventory/daily/stock-in`
- 页面文件：`src/views/inventory/daily/stock-in/index.vue`
- 后端接口前缀：`/api/stock-in`

## 已完成功能

- **筛选区（两行左对齐）**：第一行供应商/外协商（点击可直接下拉，输入后继续联想）+ 入库类型；第二行关键词 + 查询 + 开关组「回收站 | 显示未审核 | 显示未复核」+ 重置。
- **列表分页**：默认 10 条/页，可选 `10 / 20 / 50 / 100`。
- **展开明细**：无顶部汇总条；明细表底「小计」行汇总数量与金额（价格列受 `price` 权限控制）。
- **展开明细-关联单号相关信息**：按入库类型分流计算并显示两行（`关联总数` + `差数/多出数`）；有退货时追加「曾发生退货数」；查不到关联明细或无关联类型（其他入库/盘盈）显示灰字「无相关数据」。
  - 采购入库（类型 1）关联订单数量字段：`UB_ERP_Buy_order_list.kcak03`（旧库字段 `cgae03` 在当前环境不存在）。
- **列表展示**：主列表 12 列（操作、状态、入库类型、入库单号、关联单号、入库日期、入库单数据、仓库名称、供应商/外协商、经手人、纸质单号、备注）；操作与入库单号左固定；底栏横向滚动。
- **状态列**：固定显示「已审核/未审核」+「已复核/未复核」；已结案、加工只读作补充标签。
- **显示未复核**：`showUnreviewed=1` 筛 `sp_flag <> '1'`；已审核且未复核行显示「复核」按钮（须 `review` 权限）；回收站开启时该开关隐藏。
- **入库单数据列**：两行汇总（项数/数量/入库量；含税·不含税·税点总价，需 `price` 权限）。
- **入库日期**：列表只显示年-月-日。
- 只读详情：可查看主表信息和明细清单。
- 新增/编辑：支持其他入库、采购入库、外协入库、外协退料、生产入库、生产退料、销售退货、盘盈入库。
- 新增/编辑 UI：已拆分为两页签「入库单基础资料 / 入库单明细」；基础资料按 8 行展示（入库单号、日期、入库类型按钮、单号、关联方、第六行为「仓库+输入框」与「来货单号/纸质单号+输入框」同一行并排、含税与否、备注）；第六行沿用系统标准「仓库」标签列对齐，右侧追加「来货单号/纸质单号+输入框」；入库单号只读但可选中/按钮复制，关联单号只读展示，右侧固定「选择 / 清空」按钮，选中后在下方固定显示“已选单号”并可复制。
- 新增页体验：进入新增/重置新增表单时，前端优先自动选择名称或编码为「货仓」的仓库；找不到则保持空值，不硬写仓库编码。表单顶部原「返回列表」按钮改为「重置」，新增模式下清空基础资料和明细并重新带出建议单号/默认仓库，编辑模式下重新读取当前单据。
- 统一输入框宽度：以「入库日期」输入宽度为基准，入库单号、关联单号、关联单位、仓库、纸质单号统一走 `stock-unified-input`；在 `stock-form--base` 里调 `--stock-base-input-width` 可整体生效。
- 入库类型按钮：采用分离按钮样式并增加间距，按钮尺寸统一由 `stock-form--base` 下的 CSS 变量控制（高度、间距、字号、圆角）；当前默认高度 `42px`、字号 `16px`。
- 第四/五行联动：选择采购单号/外协单号/销售单号后，第五行关联方自动带出（供应商/外协客户/客户）；**生产入库/生产退料**第五行「生产车间」为必选下拉（数据来自 `UB_ERP_Stocks_workshop`），须先选车间再点第四行「派工单号 → 选择」；其他入库/盘盈保留手工填写关联单位。
- **生产入库选派工单（2026-06-22，对齐旧系统 s_search4）**：类型 4 点「选择」打开标题为「派工单列表（已选：车间名）」的明细级弹窗；接口 `GET /api/stock-in/production-dispatch-pick-page`；先校验车间在 `UB_ERP_Stocks_workshop` 存在且 `del=0/pass=1`；列表为派工主表 + 明细行（`scak02=GUID`，余量 `scak03-scak04+scak05>0`）；12 列含货品与数量；搜索仅头表（派工单号/PI/日期/备注）；**分页按派工单张数**（默认 10 张/页，可选 20/50/100），按主表 `addtime` 录入时间新→旧排序后取当前页派工单并展开其全部有效明细行；分页总数为符合条件的派工单张数（非明细行数）；**SQL 性能（2026-06-22）**：由头表逐行 `EXISTS` 扫明细改为 `qual_lines` 明细驱动反向 JOIN（内网包装部首屏约 15 秒→约 1 秒，业务结果与改前一致）；**同一派工单号多行时，仅该单在本页的第一行显示「关联选择」与派工单号**（后续行这两列留空，PI/货品/数量仍每行显示）；点「关联选择」写回派工单号、PI、车间名称，并清空全部明细；`dispatchSystemcode` 存派工主表 `systemcode` 供批量添加上下文（不入库单主表 systemcode）。
- 关联单据选择窗口（非生产入库）：除其他入库/盘盈外，第四行通过「选择」打开来源单据窗口；**生产退料**未选车间时前端拦截；`source-order-page` 默认 10 条/页，列「操作、状态、单号、PI号、关联方」；生产类型「清空」只清派工单与 PI，不清车间；换车间时若已有派工单/PI/明细，弹窗确认后一并清空。**采购入库（2026-06-22 修复）**：列表 SQL 曾出现 `AS referenceNo` 重复拼接导致「Incorrect syntax near 'AS'」，已改为仅外层一次别名。
- 备注输入框：基础资料页“备注”输入框默认占该行内容区约 `50%`，小屏自动切到 `100%`。
- 明细录入：无来源类型可手工选料；有关联单据类型可从关联单据批量带入明细；入库单明细不再显示「增加明细」按钮。
- 明细删除：明细表最左侧为按钮式选择列，每行显示「删除」，点击后变为「已选择」；「删除选定明细」只移除这些已标记行，交互参考采购订单/外协订单明细。
- **采购入库批量添加（2026-06-22）**：类型为采购入库时，「批量添加」打开独立新窗口（`/inventory/daily/stock-in-purchase-batch-window`），接口 `GET /api/stock-in/purchase-batch-lines`；按已选采购单 `kcak01` 分页列出 `UB_ERP_Buy_order_list` 明细，数量池按 `kcak02`（BOM `systemcode`）共享；需入数量 `tempx`（红）= 换算采购量 −（已审+未审入库 − 已审+未审退货）；可超量 `kcao031`（蓝）= `max(0, 换算量×(1+物料分类浮动率) − 净占用)`，浮动率来自 `UB_ERP_Stocks_material.stocks_in`；编辑入库单时汇总排除当前单 `kcan01`；有未审退货不可选；`is_admin=1` 超级管理员可在已满行强制选；带回默认入库数量=需入数量，单价按主表汇率换算 RMB；保存时 `kcao03` 不得超过 `kcao031`（有浮动率时）或需入数量；「保存已选数据」经 `postMessage` 回传（选中行须深拷贝为纯 JSON，避免 Vue 代理导致 `postMessage` 克隆失败），主页面写入明细后回 `accepted`，子窗口再提示成功并自动关窗；结果暂存用 sessionStorage；打开子窗时缓存 `window.open` 引用作回执兜底；回传时仍校验采购单号和供应商；读库时所有参与比较、展示、排序的旧库字段都先安全转文本/数字（包含 `del/pass/seq/code/stocks_in/rmb_hl/rate` 等），避免旧库 nvarchar/数字混用导致 `Error converting data type nvarchar to numeric`。本期不做：`UB_ERP_Buy_order_stocks_max` 超订量、供应商 PQD(7001) 豁免（留超量入库配置下期）。
- **外协退料批量添加（2026-06-22）**：类型为外协退料时，「批量添加」打开 `/inventory/daily/stock-in-assist-return-batch-window`；父层外协成品 + 展开 BOM 配件两层表；接口 `assist-return-batch-lines` / `assist-return-bom-parts`；带回 `kcao03=0`、`kcao031=100000`；配件单价用 `Finance_currency.bom_rate`（非 `rate`）；详见下文专节。
- **生产入库批量添加（2026-06-22，2026-06-23 补强）**：类型为生产入库时，「批量添加」打开 `/inventory/daily/stock-in-production-batch-window`；接口 `GET /api/stock-in/production-batch-lines`；打开前先校验派工主表（`del=0/pass=1/closed=0/scaj05=车间`；`dispatchSystemcode` 有值时才校验 `systemcode`）；校验失败弹中文错误约 1.5 秒后自动关窗；`kcao02` 写入派工明细键 `scak02`；可入数量 `tempx` = 换算派工量 − 已审入库 − 未审入库（**允许显示负数**，按钮仍仅 `tempx>0` 可选）；出库（返工）只展示不扣减；可入上限 `kcao031` = `max(0, tempx + tempx×浮动率)`；`tax/info/reference` 派工明细行优先、BOM 兜底；带回循环 `kcaa01~35`；单价/金额全 0；详见下文专节。
- 金额联动：按不含税单价、税点、数量计算含税单价和两套金额；不含税模式下税点强制为 0。
- 明细数量限制：关联单据类型（采购、外协、生产、销售退货等）实时按行上的 `kcao031 / availableQty / tempx / needQty` 计算可入库上限，入库数量超过上限时立即提示并回退；其他入库、盘盈入库不限制上限。保存接口仍会做同样校验，防止绕过前端。
- 税点限制：不含税模式下税点大于 0 会提示并清零；编辑入库单时税点不能为空，如无税点必须填 0。
- 批量添加限制：采购批量添加窗口中，可入库上限为 0 或存在未审采购退货的行不可选；超级管理员本期也不能绕过上限，后续统一由“超量入库配置”功能处理。非采购的当前页批量添加同样会禁用可入库上限为 0 的来源行。
- 保存校验：`kcan08` 除 **外协退料（类型 3）** 外均必填；页面上显示为来货单号 / PI号 / PO号 / 纸质单号时，未填则前端切回基础资料页并聚焦该输入框，后端同步兜底拒绝保存。外协退料来货单号允许留空。
- 详情/展开明细税点：物理列 `UB_ERP_Stocks_Storage_list.Tax` 经详情接口统一映射为 `tax`，列表展开与编辑页均用小写 `tax` 展示。
- 明细客供 `Customer_supply`：物理列为整型（`1=是`，`0/2=否`）；外协退料批量添加接口返回数字字段 `Customer_supply` + 展示字段 `customerSupplyLabel`；保存时 `normalizeCustomerSupplyInt` 兼容历史界面「是/否」。
- 审核/反审核：审核后进入库存统计口径，反审核后退出库存统计口径。
- 财务复核：已审核单可复核，`sp_flag=1` 后只读锁定。
- 删除/恢复/彻底删除：已审核单不能直接删除，必须先反审核；彻底删除只允许 `UB_ERP_User.is_admin=1` 的超级管理员（操作时按当前登录用户主键实时查库，不依赖旧登录令牌是否缓存该字段）。
- 打印：打印主表、明细和合计；价格字段受 `price` 权限控制。
- 待开发占位：导出信息、超量入库配置。

## 后端接口

- `GET /api/stock-in/list`：列表分页，SQL 使用 `ROW_NUMBER()`，兼容 SQL Server 2008 R2。
- `GET /api/stock-in/:id`：详情。
- `GET /api/stock-in/:id`：详情明细包含 `relationOrderQty/relationInboundQty/relationReturnedQty/relationDiffQty/relationOverflowQty/relationNoData`，用于“关联单号相关信息”列展示。
- `GET /api/stock-in/suggest-doc-no`：建议入库单号；最终单号仍以后端保存结果为准。
- `GET /api/stock-in/warehouse-options`：仓库候选。
- `GET /api/stock-in/list-related-party-options`：列表筛选供应商联想（`UB_ERP_System_supplier`，仅查 `del=0 AND pass=1`，关键字可空）。
- `GET /api/stock-in/related-party-options`：表单关联方候选（按入库类型）。
- `GET /api/stock-in/source-options`：关联单据候选。
- `GET /api/stock-in/source-options`：关联单据候选（返回 `sourceOrderNo + relatedPartyCode + relatedPartyName`，派工单候选额外返回 `referenceNo` 用于生产入库自动带出 PI号）。
- `GET /api/stock-in/source-order-page`：关联单据选择窗口（**生产退料**等；默认 10 条/页；生产退料须传 `relatedPartyCode` 并按 `scaj05` 过滤）。
- `GET /api/stock-in/production-dispatch-pick-page`：**生产入库**派工单明细选择（分页单位=派工单张数，默认 10 张/页；按 `addtime` 新→旧；参数 `workshopCode`、`keyword`、`page`、`pageSize`；车间无效返回 400）。
- `GET /api/stock-in/source-lines`：关联单据明细（非采购入库批量添加仍用此接口）。
- `GET /api/stock-in/purchase-batch-lines`：采购入库批量添加新窗口分页数据（`page/pageSize`，默认 20；参数 `sourceOrderNo`、`supplierCode`、`excludeReceiptNo`、`selectedKeys`、`keyword`）。
- `GET /api/stock-in/assist-batch-lines`：外协入库批量添加（仅类型 2）。
- `GET /api/stock-in/production-batch-lines`：生产入库批量添加（仅类型 4；参数 `sourceOrderNo`、`workshopCode`/`supplierCode`、`excludeReceiptNo`、`selectedKeys`、`keyword`）。
- `GET /api/stock-in/assist-return-batch-lines`：外协退料批量添加父层外协成品（类型 3）。
- `GET /api/stock-in/assist-return-bom-parts`：外协退料按成品展开 BOM 配件（参数 `productKcaa01`、`selectedKeys`）。
- `GET /api/stock-in/material-options`：手工物料候选。
- `GET /api/stock-in/print-data`：打印数据。
- `GET /api/stock-in/inventory-summary`：入库库存统计口径。
- `POST /api/stock-in`：新增。
- `PUT /api/stock-in/:id`：编辑。
- `POST /api/stock-in/:id/audit`：审核。
- `POST /api/stock-in/:id/unaudit`：反审核。
- `POST /api/stock-in/:id/review`：财务复核（`sp_flag=1`，须已审核）。
- `POST /api/stock-in/:id/unreview`：反复核（`sp_flag=0`，须已审核且已复核）。
- `POST /api/stock-in/:id/restore`：恢复。
- `DELETE /api/stock-in/:id`：软删除。
- `DELETE /api/stock-in/:id/hard`：彻底删除。

## 数据库口径

- 主表：`UB_ERP_Stocks_Storage`（`sp_flag`：`'1'` 已复核锁定）
- 明细表：`UB_ERP_Stocks_Storage_list`
- 操作日志：`UB_Date_ERP_Operation_log`
- 保存审核：新增入库单保存后固定自动审核，主表和明细表 `pass` 直接写 `1`，并写入主表审核人/审核时间；历史未审核单仍可通过审核按钮处理。
- 物料快照：保存明细时由后端按 `kcaa01` 重新查询 `UB_ERP_Bom_000`，指定快照字段以 BOM 为准；数量、价格、备注、关联订单明细键不被覆盖。本模块当前明确补写 `kcaa07`、`kcaa08`、`kcaa12`~`kcaa14`、`kcaa25`、`kcaa28`~`kcaa35`，并写入明细 `uid`、`uname`、`utruename`、`addtime`。
- 库存统计：只统计已审核且未删除的入库明细 `kcao03`，待审核、已删除、反审核后的单据不计入。

## 第一版边界

- 不做审核不通过。
- 已支持反复核（`sp_flag` 可由 `1` 改回 `0`）。
- 未审核单不能复核。
- 不做真实 Excel 导出，只保留入口。
- 不做超量入库豁免，只保留配置占位。
- 不做上游单据已入库数量反写。
- 不开放类型 `8` 加工入库新增和编辑，旧数据只读展示。

## 权限动作

- `view` / `add` / `edit` / `audit` / `delete` / `review`（复核）/ `unreview`（反复核）/ `price` / `export`
- 角色管理页可勾选「复核、反复核」；接口 `POST .../review` 和 `POST .../unreview` 分别受对应门禁。

## 已知问题 / 下一步

- 列表已去掉「创建人」「锁定」独立列；锁定信息合并进「状态」列与操作区 🚫。
- 关联单据候选和明细字段按旧表常用字段接入；若内网实际字段名与当前环境不同，需要按真实表结构补一版兼容映射。
- 第一版批量添加：采购入库、外协入库、外协退料、**生产入库**已改为独立新窗口 + 专接口；销售退货等类型仍在当前页弹窗，接口 `source-lines`。
- 后续真实导出需要由后端生成 Excel，并继续遵守价格权限。
- 给财务岗位的角色勾选「复核」权限后，重新登录方可点复核按钮。

## 2026-06-23 外协入库批量添加

- 入库类型为外协入库时，「批量添加」打开 `/inventory/daily/stock-in-assist-batch-window`，接口 `GET /api/stock-in/assist-batch-lines`（强制 `inboundType=2`）。
- 按 `UB_ERP_assist_order_list.kcaa01 + wxak02` 聚合；`kcao02` 写入外协明细键 `wxak02`。
- 可入数量 `tempx` = 外协换算数量 − 已审入库 − 未审入库；出库只展示不扣减。
- 可入上限 `kcao031` = `tempx + tempx * stocks_in`；`tempx > 0` 才可选。
- 父层 RMB 单价按主表 `rate` 换算（非 `bom_rate`）。

## 2026-06-22 外协退料批量添加（BOM 展开）

- 入库类型为外协退料时，「批量添加」打开 `/inventory/daily/stock-in-assist-return-batch-window`。
- **两层表**：父层外协成品（操作列「请展开选择」禁用 +「+」展开）；子层 BOM 配件（此处才真正选择）。
- 父层接口 `GET /api/stock-in/assist-return-batch-lines`；展开后 `GET /api/stock-in/assist-return-bom-parts?productKcaa01=`。
- BOM 最多四层展开，同 `kcaa01` 合并用量；第四层用量并入第三层物料，不单独成行。
- 带回 BOM 配件行：`kcao03=0`（用户自填退料数）、`kcao031=100000`（无上限）、`kcao04=sale_price÷bom_rate`；`kcao041/kcao05/kcao051` 先为 0。
- **bom_rate** 仅查 `UB_ERP_Finance_currency.bom_rate`（`del=0, pass=1`），空或无记录默认 1；**禁止**用 `rate` 代替。
- 子层含税展示单价固定 ×1.08（与主表 `in_tax` 无关）；价格列受 `price` 权限控制。
- 已选去重键：`systemcode + '|' + pm`（`pm` = 外协成品 `kcaa01`，仅前端会话去重，不落库）。
- BOM 配件读库：`UB_ERP_Bom_parts` 无 `reference/info/tax/rsrmb` 列；`info` 由 `Describe + d_info + remark` 拼接，`reference` 取 `d_code`，`tax` 固定 `0.08`（与展示含税单价一致）。
- **客供**：`Customer_supply` 保留库内数字（0/1/2）供保存；子层「是否客供」列显示 `customerSupplyLabel`（是/否）。
- 保存已选经 `postMessage` 回传，父页 `accepted` 后子窗关窗；结果暂存 `sessionStorage`。

## 2026-06-22 生产入库批量添加

- 入库类型为生产入库时，「批量添加」打开 `/inventory/daily/stock-in-production-batch-window`，接口 `GET /api/stock-in/production-batch-lines`（强制 `inboundType=4`）。
- **主表校验（2026-06-23）**：列表前先查 `UB_ERP_Dispatch_order`；须 `del=0`、`pass=1`、`closed=0`，且 `scaj05` = 入库单生产车间；选派工单时若已存 `dispatchSystemcode` 则一并校验 `systemcode`，无值则只校验单号+车间；不通过返回 400，子窗口弹错后约 1.5 秒自动关闭。
- 明细来自 `UB_ERP_Dispatch_order_list`（`scak01=派工单号`）；单位换算字段优先明细行，缺失时联 `UB_ERP_Bom_000` 补全 `kcaa26/kcaa27`。
- 关联键：`kcan04=scak01`，入库明细写 `kcao02=scak02`；统计已入/未入按入库明细 `kcao02`；统计返工出库按**出库明细 `kcaq02`**（出库表无 `kcao02` 列）。
- 可入数量 `tempx` = 换算派工量 − 已审入库 − 未审入库；**允许显示负数**（超入提示），选择仍仅 `tempx>0`；**返工出库只展示，不参与 tempx**。
- 可入上限 `kcao031` = `max(0, tempx + tempx * stocks_in)`；保存时按 `kcao031` 卡上限。
- `tax/info/reference`：说明取派工 `info`→`d_info`、BOM `d_info`；PI 取派工 `pi`（两表均无 `Describe`/`reference` 列）；带回仍写 `tax=0`。
- 带回：`kcao03` 默认 `tempx`（须 `tempx>0` 才可选）；`kcaa01~35` 循环写入；`kcao04/kcao041/kcao05/kcao051/tax` 全 0。
- 批量窗口列：操作、材料编码、名称、规格、颜色、单位、可入库数量（红/负值深红）、RMB单价/金额（0）、派工数量、未审入库、未审出库、实际已入、返工数量。
