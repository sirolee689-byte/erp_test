---
name: sql-performance-profile
description: Profiles slow ERP SQL on live SQL Server 2008 R2—maps API flows to queries, times each statement with a 30s cap, diagnoses bottlenecks, proposes optimizations with measured timings, and waits for 定稿 before code changes. Use when the user asks about SQL/query slowness, loading speed, 耗时分析, 性能优化, 方案A/B, or wants to profile database queries before implementing fixes.
---

# SQL 性能分析（先测后改）

本 Skill 管 **SQL 慢查询的分析节奏**：连库实测 → 逐条报耗时 → 超 30 秒即停 → 给方案并测方案耗时 → **等你定稿** 再改代码。

与 [`ask-then-execute`](../ask-then-execute/SKILL.md) 配合：本 Skill 负责「测与方案」；改代码须用户明确口令（`按定稿实现` / `按定稿实现 + 方案A`）。

## 何时启用

- 用户问「哪几条 SQL、分别多久」「加载慢」「保存慢」「连库帮我测」
- 用户要求「先分析再给方案」「超 30 秒就别等了」
- 后端列表/保存/批量接口疑似全表扫或 N+1

## 硬约束（ERP 项目）

- 语法基线：**SQL Server 2008 R2**（禁止把 2012+ 写法当唯一方案）
- 连库：优先 `user-sqlserver` MCP（`mssql_run_sql_query`）；需精确计时时用本目录 [`scripts/profile-query.mjs`](scripts/profile-query.mjs)
- **单条查询超时：30 秒**（`PROFILE_TIMEOUT_MS=30000`）；超时即 **停止后续探测**，在回复中写 `>30s（已中止）`
- Ask 阶段：**只读** SQL、只跑 SELECT/统计；不改表、不改业务代码
- Execute 阶段：仅用户定稿后才改 `server/*.js` 等

## 工作流

```
[1 圈定] → [2 列 SQL] → [3 基线测时] → [4 诊断] → [5 方案+测时] → [6 定稿闸门] → (用户口令后) [7 实现]
```

### 1. 圈定范围

明确：

- 用户操作路径（例：其他出库 → 批量添加 → 首屏 / 保存已选）
- 对应 API（例：`GET /api/stock-out/other-batch-lines`、`POST .../other-batch-prices`）
- 入参样例（例：仓库 `001`、关键字 `BM-0002/074`）

用 CodeGraph / 读 `server/*Handlers.js` 找到 SQL 构建函数（如 `buildOtherBatchListSql`）。

### 2. 列出 SQL 清单

输出表格，每条独立编号：

| 编号 | 场景 | 构建函数/位置 | 说明 |
|------|------|---------------|------|
| Q1 | 批量添加首屏 | `buildOtherBatchListSql` | 含库存 CTE + 分页 |
| Q2 | （若代码里另跑 COUNT） | `buildOtherBatchCountSql` | 是否与 Q1 重复 |
| Q3 | 保存已选取价 | `buildOtherBatchPricesSql` | 是否 N+1 循环 |

**必须**标出：同一重型 CTE 是否被执行两次、循环内是否逐条查库。

### 3. 基线测时（30 秒规则）

对每条 SQL：

1. 从代码导出可执行 SQL（参数换成实测值；`DECLARE @warehouseCode` 等）
2. 执行测时：

```powershell
Set-Location D:\my_projects\ERP_TEST
$env:PROFILE_TIMEOUT_MS = "30000"
node .cursor/skills/sql-performance-profile/scripts/profile-query.mjs --label "Q1 首屏" --sql-file .scratch/profile/q1.sql
```

3. 记录：`耗时 ms`、返回行数、是否超时

**超时处理（强制）：**

- 该条记为 `>30s（已中止）`
- **不再**对同一条加大 timeout 重试
- **停止**后续 SQL 探测（除非用户明确要求继续某一条）
- 回复用户：哪条超时、已中止、初步怀疑点（全表扫、JOIN 包函数、重复 CTE、N+1）

### 4. 诊断（大白话）

常见根因（按优先级核对）：

| 现象 | 常见根因 |
|------|----------|
| 单条 >30s | `JOIN`/`WHERE` 对列包 `LTRIM(RTRIM(CONVERT(...)))`，索引失效 |
| 两条相近耗时相加 ≈ 接口总耗时 | 同一 CTE 跑了两次（list + count） |
| 保存随选中条数线性变慢 | 循环内逐条 `TOP 1` 取价（N+1） |
| 关键字搜索反而更快 | 过滤后行数变少（仍应优化结构） |

可用 `mssql_describe_table` / `get_table_schema` 看行数级；**不改库表**。

### 5. 方案 + 方案测时

至少 **2 个方案**（推荐其一），每个方案包含：

- **改什么**（大白话，附 `server/xxx.js` 函数名）
- **不动什么**（业务结果、字段含义不变）
- **风险**（是否需索引——涉及 DDL 须单独征得用户确认，见 `.cursorrules`）
- **方案测时**：在 Ask 阶段用**草稿 SQL** 在库上实测（仍遵守 30s 规则）

方案表述模板：

```markdown
## 方案 A（推荐）
- 改动：JOIN/WHERE 直比字段；列表 SQL 加 `COUNT(1) OVER()` 去掉重复 COUNT；取价改 `IN` + `ROW_NUMBER` 批量一条
- 预期：Q1 ~2s，Q3 ~100ms（以下为实测）
- 实测：Q1 1980ms | Q3 118ms | Q2 不再需要

## 方案 B
- 改动：加覆盖索引 …（需 DDL，须你先确认）
- 实测：（未测 / >30s）
```

**方案测时也要报数字**；某方案草稿 SQL 超 30s 则标 `>30s`，不得谎称可行。

### 6. 定稿闸门（禁止擅自改代码）

分析回复末尾固定包含：

```markdown
---
**请你拍板：** 回复 `按定稿实现 + 方案A`（或 B）后我才改代码。
未收到口令前：只输出分析与方案，不写 patch。
```

与 ask-then-execute **重档**一致：动 SQL 逻辑、可能跨模块 → 须明确方案字母。

### 7. 实现（Execute）

用户口令后：

1. 按选定方案改代码
2. 补/改 `server/*.test.mjs`
3. 复跑 `profile-query.mjs` 对比前后
4. 更新模块 `README.md`；若映射变了则同步 `docs/sql/database_map.md`
5. 提醒用户手动重启 API（`.cursorrules` §16）

## 回复格式（给用户）

```markdown
## 场景
[用户操作 + API]

## 基线测时（超时上限 30s/条）
| 编号 | 场景 | 耗时 | 备注 |
|------|------|------|------|
| Q1 | … | 2680ms | |
| Q3 | … | >30s（已中止） | 疑似 N+1，已停止 Q4 |

## 诊断
[2–4 句大白话]

## 方案
### 方案 A（推荐）
… + **方案实测耗时表**

### 方案 B
…

---
请你拍板：…
```

## 辅助脚本

| 文件 | 用途 |
|------|------|
| [`scripts/profile-query.mjs`](scripts/profile-query.mjs) | 单条 SQL 测时，默认 30s 超时 |
| [`examples.md`](examples.md) | 出库「其他出库批量选材」实测样例 |

## 与 diagnosing-bugs Skill 的分工

- **diagnosing-bugs**：通用 bug/性能，先建可重复反馈环
- **本 Skill**：聚焦 **SQL Server 慢查询**，强制连库计时 + 30s 中止 + 方案实测 + 定稿闸门
