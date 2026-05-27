# Codex

## 沟通偏好

- 默认用大白话解释：先说结论，再说原因，最后说改了哪里。
- 少用技术术语；必须用术语时，顺手用一句话解释清楚。
- 面向业务结果说明：这个问题为什么发生、修完后用户会看到什么变化。
- 不展开长篇代码原理，除非用户明确要求。

本文件为 **Codex** 入口；与 [`CLAUDE.md`](./CLAUDE.md) 内容一致。细则单源在 [`docs/agents/`](./docs/agents/)。

## 读什么

| 主题 | 位置 |
|------|------|
| 工单、分诊、领域、写码纪律（索引） | [`docs/agents/index.md`](./docs/agents/index.md) |
| 写码纪律全文 | [`docs/agents/coding-discipline.md`](./docs/agents/coding-discipline.md) |
| 业务域与定稿模块 | [`CONTEXT.md`](./CONTEXT.md) |
| ERP 硬约束（SQL2008、pass/del、分页等） | [`.cursorrules`](./.cursorrules) |
| 改后端后重启 API | [`.cursor/rules/backend-api-restart.mdc`](./.cursor/rules/backend-api-restart.mdc)（Cursor alwaysApply；Codex 改 `server/**` 时同样遵守） |
| 代码探索（CodeGraph MCP） | 存在 `.codegraph/` 时用 MCP；本地 `.cursor/rules/codegraph.mdc`（已 gitignore） |

## Agent skills（摘要）

- **先定稿再执行**：`.agents/skills/ask-then-execute/`（Cursor 经 junction 读 `.cursor/skills/ask-then-execute`；丢失联接时 `npm run link:skill:ask-then-execute`）
- **Issue tracker**：`.scratch/<feature>/` → [`docs/agents/issue-tracker.md`](./docs/agents/issue-tracker.md)
- **Triage labels**：默认五类字符串 → [`docs/agents/triage-labels.md`](./docs/agents/triage-labels.md)
- **Domain docs**：`CONTEXT.md` + `docs/adr/` → [`docs/agents/domain.md`](./docs/agents/domain.md)
