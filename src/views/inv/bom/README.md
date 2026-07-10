# BOM 主档（UB_ERP_Bom_000）模块说明

## 页面路径

- `存货管理 → BOM资料查询`：`/inv/bom`
- `库存管理 → 基本资料 → BOM资料`：`/inventory/basic/bom-data`（内嵌本组件）

## 多标签切换（keep-alive）

- **全局**：`ErpLayout` 为每个已打开标签按 `route.name` 自动包缓存壳（`resolveRouteAliveComponent`），所有菜单页切回时默认保持离开前状态，无需各页单独配置。
- 切换到其它顶部标签再切回时：**列表、分页、筛选条件、已打开的详情/编辑弹窗**均保持离开前状态，不会自动重新请求 `/api/inv/bom/list`。
- **关闭 BOM 标签后**再从菜单打开：会重新挂载并加载列表（与首次进入一致）。
- 需要最新数据时：点工具栏「查询」，或标签右键 **刷新**。

## 物理表与键

- 主表：`UB_ERP_Bom_000`（可用环境变量 `INV_BOM_MASTER_TABLE` 覆盖）
- **稳定键**：`systemcode`（配件 `UB_ERP_Bom_parts.kcac01` 等关联此字段）
- **业务编码**：`kcaa01`（列表 `code`）；状态：`pass`（审核）、`del`（逻辑删除）

## 详情弹窗标签页

- **基础资料 / 配件明细**：既有功能。
- **BOM用量表运算**：「运算」/「刷新」请求 **`GET /api/bom/tree?systemcode=`**，返回 **嵌套 `children` 的树**；单层 SQL **只按 `kcac01` 匹配**（不按 `del` 过滤，与配件 GET 一致，避免旧库 `del` 空值导致子层 0 行）；**`kcac01`/`kcac02` 用 500 长 nvarchar 比较**防截断。前端 **`el-table` 树形表** + 展开/关闭全部。该表已移除「备用损耗(kcaa33)」列，改为「合计(kcac06)」列，公式为 **`用量(kcac04) × (1 + 损耗(kcac05))`**；其中「用量/合计」统一按 **6 位小数去尾 0** 展示（仅改显示，不改后端计算与落库精度）。
- **成本BOM用量表 / 成本BOM真实用量表**：占位页，后续迭代。

## 配件明细（`UB_ERP_Bom_parts`）

- **`GET /api/inventory/bom/parts/:systemcode`**：`kcaa01`/`kcaa02`/`kcaa03`/`kcaa11` 优先按 **`UB_ERP_Bom_000.kcaa01`**（在册主档，`OUTER APPLY` **TOP 1**）展示；无匹配则用配件表原列。查询按 `UB_ERP_Bom_parts.kcac01 = 当前 systemcode`、`UB_ERP_Bom_000.systemcode = 当前 systemcode` 直接匹配，不再在大表条件里包 `LTRIM/RTRIM/CONVERT`，避免配件明细打开时全表逐行函数计算。
- **`PUT /api/inventory/bom/parts/:systemcode`**（及 **`POST /api/inventory/bom/save-parts`**）：保存时每行 **UPDATE** 使用 **`id` + `kcac01`（主档 `systemcode`）** 双重锁定；按配件 **`kcaa01`** 关联 **`UB_ERP_Bom_000`** 最新在册行，将表中存在的 **`kcaa01`～`kcaa35`**、**`kcac02`** 与 **`systemcode`**（若明细表有该列，同子 BOM `systemcode`）从主档写回明细；用量/单价/备注/排序仍以请求为准。新增行先 **INSERT OUTPUT id** 再执行同一套 UPDATE。详见 `docs/sql/database_map.md`（`UB_ERP_Bom_parts` 条目）。
- **`kcac06`**：用量合计 = **`kcac04 × (1 + kcac05)`**；前端损耗按 **百分比** 编辑，库内 **`kcac05`** 为小数；保存时写入 **`kcac04`/`kcac05`/`kcac06`**（若库中存在 **`kcac06`** 列）。
- **编辑弹窗新增配件**：新增空行或选材新增时，`单位用量(kcac04)` 与 `单价(cost_price)` 默认留空，交给用户填写；若用户不填直接保存，仍按后端现有规则落为 0。
- **添加配件选材表**（`MaterialSelector.vue`，`GET /api/inv/bom/list`）：BOM 配件明细传 `fullscreen`，弹窗 **100vh 铺满**（行数多少表体区都占满，分页钉底）；编码列右侧 **输入/修改时间** 等同主列表。采购/外协/销售批量选材默认仍近全屏 `max-height`。
- **审计**：用量变更成功：`[更新]了配件用量，BOM：[主档 kcaa01]，配件：[kcaa01]，用量：[kcac04]，损耗：[kcac05]`。若配件在 **`UB_ERP_Bom_000`** 存在子档，另记：`[同步]了BOM配件属性，主BOM：[systemcode]，配件：[kcaa01]，已同步kcaa01-kcaa35共35个字段。`

