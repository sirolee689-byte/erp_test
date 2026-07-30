# 入库单

## 2026-07-28 生产车间候选

- 生产入库、生产退料的「生产车间」下拉只显示车间主档中编码为 `01`、`02`、`03`、`04`、`06`、`07`、`0901`、`0902`、`c` 的记录；名称以车间主档为准。

## 页面入口

- 菜单路径：`inventory/daily/stock-in`
- 页面文件：`src/views/inventory/daily/stock-in/index.vue`
- 后端接口前缀：`/api/stock-in`

## 已完成功能

- **筛选区（两行左对齐）**：第一行供应商/外协商（点击可直接下拉，输入后继续联想）+ 入库类型；第二行关键词 + 查询 + 开关组「回收站 | 显示未审核 | 显示未复核」+ 重置。
- **列表分页**：默认 10 条/页，可选 `10 / 20 / 50 / 100`。**主列表双分页**（2026-07）：表格上下各一条分页，类名 `pagination-row--top/bottom`，左对齐，对齐 BOM 资料。
- **展开明细**：主列表**点行展开**（左边展开箭头列已全局隐藏）；无顶部汇总条；明细表底「小计」行汇总数量与金额（价格列受 `price` 权限控制）。**列表加载后**后台批量预取当前页展开明细（`GET /api/stock-in/expand-lines/batch`），点击展开优先读缓存秒开；预取失败时仍回退单条 `GET /api/stock-in/:id`。
- **展开明细-关联单号相关信息**：按入库类型分流计算并显示两行（`关联总数` + `差数/多出数`）；有退货时追加「曾发生退货数」；查不到关联明细或无关联类型（其他入库/盘盈）显示灰字「无相关数据」。
  - 采购入库（类型 1）关联订单数量字段：`UB_ERP_Buy_order_list.kcak03`（旧库字段 `cgae03` 在当前环境不存在）。
