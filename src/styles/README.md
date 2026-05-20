# ERP 前端包容性设计系统



风格取向：**Accessible & Ethical** + **Inclusive Design**（ui-ux-pro-max），面向中老年车间/办公室用户。



## 文件



| 文件 | 作用 |

|------|------|

| `element-override.scss` | Element Plus CSS 变量、触控 44px、对比度、表格/按钮全局规则 |

| `erp-module-page.css` | 业务模块页 `.erp-module-page` 标题/说明/工具条 |

| `utils/uiDensity.js` | `comfortable`（默认）/ `standard` 切换，写入 `localStorage` + `html[data-ui]` |



## 舒适模式规范（`data-ui="comfortable"`）



- 正文 `--el-font-size-base`: **16px**

- 表格数据 `--erp-table-data-size`: **15px**

- 页面标题 `--erp-page-title-size`: **20px**

- `font-weight` 正文 **500**，标题 **600**

- `line-height` **1.6**

- 可点击控件最小高度 **44px**

- 主色 `#1d4ed8`（深蓝，非浅灰）



顶栏 **显示 → 舒适/标准** 可切换；刷新后记忆。



## 操作按钮（舒适模式）



- 列表操作列外包 `<div class="erp-table-actions">`

- 行内操作用 `plain` + 语义 `type`（`primary` 编辑/审核、`success` 审核、`warning` 反审、`danger` 删除、`info` 查看），**不要用 `link`**

- 工具条次要链式按钮可加 `erp-btn-keep-link` 豁免方框化



## 主列表表格（`.erp-list-table`）— 禁止双重滚动条



**硬性约定（现有模块 + 后续采购单/工单等一律遵守）：**



1. `class="erp-list-table"`，**数据列完整展示**（`nowrap` + 列 `min-width`，表头/表体由 EP `doLayout` 对齐；勿双表 `max-content`/`table-layout:auto`）；超出视口用**视口底横条**；勿 `show-overflow-tooltip`。

2. **禁止** 主列表 `:max-height` / `useErpListTable()` 的 `tableMaxHeight`（页面可纵向变长，只用**页面**竖滚）。

3. **必须** 视口底横向滚动：`<ErpTableViewportHScroll>` 包裹表，或 `v-erp-list-h-scroll`（与表体 `scrollLeft` 同步；表内横竖滚动条 UI 由全局 CSS 隐藏）。

4. 操作列：`erp-col-actions` + `.erp-table-actions`（换行、小按钮）。

5. 数值列：`erp-col-number` 右对齐；双行时间/多行：`erp-col-datetime` / `erp-col-multiline`。

6. 弹窗/Tab 内**子表**可单独 `max-height`（与主列表规范分开）。



## 主列表双分页（头 + 底）



**硬性约定（BOM 及现有/后续 `.erp-module-page` 主列表一律遵守）：**



1. **头部分页**：工具栏与告警之后、表格（`el-skeleton` / `el-table`）之前，类名 `pagination-row pagination-row--top`（或 `pager-row pager-row--top`）；加载中也可翻页时放在 `el-skeleton` **外**。

2. **底部分页**：表格下方，类名 `pagination-row pagination-row--bottom`（或 `pager-row--bottom`）。

3. 头/底绑定同一套 `page` / `pageSize` / `total` 与翻页事件；`layout="total, sizes, prev, pager, next, jumper"` + `background`。

4. **左对齐**：勿在 scoped 写 `justify-content: flex-end`，使用 `erp-module-page.css` 全局规则。

5. 树形/无分页视图（如部门资料 `treeMode`）不显示分页。



## 扩展



- 新页面工具条使用 class：`search-row erp-action-row`（间距 ≥8px）

- 勿在 scoped 写死 `12px` 表格字号，改用 `--erp-table-data-size`

- 详情密集表：`:size="detailTableSize"`（见 `useUiDensity()`）


