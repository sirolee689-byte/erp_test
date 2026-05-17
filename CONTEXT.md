# CONTEXT.md — ERP 系统共享语言

> 本文件是 AI 助手进入本项目的第一份必读文档。
> 内容只记录已实现的模块与已确认的业务规则。
> 每次完成新功能后由 AI 通过 /grill-with-docs 自动更新。

---

## 一、项目概述

本系统是一套面向**皮包/书包制造业**的内部 ERP。

---

## 二、技术栈

- 前端：Vue 3 (Composition API) + Element Plus + Vite
- 后端：Node.js + Express（ESM 模式）
- 数据库：SQL Server 2008 R2（mssql 驱动）
- 工单追踪：本地 .scratch/<feature>/ Markdown 文件
- 架构决策：docs/adr/

---

## 三、通用字段约定

### 审计字段（所有业务表必须包含）
| 字段 | 说明 |
|---|---|
| uid | 操作人ID |
| uname | 操作人账号 |
| utruename | 操作人真实姓名 |
| addtime | 录入时间（nvarchar业务时间串）|
| edittime | 修改时间（nvarchar业务时间串）|
| deltime | 删除时间（nvarchar业务时间串）|

### 状态位约定
| 字段 | 值 | 含义 |
|---|---|---|
| pass | '0' | 未审核（草稿，可编辑删除）|
| pass | '1' | 已审核（锁定，禁止编辑删除）|
| del | '0' | 正常在册 |
| del | '1' | 已逻辑删除 |
| Sys_Users.del | '0'或空 | 账号启用，可登录 |
| Sys_Users.del | '1' | 账号禁用，不可登录 |

> 前后端传递审核状态统一使用 pass 作为键名，禁止用 status 或 isAudited。

---

## 四、BOM资料

### 术语（主从）

| 概念 | 物理表 | 说明 |
|---|---|---|
| **BOM 主档** | bom_000 | 一个成品/半成品物料的主数据与价格等单位信息 |
| **配件明细** | Bom_parts | 挂在某一 BOM 主档下的子物料行；一行 = 父 BOM 下的一个子件 |

**关联键（配件明细行）**

| 列 | 含义 |
|---|---|
| kcac01 | 父 BOM 主档的 **systemcode**（不是父的 kcaa01 编码） |
| kcaa01 | 子件 **物料编码**（对应 bom_000.kcaa01） |
| kcac02 | 若子件本身也是 BOM，为其子 BOM 主档的 **systemcode**（无子档时可空或保留行内原值） |

### 配件明细（Bom_parts）

物理表：Bom_parts（可通过环境变量 `INV_BOM_PARTS_TABLE` 覆盖，默认 Bom_parts）

**审核与删除**

- 配件明细**无独立审核**；能否编辑整表由**父 BOM 主档**的 `pass` 决定（`pass='1'` 已审 → 配件 Tab 只读）。
- 行级仅有 `del`：软删单行后该行只读；GET 仍返回 `del=1` 行（与主档回收站分离，不在配件 Tab 做「回收站」流程）。
- 在册判定与主档一致：`del` 为空、`'0'` 或数值 0 视为在册。

**明细字段映射（配件 Tab）**

| 界面 Label | 数据库列 | 必填 | 说明 |
|---|---|---|---|
| 编码 | kcaa01 | 是 | 子件物料编码；展示优先取在册 `bom_000` 同编码主档 |
| 名称 | kcaa02 | 否 | 同上关联优先 |
| 规格 | kcaa03 | 否 | 同上 |
| 颜色 | kcaa11 | 否 | 同上 |
| 单位 | kcaa04 | 否 | 同上 |
| 单位用量 | kcac04 | 是 | 数值，最多 6 位小数 |
| 损耗率(%) | kcac05 | 否 | 见下「用量计算」 |
| 用量合计 | kcac06 | 否 | 见下「用量计算」；库无此列时不落库 |
| 单价 | cost_price | 否 | 数值，界面常用 4 位小数 |
| 成本合计 | — | — | **仅界面**：`用量合计 × 单价`，无物理列 |
| 备注 | remark | 否 | |
| （排序） | Seq | 否 | 列表排序用，界面常不显式编辑 |