- **列表展示**：主列表 12 列（操作、状态、入库类型、入库单号、关联单号、入库日期、入库单数据、仓库名称、供应商/外协商、经手人、纸质单号、备注）；操作与入库单号左固定；底栏横向滚动。
- **操作列宽度**：按当前页单据状态和当前账号权限，纯数据计算当前会显示的操作按钮宽度；不观察 DOM、不触发列表重渲染。打印选择受 `print` 权限控制；已审核行的操作顺序为“查看、反审、打印选择”。
- **状态列**：固定显示「已审核/未审核」+「已复核/未复核」；已结案、加工只读作补充标签。
- **显示未复核**：`showUnreviewed=1` 筛 `sp_flag <> '1'`；已审核且未复核行显示「复核」按钮（须 `review` 权限）；回收站开启时该开关隐藏。
- **入库单数据列**：两行汇总（项数/数量/入库量；含税·不含税·税点总价，需 `price` 权限）。
- **转向物料查询（2026-07-02）**：顶栏「入库单添加」右侧新增「转向物料查询」；点击后在当前页面切换到 `pageMode=material-trace`，按入库明细物料维度查询已审核、未删除入库明细，不打开新窗口。面板提供查询条件、立即查询、查询全部和分页，表格使用底部横向滚动条；价格列仍受入库单 `price` 权限控制。
- **入库日期**：列表只显示年-月-日。
- 只读查看（2026-07）：列表点「查看」进入与编辑相同的两页签全屏表单（基础资料 / 明细），全程只读；顶栏仅「返回列表」，无保存/重置/批量添加/删行；复制入库单号仍可用；价格列仍受 `price` 权限控制。**2026-07-21 性能**：查看只请求 `GET /api/stock-in/:id` 一次即切页，仓库/关联方用头表字段本地 seed，不再拉下拉候选与派工补全接口。
- 新增/编辑：当前开放其他入库、采购入库、外协入库、生产入库、生产退料、盘盈入库；外协退料、销售退货旧系统基本不使用，第一版只保留历史查看和列表筛选，不再提供新增/切换入口。
- 新增/编辑 UI：已拆分为两页签「入库单基础资料 / 入库单明细」；基础资料按 8 行展示（入库单号、日期、入库类型按钮、单号、关联方、第六行为「仓库+输入框」与「来货单号/纸质单号+输入框」同一行并排、含税与否、备注）；第六行沿用系统标准「仓库」标签列对齐，右侧追加「来货单号/纸质单号+输入框」；入库单号只读但可选中/按钮复制，关联单号只读展示，右侧固定「选择 / 清空」按钮，选中后在下方固定显示“已选单号”并可复制。
- 新增页体验：进入新增/重置新增表单时，前端优先自动选择名称或编码为「货仓」的仓库；新增单切到生产入库时，改为按候选接口带出「包装部」和「成品仓」，找不到则保持空值，不硬写编码。表单顶部原「返回列表」按钮改为「重置」，新增模式下清空基础资料和明细并重新带出建议单号/默认仓库，编辑模式下重新读取当前单据。
- 统一输入框宽度：以「入库日期」输入宽度为基准，入库单号、关联单号、关联单位、仓库、纸质单号统一走 `stock-unified-input`；在 `stock-form--base` 里调 `--stock-base-input-width` 可整体生效。
- **基础资料输入高度**（2026-07-23）：单行输入对齐出库单，DIY `--stock-base-input-height`（默认 `--el-component-size`）；备注 DIY `--stock-remark-input-height`；**不改**入库类型按钮、是否含税。
- 入库类型按钮：采用分离按钮样式并增加间距，按钮尺寸统一由 `stock-form--base` 下的 CSS 变量控制（高度、间距、字号、圆角）；当前默认高度 `42px`、字号 `16px`。表单按钮不展示外协退料、销售退货、加工入库；主列表入库类型筛选仍保留历史类型，并把外协退料、销售退货放在选项末尾。
- **仓库默认（2026-06-22）**：新建入库单默认「货仓」；仅**生产入库（类型 4）**切换/选中时默认「成品仓」；从生产入库切到其他类型时会自动改回「货仓」，避免残留成品仓。**2026-07 参管过滤**：默认仓仅当当前账号在该仓 `ename` 参管名单内才会带出；不在名单则保持空，不强行写入。
- **仓库候选按参管过滤（2026-07）**：下拉走 `GET /api/stock-in/warehouse-options`，只列出当前账号参管的仓；伪造保存非参管仓会被后端拒绝（提示「您不是该仓库的参管人员，无法选用」）。
- 第四/五行联动：选择采购单号/外协单号/销售单号后，第五行关联方自动带出（供应商/外协客户/客户）；**生产入库/生产退料**第五行「生产车间」为必选下拉（数据来自 `UB_ERP_Stocks_workshop`），须先选车间再点第四行「派工单号 → 选择」；其他入库/盘盈保留手工填写关联单位。
- **生产入库/生产退料选派工单（2026-06-22 对齐旧系统 s_search4，2026-06-30 扩展类型 5，2026-07-01 补齐生产入库口径，2026-07-01 优化生产入库搜索体验，2026-06-22 搜索性能 A+B，2026-07-15 生产退料空搜索）**：类型 4/5 点「选择」打开派工单明细级弹窗；生产入库标题为「派工单列表（已选：车间名）」。接口 `GET /api/stock-in/production-dispatch-pick-page`；前端先确认当前车间来自有效候选，否则提示「生产车间选择错误,请重新选择!」，后端再校验车间在 `UB_ERP_Stocks_workshop` 存在且 `del=0/pass=1`，无效返回「此生产车间错误,请重新选择!」。列表为派工主表 + 明细行（`scak02=GUID`），只显示已审核、未删除、未结案且属于当前车间的派工单；类型 4 仍按余量 `scak03-scak04+scak05>0` 过滤，类型 5 作为生产退料来源不按入库余量过滤，并额外显示「已退料数量」；**生产入库/生产退料打开弹窗默认不加载任何派工单**，须输入派工单号或 PI号后查询，后端空关键字直接返回空列表；生产入库搜索字段仅 `scaj01/scaj04`，类型 5 仍沿用既有派工头表搜索口径；**有搜索时后端先按关键字筛派工头表再 JOIN 有余量明细，列表一次 SQL 用窗口函数带出分页总数（不再单独 COUNT）；生产入库不汇总已退料行**（包装部搜 `1111` 实测接口由约 1.3s 降至约 0.5s）；**分页按派工单张数**（默认 10 张/页，可选 20/50/100），按主表 `addtime` 录入时间新→旧排序后取当前页派工单并展开其全部有效明细行；分页总数为符合条件的派工单张数（非明细行数）；**同一派工单号多行时，仅该单在本页的第一行显示「关联选择」与派工单号**（后续行这两列留空，PI/货品/数量仍每行显示）；点「关联选择」写回派工单号、PI、车间名称，并清空全部明细；`dispatchSystemcode` 存派工主表 `systemcode` 供批量添加上下文（不入库单主表 systemcode）。
- 关联单据选择窗口（非生产类型）：除其他入库/盘盈外，第四行通过「选择」打开来源单据窗口；生产入库/生产退料走派工单明细选择窗口，未选车间时前端拦截；`source-order-page` 默认 10 条/页；生产类型「清空」只清派工单与 PI，不清车间；换车间时若已有派工单/PI/明细，弹窗确认后一并清空。**采购入库/外协入库（2026-07-15）**：打开「选择」弹窗默认不加载任何数据，须用户输入关键字（外协也可只选外协商）后点查询才请求接口；后端 `source-order-page` 对类型 1 无关键字、类型 2 无关键字且无外协商直接返回空列表。**采购入库（2026-07-01）**：选择窗口只显示 `UB_ERP_Buy_order` 已审核、未删除、未结案采购单，列为「操作、状态、采购单号、PI号、供应商、采购日期、交货日期、采购员」；关键字可搜采购单号、PI号、供应商编码和供应商资料名称；选择后回填采购单号、供应商编码/名称，暂存采购主表 `systemcode`，并在采购单号变化时清空已有明细，避免不同采购单明细混用。**采购入库（2026-06-22 修复）**：列表 SQL 曾出现 `AS referenceNo` 重复拼接导致「Incorrect syntax near 'AS'」，已改为仅外层一次别名。
- 备注输入框：基础资料页“备注”输入框默认占该行内容区约 `50%`，小屏自动切到 `100%`。
- 明细录入：无来源类型可手工选料；有关联单据类型可从关联单据批量带入明细；入库单明细不再显示「增加明细」按钮。
- **批量添加搜索（2026-07-21）**：所有入库类型的「批量添加」窗口，查询条件**仅支持材料编码 `kcaa01` 模糊匹配**（前端占位「材料编码」；后端/本地筛选不再按名称、规格、颜色、唯一码等字段命中）。空关键字行为保持各类型原样（如其他入库须输入后才查）。
- **其他入库批量添加（2026-07-01）**：类型 `0` 点击「批量添加」改为打开独立新窗口 `/inventory/daily/stock-in-other-batch-window`，界面交互对齐其他出库批量选材；**首屏默认不加载任何数据**，必须输入材料编码关键字后点“立即查询”才请求接口并展示结果。列表列与配色对齐其他出库：操作、产地、材料编码、**账存数量（红）**、**物料出库未审总数（紫）**、**实际库存数量（蓝，≤0 红）**、名称中/英/开票名、规格、单位、分类；库存三列按当前仓库 + `kcaa01` 汇总（账存=已审入−已审出，实际=账存−未审出）。接口 `GET /api/stock-in/other-batch-lines`（参数 `warehouseCode`、`keyword` 仅 `kcaa01`、`requireKeyword`、`page/pageSize`）；保存时复用 `POST /api/stock-in/surplus-batch-prices` 取最近复核入库价。其他入库不按库存正数限制可选。选择后通过 `postMessage` 回传父页，父页按物料去重后写入明细。
- 明细删除：明细表最左侧为按钮式选择列，每行显示「删除」，点击后变为「已选择」；「删除选定明细」只移除这些已标记行，交互参考采购订单/外协订单明细。
- **明细工具栏**（2026-07-23）：按钮顺序「删除选定明细」→「删除全部明细」→「批量添加」；高度/字号 DIY：`--stock-in-line-toolbar-btn-height` / `--stock-in-line-toolbar-btn-font-size`（默认 36px / 16px）。
- **表单头标题与保存/重置**（2026-07-23）：左上「新增/编辑/查看入库单」字号 `--stock-in-form-head-title-font-size`；右上按钮高度/字号 `--stock-in-form-head-btn-height` / `--stock-in-form-head-btn-font-size`（默认 18px / 36px / 16px）。
- **采购入库批量添加（2026-06-22）**：类型为采购入库时，「批量添加」打开独立新窗口（`/inventory/daily/stock-in-purchase-batch-window`），接口 `GET /api/stock-in/purchase-batch-lines`；按已选采购单 `kcak01` 分页列出 `UB_ERP_Buy_order_list` 明细，数量池按 `kcak02`（BOM `systemcode`）共享；需入数量 `tempx`（红）= 换算采购量 −（已审+未审入库 − 已审+未审退货）；可超量 `kcao031`（蓝）= `max(0, 换算量×(1+物料分类浮动率) − 净占用)`，浮动率来自 `New_UB_ERP_Stocks_material.stocks_in`；编辑入库单时汇总排除当前单 `kcan01`；有未审退货不可选；`is_admin=1` 超级管理员可在已满行强制选；带回默认入库数量=需入数量，单价按主表汇率换算 RMB；保存时 `kcao03` 不得超过 `kcao031`（有浮动率时）或需入数量；「保存已选数据」经 `postMessage` 回传（选中行须深拷贝为纯 JSON，避免 Vue 代理导致 `postMessage` 克隆失败），主页面写入明细后回 `accepted`，子窗口再提示成功并自动关窗；结果暂存用 sessionStorage；打开子窗时缓存 `window.open` 引用作回执兜底；回传时仍校验采购单号和供应商；读库时所有参与比较、展示、排序的旧库字段都先安全转文本/数字（包含 `del/pass/seq/code/stocks_in/rmb_hl/rate` 等），避免旧库 nvarchar/数字混用导致 `Error converting data type nvarchar to numeric`。本期不做：`UB_ERP_Buy_order_stocks_max` 超订量、供应商 PQD(7001) 豁免（留超量入库配置下期）。
- **外协退料批量添加（2026-06-22）**：类型为外协退料时，「批量添加」打开 `/inventory/daily/stock-in-assist-return-batch-window`；父层外协成品 + 展开 BOM 配件两层表；接口 `assist-return-batch-lines` / `assist-return-bom-parts`；带回 `kcao03=0`、`kcao031=100000`；配件单价用 `Finance_currency.bom_rate`（非 `rate`）；详见下文专节。
- **生产入库/生产退料批量添加（2026-06-22，2026-06-23 补强，2026-06-30 扩展类型 5，2026-07-01 退料对齐生产领料）**：类型为生产入库或生产退料时，「批量添加」打开 `/inventory/daily/stock-in-production-batch-window`；接口 `GET /api/stock-in/production-batch-lines`。类型 4 生产入库仍按派工明细本身计算可入库数量；类型 5 生产退料改为按生产领料来源退料：非开料部由派工明细经 `UB_ERP_Bom_pi_cost` 按 PI 展开实际领料子料，同子料 `kcaa01` 合并显示；开料部（车间 `04`）复用出库生产领料的开料部 PI 裁片来源和 `cutting_issue` 分类配置，再按退料口径重新计算已领/已退/可退。生产退料必须已有生产车间、仓库、派工单号、PI号、`dispatchSystemcode`；可退数量 = 当前派工单+当前仓库+子料的生产领料出库数量（已审+未审） - 当前派工单+子料的生产退料数量（已审+未审，编辑时排除当前单）；未领过或已退完的子料不可选。生产退料带回 `kcao02=首个派工明细 scak02`（开料部为 `CUT|材料编码`）、`reference=PI号`、`Describe/info=对应派工货品名称`，单价/金额/税点保持 0。
- **盘盈入库批量添加（2026-07-01）**：类型为盘盈入库时，「批量添加」打开 `/inventory/daily/stock-in-surplus-batch-window`；接口 `GET /api/stock-in/surplus-batch-lines` 从 `UB_ERP_Bom_000` 物料主档分页选材，只过滤未删除物料，不按当前库存是否大于 0 限制；`keyword` 仅按材料编码 `kcaa01` 模糊。选中后 `POST /api/stock-in/surplus-batch-prices` 按当前仓库取最近一条已审核且已复核的入库明细价；无价格则单价/税点为 0。带回默认 `kcao03=1`、`kcao031=1`，用户在明细里改为实际盘盈数量；盘盈不是关联单据类型，保存不要求 `kcao02` 来源明细键，也不做可入库上限限制。
- 金额联动：按不含税单价、税点、数量计算含税单价和两套金额；不含税模式下税点强制为 0。
- 明细数量限制：关联单据类型（采购、外协、生产、销售退货等）实时按行上的 `kcao031 / availableQty / tempx / needQty` 计算可入库上限，入库数量超过上限时立即提示并回退；其他入库、盘盈入库不限制上限。保存接口仍会做同样校验，防止绕过前端。
- 税点限制：不含税模式下税点大于 0 会提示并清零；编辑入库单时税点不能为空，如无税点必须填 0。
- 批量添加限制：采购批量添加窗口中，可入库上限为 0 或存在未审采购退货的行不可选；超级管理员本期也不能绕过上限，后续统一由“超量入库配置”功能处理。非采购的当前页批量添加同样会禁用可入库上限为 0 的来源行。
- 保存校验：`kcan08` 除 **外协退料（类型 3）** 外均必填；页面上显示为来货单号 / PI号 / PO号 / 纸质单号时，未填则前端切回基础资料页并聚焦该输入框，后端同步兜底拒绝保存。外协退料来货单号允许留空。生产入库/生产退料必须选择生产车间和派工单，生产退料第一版只从派工单带出明细。
- 详情/展开明细税点：物理列 `UB_ERP_Stocks_Storage_list.Tax` 经详情接口统一映射为 `tax`，列表展开与编辑页均用小写 `tax` 展示。
- 明细客供 `Customer_supply`：物理列为整型（`1=是`，`0/2=否`）；外协退料批量添加接口返回数字字段 `Customer_supply` + 展示字段 `customerSupplyLabel`；保存时 `normalizeCustomerSupplyInt` 兼容历史界面「是/否」。
- 审核/反审核：审核后进入库存统计口径，反审核后退出库存统计口径；主表 `pass` 变化时，明细表 `UB_ERP_Stocks_Storage_list.pass` 同步变化。
- 财务复核：已审核单可复核，`sp_flag=1` 后只读锁定；主表 `sp_flag` 变化时，明细表 `UB_ERP_Stocks_Storage_list.sp_flag` 同步变化。
- 删除/恢复/彻底删除：已审核单不能直接删除，必须先反审核；彻底删除只允许 `New_UB_ERP_User.is_admin=1` 的超级管理员（操作时按当前登录用户主键实时查库，不依赖旧登录令牌是否缓存该字段）。
- 打印：**列表批量打印**（2026-07-01，2026-07-29 模板对齐出库单）：行内「打印选择/已选择」按入库单号 `kcan01` 记录；筛选区显示「已选择：N条记录进行打印」、打印类型（汇总/明细）与「打印入库单」按钮；未选提示「请选择需要打印的单据。」；新标签打开 `/inventory/daily/stock-in-print?p_sum=...&print_cn=...`；接口 `GET /api/stock-in/print-data` 批量模式按 `kcan01` 查主表 `UB_ERP_Stocks_Storage` 与明细 `UB_ERP_Stocks_Storage_list`（不按 pass 限制）；明细列：序号、厂款号/PI号、电脑编码、材料名称、规格、颜色、单位、数量、备注；汇总模式按物料字段分组合计数量；LOGO 来自系统打印设定；支持 2–10 行/页换行；未审单显示【未审】；不含单价/金额列。数量/合计：居中显示，最多三位小数并去尾 0（如 `80`、`54.54`）。合计行：颜色列写「合计」，单位+数量合并显示合计数量，颜色前各列保持空格；列宽 DIY 在 `print.vue` 的 `.col-seq/.col-ref/.col-code/.col-unit/.col-qty`。纸型固定为 `215mm × 139mm`，只在相邻打印块之间分页，最后一张后不追加空白页；页码文案统一为 `x/y页`；签名区为「制表人、仓库、收发人、进账人」，同一张入库单分成多页时每页都显示，合计仍只在最后一页显示。
- 标签打印（2026-07-02）：列表勾选入库单后点击「打印标签」，打开 `/inventory/daily/stock-in-label-print?p_sumbq=...`；接口 `GET /api/stock-in/label-print-data` 只允许主表 `del=0/pass=1` 的入库单，空参数返回 `Error,Code:208`，单据不存在返回「数据不存在，请返回检查！」；按明细 `kcao01=kcan01`、未删除、`seq/id` 顺序生成标签，一条明细一张标签；标签显示物料编码、英文名或入库单号+中文名、颜色名称/颜色编码、数量和入库时间，二维码内容沿用旧系统 `view.asp?action=stocks&kcaa01=材料编码&kcao01=入库单号`。
- 待开发占位：导出信息、超量入库配置。

