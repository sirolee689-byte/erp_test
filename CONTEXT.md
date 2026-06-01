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
| uname | 当前操作人**登录账号列** | `UserName`（物理列常为 `username`；**不是** `usercode`、**不是** `Sys_Users.uname` 创建人列） |
| utruename | 当前操作人**真实姓名** | `truename`（按当前登录 `usercode` 查库；禁止用工牌显示名 / 令牌 `userName`） |
| addtime | 录入时间（nvarchar 业务时间串） | — |
| edittime | 修改时间 | — |
| deltime | 删除时间 | — |

**修改人（仅部分主档 UPDATE）**：`bom_000.uptruename` = 保存时当前操作人的 **`truename`**（同样按登录 **`usercode`** 查库）。

> 实现：`server/businessAuditFields.js` 的 `getActorAuditTripletFromReq`（令牌）与 `resolveActorAuditTripletFromReq`（按 `usercode` 查库覆盖）。登录令牌另存 `auditUserName` / `auditTruename`，界面显示名仍用 `userName`（可含人事 `StaffDisplayName`）。
> 经典易错点：勿把 **`usercode`** 写入业务表 `uname`；勿把 **`Sys_Users.uname`**（创建人姓名）当成当前操作人；`utruename` 必须落 **`truename`**。

### 操作员表 Sys_Users（列名勿与业务表审计列混用）

| 列 / 概念 | 说明 |
|---|---|
| **usercode** | 本账号**登录账号**（操作人账号）；全表唯一；与 `username` 同步 |
| **truename** | 本账号**真实姓名**（界面「姓名」） |
| **uname** | **创建本账号的人**的 **`truename`**（创建人真实姓名，不是登录账号） |
| **utruename** | （若库中存在）与操作员模块审计约定一致；**不等于**业务表里的「操作人真实姓名」列语义，以操作员模块实现为准 |

**登录**：令牌 `userCode` = `usercode`；业务表 `uname` / `utruename` 应对 `UserName` / `truename`（查库键仍为 `usercode`）。

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

## 七、销售订单

**订单**：主表 `UB_ERP_Sales_order`、明细 `UB_ERP_Sales_order_list`。  
**PI 专用 BOM**（与主 BOM `bom_000` / `Bom_parts` 分离，按单可改）：头 `UB_ERP_Bom_Sales`、配件行 `UB_ERP_Bom_Sales_list`。  
**一键运算结果（物料单，全系统订料口径）**：明细 `UB_ERP_Bom_pi_cost`、汇总 `UB_ERP_Bom_pi_consumption`（仅 **已运算** 有效；仓库/采购/出入库依此订料）。  
主数据：`bom_000`；币别 `bom_currency`（人民币/美元/欧元/港元）。

### 术语

| 概念 | 说明 | Avoid |
|---|---|---|
| **PI 号** | 用户手填业务单号（如 `PI-0001`）；订单主从、PI BOM、物料单结果的关联键；**全表唯一**（含已软删） | 系统单号 |
| **系统单号** | 首次保存生成 `PI-YYYYMMDD-XXX`；仅展示/检索；`XXX` 为销售日期当日 3 位流水 | 与 PI 号混称「单号」 |
| **销售订单明细** | 订货行：`kcaa01` + **订货数量**；来自 `bom_000` 展示快照 | 销售 BOM 配件行 |
| **货品编码** | `bom_000.kcaa01`；明细合并键 | systemcode（合并不用） |
| **主 BOM** | `bom_000` + `Bom_parts`；库存标准 BOM 资料 | PI 销售 BOM |
| **销售 BOM（PI BOM）** | `UB_ERP_Bom_Sales`（**一行成品 BOM 头**）+ `UB_ERP_Bom_Sales_list`（**该头下全部子编码/配件**，关联方式同 `Bom_parts`）；**本 PI 可改**，与主 BOM 独立 | 主 BOM、物料单结果表 |
| **同步 BOM** | 销售明细 Tab「操作」**手动**触发：将**指定明细行**对应成品从 **主 BOM** 拉到本 PI 的 `UB_ERP_Bom_Sales*`；**不点则维持 PI 内原样** | 保存、一键运算 |
| **一键运算** | 在 **PI 销售 BOM** 上做与 BOM 资料 **成本运算用量表** 同类运算；结果写入 `UB_ERP_Bom_pi_cost` / `UB_ERP_Bom_pi_consumption`；**不乘订货数量** | 保存、同步 BOM |
| **物料单（运算结果）** | 仅 **一键运算之后** 写入 `UB_ERP_Bom_pi_cost` / `UB_ERP_Bom_pi_consumption`；**仓库、采购、出入库等全系统订料口径** | 销售 BOM 配件表 |
| **订货数量** | 仅存订单明细；**不参与** 运算写入；备料展示 **用量 × 订货数量**（按款） | 结构用量 |
| **运算状态** | 主表概念：**已运算** / **未运算**（列名实现探测，如 `isok`）；**未运算** 时物料单无效，**禁止** 下游引用 | 审核 pass |

