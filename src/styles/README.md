# ERP 前端包容性设计系统



风格取向：**Accessible & Ethical** + **Inclusive Design**（ui-ux-pro-max），面向中老年车间/办公室用户。



## 文件



| 文件 | 作用 |

|------|------|

| `element-override.scss` | Element Plus CSS 变量、触控 44px、对比度、表格/按钮全局规则 |

| `erp-module-page.css` | 业务模块页 `.erp-module-page` 标题/说明/工具条；页面级弹窗 `.erp-page-dialog` |
| `erp-detail-form.css` | 详情/大表单 **蓝灰专业系**：`erp-detail-form-context`（`ErpPageDialog` 默认）+ `erp-detail-form` + `erp-detail-form-surface`；变量 `--erp-detail-*` |
| `components/erp/ErpPageDialog.vue` | 页面级详情/大表单弹窗封装（近全屏方案 A） |
| `components/erp/ErpTableActions.vue` | 表格操作列容器（Grid 两行、按可见按钮数设列） |
| `components/erp/ErpListRowContextMenu.vue` | 列表行/左侧菜单/模式按钮右键浮层（Teleport）；全站由 `ErpLayout` 挂载一份并通过 `useErpListRowContextMenu` 调用；菜单项「在新标签页中打开」；DIY 变量 `--erp-list-row-contextmenu-*` |
| `composables/useErpListRowContextMenu.js` | 列表行 `onErpListRowContextMenu`、模式条 `onErpModeBtnContextMenu`、侧栏 `onErpMenuContextMenu` |
| `utils/erpListRowContextMenuRegistry.js` | 按路由注册行右键目标 URL（干净独立页或 `?erpOpen=view&erpRecordId=` 深链） |
| `composables/useErpDeepLinkOpen.js` | 新标签打开后根据 `erpOpen` / `erpMode` / `erpRecordId` 自动切模式或弹查看/编辑 |

| `utils/uiDensity.js` | `comfortable`（默认）/ `standard` 切换，写入 `localStorage` + `html[data-ui]` |
| `utils/uiTheme.js` | 皮肤 `light`（默认全白）/ `warm`（暖色护眼）/ `lightblue`（淡蓝）/ `dark`（暗黑）/ `beangreen`（豆沙绿）切换，写入 `localStorage` + `html[data-theme]`；组合式 `composables/useUiTheme.js` |



## 舒适模式规范（`data-ui="comfortable"`）



- 正文 `--el-font-size-base`: **16px**

- 表格数据 `--erp-table-data-size`: **15px**

- 页面标题 `--erp-page-title-size`: **20px**

- `font-weight` 正文 **500**，标题 **600**

- `line-height` **1.6**

- 可点击控件最小高度 **44px**

- 主色 `#1d4ed8`（深蓝，非浅灰）



顶栏 **显示 → 舒适/标准** 可切换；刷新后记忆。



## 皮肤（配色主题 `data-theme`）

- 顶栏「**皮肤**」下拉（在「显示」左边）：**全白**（默认）/ **暖色护眼**（米黄纸色）/ **淡蓝**（清爽低刺激）/ **暗黑**（深灰底浅字）/ **豆沙绿**（淡绿护眼）；与密度开关相互独立，各自记忆在本浏览器。
- 换「**面色**」——内容区底、卡片/表格、顶栏，以及**左侧菜单栏**（暖色=深咖、淡蓝=深蓝、暗黑=近黑、豆沙绿=深墨绿）；按钮语义色（蓝/绿/红）不动；**暗黑**会同步调浅文字色以保证可读。
- 单源与调色：`element-override.scss` 末尾 `html[data-theme='warm']` / `lightblue` / `dark` / `beangreen` 各段。想更暖/更淡/更深就改各段开头的基准值（`--erp-app-bg` / `--erp-surface` / 表头填充 / 边框 / `--erp-sidebar-*`），其余 Element Plus 面色变量随之统一。
- 布局壳（`ErpAppMain.vue` `.erp-main`/`.erp-content-card`、`ErpLayout.vue` `.erp-header`、`ErpSidebar.vue` `.erp-aside`/`.erp-menu`）读这些变量，勿再在 scoped 写死底色。
- **批量选单窗**（`*-batch-window.vue`、采购/外协 `batch-add-window.vue`）及 BOM 模式条等自定义面板：底色/表头/边框应映射 `var(--erp-surface)`、`var(--erp-app-bg)`、`var(--el-fill-color-light)`、`var(--el-border-color*)`；**打印页**（`print.vue`/`label-print.vue`）与**白纸报表**（`inventory/analysis/*` 的 `.report-shell`）可保留 `#fff`。
- 新增一档皮肤：`utils/uiTheme.js` 的 `UI_THEME_VALUES` 登记取值 → `element-override.scss` 加 `html[data-theme='xxx']` 一段 → `ErpLayout.vue` 下拉加一个 `el-option`。