## 接口一览（`server/index.js`）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/inv/bom/list` | 分页列表；`recycled=1` 回收站；否则 `pass` + 在册 `del`；可选 **`bom_code_id`**（`UB_ERP_Bom_code.id`，按 flag5 前缀筛 `kcaa01`）；`keyword` 支持编码、名称、录入人、修改人；返回含 **`systemcode`**；“已运算/未运算”和主页成本用量列复用当前页 `UB_ERP_Bom_cost` 汇总结果，不在列表主查询里重复逐行查成本表 |
| GET | `/api/inv/bom/bom-code-categories` | BOM 分类下拉（`UB_ERP_Bom_code`，按 `id` 升序） |
| GET | `/api/inventory/bom/:id` | 详情，`:id` = `kcaa01`（URL 编码）；**含已删行**（便于回收站查看） |
| POST | `/api/inventory/bom/save-main` | **新增主档（标准）**：与旧版 `POST /api/inventory/bom` 共用逻辑 |
| POST | `/api/inventory/bom` | 新增主档（兼容；与 `save-main` 相同） |
| PUT | `/api/inventory/bom` | 保存（body 含 `systemcode`，**未审且在册**） |
| PUT | `/api/inventory/bom/audit` | 审核 `body: { systemcode }` |
| PUT | `/api/inventory/bom/audit-batch` | 批量审核 `body: { systemcodes }`（仅当前页，最多 200） |
| PUT | `/api/inventory/bom/unaudit` | 反审 |
| PUT | `/api/inventory/bom/restore` | 回收站恢复 |
| DELETE | `/api/inventory/bom/systemcode/:systemcode` | 软删（**已审拒绝**） |
| DELETE | `/api/inventory/bom/systemcode/:systemcode/permanent` | 物理删（**仅回收站**） |
| GET | `/api/inventory/bom/check-code` | 编码冲突提示 |
| GET | `/api/inventory/bom/unit-rate-suggest` | 单位换算建议 |
| GET/PUT | `/api/inventory/bom/parts/:systemcode` 等 | 配件明细（见 `database_map.md` §3.6.x） |

## 标准件交互（对齐颜色编码）

