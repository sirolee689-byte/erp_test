# 写码纪律（coding discipline）

来源：[andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills) 四条行为准则的**仓库内唯一全文**（原 `.cursor/rules/karpathy-guidelines.mdc` 已移除，勿再维护副本）。**琐碎任务可酌情放宽。**
---

## 1. 先想清楚再写（Think Before Coding）

- 明确写出假设；不确定就问。
- 多种理解并存时列出来，不要静默选一种。
- 有更简单做法要说；该反对时要反对。
- 说不清就先停，点名困惑点再要澄清。

## 2. 简单优先（Simplicity First）

- 不做需求外的功能。
- 不为只用一次的场景抽象。
- 不加未要求的「灵活性/可配置」。
- 不为不可能发生的场景堆错误处理。
- 200 行能写成 50 行就重写。

## 3. 手术式修改（Surgical Changes）

- 不顺手「整理」相邻代码、注释、格式。
- 不重构没坏的东西；风格跟现有代码走。
- 发现无关死代码：**提及**，不擅自删。
- **本次改动**产生的无用 import/变量/函数要删。
- 检验：每一行改动都能对应到用户本次请求。

## 4. 目标驱动（Goal-Driven Execution）

- 把任务变成可验证目标（修 bug → 先复现再修；重构 → 前后测试仍过）。
- 多步任务先列简短计划与每步验收点。

## 5. 热路径先量后写（SQL / 列表接口）

**适用：** 新建或改动「分页列表、批量选单、保存前批量取价」等**会扫 legacy 大表**的后端 SQL；极简单表 CRUD 可跳过。

**触发条件（满足任一即适用）：** 分页列表 / 批量弹窗 / 循环查库；或 JOIN 3+ 张业务大表；或用户提到慢、加载、耗时。

**写 SQL 前自检（必须过一遍）：**

| 检查项 | 禁止默认写法 | 优先写法（仓库内已有范例） |
|--------|--------------|----------------------------|
| 分页总数 | 同一重型 CTE 再跑一遍 `COUNT` | 列表 SQL 内 `COUNT(1) OVER ()` 一次带回；仅「翻页超出且无行」再兜底 count |
| 行级汇总字段 | `SELECT` 里关联子查询 / `OUTER APPLY` 逐行聚合 | `WITH … GROUP BY` 预聚合 + `LEFT JOIN` |
| 关联条件 | `JOIN`/`WHERE` 对列包 `LTRIM/RTRIM/CONVERT` | 关联键直比字段；清洗放 `SELECT` 展示层 |
| 保存/批量 | 循环内逐条 `query`（N+1） | `IN` + `ROW_NUMBER` 或单次 `GROUP BY` 批量查 |

**实现前：** 在 `server/` 搜同类已优化模块（如 `stockOutOtherBatchAdd.js`、`buyOrderBatchAdd.js`、`stockOutHandlers.js` 外协选单），**对齐写法再写**，不要从零发明「count + list 双查 + 子查询」模板。

**档位：**

- **轻档**：过自检表 + 对齐已有范例即可。
- **中/重档**（批量选单、跨 3+ legacy 表）：须先 profile 或引用同模块已测耗时，再动 SQL；走 [`.cursor/skills/sql-performance-profile`](../../.cursor/skills/sql-performance-profile/SKILL.md)（连库测时、方案字母、**定稿后再改**；单条探测上限 30s）。

**文档：** 模块 `README.md` 若接口含 CTE/多表 JOIN，须记录是否已做 count 合并 / 预聚合（未做则标「待优化」）。

**与 §2「简单优先」关系：** 热路径上「跑得动」优先于「代码行数少」；简单写法若触发上表任一禁止项，须换写法或写明为何数据量可忽略。

---

## 本项目 override（优先于上文的泛化表述）

1. **测试**：以 issue / PRD / `npm run test:*` 清单为准；**未要求不新增**单元测试或大范围集成测试。
2. **大需求**：先对齐定稿（`ask-then-execute` **重档**完整定稿、`.scratch` PRD）再动代码；**轻档**小修小补不必反复盘问；**中档**用轻量定稿即可。档位定义见 `.agents/skills/ask-then-execute` §A。
3. **标准件模块**：用户明确要求「按标准件/采购报价式」时，权限、审计、回收站等属于**范围内**实现，不算擅自加功能。
4. **沟通与注释**：全中文、业务注释规则见 [`.cursorrules`](../../.cursorrules) §1；勿与 User Rules 重复维护同一句话。
5. **界面数值展示**：数量/单价/金额等**展示**须四舍五入后去掉末尾无意义的 0（如 `80.000→80`、`54.540→54.54`）；单源 [`src/utils/erpNumberDisplay.js`](../../src/utils/erpNumberDisplay.js)，细则见 [`.cursor/rules/erp-number-display.mdc`](../../.cursor/rules/erp-number-display.mdc)。
6. **后端变更**：见 [`.cursorrules`](../../.cursorrules) §14（单源；此处不重复禁止项与命令）。

---

**生效标准：** diff 更少无关改动、少因过度设计返工、澄清问题出现在实现之前而非之后；列表/批量 SQL 不默认双查 CTE、不默认逐行子查询。