## 后端接口

- `GET /api/stock-in/list`：列表分页，SQL 使用 `ROW_NUMBER()`，兼容 SQL Server 2008 R2。
- `GET /api/stock-in/material-trace/list`：转向物料查询；从 `UB_ERP_Stocks_Storage_list` 查询已审核未删除入库明细，并按 `kcao01=kcan01` 回查 `UB_ERP_Stocks_Storage` 的日期、仓库、供应商/外协商等信息；关键字第一版只搜高频字段，不全量 OR `kcaa01~kcaa35`。
- `GET /api/stock-in/:id`：详情（头表 + 明细原始字段；**不做**逐行关联数量 enrich，查看/编辑秒开）。
- `GET /api/stock-in/expand-lines/batch`：列表展开明细；含 `relationOrderQty/relationInboundQty/relationReturnedQty/relationDiffQty/relationOverflowQty/relationNoData`，用于主列表「关联单号相关信息」列。
- `GET /api/stock-in/suggest-doc-no`：建议入库单号；最终单号仍以后端保存结果为准。
- `GET /api/stock-in/warehouse-options`：仓库候选；**仅返回当前登录 `userCode` 落在仓库编码 `ename`（参管人员分号串）中的未删仓**；空 `ename` 对任何人都不可见；保存时 `resolveWarehouse` 再校验一遍。
- `GET /api/stock-in/list-related-party-options`：列表筛选供应商联想（`UB_ERP_System_supplier`，仅查 `del=0 AND pass=1`，关键字可空）。
- `GET /api/stock-in/related-party-options`：表单关联方候选（按入库类型）。
- `GET /api/stock-in/source-options`：关联单据候选。
- `GET /api/stock-in/source-options`：关联单据候选（返回 `sourceOrderNo + relatedPartyCode + relatedPartyName`，派工单候选额外返回 `referenceNo` 用于自动带出 PI号、`sourceSystemcode` 用于编辑旧单时恢复批量添加所需的 `dispatchSystemcode`）。
- `GET /api/stock-in/source-order-page`：关联单据选择窗口（默认 10 条/页）；采购入库按 `UB_ERP_Buy_order.kcaj01/kcaj04/kcaj05/kcaj02/systemcode` 返回采购单号、PI号、供应商、采购日期和前端暂存来源键，只显示 `del=0/pass=1/closed=0`；**采购入库无关键字直接返回空列表**；**外协入库无关键字且未选外协商直接返回空列表**（已选外协商可按外协商查询）；生产退料须传 `relatedPartyCode` 并按 `scaj05` 过滤。
- `GET /api/stock-in/production-dispatch-pick-page`：**生产入库/生产退料**派工单明细选择（分页单位=派工单张数，默认 10 张/页；按 `addtime` 新→旧；参数 `workshopCode`、`inboundType`、`keyword`、`page`、`pageSize`；**类型 4/5 `keyword` 为空时返回空列表**；车间无效返回 400）。
- `GET /api/stock-in/source-lines`：关联单据明细（非采购入库批量添加仍用此接口）。
- `GET /api/stock-in/purchase-batch-lines`：采购入库批量添加新窗口分页数据（`page/pageSize`，默认 20；参数 `sourceOrderNo`、`supplierCode`、`excludeReceiptNo`、`selectedKeys`、`keyword` 仅材料编码 `kcaa01` 模糊）。
- `GET /api/stock-in/assist-batch-lines`：外协入库批量添加（仅类型 2；`keyword` 仅 `kcaa01`）。
- `GET /api/stock-in/production-batch-lines`：生产入库/生产退料批量添加（类型 4/5；参数 `inboundType`、`sourceOrderNo`、`workshopCode`/`supplierCode`、`warehouseCode`、`piNo`、`dispatchSystemcode`（类型 5 必填）、`excludeReceiptNo`、`selectedKeys`、`keyword` 仅 `kcaa01`；类型 5 支持 `fetchAll=1` 一次返回全部合并子料）。
- `GET /api/stock-in/assist-return-batch-lines`：外协退料批量添加父层外协成品（类型 3；`keyword` 仅成品 `kcaa01`）。
- `GET /api/stock-in/assist-return-bom-parts`：外协退料按成品展开 BOM 配件（参数 `productKcaa01`、`selectedKeys`）。
- `GET /api/stock-in/surplus-batch-lines`：盘盈入库批量选材（类型 7；参数 `keyword` 仅 `kcaa01`、`selectedKeys`、`page/pageSize`）。
- `POST /api/stock-in/surplus-batch-prices`：盘盈入库批量选材最近复核入库价（参数 `warehouseCode`、`materialCodes`）。
- `GET /api/stock-in/other-batch-lines`：其他入库批量选材（类型 0；参数 `warehouseCode`、`keyword` 仅 `kcaa01`、`requireKeyword`、`selectedKeys`、`page/pageSize`；首屏 `requireKeyword=1` 且关键字为空时返回空列表）。
- `GET /api/stock-in/material-options`：手工物料候选；支持 `page/pageSize` 分页；传 `requireKeyword=1` 时关键字为空直接返回空列表。
- `GET /api/stock-in/print-data`：打印数据；单张兼容 `id`；批量打印用 `p_sum`（逗号分隔 `kcan01`）+ `print_cn`（`1` 明细 / `2` 汇总）；返回 `list`、`printMode`、`printConfig.logoSrc`。
- `GET /api/stock-in/label-print-data`：标签打印数据；参数 `p_sumbq`（逗号分隔 `kcan01`）；仅返回已审核、未删除入库单的明细标签数据。
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
- 保存审核：有有效明细的新增与待审核编辑保存后自动审核，主表和明细表 `pass` 直接写 `1`，并写入主表审核人/审核时间；空明细允许保存为待审核草稿，但审核接口会拒绝空明细。已审核单仍须反审后才能编辑；历史未审核单仍可通过审核按钮处理。审核/反审核会同步明细 `pass`，复核/反复核会同步明细 `sp_flag`。
- 转向物料查询：只读查询 `UB_ERP_Stocks_Storage_list l` + `UB_ERP_Stocks_Storage h`，JOIN 条件为 `l.kcao01=h.kcan01`；主从表均要求未删除且已审核（`del=0/pass=1`）；分页用 `ROW_NUMBER()` 兼容 SQL Server 2008 R2。第一版为性能优先，关键字只匹配入库单号、关联单号、物料编码、名称、规格、颜色、PO/PI、备注、供应商/外协商、仓库等高频字段。
- 物料快照：保存明细时由后端按 `kcaa01` 重新查询 `UB_ERP_Bom_000`，指定快照字段以 BOM 为准；数量、价格、备注、关联订单明细键不被覆盖。本模块当前明确补写 `kcaa07`、`kcaa08`、`kcaa12`~`kcaa14`、`kcaa25`、`kcaa28`~`kcaa35`，并写入明细 `uid`、`uname`、`utruename`、`addtime`。
- 库存统计：只统计已审核且未删除的入库明细 `kcao03`，待审核、已删除、反审核后的单据不计入。