### 关系

- 一张 **PI** → 订单主从 + **每款成品一行** `UB_ERP_Bom_Sales`（`kcaa01`）+ 该头下全部 `UB_ERP_Bom_Sales_list`（子编码，展开最多 **4 层**）。
- **保存** 后订单明细的 `kcaa01` 集合必须与 `UB_ERP_Bom_Sales` **一致**（见保存流水线「PI BOM 对齐」）：删明细则 **删掉该款头及其 list 全部行**；仍在单上的款 **不得** 被主 BOM 偷偷改内容。
- **主 BOM → PI BOM** 仅允许在 **主 BOM 门禁**（下节）三种情况；**一键运算** 只读 **PI BOM** 写物料单，**禁止** 运算时从主 BOM 覆盖已在单上的款。
- **物料单** 仅在 **已运算** 时有效；**改明细货品行** 或 **仅改订货数量** → **未运算**，须再 **一键运算** 按当前明细 **重写** 物料单。

### 主 BOM 门禁（已定）

**默认**：凡 **未点「同步 BOM」** 且 **不属于下列例外** 的操作（含保存、一键运算），**禁止** 用 `bom_000` / `Bom_parts` 覆盖该款已有 PI BOM 内容。

| 允许从主 BOM 写入该款 `UB_ERP_Bom_Sales*` | 条件 |
|---|---|
| **同步 BOM** | 用户在销售明细 Tab「操作」**按行**点击 |
| **例外 1** | 该 `kcaa01` 曾从本单明细 **删掉**，后又 **加回同一货品编码**（视为新款，从主 BOM 重建） |
| **例外 2** | 该 `kcaa01` **第一次** 出现在本 PI 订单明细中（从主 BOM 建立该款头+子件） |

**不在例外内**的款：PI 内自改用量（如 `0.1→0.2`）**一直保持**，直到用户 **同步 BOM** 或删行后同码再加。

### 运算状态与物料单（已定）

- **已运算**：存在与当前订单一致的有效 `pi_cost` / `pi_consumption`；仓库、采购、出入库 **可依此订料**。
- **未运算**：无有效物料单，或曾因改单失效；**禁止** 下游按旧物料单订料。
- 下列操作后订单 → **未运算**（实现上标记主表并视需求清空或忽略旧 `pi_*` 行）：
  - 明细 **增 / 删 / 换** 货品编码（保存后 PI BOM 已对齐）；
  - **仅改订货数量**（数量变，备料总量变）；
  - 对某行执行 **同步 BOM**（PI BOM 已变，须重算物料单）。
- **一键运算**（订单 **未运算**）：按 **当前明细全部在单款**，基于各款 **PI BOM** **重写整单** `pi_cost` / `pi_consumption`。
- **一键运算**（订单 **已运算** 且仅 **部分款同步 BOM** 后）：**只重算本次同步过的款** 的 `pi_*`；**其它款** 不动。

### 保存（提交）流水线（已定）

**提交** = 对 `pass='0'` 订单 **保存**（非审核按钮）。同一事务建议顺序：

1. **校验**（见「提交校验」）
2. **主表**：新增录 **PI 号** + **系统单号**；编辑不改 PI 号/系统单号
3. **订单明细**：合并同 PI + 同 `kcaa01`；写入 `UB_ERP_Sales_order_list`（按 PI **先删旧行再插新行**，整单重写）
4. **PI BOM 对齐**（**禁止** 整 PI `DELETE` 再插；**按款**处理）：
   - **删款**：明细中已不存在的 `kcaa01` → **物理删除** `UB_ERP_Bom_Sales` 该行，及该头下 **全部** `UB_ERP_Bom_Sales_list`（例：PI-TEST 原 TEST1+TEST2，删 TEST1 保存后只剩 TEST2 一头，TEST1 的 list 全删）
   - **仍在单上的款**：**不** 用主 BOM 改其子件/用量（无同步、非例外则不动）
   - **新款入单**（例外 1 或 2）：明细出现尚无 PI BOM 头的 `kcaa01` → **从主 BOM 建立** 该款 `UB_ERP_Bom_Sales` + `_list`（展开规则同 BOM 资料，深度 ≤ 4）
