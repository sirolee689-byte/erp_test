# Issue tracker（工单）

## 位置

- 功能工单：`.scratch/<feature>/` 下的 Markdown（例如 `.scratch/sales-order/issues/01-*.md`）
- PRD：`.scratch/<feature>/PRD.md`
- E2E 验收（若有）：`.scratch/<feature>/E2E-ACCEPTANCE.md`

## 约定

- 每个 issue 文件应可独立被 Agent 领取：目标、验收清单、相关路径/SQL 表。
- 完成项用 `- [x]`，未完成用 `- [ ]`。
- 不默认使用 GitHub Issues；若将来改用 `gh`，在本文件顶部增补说明并同步 `docs/agents/index.md`。

## 相关 skill

- `to-issues`、`to-prd`（`.agents/skills/`）