- **页面入口布局**：顶部按采购订单风格分为「管理BOM资料 / BOM资料添加 / 转向物料查询」三段；「转向物料查询」当前仅为占位页，不接接口。
- **管理页筛选布局**：第一行——BOM 分类、裁片过滤、批量审核、批量运算；第二行——查询内容、查询、重置、回收站、显示未审核（用竖线间隔）。管理卡片不再单独显示「BOM资料」标题行，避免和顶部模块标题重复。新增 BOM 不再放在筛选区，改从顶部「BOM资料添加」进入。
- **当前页面打开**：列表「查看详情」「编辑」「复制」均在当前 BOM 页面内切换显示；「查看详情」和「编辑」的基础资料使用同一套显示布局，区别是查看详情全部只读；「编辑」仍只在未审核视图可用，保存接口和运算逻辑不变。成本 BOM 打印、配件下钻等独立页能力不属于本条改动范围。
- **BOM 基础资料表单**：查看、新增、编辑共用同一套横排布局，参考采购订单添加页；主界面不显示 `systemcode`，但保存时仍保留内部字段。字段顺序固定为：编码；名称+是否客供；开票名称；英文名称+分类；规格+组别；颜色+产地；客户款号+报价损耗；工厂款号+物料损耗；使用单位+小数点配置；采购单位+转换方式+转换率；报价单位+转换方式+转换率；BOM价格+币别+采购价格+币别；供应商；工作方式+生产车间；是否保税；备注。编码、名称、开票名称、英文名称、规格、颜色、供应商、备注使用宽输入框，其余非按钮控件使用窄输入框，宽输入框为窄输入框的 2 倍。颜色显示按 `UB_ERP_Stocks_colorcode` 补名称，例如 `CU` 显示为 `CU,杏色`，保存字段仍只保留颜色编码。是否客供、是否保税用「是/否」按钮，默认否；工作方式用「采购/外协/自产」多选按钮，新增默认自产。当前页面内新增/编辑只保留页面最外层纵向滚动，不在 BOM 基础资料内部再套纵向滚动。该改动只影响前端显示，不改字段、接口、单位换算、配件和运算逻辑。
- **基础资料颜色校验**：新增/编辑点击「保存主档」时，前端会取编码最后一个 `/` 后、遇到 `-` 前的内容作为颜色后缀，例如 `BAG-PQ2803H1/R-TEST` 取 `R`，`PQ-3119B1/N` 取 `N`。颜色支持下拉选择和手动输入（如 `R` 或 `R,红色`），保存前都会解析成颜色码参与比对；若颜色码与后缀不一致，会提示「颜色跟编码后缀不一致，是否继续？」；点继续才提交，点取消不保存。
- **主页查询内容**：同一个关键词框支持搜索 BOM 编码、名称、录入人、修改人；仍沿用原规则，关键词不足 3 个字不作为筛选条件。
- **BOM 分类筛选**：工具栏下拉来自 **`UB_ERP_Bom_code`**（按 `id` 排序，展示 `flag1` 如「产品」）；查询传 **`bom_code_id`**，按该分类 **`flag5` 前缀** 匹配物料编码 `kcaa01`；默认「全部分类」。列表「分类」列仍为材料分类（`UB_ERP_Stocks_material` / `kcaa05`，旧表名 `Bom_material`），与筛选项不是同一张表。**仅改分类或裁片过滤下拉不会刷新列表**，须点「查询」或关键词回车。
- **主列表列字体统一**：主列表所有数据列（含编码、名称、规格、输入/修改时间、成本用量、录入人/修改人等）字号与粗细与「分类」列一致（常规字号、非粗体）；仅改屏上展示，不动数据与接口。DIY 位置：`index.vue` `<style scoped>` 内 `.erp-list-table :deep(.bom-list-cell-wrap)` 等覆盖规则。
- **模式行按钮字体统一**：顶部「管理BOM资料 / BOM资料添加 / 转向物料查询 / MOQ查询」模式按钮，字号与粗细与主列表列数据一致（`--erp-table-data-size` + `--erp-font-weight-body`）；仅改屏上展示。DIY 位置：`index.vue` `<style scoped>` 内 `.bom-mode-btn`。
- **筛选区按钮字体统一**：管理页筛选区第一行「批量审核（仅当前页）/ 批量运算（当前页）」与第二行「查询 / 重置」，字号与粗细均与「管理BOM资料」一致；仅改屏上展示，不动查询与审核逻辑。DIY 位置：`index.vue` `<style scoped>` 内 `.bom-filter-unified-btn-font`（父级挂在 `.bom-filter-bar`）；查询/重置保留 `.bom-filter-action-btn` 作锚点。
- **操作按钮字号统一**：BOM 基础资料「是否客供 / 工作方式 / 是否保税」是/否按钮，详情/编辑页头「返回列表 / 重置 / 保存主档 / 保存配件明细」，配件明细工具条（含「+ 增加配件明细」行）与表格操作列（「添加配件 / 编辑配件 / 查看」），以及联动弹窗同类按钮，字号与粗细均与「管理BOM资料」一致；仅改屏上展示。DIY 位置：`index.vue`、联动弹窗 `BomLinkedDetailDialog.vue` 内 `.bom-unified-btn-font`；`BomBasicForm.vue` 内 `.bom-basic-buttons :deep(.el-button)`；「编辑配件」伪元素见 `index.vue` `.bom-part-edit-child-action-btn`。
- **基础资料字体统一**：查看详情/编辑「BOM基础资料」左侧字段名与右侧输入值（含下拉、备注）字号与粗细与主列表「分类」列一致（常规字号、非粗体）；仅改屏上展示，不动数据与接口。DIY 位置：`BomBasicForm.vue` `<style scoped>` 内 `.bom-basic-label`、`.bom-basic-field :deep(.el-input__inner)` 等覆盖规则；字段值字号变量 `--bom-basic-control-font-size`（默认跟 `--erp-table-data-size`）。
- **默认**：列表 `pass=1`（已审核）
- **显示未审核**：`pass=0`；此时显示「编辑」入口；工具栏 **批量审核（仅当前页）** 只审当前分页行（如 10 条/页最多 10 条）
- **回收站**：仅 `del=1`；操作「恢复」「彻底删除」；与「显示未审核」互斥
- **二次确认**：审核 / 反审 / 软删 / 恢复 / 彻底删除均需 `ElMessageBox.confirm`；彻底删除为危险确认
- **已审核**：禁止编辑、禁止软删；彻底删除在回收站内对已审行按钮禁用（需先恢复再反审后再删，按业务）