5. **运算状态**：若本次保存变更了明细 `kcaa01` 集合或 **订货数量** → 主表标 **未运算**

**不** 在保存时写入物料单（`pi_*` 仅 **一键运算** 写入）；**不** 用主 BOM **更新** 已在单上且已有 PI BOM 的款。

**已审核**禁止保存；**反审**后可再保存并按上序对齐。**审核/反审** 只改 `pass` 等，**不** 自动运算。

### 提交校验（已定）

- **PI 号**：必填；**全表唯一**（含回收站 `del='1'` 的行）。软删后 **不可** 复用同一 PI 号；仅 **彻底删除** 订单及该 PI 下全部关联表（含 `UB_ERP_Bom_Sales*`、`UB_ERP_Bom_pi_cost`、`UB_ERP_Bom_pi_consumption`）后方可复用。
- **销售日期**：必填。
- **交货日期**：选填；若填写则 **不得早于销售日期**。
- **明细**：每行 **货品编码**、**订货数量** 必填；数量须为 **> 0** 的数值。
- 明细其它展示字段（名称、规格、颜色、单位等）**只读**，保存时从 `bom_000` 主档带出，**不在界面录入**。

### 销售订单明细行（已定）

| 业务含义 | 明细字段（`UB_ERP_Sales_order_list`） | 规则 |
|---|---|---|
| 关联 PI 号 | `xsak01` | 关联主表 `xsaj01`（PI 号） |
| 行序号 | `seq` | 明细行序号 |
| 货品编码 | `kcaa01` | 必填；合并键（同 PI + 同编码合并） |
| 订货数量 | `xsak03` | 必填、>0；作为订货数量主字段 |
| 计划数量 | `plan_quantity` | 与订货数量同步，`plan_quantity = xsak03` |
| 单价 | `xsak04` | 行单价 |
| 金额 | `xsak05` | `xsak05 = xsak04 × xsak03` |
| 明细备注 | `remark` | 从 `bom_000.remark` 抄快照 |
| 名称/规格/颜色/单位等快照 | `kcaa02`/`kcaa03`/`kcaa11`/`kcaa04` 等 | 保存时从 `bom_000` 抄快照 |

- 兼容键与扩展快照：保存时按明细 `kcaa01` 精确匹配 `bom_000.kcaa01` 的最新在册行；`xsak02` 取 `bom_000.GUID`；`kcac01` 取销售订单主表 `GUID/systemcode`；`kcac02`、`GUID`、`systemcode` 同 `xsak02`；`kcac03` 取 `bom_000.kcaa25`，业务含义为采购单位；`kcaa07/08/11/12/13/14/15/25/26/16/27/28/29/30/31`、`type`、`location`、`pass`、`remark` 均从 `bom_000` 抄快照。若 `bom_000` 或 `UB_ERP_Sales_order_list` 缺少上述字段，保存前直接提示缺哪个字段。
- `xsak06`/`xsak07`/`xsak09` 当前未作为销售订单一期业务主字段使用。
- 保存采用整单重写：按 PI 删除旧明细后写入新明细。
- 旧系统保存后在 `UB_ERP_Sales_order_list` 实际会落一批兼容字段（用于历史兼容/快照对账），当前已确认字段清单：
  - `id`、`xsak01`、`seq`、`xsak02`、`xsak03`、`xsak04`、`xsak05`、`in_tax`、`plan_quantity`
  - `kcac01`、`kcac02`、`kcac03`
  - `GUID`、`kcaa01`、`kcaa02`、`kcaa03`、`kcaa04`、`kcaa05`、`kcaa06`、`kcaa07`、`kcaa08`、`kcaa09`、`kcaa10`、`kcaa11`、`kcaa12`、`kcaa13`、`kcaa14`、`kcaa15`、`kcaa25`、`kcaa26`、`kcaa27`、`kcaa28`、`kcaa29`、`kcaa30`、`kcaa31`
  - `type`、`location`、`version`、`remark`
  - `uid`、`uname`、`utruename`、`del`、`addtime`
  - `systemcode`、`back`、`is_pur`、`pass`、`ip`、`decimal`、`decimal_view`