## ERP 内核数据关联

- ERP 内核 `/system/kernel/data-relations` 可通过“入库单”按钮查看本模块当前代码的数据流。
- 新增/编辑保存会校验仓库、关联方和来源单据，并写入 `UB_ERP_Stocks_Storage`、整批重写 `UB_ERP_Stocks_Storage_list`；有有效明细时自动审核，空明细保存为待审核草稿。
- 保存按入库类型读取采购单、外协单、派工单或销售单头表做状态和关联方校验，但不反写这些上游来源表；来源单号写主表 `kcan04`，来源明细键写明细 `kcao02`。
- 审核/反审核同步主从表 `pass`，决定该单是否进入库存统计；审核前再次校验至少一条有效明细。
- 复核/反复核同步主从表 `sp_flag`；复核只锁定单据，不改变审核状态和库存数量。
- 数据关联页不展示删除、恢复、彻底删除、打印和纯查询动作。

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

## 2026-06-22 生产退料批量添加

- 入库类型为生产退料时，共用 `/inventory/daily/stock-in-production-batch-window`，接口强制 `inboundType=5`；窗口一次拉取全部可退子料，本地仅按退料材料编码筛选，点击「刷新数据」重新拉取已领/已退数量。
- 打开前须：入库类型、是否含税、生产车间、派工单号、**`dispatchSystemcode`（选派工单后写入）**。
- 主表按车间 + `dispatchSystemcode` 查 `UB_ERP_Dispatch_order`（`del=0/pass=1/closed=0`），并与派工单号交叉校验；无效 →「数据不存在,请联系IT部检查!」；无明细 →「此订单无清单数据,请检查订单数据!」；缺 systemcode →「参数错误！」。
- 可退料数量 `tempx` = 换算派工量 − 已审退料入库(`kcan03=5`) − 未审退料入库；返工出库（已审 `kcaq03`）仅展示在「返工数量」列，不扣减 tempx。
- 批量窗口列名：可退料数量、未审退料情况、实际已退数量（其余与生产入库批量添加一致）。

