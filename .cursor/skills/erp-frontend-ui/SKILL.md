---
name: erp-frontend-ui
description: >-
  ERP_TEST 项目前端展示与交互专用：只改 Vue/样式/组件，不改 server/SQL/接口字段/业务数据。
  改字号、弹窗、表格、按钮、分页、滚动条等后必须用中文标注 DIY 位置（文件+行号+变量名）。
  用户说前端 UI、界面显示、样式、弹窗、列表、DIY、调 px、中老年可读 时使用；与 ui-ux-pro-max 可叠加（设计原则），本 skill 管落地与 DIY 说明。
---

# ERP 前端 UI（仅展示层 + DIY 标注）

**适用范围**：仅本仓库 `ERP_TEST`。不要用于其它项目。

## 硬性边界（必须遵守）

1. **只做前端**：允许改 `src/**`（含 `components`、`views`、`styles`、`composables`），**禁止**改 `server/**`、`apiPermissionGate`、SQL、表结构、接口契约（除非用户明确另开后端任务）。
2. **不改业务数据含义**：不增删 API 字段、不改保存 payload、不改列表查询条件；仅布局、样式、交互（如关窗方式、叠层弹窗）。
3. **与仓库设计系统一致**：优先 `src/styles/element-override.scss`、`src/styles/erp-module-page.css`、`src/styles/README.md`；页面级大弹窗用 `ErpPageDialog`；主列表遵守双分页、底栏横滚等既有约定。
4. **包容性**：默认照顾中老年用户（字号、对比度、点击区域 ≥44px）；见 `element-override.scss` 与 `html[data-ui="comfortable|standard"]`。

## 改完必须交付：DIY 说明块（中文）

每次完成 UI 相关改动，回复中**单独一节**，标题固定为：

### 你自己能改的地方（DIY）

每条格式：

- **想改什么**（人话，如「关闭按钮再大一圈」）
- **文件**：`src/styles/xxx`（或具体 `.vue`）
- **位置**：约第 N 行，或搜索 `关键字`
- **改什么**：变量名或属性名 + 示例值（如 `--erp-dialog-close-size: 52px`）

优先指引用户改 **CSS 变量**（`:root` / `html[data-ui='comfortable']`），少让用户改散落的多处 `px`。

若本次改动在代码里新增了可调项，须在 SCSS 中写 **中文注释**（说明变量用途、建议范围、标准/舒适模式是否各一套）。

## 实现习惯

### 可调样式 → 变量优先

在 `element-override.scss` 的 `:root` 增加 `--erp-*` 变量，舒适模式在 `html[data-ui='comfortable']` 覆盖；样式块用 `var(--erp-*)` 引用。

### 弹窗（本仓库）

| 能力 | 默认 | DIY 变量/位置 |
|------|------|----------------|
| 页面级大弹窗 | `ErpPageDialog`，点遮罩/Esc 默认不关 | `src/components/erp/ErpPageDialog.vue` |
| 关闭按钮大小/图标 | 全站 `.el-dialog__headerbtn` | `:root` `--erp-dialog-close-size`、`--erp-dialog-close-icon-size`；见 `element-override.scss`「弹窗关闭」段 |
| 大弹窗尺寸 | `.erp-page-dialog` | `src/styles/erp-module-page.css` |

### 列表与表格

- 主列表：`erp-module-page.css`、`element-override.scss` 中 `.erp-list-table`、横滚相关类。
- 密度：`src/utils/uiDensity.js` + `html[data-ui]`。

### 说明文档

触及约定时同步 `src/styles/README.md` 一两句，不写长篇。

## 与其它 Skill

| Skill | 关系 |
|-------|------|
| `ui-ux-pro-max` | 配色、无障碍原则；本 skill 负责本仓库内落地 |
| `ask-then-execute` | 大需求先定稿；本 skill 不替代执行口令 |
| `erp-master-detail-document` / `erp-masterdata-standard` | 做业务功能时叠加；**纯样式任务只用本 skill** |

## 自检清单（交付前）

- [ ] 未改 `server/**`（除非用户明确要求）
- [ ] 构建或 dev 无语法错误（仅改样式时可说明「刷新浏览器」）
- [ ] 回复含 **DIY 说明块**（文件 + 行号/搜索词 + 变量名）
- [ ] 新增可调项已在 SCSS 写中文注释

## 示例（DIY 说明块）

### 你自己能改的地方（DIY）

- **关闭按钮方框大小**：`src/styles/element-override.scss` → `:root` 搜索 `--erp-dialog-close-size`（如改为 `52px`）；舒适模式在 `html[data-ui='comfortable']` 同名变量。
- **× 图标大小**：同上文件 `--erp-dialog-close-icon-size`（如 `26px`）。
- **按钮离右边缘**：搜索 `弹窗关闭`，`.el-dialog__headerbtn` 的 `right`；大弹窗 `.erp-page-dialog .el-dialog__headerbtn` 单独一行。