### 同步 BOM 与一键运算（已定）

| 操作 | 触发 | 数据源 | 行为 |
|---|---|---|---|
| **同步 BOM** | 明细 Tab「操作」，**按行** | **主 BOM** | 覆盖该款 `UB_ERP_Bom_Sales*`；订单 → **未运算** |
| **一键运算** | 用户执行 | **PI BOM**（禁止偷拉主 BOM） | 写 `UB_ERP_Bom_pi_cost`、`UB_ERP_Bom_pi_consumption`；订单 → **已运算** |

**物料单**：`pi_cost` 同 BOM **成本运算用量表**；`pi_consumption` = **`pi_cost` 按子件编码 + 备注** 合并。**运算不写订货数量**；展示/订料时 **× 该款订货数量**。

**运算范围**：

- 订单 **未运算**（改数量、删款、加款保存后等）：一键运算 → 对 **当前明细全部在单款**，按各款 PI BOM **重写整单** 物料单。
- 订单 **已运算** 且仅对个别行 **同步 BOM** 后：一键运算 → **只重算本次同步过的款** 的 `pi_*`；**其它款** 物料单与 PI BOM **禁止改动**。

**业务示例（PI-002，BAG-TEST1、BAG-TEST2）**：PI 内将 TEST2 某子件 `0.1→0.2` 且 **未同步** → 保持 `0.2`；**同步 TEST2** → 主 BOM 盖回（如 `0.1`）并 **未运算**；**一键运算** 只读 PI BOM，不会偷偷用主 BOM。TEST1 未同步则运算时不改其物料单。**删 TEST1 保存** → `UB_ERP_Bom_Sales` 仅余 TEST2，TEST1 的 **list 全删**，整单 **未运算**，须再运算才可供仓库/采购订料。

### PI 销售 BOM 结构（已定）

- `UB_ERP_Bom_Sales`：**一行 = 一款成品**（`kcaa01`），与订单明细款 **一一对应**（保存对齐）。
- `UB_ERP_Bom_Sales_list`：该头下 **全部子编码/配件**（`kcac01` 挂父等，同 `Bom_parts`）。
- **禁止** 整 PI 「先 DELETE 全部再 INSERT」；允许 **按款删除**（明细删款）及 **按款 INSERT**（例外 1/2 从主 BOM 建款）。
- `UB_ERP_Bom_Sales_list` 生成规则（已确认）：
  - 以订单明细成品编码（如 `PQ-3119B1/N`）为起点，围绕该款展开 PI 销售 BOM 子件。
  - 先取该款在 `UB_ERP_Bom_Sales` 的父 GUID（作为首层父键，例如 `PQKCAC01`）。
  - 递归查询 `Bom_parts`：每次按 `Bom_parts.kcac01 = 当前父键` 取出全部子行。
  - 将本轮子行写入 `UB_ERP_Bom_Sales_list` 后，再用这些子行对应子件的 GUID 作为下一轮父键继续查。
  - 直到某一轮查不到子编码（无子行）才停止；最终把整棵子件树全部落入 `UB_ERP_Bom_Sales_list`。
  - `UB_ERP_Bom_Sales_list.sid` 关联 PI 号（=`UB_ERP_Sales_order.xsaj01`）。
  - `UB_ERP_Bom_Sales_list.kcac01` 作为父节点关联键（父节点 `systemcode/GUID`）。
- `UB_ERP_Bom_Sales` 字段口径（已确认）：
  - `sid` 关联 PI 号（=`UB_ERP_Sales_order.xsaj01`）。
  - `kcaa01` 为成品货号；一条记录就是该 PI 下一款成品的 BOM 头。
  - `kcaa02`/`kcaa03`/`kcaa11`/`kcaa04` 等基础信息从 `bom_000` 同步快照。
  - `kcaa07`/`kcaa08`/`kcaa30` 作为 BOM 头价格/损耗快照保存。
  - `sign` 为旧系统状态位，默认 1，当前按兼容字段保留。
  - 审计与状态字段（`uid`/`uname`/`utruename`/`del`/`addtime`/`pass`/`back`/`is_pur`/`ip`）与主表一致，由服务端统一写。
  - `decimal` 沿旧系统口径保存（兼容）。
  - 保存策略按“款”增删改，禁止整 PI 重写。