## 权限（`apiPermissionGate.js`）

菜单 path：`inv/bom` 或 `inventory/basic/bom-data`：`view` / `add` / `edit` / `audit` / `delete`
## 打印

- **成本BOM用量表抬头**：屏上、打印、导出统一为 `《成本BOM用量表》 编码【…】 ， 名称【…】 ， 客户款号【…】`（来自当前 BOM 主档 `kcaa01` / `kcaa02` / `kcaa06`）；明细列仍含规格等字段。
- **成本BOM用量表**：点击「点击此处打印」直接以 **A4 纵向** 在新页打开并调起浏览器打印（无布局确认弹窗）；并在页面左上角显示「打印时间」（记录点击打印瞬间的本地时间）。使用独立打印专用表格，打印模式隐藏侧栏/页签。明细列：编码、名称、规格、单位、备注、用量、损耗、合计；**合计行仅在最后一页**（不作为每页重复表尾）。每页底部有页码（如 `1/6`，依赖 Chrome/Edge 打印引擎）。**打印版式 DIY**：仅改 `index.vue` 内 `@media print` → `html.print-bom-cost-usage` 上的 CSS 变量（`--bom-cost-print-font-size`、`--bom-cost-print-col-code` 等），不影响屏上表格；改完 Ctrl+F5 再打印预览。**打印抬头单行**：抬头 `《成本BOM用量表》编码【…】,名称【…】,客户款号【…】` 强制不换行；编码较短时保持 17px 大字，编码过长时按 A4 内容区宽度自动缩小字号（下限 9px），仅改打印展示、不改抬头文本与明细数据。
- **隐藏编码前缀**：界面不再提供配置；仍按内置前缀列表在展示层过滤 CUT-/BAG- 等中间件行（与改前默认列表一致）。
- **成本BOM用量表显示**：导出/打印按钮与主抬头 `《成本BOM用量表》 编码【…】…` 同在工具条（抬头在按钮下一行）；灰框只包表格。`el-table` 不设固定/最大高度（避免合计下表体留白）；行数少于 28 时整块随内容增高，弹窗 body 不撑满屏；28 行及以上时灰框外层 `max-height` 纵向滚动。页面、打印、导出里的「损耗」列按实际损耗最多 6 位小数并去掉多余末尾 0，`0` 显示为 `0`；同一编码+备注合并后若损耗一致，保留原始 `kcac05` 显示，不再用 `kcac06/kcac04` 反推，避免 6 位小数合计反算误差；若合并行损耗确实不同，才继续按总合计/总用量计算综合损耗。「用量」「合计」仍按原规则显示，不跟随此规则。
- **成本BOM用量表备注兼容**：新系统运算后的备注仍以 `UB_ERP_Bom_cost.Describe` 为准；读取旧缓存时若 `Describe` 为空，则用旧系统 `binfo` 作为页面/打印/导出的备注显示与合并区分值，不改运算结果、不回写历史数据。
- **成本BOM用量表导出**：含与屏上相同的主抬头行，再输出表头列与数据；点击「导出信息」后浏览器下载，默认文件名 `下载.xls`。导出 Excel 按 **A4 纵向** 页面设置，表格区域带边框，列宽贴近打印预览；导出不额外添加「打印时间」。导出时主抬头、表头列名、明细数据行和合计行均使用 Arial、10 号字体；主抬头、表头列名和合计行保留加粗。
- **BOM 主页一次性筛选**：BOM 分类（例如成品）和裁片过滤须先选好再点「查询」才生效；只作为本次查询条件使用。查询结果按本次条件返回后，下拉框自动恢复默认，不影响已经查出的列表内容。
- **成本用量运算缓存与审核状态**：只有未审核 BOM 才能编辑配件明细；保存配件明细后，只清掉当前正在编辑 BOM 的 `UB_ERP_Bom_cost` 缓存，主页随即回到“未运算”、成本用量列为空，不额外反审，也不递归影响上级 BOM。纸格导入 `BAG-PQ3119B1/N`、`TAG-PQ3119B1/N` 这类下级资料后，不修改引用它们的 `PQ-3119B1/N` 审核状态，也不删除该 PQ 原有 `UB_ERP_Bom_cost`。影响范围禁止按被改材料编码全库反查；例如从 `PQ-3182F1/N` 进入新增 `WSFX-PQ3182F1/N`，只让 `PQ-3182F1/N` 自己未运算。
- **PQ 成本排序补值**：只有主 BOM 编码以 `PQ-` 开头的一键运算会写入 `UB_ERP_Bom_cost.px`；规则为明细 `kcaa01` 找 `UB_ERP_Bom_000.kcaa05`，再用该分类编号匹配 `UB_ERP_Stocks_material.code` 取 `px`。读取成本 BOM 用量表缓存时，`PQ-` 主 BOM 按 `px` 从小到大显示，`px` 为空的排在后面；`BAG-`、`TAG-` 等纸格导入下级资料的一键运算不写 `px`，也不按 `px` 改排序，避免改变纸格导入后的排序。
- **CUT 下层倍率**：写入 `UB_ERP_Bom_cost` 时，路径仍逐层累乘，但 **CUT- 中间层系数按 1 跳过**（不放大子层）；非 CUT 层（如 `PQ-`/`BAG-`/`TAG-`）仍正常参与乘算。示例：`CUT-BAGPQ3188A3/GRN<1-2>` 数量为 2，子编码 `LA-0240/GR3` 用量 0.1673，落库仍为 `0.1673`（不乘 2）；而 `PQ-3188A3/GRN` 下 `BAG-PQ3188A3/GRN` 数量为 2 时，`LA-0240/GR3` 落库为 `0.1673 * 2 = 0.3346`。树形预览的原始平铺数据不作为本条落库规则的依据。
- **数据库变更**：本次无数据库变更。
- **已知问题/下一步**：页码 `当前页/总页数` 在 Chrome/Edge 打印预览较稳定；Firefox 等浏览器可能无总页数或版式略有差异。若列过多被裁切，可在系统打印对话框中临时改横向。打印默认：表体 **14px / 字重 700**，抬头 **17px**（超长编码自动缩小，下限 9px）；列宽比例编码 15%、名称/规格各 20%、单位 5%、备注 10%、用量/损耗各 11%、合计 8%（均可通过上述变量调整）。极端超长编码缩到 9px 下限后仍可能触达页宽，属可接受边界。