## 全局页面标签栏

- 外壳（`src/layout/ErpLayout.vue`）锁 `height: 100vh` + `overflow: hidden`，顶栏与左侧功能栏固定不动；纵向滚动仅发生在 `src/layout/ErpAppMain.vue` 的 `.erp-main`（`overflow-y: auto`）。
- `BOM资料 / 使用单位 / 单位转换率` 这类已打开页面标签，由 `src/layout/ErpAppMain.vue` 统一固定在内容区顶部。
- 页面向下滚动时标签栏必须继续显示，方便用户随时切换已打开页面。
- 横向溢出优先用 `overflow-x: clip` 或表格自己的视口底横条处理。



## 操作按钮（舒适模式）



- 列表操作列外包 `<ErpTableActions>`（Grid 最多两行、左对齐；`row-gap` 2px / `col-gap` 4px；主列表小按钮 token 见 `--erp-list-action-*`）

- 行内操作用 `plain` + 语义 `type`（`primary` 编辑、`info` 查看、`success` 审核、`warning` 反审、`danger` 删除），**不要用 `link`**；标杆见 `src/views/inv/bom/index.vue`
- 审核区工具栏：`audit-switch` + `switch-label` + `el-switch`；未审视图用 `el-alert type="warning"` 提示

- 工具条次要链式按钮可加 `erp-btn-keep-link` 豁免方框化

- **全站落地（2026-07）**：主数据、单据、报价、系统/人事/宿舍等主列表操作列已按 `inv/bom/index.vue` 标杆统一；子表/弹窗内操作钮不在此次范围。



## 主列表表格（`.erp-list-table`）— 禁止双重滚动条



**硬性约定（现有模块 + 后续采购单/工单等一律遵守）：**



1. `class="erp-list-table"`，**数据列完整展示**（`nowrap` + 列 `min-width`，表头/表体由 EP `doLayout` 对齐；勿双表 `max-content`/`table-layout:auto`）；超出视口用**视口底横条**；勿 `show-overflow-tooltip`。

2. **禁止** 主列表 `:max-height` / `useErpListTable()` 的 `tableMaxHeight`（页面可纵向变长，只用**页面**竖滚）。

3. **必须** 视口底横向滚动：`<ErpTableViewportHScroll>` 包裹表，或 `v-erp-list-h-scroll`（与表体 `scrollLeft` 同步；**仅主表根节点**表内横滚 UI 由全局 CSS 隐藏——**只藏横向**，表体原生/EP **竖条保留**，定高子表仍可上下滚；展开行等未挂横条的嵌套 `el-table` 仍保留自身横滚条）。DIY：`element-override.scss` 搜 `erp-table-viewport-hscroll-active`（勿对表体 wrap 写 `scrollbar-width: none` / `::-webkit-scrollbar { width:0 }`，否则竖条一并消失）。

4. 操作列：`erp-col-actions` + `<ErpTableActions>`（左对齐紧凑排版；列数见 `src/utils/erpTableActionsLayout.js`）。

5. 数值列：`erp-col-number` 右对齐；双行时间/多行：`erp-col-datetime` / `erp-col-multiline`。

6. 弹窗/Tab 内**子表**也可接 `ErpTableViewportHScroll`（如 BOM 配件明细），与主列表同款「随时可拖」底横条；定高子表靠表内纵滚 + 视口底横条并存。未接横条的展开行明细仍可用表内横滚。



## 表格行背景（斑马纹已全局关闭 · 2026-07）

- **现象**：部分表格「一行白、一行浅蓝」来自 Element Plus `el-table` 的 `stripe` 斑马纹，不是业务 bug。
- **全站处理**：`element-override.scss` 搜索「**关闭表格斑马纹**」，将 `.el-table__row--striped` 背景强制与普行一致（`--el-table-tr-bg-color` / `--erp-surface`），五档皮肤自动跟随；**鼠标悬停**（hover）亦与普通行同色（`--el-table-row-hover-bg-color`），避免隔行无反应。
- 各页模板里的 `stripe` 属性可留可删，视觉效果已无隔行色差；若要源码干净可后续批量删 `stripe`。
- **保留**：报表小计/合计行、采购明细标记行等 `row-class-name` 业务着色不受影响。



## 页面级弹窗（近全屏 · 方案 A）



**硬性约定（查看详情、主从大表单等；小窗增删改不在此列）：**



1. 使用 `ErpPageDialog`（`src/components/erp/ErpPageDialog.vue`）或 `el-dialog` + `class="erp-page-dialog"`，样式见 `erp-module-page.css`。