## 当前准则：采购入库选择窗口

- 采购入库点击基础资料【选择】时，`GET /api/stock-in/source-order-page?inboundType=1` 显示的是“采购订单 + 采购订单明细”的汇总列表，不是单纯采购主表列表。
- **打开弹窗默认不加载任何数据**（2026-07-15）：须输入关键字后点「查询」才请求接口；后端无关键字直接返回空列表。
- 数据来源为 `UB_ERP_Buy_order`、`UB_ERP_Buy_order_list`、`UB_ERP_Finance_currency`，只取采购主表 `del=0/pass=1/closed=0` 且采购明细 `del=0` 的数据。
- 列表按采购单号、采购明细来源键、物料和单位换算字段汇总，展示操作、采购单号、材料编码、材料名称、规格、采购数量、单价、单价(含税)、金额、金额(含税)、入库单未审数、已入库数量、退货数量、差数、是否存在转换数据。
- 价格列仍受入库单 `price` 权限控制；无价格权限不显示单价、金额相关列。**单价 / 单价(含税) / 金额 / 金额(含税)** 展示统一最多 4 位小数并去尾 0（`formatErpPriceDisplay`，仅展示不改落库）。
- 同一采购单只在第一行显示“关联选择”。点击后回填采购单号、供应商编码、供应商名称和前端隐藏来源键，并清空当前入库明细，避免不同采购单明细混用。
- 关键字匹配采购单号、PI号、采购字段 `kcaj03/kcaj04/kcaj05/kcaj06/kcaj08`、币别和材料基础字段；包含 `/N` 的关键字第一版仍按采购主表 `kcaj04` 文本匹配。
## 当前准则：采购入库选择窗口性能

