# CLAUDE

本文件为 **Cursor** 入口；与 [`AGENTS.md`](./AGENTS.md) 内容一致。沟通与注释单源见 [`.cursorrules`](./.cursorrules) §1。细则索引在 [`docs/agents/`](./docs/agents/)。

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

- **先定稿再执行**：`.agents/skills/ask-then-execute/`（同 Codex 单源；联接脚本 `npm run link:skill:ask-then-execute`）
- **Issue tracker**：`.scratch/<feature>/` → [`docs/agents/issue-tracker.md`](./docs/agents/issue-tracker.md)
- **Triage labels**：默认五类字符串 → [`docs/agents/triage-labels.md`](./docs/agents/triage-labels.md)
- **Domain docs**：`CONTEXT.md` + `docs/adr/` → [`docs/agents/domain.md`](./docs/agents/domain.md)