**用量计算**

- **用量合计**：`kcac06 = kcac04 × (1 + kcac05)`；保存时写入库（存在 `kcac06` 列时）。
- **损耗率**：界面按**百分比**编辑（如 `5` 表示 5%）；库内 `kcac05` 存**小数**（5% → `0.05`）。
- **纸格导入例外**：裁片（CUT）子行可将 `kcac05`、`kcac06` 写为 **NULL**（与手工维护行不同）；若 Excel 提供合计列且可解析，可直写 `kcac06`。

**与子件主档同步（GET 展示 + 保存写回）**

- 关联键：明细行 **`kcaa01`** = 子件物料编码 → 匹配 **`bom_000` 在册**行（`del` 空/`0`），取 **`TOP 1 ORDER BY id DESC`**（与 GET 配件列表展示规则一致）。
- **GET**：`kcaa01` / `kcaa02` / `kcaa03` / `kcaa11` 优先展示主档值；无匹配则用明细表原列。
- **保存（PUT 配件 / 纸格落库）**：在 `id` + `kcac01`（父 `systemcode`）双重锁定下 UPDATE；将表中存在的 **`kcaa01`～`kcaa35`**、**`kcac02`**（及若有 **`systemcode`** 列，同为子 BOM 的 `systemcode`）从子件主档写回明细。
- **仍以请求为准**（不被主档覆盖）：`kcac04`、`kcac05`、`kcac06`（若落库）、`cost_price`、`remark`、`Seq`。
- **无子档 BOM 时兜底**：`kcaa02` / `kcaa03` / `kcaa04` / `kcaa11` 可用请求体；其余 `kcaa` 列保持行内原值（避免清空历史扩展字段）。
- **新增行**：先 `INSERT` 得 `id`，再执行同一套同步 UPDATE。

### BOM 主档（bom_000）

物理表：bom_000（可通过环境变量 INV_BOM_MASTER_TABLE 覆盖，代码中不硬编码表名）

### 主档字段映射
| 界面Label | 数据库列 | 必填 |
|---|---|---|
| 编码 | kcaa01 | 是 |
| 名称 | kcaa02 | 是 |
| 英文名称 | kcaa02_en | 否 |
| 开票名称 | kpname | 否 |
| 规格 | kcaa03 | 否 |
| 颜色 | kcaa11 | 否 |
| 分类 | kcaa05 | 是 |
| 组别 | kcaa10 | 否 |
| 产地 | location | 否 |
| 客户款号 | kcaa06 | 否 |
| 工厂款号 | kcaa09 | 否 |
| 使用单位 | kcaa04 | 是 |
| 采购单位 | kcaa25 | 是 |
| 报价单位 | kcaa29 | 否 |
| 采购价格 | cost_price | 否 |
| BOM价格 | sale_price | 否 |
| 币别 | kcaa35 | 否 |
| 报价损耗 | kcaa32 | 否 |
| 物价损耗 | kcaa33 | 否 |
| 小数点配置 | [decimal] | 否 |
| 备注 | remark | 否 |

### 业务标记（0/1，界面只读复选框）
| 界面Label | 数据库列 |
|---|---|
| 采购 | kcaa12 |
| 外协 | kcaa13 |
| 自产 | kcaa14 |
| 生产车间 | kcaa15 |
| 客供 | Customer_supply（1=是，2=否）|

> kcaa16 在「BOM基础资料」弹窗中明确不展示。

### 单位转换
来源表：Bom_unit_change（字段：unit_name、unit_name_tow、change_bl）
- 采购/报价单位 ↔ 使用单位，可选两种转换方向
- 转换率只读，未匹配时显示「—」

---

## 五、已知设计取舍

| 决策 | 内容 |
|---|---|
| BOM表名可配置 | 主档 `INV_BOM_MASTER_TABLE`、明细 `INV_BOM_PARTS_TABLE`，默认 bom_000 / Bom_parts |
| 纸格解析文件冻结 | server/paperPatternImportParse.js 非明确需求禁止修改 |
| 库存流水只增不改 | 只允许 INSERT，保证历史可追溯 |

---

<!-- 以下章节由 AI 随开发进度自动补充 -->