- 采购入库基础资料【选择】走 `GET /api/stock-in/source-order-page?inboundType=1`，窗口显示采购订单 + 采购明细汇总行。
- 第一版性能优化不新增数据库索引：接口先按采购订单/明细取当前请求页，再只按这些行的采购单号、采购明细键、材料编码补算未审入库、已入库、退货数量，避免打开第一页就全量汇总 `UB_ERP_Stocks_Storage_list` 和 `UB_ERP_Stocks_out_list`。
- 前端采购选择窗口默认一次预取 3 页；第 2、3 页从本地缓存切换，不重新请求；第 4 页及以后点击时再继续向后加载。
- 采购选择搜索按关键字形态分流：`ZY-260904` 这类优先搜采购单号 `kcaj01`，`OA-10431` 这类优先搜材料编码 `kcaa01`，普通关键字再走采购单号、PI、供应商、币别、材料名称/规格等多字段模糊搜索。
- 当前分页总数不是首屏精确总数，而是“已加载数量 + 是否还有下一页”的体验口径，目的是优先让列表先显示出来。
# 当前准则：外协入库基础资料选择窗口

- 入库类型为外协入库（`inboundType=2`）时，基础资料【选择】打开“外协订单 + 外协明细汇总”窗口，不再使用通用外协主表列表。
- 接口仍为 `GET /api/stock-in/source-order-page?inboundType=2`；默认只显示已审核、未删除、未结案、明细未删除的外协订单。传 `includeUnaudited=1` 时显示未审外协单，但前端第一列显示“未审”且不可选择。
- **打开弹窗默认不加载任何数据**（2026-07-15）：须选择外协商或输入关键字后点「查询」才请求接口；后端无关键字且未选外协商直接返回空列表；仅选外协商（含表单已预填外协商）点查询可按外协商出单。
- 窗口顶部支持外协商筛选，候选来自 `UB_ERP_System_supplier`，只取 `del=0/pass=1` 且 `s_lb` 为“外协”或“共用”的供应商；基础资料已选外协商时，打开窗口自动带入。
- 列表按外协单号、外协明细键、物料和单位换算字段分组，显示外协日期、供应商、关联单号、是否含税、备注、材料、外协数量、已审核入库数量、外协出库数量和单位换算提示；供应商列只显示 `UB_ERP_assist_order.kehu`，外协日期按 `yyyy-mm-dd` 显示；基础资料选择页不显示单价/金额列。
- 外协入库选择页按采购选择页的性能口径处理：不为首屏强制精确统计总数，默认一次预取 3 页；第 2、3 页从本地缓存切换，第 4 页及以后继续请求后续数据。
- 外协单号形态关键字（如 `wx26042102`）优先按 `wxaj01` 精确/前缀匹配；普通关键字仍按外协单号、外协日期、外协相关字段和币别做模糊匹配。
- 点击【关联选择】后回填外协单号、外协商编码/名称和外协主表 `systemcode`，如果外协单号变化则清空当前明细，避免不同外协订单混用。

