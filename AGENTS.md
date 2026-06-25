# Codex

## 沟通偏好

与 Cursor 单源一致：见仓库 [`.cursorrules`](./.cursorrules) **§1**（全中文、大白话、界面主语、业务注释）。下文「读什么」为索引，不重复粘贴条文。

本文件为 **Codex** 入口；与 [`CLAUDE.md`](./CLAUDE.md) 内容一致。细则单源在 [`docs/agents/`](./docs/agents/)。

## 读什么

| 主题 | 位置 |
|------|------|
| 工单、分诊、领域、写码纪律（索引） | [`docs/agents/index.md`](./docs/agents/index.md) |
| 写码纪律全文 | [`docs/agents/coding-discipline.md`](./docs/agents/coding-discipline.md) |
| 业务域与定稿模块 | [`CONTEXT.md`](./CONTEXT.md) |
| ERP 硬约束 | [`.cursorrules`](./.cursorrules) |
| 浏览器验收 | [`.cursor/rules/ironbee-devtools-use.mdc`](./.cursor/rules/ironbee-devtools-use.mdc) |
| 规则单源地图 | [`docs/agents/index.md`](./docs/agents/index.md)「规则单源地图」 |

## Agent skills（摘要）

- **先定稿再执行**：`.agents/skills/ask-then-execute/`（Cursor 经 junction 读 `.cursor/skills/ask-then-execute`；丢失联接时 `npm run link:skill:ask-then-execute`）
- **Issue tracker**：`.scratch/<feature>/` → [`docs/agents/issue-tracker.md`](./docs/agents/issue-tracker.md)
- **Triage labels**：默认五类字符串 → [`docs/agents/triage-labels.md`](./docs/agents/triage-labels.md)
- **Domain docs**：`CONTEXT.md` + `docs/adr/` → [`docs/agents/domain.md`](./docs/agents/domain.md)
