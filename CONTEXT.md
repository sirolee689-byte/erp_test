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

### 审计字段（业务表：bom_000、Bom_parts、颜色编码等）

记录**本条业务数据**的录入/修改人，与 `Sys_Users` 上「创建人」列不是同一套语义。

| 字段 | 说明 | 与 Sys_Users 的对应 |
|---|---|---|
| uid | 当前操作人 ID | `UserID` |
| uname | 当前操作人**登录账号** | 写入值应对 **`usercode`**（勿读 `Sys_Users.uname`） |
| utruename | 当前操作人**真实姓名** | 写入值应对 **`truename`**（用当前登录 `usercode` 查库，禁止用令牌显示名或 `Sys_Users.name`） |
| addtime | 录入时间（nvarchar 业务时间串） | — |
| edittime | 修改时间 | — |
| deltime | 删除时间 | — |

**修改人（仅部分主档 UPDATE）**：`bom_000.uptruename` = 保存时当前操作人的 **`truename`**（同样按登录 **`usercode`** 查库）。

> 查真实姓名：只用登录 **`usercode`** 精确匹配 `Sys_Users.usercode` → 取 `truename`。与 `Sys_Users.uname`（创建人姓名）无关。

### 操作员表 Sys_Users（列名勿与业务表审计列混用）

| 列 / 概念 | 说明 |
|---|---|
| **usercode** | 本账号**登录账号**（操作人账号）；全表唯一；与 `username` 同步 |
| **truename** | 本账号**真实姓名**（界面「姓名」） |
| **uname** | **创建本账号的人**的 **`truename`**（创建人真实姓名，不是登录账号） |
| **utruename** | （若库中存在）与操作员模块审计约定一致；**不等于**业务表里的「操作人真实姓名」列语义，以操作员模块实现为准 |

**登录**：令牌中的 `userCode` 来自 `Sys_Users.usercode`；业务表审计写 `uname` / `utruename` 时应对 `usercode` / `truename`，不得把 `Sys_Users.uname` 当成当前登录账号。

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

### 操作员（Sys_Users）

| 概念 | 说明 |
|---|---|
| **新增操作员** | 管理员只填登录账号、姓名、角色；**不在表单录入初始密码** |
| **初始密码** | 系统固定为 `123`，**一律 bcrypt** 写入 `password`；列宽不足时 API **自动扩列**至 `NVARCHAR(200)`（亦可用 `docs/sql/sys_users_password_widen.sql`）；**不限制**用户设置的多长明文密码；`is_first_login=1` 表示须首次登录改密 |
| **列表** | 在册默认 `del=0` 且 `pass=1`；可开关查 `pass=0`；禁用为 `del=1`，默认列表不显示 |
| **登录账号** | 对应 **`Sys_Users.usercode`**，全表唯一；冲突提示「登录账号「xxx」已存在，请更换」；保存时与 `username` 同步 |
| **编辑操作员** | **本模块已审核（pass=1）仍可编辑**（例外于全局已审锁）；密码框留空表示不修改密码 |

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

**主档一键更新（列表「一键更新」）**

- 入口：BOM 资料列表行操作；`POST /api/inventory/bom/propagate-master`，body `{ systemcode }`；权限 `inv/bom` **edit**。
- 按主档 **systemcode** 取在册 `bom_000` 最新行，以其 **kcaa01** 精确匹配（非 `LIKE`）全库 **`Bom_parts`** 与 **`bom_cost`** 中 `kcaa01` 相同的在册行，批量 UPDATE 基础字段（含 `kcaa02`/`kcaa03` 名称规格；`bom_cost` 另含与运算补全一致的扩展列）。
- **不改**：`kcac04`～`kcac06` 等用量、`top_kcaa*`、不触发 `POST /api/bom/usage-calc`。
- 审计：`[一键更新]物料编码：[…]，同步配件明细 N 条、成本运算缓存 M 条…`。

**列表一键运算**

- 入口：BOM 资料列表「一键运算」；复用 `POST /api/bom/usage-calc`（与详情「BOM用量表运算」相同；`hidePrefixes` 取列表页配置）。
- **未运算**：首次写入 `bom_cost`；**已运算**：确认后覆盖重算；**不需运算**：按钮禁用。
- 成功后自动打开详情并切到 **「成本BOM用量表」** Tab，并刷新列表运算/成本列。

**纸格导入扩展列**（库存配件 Tab 不展示；列存在才写入）

| 列 | 典型取值 / 来源 | 说明 |
|---|---|---|
| `type` | 缺省 `1` | 行类型标记；未传时 INSERT 默认 1 |
| `version` | `100` | 纸格批次版本常量 |
| `pass` | `'1'` | **仅纸格落库**：明细行默认已审；库存界面仍以**父 BOM `pass`** 控制能否编辑，不读明细 `pass` |
| `remark` | CUT：`纸格系统导入`；辅料：子件主档 `remark`；物料：Excel 备注 | CUT 固定文案见常量 |
| `Describe` | Excel「搭配」 | CUT/物料：本行搭配为空时，同步同主段号（如 `4-1`→`4`）下首条非空搭配 |
| `kcac03` | 子件主档 `kcaa04`（使用单位） | CUT 预览行固定写 `张`；辅料/物料写主档单位 |
| `sale_price` | 辅料：子件 `bom_000.sale_price` | 无效/空写 **NULL**（不写 0） |
| `cost_price` | 辅料：子件 `bom_000.cost_price` | 同上；CUT 预览行 **NULL**（`nullPrices`） |
| `kcaa02_en` / `location` | 辅料：从子件主档抄入 | 列存在时 UPDATE |