## 配件编码保护

- 保存配件明细时，`kcaa01` 始终以用户提交的配件编码为准，不会被 `UB_ERP_Bom_000` 同步覆盖；保存后会按本次提交编码做精确对账，若少行或编码被改写则整次保存回滚。

## 编辑态下钻配件

- 从 BOM 主页点“编辑”进入后，在“配件明细”里点击下层配件编码时，打开的是配件明细维护页，默认停在“配件明细”标签。
- 该维护页的“基础资料”只用于查看，不能编辑主档；“配件明细”可编辑并保存。
- 保存范围只限当前打开的下层主 BOM，例如从 `BAG-PQ3119B1/N` 进入某个 `CUT-...`，保存时只改这个 `CUT-...` 的 `UB_ERP_Bom_parts`。
- `parts-edit` 下钻页的配件明细按“从编辑入口进入”放开维护；即使当前下层 BOM 已审核，也只允许改配件明细，不允许改基础资料主档。从“查看”入口进入时仍按查看逻辑打开。
- `parts-edit` 页面里继续下钻下层配件时，操作按钮继续显示“编辑配件”，并继续打开 `parts-edit`；普通查看页仍显示“查看”。

## 转向物料查询（BOM资料）

- 顶部「转向物料查询」已从占位页改为当前页内查询面板，不新开窗口；查询只读，不维护 BOM。
- **筛选栏改两行**：第一行「分类 + 开始日期 + 结束日期」；第二行是「查询条件输入框 + 查询 + 重置 + 显示英文」。
- **进页面默认不加载**：切到「转向物料查询」不再自动发请求，列表空白并提示「请输入关键字后点查询」；点「查询」后才查库（避免一进来就对约 200 万行主表做全表扫）。
- **分类可选全部**：分类下拉与列表页一致，可清空、带「全部分类」项，默认不选（空=全部分类）；数据源 `UB_ERP_Bom_code`。
- **重置行为**：点击「重置」会清空关键字、日期与分类（回到“全部分类”），列表与分页清空并回到“未查询”空态。
- **展开全部/收起全部**：第二行「显示英文」右侧新增按钮，一键展开或收起当前页所有明细行（展开会逐行触发对应成品/PI 明细的懒加载）；无数据时禁用。查询/重置/换页后按钮状态回落为「展开全部」。「查询·重置」与「显示英文」、「显示英文」与该按钮之间用竖线分隔。
- 主列表接口：`GET /api/inv/bom/material-trace/list`。数据来自 `UB_ERP_Bom_Sales_list`，固定 `del=0 and pass=1`，默认按 `id desc` 分页，支持 `page/pageSize`、`bom_code_id`、`startDate`、`endDate`、`keyword`、`all=1`。
- **性能（2026-07 优化）**：主表约 200 万行且只有 id 主键。关键词搜索主列表仍走快速分页：只按 `id desc` 取当前页需要的行数再多 1 行，用多出的 1 行判断是否还有下一页，保证列表先快出；精确总数改为后台接口 `GET /api/inv/bom/material-trace/count` 异步补算，前端先提示「总数计算中…」，算完后回填「共 N 条」。同一筛选条件翻页会复用前端缓存，不重复慢算。完整编码类关键词（如 `TAG-PQ2818B1/N`）在列表和补算总数都按同一口径：先按 `kcaa01/kcac01/kcac02` 精确查找，精确没有结果时才回落到原多字段模糊搜索。非关键词/查询全部仍保留首包精确总数。
- 分类复用 `UB_ERP_Bom_code`：前端传 `bom_code_id`，服务端按对应 `flag5` 前缀过滤 `UB_ERP_Bom_Sales_list.kcaa01`。
- 日期范围第一版按 `UB_ERP_Bom_Sales_list.addtime` 的日期部分过滤；展开 PI 明细时同一日期范围再按销售订单主表 `UB_ERP_Sales_order.xsaj02` 过滤。
- 关键字第一版为性能优先，只搜高频字段：`sid/kcac01/kcac02/kcaa01/kcaa02/kcaa02_en/kpname/kcaa03/kcaa06/kcaa09/kcaa10/kcaa11/remark/Describe/Customer_Name/location`；不做旧系统 `kcaa01~kcaa35` 全字段模糊搜。
- 主列表会关联 `UB_ERP_Stocks_material` 显示分类名、`UB_ERP_Stocks_colorcode` 显示颜色名、`UB_ERP_Finance_currency` 显示报价/采购币别名；采购、外协、自产、是否保税、客户供应等布尔字段按 `1=是` 展示。
- 展开接口：`GET /api/inv/bom/material-trace/:id/usage`。用当前行 `kcac01` 向上查 `UB_ERP_Bom_Sales_list.kcac02 = 当前 kcac01`，最多追溯三层，找到 `PQ-` 成品款号后展示对应成品和 PI 明细。向上追溯仅按 `del=0`，**不限 `pass`**（上级 BAG/成品行常为 `pass=0`；若追溯加 `pass=1` 会导致展开「对应成品」「PI明细」全空）；销售订单主/明细仍要求 `pass=1`。
- **性能（2026-07 优化）**：追溯的 `kcac02` 等值比较改直接 `kcac02 = @childKey`（参数用 `varchar(50)` 对齐字段类型），去掉原来的 `LTRIM(RTRIM(CONVERT(nvarchar,...)))` 外包，避免逐行函数计算与隐式转换（每层约 2.6s → 1.66s）。找到 `PQ-` 成品后立即停止继续向上追，避免再跑下一层空查询；`PQ3671B1/BO` 展开模拟从约 3.21s 降到约 1.69s。`kcac02` 目前无索引，仍是全表扫；如需进一步提速需加索引（属库表变更，须另行确认）。
- PI 明细来自 `UB_ERP_Sales_order_list` + `UB_ERP_Sales_order`，并用 `UB_ERP_Bom_pi_cost` 计算计价用量合计：`销售数量 xsak03 × SUM(pi_cost.kcac06)`。新系统不再查 `UB_ERP_Bom_pi_consumption`，也不显示旧系统“真实用量”列。
- **展开明细可读性**：对应成品与 PI 明细两张表改为固定列宽（不再用 `min-width` 拉伸整行），并将「PI号」列名改为「对应PI号」，避免短值列占据过宽区域。
- **主页成本用量列展示**：`成本：kcac04合计,kcac06合计` 统一按 4 位小数格式化并去掉无意义尾零（例如 `1.2300` 显示 `1.23`，`80.0000` 显示 `80`）。
- BOM资料页面及下钻弹窗里的数量、损耗、合计、金额类显示统一去掉无意义尾零，例如 `1.000000` 显示 `1`、`0.00` 显示 `0`、`1.230000` 显示 `1.23`；查看详情的配件明细为只读，工具栏不再显示「保存配件明细」，且只显示查看按钮不显示删除按钮；编辑弹窗内「保存配件明细」成功后会自动切回「BOM资料」页签。只改显示与交互，不改保存值和计算精度。
- **配件明细 Tab 铺满 / 展开（2026-07）**：**独立全屏窗**（新标签 `bom-data-window`）仍用 `bom-parts-tab-fill` 纵向 flex——工具栏在上、表格 `height:100%` 吃满中间、**「实际用量总和」**（`bom-parts-sum-row--dock`）钉在 Tab 最底。**当前页面内查看/编辑**（列表点「查看详情」或「编辑」后切到「配件明细」）不再给表格固定高度或最大高度，配件明细按内容自然展开，纵向滚动交给页面最外层，视觉高度与「BOM基础资料」保持一致；横向滚动仍保留在表格外层。独立全屏编辑页配件 Tab 无底栏（保存走工具栏）。DIY：`index.vue` 搜 `bomPartsTableMaxHeight`、`bomEditPartsTableHeight`、`bom-parts-tab-fill`、`bom-edit-dialog--parts-tab`。

