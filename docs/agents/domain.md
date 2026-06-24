# Domain docs（领域文档）

## 布局

- **单上下文**（本仓库）：根目录 [`CONTEXT.md`](../../CONTEXT.md) 为领域语言与已定稿模块规则的唯一主入口。
- **架构决策**：[`docs/adr/`](../../docs/adr/)（有 ADR 时写入；无文件时以 `CONTEXT.md` 与模块 README 为准）。

## 阅读顺序（Agent）

1. 用户任务涉及的 `CONTEXT.md` 章节（如销售订单第七节）。
2. 当前模块 `src/views/.../README.md` 与 `.scratch/<feature>/PRD.md`。
3. 涉及表结构时查 `docs/sql/database_map.md`。
4. 需要历史决策时再查 `docs/adr/`。

## 相关 skill

- `improve-codebase-architecture`、`diagnose`、`tdd`、`grill-with-docs`（`.agents/skills/`）
