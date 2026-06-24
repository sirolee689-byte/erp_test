# Agent 共享说明（单源）

本目录供 **Cursor（`CLAUDE.md`）** 与 **Codex（`AGENTS.md`）** 共同引用，避免在入口文件重复粘贴长文。

## 文档地图

| 主题 | 文件 |
|------|------|
| 工单 / issue 放哪 | [issue-tracker.md](./issue-tracker.md) |
| 分诊标签词汇 | [triage-labels.md](./triage-labels.md) |
| 领域与架构决策 | [domain.md](./domain.md) |
| 写码纪律（Karpathy + 本项目 override） | [coding-discipline.md](./coding-discipline.md) |
| 代码探索 / 调用链（CodeGraph MCP） | 项目根存在 `.codegraph/` 时用 MCP；本地规则 `.cursor/rules/codegraph.mdc`（已 gitignore） |

## ERP 与 Cursor 专用（不在此目录重复全文）

- **业务与技术硬约束**：仓库根目录 [`.cursorrules`](../../.cursorrules)（SQL 2008、pass/del、分页、审计等）
- **改后端后的 API 重启**：见仓库根目录 [`.cursorrules`](../../.cursorrules) §16；由用户手动重启，Agent 只提醒、不执行、不查端口/PID、不贴启动指纹
- **领域语言与模块定稿**：[`CONTEXT.md`](../../CONTEXT.md)
- **表名映射**：[`docs/sql/database_map.md`](../sql/database_map.md)
- **模块 Skills**：`.cursor/skills/`、`.agents/skills/`（按任务触发，不写入口全文）
- **CodeGraph**：`npm run codegraph:init` 建索引；`npm run codegraph:status` 查看状态；安装/重建见 `package.json` 中 `codegraph:*` 脚本。索引会包含 **已被 git 跟踪** 的路径（本仓库若提交了 `node_modules`，库会很大，属正常；瘦身需从 git 取消跟踪 `node_modules` 后 `npm run codegraph:init` 重建）

## Skills 入口

使用 `to-issues`、`to-prd`、`triage`、`diagnose`、`tdd` 等 engineering skills 前，先读本目录与 `CONTEXT.md`。

先定稿再执行、且需沉淀长期知识时，遵循 `.agents/skills/ask-then-execute`（Cursor 经 junction 读同目录）中的 **长期知识分层** 与 **选型决策树**。联接丢失时：`npm run link:skill:ask-then-execute`。
