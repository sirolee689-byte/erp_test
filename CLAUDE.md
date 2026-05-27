# CLAUDE

本文件为 **Cursor** 入口；与 [`AGENTS.md`](./AGENTS.md) 内容一致。细则单源在 [`docs/agents/`](./docs/agents/)。

## 读什么

| 主题 | 位置 |
|------|------|
| 工单、分诊、领域、写码纪律（索引） | [`docs/agents/index.md`](./docs/agents/index.md) |
| 写码纪律全文 | [`docs/agents/coding-discipline.md`](./docs/agents/coding-discipline.md) |
| 业务域与定稿模块 | [`CONTEXT.md`](./CONTEXT.md) |
| ERP 硬约束（SQL2008、pass/del、分页等） | [`.cursorrules`](./.cursorrules) |
| 改后端后重启 API（每条对话） | [`.cursor/rules/backend-api-restart.mdc`](./.cursor/rules/backend-api-restart.mdc) |
| 代码探索（CodeGraph MCP） | 存在 `.codegraph/` 时用 MCP；本地 `.cursor/rules/codegraph.mdc`（已 gitignore） |

## Agent skills（摘要）

- **先定稿再执行**：`.agents/skills/ask-then-execute/`（同 Codex 单源；联接脚本 `npm run link:skill:ask-then-execute`）
- **Issue tracker**：`.scratch/<feature>/` → [`docs/agents/issue-tracker.md`](./docs/agents/issue-tracker.md)
- **Triage labels**：默认五类字符串 → [`docs/agents/triage-labels.md`](./docs/agents/triage-labels.md)
- **Domain docs**：`CONTEXT.md` + `docs/adr/` → [`docs/agents/domain.md`](./docs/agents/domain.md)