## 2026-07-02 入库标签二维码扫码页

- 标签打印页的二维码改为标准二维码，扫码内容使用 `/view.asp?action=stocks&kcaa01=材料编码&kcao01=入库单号`，新系统用 `/view.asp` 兼容旧系统入口，并打开同一张只读扫码页。
- 扫码页路由为 `/stock-in/material-qr-info`，不进入 ERP 主框架、不要求登录，只能读取 `GET /api/stock-in/material-qr-info` 这一项只读数据；新增、编辑、删除、审核等接口仍按原权限走。
- 扫码页展示入库单号、关联单号、入库数量、PI号、中文/英文名称、规格、颜色、单位、分类、组别、产地、备注、货仓/板房库存、最近采购记录、最近入库记录；底部开发人显示“廖越锋”。
- 库存口径：按当前库存计算方式，统计已审核且未删除的入库明细数量减已审核且未删除的出库明细数量；第一版按仓库名称或编码中包含“货仓”“板房”来归类。
- 涉及表：`UB_ERP_Stocks_Storage`、`UB_ERP_Stocks_Storage_list`、`UB_ERP_Bom_000`、`UB_ERP_Stocks_colorcode`、`New_UB_ERP_Stocks_material`、`UB_ERP_Buy_order`、`UB_ERP_Buy_order_list`、`UB_ERP_Stocks_out`、`UB_ERP_Stocks_out_list`。
