# BOM 主档（bom_000）模块说明

## 页面路径

- `存货管理 → BOM资料查询`：`/inv/bom`
- `库存管理 → 基本资料 → BOM资料`：`/inventory/basic/bom-data`（内嵌本组件）

## 物理表与键

- 主表：`bom_000`（可用环境变量 `INV_BOM_MASTER_TABLE` 覆盖）
- **稳定键**：`systemcode`（配件 `Bom_parts.kcac01` 等关联此字段）
- **业务编码**：`kcaa01`（列表 `code`）；状态：`pass`（审核）、`del`（逻辑删除）

## 详情弹窗标签页

- **基础资料 / 配件明细**：既有功能。
- **BOM用量表运算**：「运算」/「刷新」请求 **`GET /api/bom/tree?systemcode=`**，返回 **嵌套 `children` 的树**；单层 SQL **只按 `kcac01` 匹配**（不按 `del` 过滤，与配件 GET 一致，避免旧库 `del` 空值导致子层 0 行）；**`kcac01`/`kcac02` 用 500 长 nvarchar 比较**防截断。前端 **`el-table` 树形表** + 展开/关闭全部。
- **成本BOM用量表 / 成本BOM真实用量表**：占位页，后续迭代。

## 配件明细（`Bom_parts`）

- **`GET /api/inventory/bom/parts/:systemcode`**：`kcaa01`/`kcaa02`/`kcaa03`/`kcaa11` 优先按 **`bom_000.kcaa01`**（在册主档，`OUTER APPLY` **TOP 1**）展示；无匹配则用配件表原列。
- **`PUT /api/inventory/bom/parts/:systemcode`**（及 **`POST /api/inventory/bom/save-parts`**）：保存时每行 **UPDATE** 使用 **`id` + `kcac01`（主档 `systemcode`）** 双重锁定；按配件 **`kcaa01`** 关联 **`bom_000`** 最新在册行，将表中存在的 **`kcaa01`～`kcaa35`**、**`kcac02`** 与 **`systemcode`**（若明细表有该列，同子 BOM `systemcode`）从主档写回明细；用量/单价/备注/排序仍以请求为准。新增行先 **INSERT OUTPUT id** 再执行同一套 UPDATE。详见 `docs/sql/database_map.md`（`Bom_parts` 条目）。
- **`kcac06`**：用量合计 = **`kcac04 × (1 + kcac05)`**；前端损耗按 **百分比** 编辑，库内 **`kcac05`** 为小数；保存时写入 **`kcac04`/`kcac05`/`kcac06`**（若库中存在 **`kcac06`** 列）。
- **编辑弹窗新增配件**：新增空行或选材新增时，`单位用量(kcac04)` 与 `单价(cost_price)` 默认留空，交给用户填写；若用户不填直接保存，仍按后端现有规则落为 0。
- **添加配件选材表**（`MaterialSelector.vue`，`GET /api/inv/bom/list`）：编码列右侧展示 **输入/修改时间**（两行，与 BOM 主列表一致），时间为**子件 `bom_000` 主档**的 `addtime`/`edittime`；采购报价、外协报价、销售订单批量选材共用该弹窗。
- **审计**：用量变更成功：`[更新]了配件用量，BOM：[主档 kcaa01]，配件：[kcaa01]，用量：[kcac04]，损耗：[kcac05]`。若配件在 **`bom_000`** 存在子档，另记：`[同步]了BOM配件属性，主BOM：[systemcode]，配件：[kcaa01]，已同步kcaa01-kcaa35共35个字段。`

## 接口一览（`server/index.js`）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/inv/bom/list` | 分页列表；`recycled=1` 回收站；否则 `pass` + 在册 `del`；可选 **`bom_code_id`**（`Bom_code.id`，按 flag5 前缀筛 `kcaa01`）；返回含 **`systemcode`** |
| GET | `/api/inv/bom/bom-code-categories` | BOM 分类下拉（`Bom_code`，按 `id` 升序） |
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

- **列表工具条布局**：第一行——关键词、查询、BOM 分类、裁片过滤；第二行——回收站、显示未审核、批量审核/批量运算、重置、新增 BOM。回收站视图下第一行仅保留关键词与查询。
- **BOM 分类筛选**：工具栏下拉来自 **`Bom_code`**（按 `id` 排序，展示 `flag1` 如「产品」）；查询传 **`bom_code_id`**，按该分类 **`flag5` 前缀** 匹配物料编码 `kcaa01`；默认「全部分类」。列表「分类」列仍为材料分类（`Bom_material` / `kcaa05`），与筛选项不是同一张表。**仅改分类或裁片过滤下拉不会刷新列表**，须点「查询」或关键词回车。
- **默认**：列表 `pass=1`（已审核）
- **显示未审核**：`pass=0`；此时显示「编辑」入口；工具栏 **批量审核（仅当前页）** 只审当前分页行（如 10 条/页最多 10 条）
- **回收站**：仅 `del=1`；操作「恢复」「彻底删除」；与「显示未审核」互斥
- **二次确认**：审核 / 反审 / 软删 / 恢复 / 彻底删除均需 `ElMessageBox.confirm`；彻底删除为危险确认
- **已审核**：禁止编辑、禁止软删；彻底删除在回收站内对已审行按钮禁用（需先恢复再反审后再删，按业务）

## 权限（`apiPermissionGate.js`）

菜单 path：`inv/bom` 或 `inventory/basic/bom-data`：`view` / `add` / `edit` / `audit` / `delete`
## 打印