- 旧系统保存后在 `UB_ERP_Bom_Sales` 实际会落一批兼容字段（用于历史兼容/快照对账），当前已确认字段清单：
  - `id`、`sid`、`GUID`
  - `kcaa01`、`kcaa02`、`kcaa03`、`kcaa04`、`kcaa05`、`kcaa06`、`kcaa07`、`kcaa08`、`kcaa09`、`kcaa10`、`kcaa11`、`kcaa12`、`kcaa13`、`kcaa14`、`kcaa15`、`kcaa25`、`kcaa26`、`kcaa27`、`kcaa28`、`kcaa29`、`kcaa30`、`kcaa31`
  - `type`、`location`、`version`、`remark`、`sign`
  - `uid`、`uname`、`utruename`、`del`、`addtime`
  - `systemcode`、`back`、`is_pur`、`pass`、`decimal`
- 旧系统保存后在 `UB_ERP_Bom_Sales_list` 实际会落一批兼容字段（用于历史兼容/快照对账），当前已确认字段清单：
  - `id`、`sid`
  - `kcac01`、`kcac02`、`kcac03`、`kcac04`、`kcac05`、`kcac06`、`kcac07`、`kcac08`
  - `seq`、`Describe`、`GUID`
  - `kcaa01`、`kcaa02`、`kcaa02_en`、`kcaa03`、`kcaa04`、`kcaa05`、`kcaa06`、`kcaa07`、`kcaa08`、`kcaa09`、`kcaa10`、`kcaa11`、`kcaa12`、`kcaa13`、`kcaa14`、`kcaa15`、`kcaa25`、`kcaa26`、`kcaa27`、`kcaa28`、`kcaa29`、`kcaa30`、`kcaa31`、`kcaa32`、`kcaa33`、`kcaa34`、`kcaa35`
  - `type`、`location`、`sale_price`、`cost_price`、`Customer_supply`、`Customer_Name`、`version`、`remark`
  - `uid`、`uname`、`utruename`、`del`、`addtime`、`edittime`
  - `systemcode`、`intime`、`upname`、`uptruename`
  - `back`、`is_pur`、`pass`
  - `kpname`、`pkcaa01`、`ip`、`syscode`、`decimal`、`decimal_view`、`info`、`seqi`

### 主表头信息（已定）

- **字段口径（仅记录当前实际使用）**：
  | 业务含义 | 主表字段（`UB_ERP_Sales_order`） | 取值规则 |
  |---|---|---|
  | PI 号（业务单号） | `xsaj01` | 手填，保存后不可改；全表唯一（含软删） |
  | 销售日期 | `xsaj02` | 主表日期字段 |
  | 客户编码 | `xsaj05` | 保存 `System_sales_customer.s_code` |
  | 客户名称 | `kehu` | 保存 `System_sales_customer.s_name` 快照 |
  | PO 号 | `xsaj06` | 销售订单 PO 号 |
  | 币别代码 | `xsaj07` | 保存 `bom_currency.id` |
  | 币别名称 | `rmb` | 保存 `bom_currency.cn_name` 快照 |
  | 备注 | `remark` | 头部备注 |
  | 小数位配置 | `decimal` / `decimal_view` | 默认 6（整单金额/单价显示精度预留） |
- **客户规则**：选中客户后同时落两份数据：`xsaj05=s_code`、`kehu=s_name`（例：客户 `7001 PQD` → `xsaj05=7001`，`kehu=PQD`）。保存时客户必须在册（`del` 空/`'0'`）且 **已审核**（`pass='1'`），否则保存失败。
- **币别规则**：下拉读取 `bom_currency`，保存时同时落 `xsaj07=id` 与 `rmb=cn_name` 快照；之后改币别主数据不回写历史订单。
- 另有：销售日期、交货日期、备注。
- **小数点位数**：整单 **金额/单价** 显示与舍入精度（与 `bom_000` 小数位配置同类语义）；**一期无行金额，不参与任何计算**；默认 **6**，可编辑并入库，供后续金额功能沿用。

### 操作人与审计（已定）

与第三节「审计字段」及采购报价一致（**禁止**把 `Sys_Users.uname` 当作当前登录账号）：

