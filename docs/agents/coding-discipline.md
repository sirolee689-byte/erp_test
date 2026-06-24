# 写码纪律（coding discipline）

来源：[andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills) 的 `CLAUDE.md`，已与 ERP 项目约定合并。**琐碎任务可酌情放宽。**

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

---

## 本项目 override（优先于上文的泛化表述）

1. **测试**：以 issue / PRD / `npm run test:*` 清单为准；**未要求不新增**单元测试或大范围集成测试。
2. **大需求**：先对齐定稿（`ask-then-execute`、`.scratch` PRD）再动代码；小修小补不必反复盘问。
3. **标准件模块**：用户明确要求「按标准件/采购报价式」时，权限、审计、回收站等属于**范围内**实现，不算擅自加功能。
4. **沟通与注释**：全中文、业务注释规则见 [`.cursorrules`](../../.cursorrules) §1；勿与 User Rules 重复维护同一句话。
5. **后端变更**：修改 `server/**` 或 `apiPermissionGate.js` 后，只提醒用户按 [`.cursorrules`](../../.cursorrules) §16 手动重启 API；Agent 不执行 `taskkill`、不查端口/PID、不运行 `npm run dev:server`、不贴启动指纹，也不得断言「后端已生效」。

---

**生效标准：** diff 更少无关改动、少因过度设计返工、澄清问题出现在实现之前而非之后。