- **成本BOM用量表抬头**：屏上、打印、导出统一为 `《成本BOM用量表》 编码【…】 ， 名称【…】 ， 客户款号【…】`（来自当前 BOM 主档 `kcaa01` / `kcaa02` / `kcaa06`）；明细列仍含规格等字段。
- **成本BOM用量表**：点击「点击此处打印」直接以 **A4 纵向** 在新页打开并调起浏览器打印（无布局确认弹窗）；并在页面左上角显示「打印时间」（记录点击打印瞬间的本地时间）。使用独立打印专用表格，打印模式隐藏侧栏/页签。明细列：编码、名称、规格、单位、备注、用量、损耗、合计；**合计行仅在最后一页**（不作为每页重复表尾）。每页底部有页码（如 `1/6`，依赖 Chrome/Edge 打印引擎）。**打印版式 DIY**：仅改 `index.vue` 内 `@media print` → `html.print-bom-cost-usage` 上的 CSS 变量（`--bom-cost-print-font-size`、`--bom-cost-print-col-code` 等），不影响屏上表格；改完 Ctrl+F5 再打印预览。
- **隐藏编码前缀**：界面不再提供配置；仍按内置前缀列表在展示层过滤 CUT-/BAG- 等中间件行（与改前默认列表一致）。
- **成本BOM用量表显示**：导出/打印按钮与主抬头 `《成本BOM用量表》 编码【…】…` 同在工具条（抬头在按钮下一行）；灰框只包表格。`el-table` 不设固定/最大高度（避免合计下表体留白）；行数少于 28 时整块随内容增高，弹窗 body 不撑满屏；28 行及以上时灰框外层 `max-height` 纵向滚动。页面、打印、导出里的「损耗」列单独使用简洁小数显示，`0` 显示为 `0`，其余值至少保留两位并去掉多余末尾 0；「用量」「合计」仍固定四位，不跟随此规则。
- **成本BOM用量表导出**：含与屏上相同的主抬头行，再输出表头列与数据；点击「导出信息」后浏览器下载，默认文件名 `下载.xls`。导出 Excel 按 **A4 纵向** 页面设置，表格区域带边框，列宽贴近打印预览；导出不额外添加「打印时间」。
- **BOM 主页一次性筛选**：BOM 分类（例如成品）和裁片过滤须先选好再点「查询」才生效；只作为本次查询条件使用。查询结果按本次条件返回后，下拉框自动恢复默认，不影响已经查出的列表内容。
- **成本用量运算缓存与审核状态**：只有未审核 BOM 才能编辑配件明细；保存配件明细后，只清掉当前正在编辑 BOM 的 `bom_cost` 缓存，主页随即回到“未运算”、成本用量列为空，不额外反审，也不递归影响上级 BOM。纸格导入 `BAG-PQ3119B1/N`、`TAG-PQ3119B1/N` 这类下级资料后，不修改引用它们的 `PQ-3119B1/N` 审核状态，也不删除该 PQ 原有 `bom_cost`。影响范围禁止按被改材料编码全库反查；例如从 `PQ-3182F1/N` 进入新增 `WSFX-PQ3182F1/N`，只让 `PQ-3182F1/N` 自己未运算。
- **PQ 成本排序补值**：只有主 BOM 编码以 `PQ-` 开头的一键运算会写入 `bom_cost.px`；规则为明细 `kcaa01` 找 `bom_000.kcaa05`，再用该分类编号匹配 `Bom_material.code` 取 `px`。读取成本 BOM 用量表缓存时，`PQ-` 主 BOM 按 `px` 从小到大显示，`px` 为空的排在后面；`BAG-`、`TAG-` 等纸格导入下级资料的一键运算不写 `px`，也不按 `px` 改排序，避免改变纸格导入后的排序。
- **CUT 下层倍率**：写入 `bom_cost` 时，`CUT-` 自己的数量会放大下层子编码用量，`CUT-` 上面的 `BAG-` / `TAG-` 单位用量也会继续传下去。例如 `CUT-BAGPQ3633A1/BLU4<6-1>` 用量为 2，子编码 `BM-0032/395` 用量为 0.0612，则落入 `bom_cost` 的用量为 `0.0612 * 2 = 0.1224`。树形预览的原始平铺数据不作为本条落库规则的依据。
- **数据库变更**：本次无数据库变更。
- **已知问题/下一步**：页码 `当前页/总页数` 在 Chrome/Edge 打印预览较稳定；Firefox 等浏览器可能无总页数或版式略有差异。若列过多被裁切，可在系统打印对话框中临时改横向。打印默认：表体 **14px / 字重 700**，抬头 **17px**；列宽比例编码 15%、名称/规格各 20%、单位 5%、备注 10%、用量/损耗各 11%、合计 8%（均可通过上述变量调整）。

## 配件编码保护

- 保存配件明细时，`kcaa01` 始终以用户提交的配件编码为准，不会被 `bom_000` 同步覆盖；保存后会按本次提交编码做精确对账，若少行或编码被改写则整次保存回滚。

## 编辑态下钻配件

- 从 BOM 主页点“编辑”进入后，在“配件明细”里点击下层配件编码时，打开的是配件明细维护页，默认停在“配件明细”标签。
- 该维护页的“基础资料”只用于查看，不能编辑主档；“配件明细”可编辑并保存。
- 保存范围只限当前打开的下层主 BOM，例如从 `BAG-PQ3119B1/N` 进入某个 `CUT-...`，保存时只改这个 `CUT-...` 的 `Bom_parts`。
- `parts-edit` 下钻页的配件明细按“从编辑入口进入”放开维护；即使当前下层 BOM 已审核，也只允许改配件明细，不允许改基础资料主档。从“查看”入口进入时仍按查看逻辑打开。
- `parts-edit` 页面里继续下钻下层配件时，操作按钮继续显示“编辑配件”，并继续打开 `parts-edit`；普通查看页仍显示“查看”。
