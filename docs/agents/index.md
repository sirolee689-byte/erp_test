# Agent 共享说明（单源）

本目录供 **Cursor（`CLAUDE.md`）** 与 **Codex（`AGENTS.md`）** 共同引用，避免在入口文件重复粘贴长文。

## 规则单源地图（避免重复维护）

| 主题 | 单源文件 | 其它文件只 |
|------|----------|------------|
| 沟通、大白话、业务注释 | [`.cursorrules`](../../.cursorrules) §1 | 指针，不抄全文 |
| ERP 硬约束（SQL2008、pass/del、分页、权限门禁等） | [`.cursorrules`](../../.cursorrules) | 指针 |
| 改后端重启 API | [`.cursorrules`](../../.cursorrules) §14 | 指针 |
| 库表文档同步 | [`.cursorrules`](../../.cursorrules) §13 | 指针 |
| 写码纪律（先想再写、最小 diff） | [coding-discipline.md](./coding-discipline.md) | 指针 |
| 列表/SQL 性能自检（热路径先量后写） | [coding-discipline.md](./coding-discipline.md) §5 | 指针 |
| SQL 慢查询测时与方案 | [`.cursor/skills/sql-performance-profile`](../../.cursor/skills/sql-performance-profile/SKILL.md) | 指针 |
| 定稿节奏、轻/中/重、执行口令 | [`.agents/skills/ask-then-execute`](../../.agents/skills/ask-then-execute/SKILL.md) | 指针 |
| 业务术语、模块定稿、pass/del 详述 | [`CONTEXT.md`](../../CONTEXT.md) | 指针 |
| 表/字段映射 | [`docs/sql/database_map.md`](../sql/database_map.md) | 指针 |
| 模块页面行为、接口一览 | `src/views/<模块>/README.md` | 指针 |
| 浏览器验收 | [`.cursor/rules/ironbee-devtools-use.mdc`](../../.cursor/rules/ironbee-devtools-use.mdc) | 指针 |
| 代码探索（CodeGraph MCP） | MCP 工具 `codegraph_explore`（v1.1+ 单工具；用法由 MCP 服务自动下发） | 勿维护过时的多工具规则文件 |

## 文档地图

| 主题 | 文件 |
|------|------|
| 工单 / issue 放哪 | [issue-tracker.md](./issue-tracker.md) |
| 分诊标签词汇 | [triage-labels.md](./triage-labels.md) |
| 领域与架构决策 | [domain.md](./domain.md) |
| 写码纪律 | [coding-discipline.md](./coding-discipline.md) |
| 代码探索 / 调用链（CodeGraph MCP） | 项目根存在 `.codegraph/` 时用 MCP `codegraph_explore`；配置见 `.cursor/mcp.json`（gitignore） |

## ERP 与 Cursor 专用（不在此目录重复全文）

- **业务与技术硬约束**： [`.cursorrules`](../../.cursorrules)
- **领域语言与模块定稿**： [`CONTEXT.md`](../../CONTEXT.md)
- **表名映射**： [`docs/sql/database_map.md`](../sql/database_map.md)
- **模块 Skills**： `.cursor/skills/`、`.agents/skills/`（按任务触发，不写入口全文）
- **CodeGraph**（[官方仓库](https://github.com/colbymchenry/codegraph)）：全局 CLI 建议 `codegraph upgrade` 保持最新；`npm run codegraph:init` 建索引；`npm run codegraph:status` 查看状态；**重装 MCP 接线**用全局 `codegraph install --target=cursor --location=local --yes`（勿只用旧版 `npm run codegraph:install`，须先保证 `package.json` 里 `@colbymchenry/codegraph` 为 ^1.1.0）。v1.1+ MCP 默认只暴露 `codegraph_explore` 一个工具，不再生成 `.cursor/rules/codegraph.mdc`。索引目录 `.codegraph/` 已 gitignore。

## Skills 入口

使用 `to-issues`、`to-prd`、`triage`、`diagnose`、`tdd` 等 engineering skills 前，先读本目录与 `CONTEXT.md`。

先定稿再执行时，遵循 `.agents/skills/ask-then-execute`（Cursor 经 junction 读同目录）。联接丢失时：`npm run link:skill:ask-then-execute`。