## MOQ查询（复刻旧系统）

- 入口在 BOM 页模式栏，放在「转向物料查询」右边，页内切换，不新开窗口。
- 查询条件只保留一个编码输入框（物料编码/颜色编码），**必须先输入再查**；空条件点击查询会提示「请输入编码进行查询」。
- 新增「显示全部」开关：默认关闭（会隐藏销售单号后缀为 `-DECR` / `-CP` 的 PI）；打开后自动重查并显示全部。
- 主接口：`GET /api/inv/bom/moq/list`，核心主表是 `UB_ERP_Bom_pi_cost`，按 `kcaa01 = 输入编码 OR kcaa11 = 输入编码` 精确匹配，且仅统计 `del=0`、`isok=1` 行。
- 汇总维度为 `sid + pq + kcaa01 + temp + kcaa11`，`SUM(kcac06)` 后先批量准备销售主/明细、当前 PI 采购价和最近采购价，再一次性组装结果，按 `sid desc` 分页；`BN-0001/956` 实测从约 4.55 秒优化到约 0.37 秒。
- 单价规则：优先查当前 PI 对应采购价 `dj`；若没有则回退该物料最近采购价 `dj2`，页面单价列用红字提示“回退价”。
- 金额口径：`物料所在款号内总用量(totalUsage) × 有效单价(ep)`；列表底部固定展示「总用量合计、金额合计」（合计按全量结果，不只当前页）。
- 页面默认 10 条/页；只保留「导出信息（xlsx）」按钮，已删除「打印本页」按钮；导出按当前页数据生成 xlsx。
- 金额列与金额合计按 **2 位小数显示并去尾零**（如 `12.50` 显示 `12.5`，`100.00` 显示 `100`）；其余数量/单价维持原精度展示。
- 本次按旧系统口径复刻：未把分类、日期范围强行并入 MOQ 主 SQL 过滤。