2. 宽度 `min(100%, calc(100vw - 32px))`，`max-width: none`，`top` 默认 **8px**；遮罩在整页上，**侧栏/顶栏仍可见**。

3. 正文在 `.el-dialog__body` 内**单一纵滚**；Tab 内超长子表可单独 `max-height`（与主列表分开）。

4. **关闭方式**：`ErpPageDialog` 默认**禁止**点灰色遮罩、按 Esc 关闭；仅右上角 **×**（或页内「取消」按钮）可关。小表单窗建议同样设 `:close-on-click-modal="false"`。× 按钮 DIY：改 `element-override.scss` 中 `--erp-dialog-close-size` / `--erp-dialog-close-icon-size`（文件内搜索「弹窗关闭」）；前端 UI 任务可 @ 项目 skill `erp-frontend-ui`。

5. 表单级（新增颜色、改密码等）继续 `width="480px"`～`560px`，**勿**加 `erp-page-dialog`。

6. **详情蓝灰风格**：`ErpPageDialog` 已默认 `erp-detail-form-context`（深蓝标题栏、浅蓝灰底、Tab/分区/输入框见 `erp-detail-form.css`）。中等弹窗在 `el-dialog` 上自加 `erp-detail-form-context`；表单区 `erp-detail-form-surface`，`el-form` 加 `erp-detail-form`；分区标题 `bom-section-title` / `erp-detail-section-title`。DIY：`element-override.scss` 的 `--erp-detail-*`。



## 主列表双分页（头 + 底）



**硬性约定（BOM 及现有/后续 `.erp-module-page` 主列表一律遵守）：**



1. **头部分页**：工具栏与告警之后、表格（`el-skeleton` / `el-table`）之前，类名 `pagination-row pagination-row--top`（或 `pager-row pager-row--top`）；加载中也可翻页时放在 `el-skeleton` **外**。

2. **底部分页**：表格下方，类名 `pagination-row pagination-row--bottom`（或 `pager-row--bottom`）。

3. 头/底绑定同一套 `page` / `pageSize` / `total` 与翻页事件；`layout="total, sizes, prev, pager, next, jumper"` + `background`；`:page-sizes="ERP_PAGE_SIZE_OPTIONS"`（单源 `src/utils/erpPagination.js`：5～1000，各页默认条数仍各自 `ref`）。

4. **左对齐**：勿在 scoped 写 `justify-content: flex-end`，使用 `erp-module-page.css` 全局规则；`element-override.scss` 中 `.pagination-row` / `.el-pagination` 已与之一致为 `flex-start`（2026-07 订单主列表统一）。

5. 树形/无分页视图（如部门资料 `treeMode`）不显示分页。



## 右键「在新标签页中打开」（2026-07 全站）

- **左侧菜单**：叶子菜单项右键 → 新标签打开该功能页（带完整顶栏+侧栏）。
- **主列表行**：带 `erp-list-table` 的列表右键 → 按 `erpListRowContextMenuRegistry.js` 打开干净独立页（如 BOM/PI-BOM）或同页深链 `?erpOpen=view&erpRecordId=`（采购/销售/出入库等自动弹出查看）。
- **模式条按钮**：采购单/外协单/销售单顶部模式按钮右键 → 新标签打开对应模式（`?erpMode=` 或已有独立窗路由）。
- **BOM** 仍保留自有子表/四模式逻辑；注册表对 `inventory/basic/bom-data` 设为 `skip`，由 `inv/bom/index.vue` 自管。
- 新模块接入：主表加 `@row-contextmenu="onErpListRowContextMenu"` + `useErpListRowContextMenu()`；若有查看弹窗再加 `useErpDeepLinkOpen({ handlers: { view: ... } })`。


## 扩展

## 管理/单据页统一尺寸（2026-07）

- 顶部模式按钮统一使用 `erp-mode-bar` + `erp-mode-btn`，例如「管理BOM资料 / BOM资料添加」「管理采购订单 / 采购订单添加」。
- 查询筛选区统一使用 `erp-filter-bar`、`erp-filter-row`、`erp-filter-action-btn`、`erp-filter-divider`、`erp-filter-switch`。
- 主列表继续使用 `erp-list-table`，数据列字号和字重统一走 `--erp-table-data-size`、`--erp-font-weight-body`。
- 适用范围是管理页和单据页：BOM、采购订单、销售订单、外协订单、出入库单、库存基础资料等；统计分析/报表页不主动套这套规则，避免影响报表排版。



- 新页面工具条使用 class：`search-row erp-action-row`（间距 ≥8px）

- 勿在 scoped 写死 `12px` 表格字号，改用 `--erp-table-data-size`

- 详情密集表：`:size="detailTableSize"`（见 `useUiDensity()`）