| 时机 | 写入（列存在则落库） |
|---|---|
| **新增保存** | `uid`（`UserID`）、`uname`（`UserName`）、`utruename`（`truename`，按 `usercode` 查库）、`addtime` |
| **每次保存（含编辑）** | `edittime`；操作人三列按当前登录态 **覆盖**（与采购报价明细规则一致） |
| **软删** | `del='1'`、`deltime` |
| **审核 / 反审** | `pass`；若表有 `passuid`/`passuname`/`passutruename`/`passtime` 等则写入（实现探测） |
| **客户端 IP** | 请求 IP 写入表内 **IP 列**（列名实现探测，如 `IPAddress`）；**不**单独维护「创建人」中文名列 |

- 明细行、销售 BOM 行：若物理表含 `uid`/`uname`/`utruename`，由 **服务端** 在 INSERT 时写入，**禁止**前端 body 覆盖。

### 审核与生命周期（已定）

与采购报价等主从单据一致，使用全局 **`pass` / `del`** 语义（见第三节）：

| 状态 | pass | del | 行为 |
|---|---|---|---|
| 未审核草稿 | `'0'` | `'0'` | 可编辑；保存写订单主从 + **PI BOM 对齐** + 可能 **未运算**；物料单仅 **一键运算** 产生 |
| 已审核 | `'1'` | `'0'` | **锁定**：禁止编辑主从、禁止软删 |
| 回收站 | 任意 | `'1'` | 列表回收站可见；**恢复**后回到删除前 pass；**彻底删除**仅回收站内 |

- 支持 **审核**、**反审**；反审后可再保存；**不** 自动从主 BOM 改 PI BOM，**不** 自动运算物料单。
- **PI 号** 保存后不可修改（关联键）；要改单号须作废/重做单，不作「改 PI 号连带明细」。
- 新建默认 `pass='0'`、`del='0'`。

### 逻辑删除与彻底删除（已定）

与采购报价一致：

| 操作 | 主表 | 订单明细 | PI BOM / 物料单 |
|---|---|---|---|
| **软删** | `del='1'`（仅未审） | **不改** `del` | **不改** |
| **恢复** | `del='0'` | — | — |
| **彻底删除**（仅回收站、未审） | 物理 DELETE | 按 **PI 号** DELETE | 按 **PI 号** DELETE `UB_ERP_Bom_Sales*`、`UB_ERP_Bom_pi_cost`、`UB_ERP_Bom_pi_consumption` |

- 列表/在册判定以 **主表 `del`** 为准；子表仍绑 **PI 号**，不因主表软删而单独标记删除。
- **已审**禁止软删、禁止彻底删（须先反审）。

### Example dialogue

> **Dev：** 改 PI 号后明细要不要跟着改外键？  
> **业务：** 不行，PI 号就是关联键，保存后不应改；要改就作废重做单。  
> **Dev：** 列表上 `PI-20260524-001` 和 `PI-0001` 各是什么？  
> **业务：** `PI-0001` 是 PI 号；`PI-20260524-001` 是系统单号，给人看流水，表与表之间用 PI 号串。  
> **Dev：** 保存会改 PI 里已改过的 CUT 用量吗？  
> **业务：** 不会，只要没点「同步 BOM」。保存会对齐删款：删 TEST1 就把 TEST1 的 Sales 头和 list 全删掉，订单变未运算。  
> **Dev：** 没同步能一键运算吗？    
> **业务：** 能，算的是 PI BOM，不会从主 BOM 偷改。物料单只有运算后才有，仓库采购只认这个。改数量也要重新运算。

### BOM 展开深度（已定）

- 层号从 **成品（明细 `kcaa01`）** 为第 **1** 层；**建款/同步** 时沿 **主 BOM** 展开写入 PI BOM；**一键运算** 时沿 **PI 销售 BOM** 读；第 **5** 层及以下超限。
- **循环引用**：与库存 BOM 运算一致，**同步 BOM** / **一键运算** 失败并提示 **货品编码**。

### 系统单号流水（已定）

- 格式：`PI-` + **销售日期** `YYYYMMDD` + `-` + **3 位序号** `001`～`999`。
- 序号：取同日前缀下已有 **系统单号** 的最大 `XXX` **+1**；**按自然日重置**（不以保存日代替销售日期）。
- 当日序号已达 **999**：**保存失败**，提示改日或人工协调（不自动扩位）。
- **编辑**未审单：系统单号 **不变**（含其中 `YYYYMMDD` 段）；仅主表 **销售日期** 字段更新。即：系统单号在 **首次保存** 时按当时销售日期生成，此后改销售日期 **不** 改单号前缀与序号。

<!-- 以下章节由 AI 随开发进度自动补充 -->