## 查看详情独立页

- `BOM资料` 列表里的「查看详情」使用浏览器原生新页打开 `/inventory/basic/bom-data-window?mode=detail&code=...`；新页不显示 ERP 左侧栏、列表筛选、分页和列表操作，只显示当前 BOM 详情数据区，详情页签内原有运算、导出、打印等按钮保持可用。
- **四模式按钮右键（2026-07）**：顶部「管理BOM资料 / BOM资料添加 / 转向物料查询 / MOQ查询」按钮右键 →「在新标签页中打开」，在新标签打开干净独立页（无侧栏、无模式切换条），URL 分别为 `bom-data-window?mode=manage|create|material-trace|moq`；左键仍在当前页切换模式。权限：`manage`/`material-trace`/`moq` 需 `view`，`create` 需 `add`。DIY：`index.vue` `.bom-mode-bar` 的 `@contextmenu` 与 `buildBomModeWindowUrl` / `onBomModeBtnContextMenu`。
- **独立页新增/编辑底栏（2026-07）**：`bom-data-window?mode=create|edit` 时，「关闭 / 重置（仅新增）/ 保存主档 / 保存配件明细」固定在弹窗底栏（`el-dialog` `#footer`），无需滚动即可见；内嵌页仍用面板顶栏 `.bom-page-panel-header`。DIY：`index.vue` 编辑弹窗 `#footer` 与全局样式 `.bom-edit-dialog--standalone`。
- **列表行右键（2026-07）**：在「管理BOM资料」主列表（含 `mode=manage` 干净独立页）、详情/独立页内「配件明细」「BOM用量表运算」「成本BOM用量表」、编辑弹窗「配件明细」等表格行上右键，菜单项「在新标签页中打开」与对应操作列按钮同效果（干净独立页）；**开启「显示未审核」且当前行未审时，主列表右键打开 `mode=edit` 编辑独立页**（含添加/删除配件、保存主档等），已审或默认已审列表仍为 `mode=detail` 只读详情。无 `view`/`edit` 权限或无编码时不弹自定义菜单（无编码时菜单项灰显）。通用组件 `ErpListRowContextMenu.vue`；主列表 `resolveBomListRowContextMenuMode` / `onBomListRowContextMenu`，详情子表 `onBomDetailPartsRowContextMenu` / `onBomUsageOrCostRowContextMenu` / `onBomEditPartsRowContextMenu`。
- 独立页里的「成本BOM用量表」按表格内容自然增高；行数少时合计紧跟明细，不再把表体强行撑满整屏，行数多时仍保留最大高度和滚动显示。