**纸格落库三类行**（均 `kcac01` = 对应父 BOM 的 `systemcode`）

| 行别 | 父 BOM | `kcaa01` | 用量要点 |
|---|---|---|---|
| CUT 预览 | 主款 `systemcode` | 裁片 BOM 编码 | `kcac04`=CUT 数量；`kcac05`/`kcac06`= **NULL**；`Seq`=0 |
| 辅料 Accessory | 主款 | ERP 辅料编码 | `kcac04`/`kcac05`/`kcac06` 来自 Excel E/H/I；I 空则 `kcac06` 按公式；`Seq` 自 1 递增 |
| 分组物料 Material | 各 CUT 子 BOM `systemcode` | 物料编码 | `kcac04`=该 CUT「单位用量」；`kcac05`=Excel 损耗或主档 `kcaa33`；`Seq`=**纸格 Material 列表全局序号**（同编码取首次出现，与导入页列表顺序一致；供成本 BOM 用量表排序） |

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

## 五、纸格资料（paper-pattern）

### 菜单

| 路径 | 页面 |
|---|---|
| `paper-pattern/import/manage` | 管理纸格导入资料（`System_uplod_file` 查询） |
| `paper-pattern/import` | 纸格资料导入（Excel 解析、智能校验、正式导入） |

- **是否清仓单**（导入页，与导入类型共用）：默认否。选「是」时仅主 BOM / CUT 的 `bom_000.kcaa01` 及主 BOM 下 CUT 子件 `bom_parts.kcaa01` 在颜色段末尾固定加 `-OUT`（例 `BAG-…/R-TEST` → `BAG-…/R-TEST-OUT`；`commit-bom000` 传 `clearanceOrder: true`）。Material/Accessory 物料全码与其余字段不变。

### 文件磁盘路径（`.env`）

| 变量 | 说明 | 默认（本地测试） |
|---|---|---|
| `PAPER_PATTERN_UPLOAD_DIR` | 导入页 `POST /api/paper-pattern/import/upload` 落盘目录 | `C:\Users\it_manager\Desktop\纸格测试资料\upload` |
| `PAPER_PATTERN_DOWNLOAD_ROOT` | 管理页下载时与 `System_uplod_file.filepath`/`filename` 拼接的根目录 | 同上 |
| `SYSTEM_UPLOAD_FILE_TABLE` | 管理列表物理表名 | `System_uplod_file` |

- 下载解析：取 `filepath`/`filename` 的**文件名段**，再与 `PAPER_PATTERN_DOWNLOAD_ROOT` 安全拼接（禁止目录穿越）。
- 上线：仅需改 `.env` 为服务器共享路径，重启 API。

### `System_uplod_file`（管理列表只读）

| 列 | 用途 |
|---|---|
| `truename` | 登记快照；列表「上传者」展示优先 `Sys_Users.truename`（按 `uid` 关联，无匹配时回退本列） |
| `addtime` | 上传时间 `nvarchar`（展示/搜索） |
| `truefilename` | 用户上传原始文件名（展示/搜索） |
| `filename` | 服务器存储文件名（下载候选） |
| `filepath` | 相对路径，如 `\ub_bom\upload\*.xls`；列表范围 `filepath` 含 `ub_bom` |
| `filesize` | 字节，`nvarchar`；界面展示为四舍五入 **KB**；可按字节或 KB 模糊搜索 |

- 接口：`GET /api/paper-pattern/import/files/list`（`queryAll=1` 或 `keyword`；分页默认 20）；`GET /api/paper-pattern/import/files/download?id=`（按 `id` 流式下载，保存名为库字段 `filename`，如 `20260519155801.xls`）。
- **正式导入成功**（`POST /api/paper-pattern/import/commit-bom000`）在同一事务写入本表：`filename` = 正式导入时刻 `YYYYMMDDHHmmss` + 扩展名；`truefilename` = 用户原始名（可重复）；`filepath` = `\ub_bom\upload\{filename}`。仅上传/解析不写本表。

---

## 六、已知设计取舍

| 决策 | 内容 |
|---|---|
| BOM表名可配置 | 主档 `INV_BOM_MASTER_TABLE`、明细 `INV_BOM_PARTS_TABLE`，默认 bom_000 / Bom_parts |
| 纸格解析文件冻结 | server/paperPatternImportParse.js 非明确需求禁止修改 |
| 库存流水只增不改 | 只允许 INSERT，保证历史可追溯 |

---

<!-- 以下章节由 AI 随开发进度自动补充 -->