# Triage labels（分诊标签）

本仓库 issue 若走分诊流程，五类角色与 **默认标签字符串**（与角色名一致）：

| 角色 | 默认标签 | 含义 |
|------|----------|------|
| needs-triage | `needs-triage` | 维护者待评估 |
| needs-info | `needs-info` | 等待报告人补充信息 |
| ready-for-agent | `ready-for-agent` | 已写清，可交给 AFK Agent |
| ready-for-human | `ready-for-human` | 需人工实现 |
| wontfix | `wontfix` | 不做 |

若实际使用不同名称，在此表增加「本项目映射」列，并告知使用 `triage` skill 的 Agent。

## 相关 skill

- `triage`（`.agents/skills/`）
