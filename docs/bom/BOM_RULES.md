# BOM_RULES.md

本文件沉淀 ERP BOM 的长期业务规则，供未来 AI Agent、重构、排错和测试设计优先阅读。

本文只记录已经从现有文档与代码中确认的规则。不清楚的字段不得猜测，必须回到 `CONTEXT.md`、`docs/sql/database_map.md` 和真实库结构核对。

## 1. BOM 业务边界

### 1.1 库存 BOM

库存 BOM 是标准主数据。

- 主档表：`bom_000`
- 配件明细表：`Bom_parts`
- 成本运算明细缓存表：`bom_cost`
- 历史真实用量汇总表：`Bom_consumption`

库存 BOM 的维护入口是 BOM 资料页面。主档保存、配件维护、审核、反审、回收站和一键运算都围绕 `bom_000.systemcode` 展开。

### 1.2 纸格导入 BOM

纸格正式导入会在同一个业务流程中写入：

- 主 BOM：`bom_000`
- CUT 子 BOM：`bom_000`
- 主 BOM 下的 CUT 预览行和 Accessory 行：`Bom_parts`
- CUT 子 BOM 下的 Material 行：`Bom_parts`

纸格导入属于 BOM 数据源之一。它不是普通前端手工录入，存在 CUT、Accessory、Material 的专门规则。

Material 同一序号行的分色全码应使用同一个 `/` 前前缀，并以 Excel N 列为基准列。例：序号 1 的 N 列 `LA-0368/G3` 是基准，`LA-0368/BLU2`、`LA-0368/MO` 属于同一前缀；若 O 列写成 `LA-0369/VE12`，应视为上传 Excel 疑似有误，智能校验页面要在对应单元格红底标出，智能校验和正式导入都要拦截，不自动改码。

### 1.3 销售订单 PI BOM

销售订单有独立的 PI BOM，不直接修改库存 BOM。

- PI BOM 头：`UB_ERP_Bom_Sales`
- PI BOM 明细：`UB_ERP_Bom_Sales_list`
- PI 物料明细：`UB_ERP_Bom_pi_cost`
- PI 物料汇总：`UB_ERP_Bom_pi_consumption`

销售订单一键运算只读 PI BOM，禁止在运算时从库存 BOM 偷偷覆盖 PI BOM。

## 2. 核心表职责

### 2.1 `bom_000`

`bom_000` 是 BOM 主档表。

长期固定含义：

| 字段 | 含义 |
|---|---|
| `systemcode` | BOM 主档稳定关联键 |
| `GUID` | 旧库或扩展字段中的主档标识；现有逻辑兼容它参与缓存查找 |
| `dr_systemcode` | 纸格导入中与 `systemcode` 同源写入的三连键之一 |
| `kcaa01` | 物料/成品编码 |
| `kcaa02` | 名称 |
| `kcaa03` | 规格 |
| `kcaa04` | 使用单位 |
| `kcaa11` | 颜色 |
| `kcaa33` | 主档损耗来源之一；具体是否作为 fallback 必须按运算规则执行 |
| `pass` | 审核状态，`'1'` 已审核，`'0'` 未审核 |
| `del` | 逻辑删除状态，`'1'` 已删除，空或 `'0'` 在册 |

### 2.2 `Bom_parts`

`Bom_parts` 是库存 BOM 的配件明细表。

长期固定含义：

| 字段 | 含义 |
|---|---|
| `kcac01` | 父 BOM 主档的 `systemcode`，不是父 `kcaa01` |
| `kcac02` | 子件如果也是 BOM，则为子 BOM 主档的 `systemcode` |
| `systemcode` | 明细行中保存的子 BOM `systemcode` 备份字段；不得与父 `kcac01` 混用 |
| `kcaa01` | 子件物料编码，对应 `bom_000.kcaa01` |
| `kcaa02` | 子件名称，展示和同步时可被主档覆盖 |
| `kcaa03` | 子件规格，展示和同步时可被主档覆盖 |
| `kcaa04` | 子件单位，展示和同步时可被主档覆盖 |
| `kcaa11` | 子件颜色，展示和同步时可被主档覆盖 |
| `kcac04` | 单位用量 |
| `kcac05` | 损耗率，库内使用小数 |
| `kcac06` | 用量合计 |
| `cost_price` | 单价/采购价快照 |
| `sale_price` | BOM 价格快照，列存在时写入 |
| `Describe` | 搭配/备注；成本合并键之一 |
| `Seq` | 排序；纸格 Material 使用全局序 |
| `pass` | 纸格导入可能写入，但库存配件编辑权限不以它为准 |
| `del` | 配件行删除状态或物理删除辅助状态 |

配件明细没有独立审核流程。能否编辑由父 `bom_000.pass` 控制。

### 2.3 `bom_cost`

`bom_cost` 是库存 BOM 成本运算明细缓存表。

长期固定含义：

| 字段 | 含义 |
|---|---|
| `pq` | 成品/主 BOM 编码，来自 `bom_000.kcaa01` |
| `sid` | 库存 BOM 中为主档 `systemcode`；历史逻辑也兼容 `GUID` 查找 |
| `kcaa01` | 运算后子件编码 |
| `kcaa02` | 运算后子件名称快照 |
| `top_kcaa01` | 直接上层或顶层关联编码，按现有运算逻辑写入 |
| `top_kcaa02` | 直接上层或顶层关联名称，按现有运算逻辑写入 |
| `kcac04` | 运算后结构用量 |
| `kcac05` | 运算后损耗率 |
| `kcac06` | 运算后含损耗合计 |
| `Describe` | 搭配/备注 |
| `binfo` | 备注快照，现有逻辑取 `Describe` |
| `GUID` | 子件主档 GUID 或 systemcode 快照 |
| `systemcode` | 子件主档 systemcode 快照 |
| `isok` | 本批运算完成标记 |

`bom_cost` 是平铺明细，不是合并结果。展示层可以按 `kcaa01 + Describe` 合并，但落库明细不得默认合并。

### 2.4 `Bom_consumption`

`Bom_consumption` 是库存 BOM 早期成本真实用量汇总表。

当前规则：

- 迁移脚本和历史数据保留。
- 库存 BOM 当前运算不再维护它。
- 未来 AI 不得把它当作库存 BOM 当前有效结果表，除非业务重新确认。

### 2.5 PI BOM 相关表

`UB_ERP_Bom_Sales` 和 `UB_ERP_Bom_Sales_list` 是销售订单内的 PI BOM。

`UB_ERP_Bom_pi_cost` 和 `UB_ERP_Bom_pi_consumption` 是销售订单一键运算后的物料单结果。

PI 表中 `sid` 是 PI 号，不是库存 BOM 的 `systemcode`。

## 3. BOM 运算链路

库存 BOM 一键运算链路：

1. 用户在 BOM 资料详情或列表点击运算。
2. 后端按 `systemcode` 找到 `bom_000` 主档。
3. 后端从 `Bom_parts.kcac01 = 当前 systemcode` 开始递归取配件。
4. 遇到子件有 `kcac02` 时，继续以该 `kcac02` 作为下一层父 `systemcode`。
5. 递归树按深度优先平铺。
6. 按用量、损耗、CUT 特殊规则计算 `kcac04/kcac05/kcac06`。
7. 按隐藏前缀剔除不落库的行。
8. 删除旧 `bom_cost` 中同 `pq + sid` 的结果。
9. 批量写入新的 `bom_cost`。
10. 将本批 `bom_cost.isok` 标记为完成。

PQ 主 BOM 的排序补值规则：

- 仅当本次运算主档 `pq` 以 `PQ-` 开头时，写入 `bom_cost.px`。
- 补值链路为：明细行 `kcaa01` 精确找 `bom_000.kcaa01`，取该主档 `kcaa05`，再用 `kcaa05` 精确匹配 `Bom_material.code`，取 `Bom_material.px` 写入 `bom_cost.px`。
- 找不到 `bom_000.kcaa05`、找不到 `Bom_material.code`，或 `Bom_material.px` 为空时，`bom_cost.px` 保持空值。
- `PQ-` 主 BOM 读取成本 BOM 用量表缓存时，按 `bom_cost.px` 从小到大排序；`px` 为空的行排在有 `px` 的行之后，再按原落库 `id` 保持稳定。
- `BAG-`、`TAG-` 等非 `PQ-` 主 BOM 运算不写 `px`，也不按 `px` 排序，纸格导入后的下级 BOM 运算排序不受这条规则影响。

销售订单一键运算链路：

1. 用户在销售订单列表第一列「操作」点击一键运算；查看/编辑弹窗不再放一键运算入口。
2. 后端读取当前 PI BOM。
3. 后端禁止从库存 BOM 覆盖已有 PI BOM。
4. 运算生成 `UB_ERP_Bom_pi_cost`，口径照 BOM 资料一键运算；唯一差别是来源从 `Bom_parts` 换成 `UB_ERP_Bom_Sales_list`。
5. 若 `UB_ERP_Bom_pi_consumption` 存在，则同步生成或重建汇总。
6. 订单主表标记为已运算。

销售订单已审核、未审核都可以执行一键运算，回收站订单不可运算。销售订单 `UB_ERP_Bom_pi_cost.px` 与库存 BOM `bom_cost.px` 使用同一套规则：子件 `kcaa01` → `bom_000.kcaa05` → `Bom_material.code` → `Bom_material.px`；无匹配则 `px` 留空。

PI_BOM资料页是已确认的维护特例：即使销售订单已审核，也允许在该页面维护当前 PI 的 `UB_ERP_Bom_Sales_list` 配件明细。该特例只影响 `inventory/basic/pi-bom-data`，不放开销售订单编辑页的已审核订单保存、同步 BOM 或删除。

## 4. 配件递归规则

- 递归入口是父 BOM `systemcode`。
- 查询条件是 `Bom_parts.kcac01 = 父 systemcode`。
- 子件是否继续展开，看 `Bom_parts.kcac02` 是否有子 BOM `systemcode`。
- 递归必须检测循环引用。
- PI BOM 当前明确最大展开深度为 4 层。
- 库存 BOM 也必须保留循环保护；未来如要增加深度上限，必须写入测试。
- `kcac01` 不得被解释为父物料编码。
- `kcac02` 不得被解释为子物料编码。

## 5. GUID 关联规则

库存 BOM 主档存在多个标识字段：

- `systemcode`
- `GUID`
- `dr_systemcode`

当前规则：

- 库存 BOM 的稳定关联主键以 `systemcode` 为准。
- `Bom_parts.kcac01` 关联父 `systemcode`。
- `Bom_parts.kcac02` 和部分 `Bom_parts.systemcode` 保存子 BOM `systemcode`。
- `bom_cost.sid` 当前写入主档 `systemcode`。
- 列表判断是否已有运算时兼容 `sid = systemcode` 或 `sid = GUID`，用于兼容历史数据。
- 纸格导入会把 `systemcode`、`GUID`、`dr_systemcode` 作为三连键写入同源值。

禁止事项：

- 禁止把 `GUID` 和 `systemcode` 无条件互换。
- 禁止在新增逻辑中优先使用 `GUID` 作为父子 BOM 关联键。
- 禁止把 PI 物料单 `sid` 与库存 BOM `sid` 混为一谈。

## 6. `bom_cost` 生成逻辑

`bom_cost` 只由 BOM 运算生成或覆盖。

生成规则：

- `pq` 取主档 `kcaa01`。
- `sid` 取主档 `systemcode`。
- 运算结果为平铺行。
- 主 BOM 根行不写入。
- 命中 `hidePrefixes` 的行不写入。
- 写入前删除同 `pq + sid` 的旧结果。
- 写入时按子件 `kcaa01` 从 `bom_000` 补全单位、英文名、分类、颜色、采购价、BOM 价、损耗、备注等列。
- 写入后将 `isok` 置为 1。

展示规则：

- 成本 BOM 用量表可以按 `kcaa01 + Describe` 合并。
- 合并展示不代表 `bom_cost` 落库合并。

## 7. `Bom_consumption` 生成逻辑

当前库存 BOM 规则：

- `Bom_consumption` 不再由库存 BOM 运算维护。
- 库存 BOM 当前有效成本明细来自 `bom_cost`。

当前 PI BOM 规则：

- 销售订单 PI 物料单有自己的汇总表 `UB_ERP_Bom_pi_consumption`。
- `UB_ERP_Bom_pi_consumption` 由 `UB_ERP_Bom_pi_cost` 汇总生成。

未来如果恢复库存 `Bom_consumption` 维护，必须先补规则、补测试，并明确它与 `bom_cost` 的一致性关系。

## 8. 需要运算规则

BOM 主档列表中的“需要运算”来自 `Bom_code`：

- `Bom_code.copen = 1`
- `Bom_code.flag5` 非空
- 主档 `bom_000.kcaa01` 以前缀 `flag5` 开头
- 主档未删除

状态含义：

| 状态 | 含义 |
|---|---|
| 不需运算 | 不符合 `Bom_code` 运算前缀 |
| 未运算 | 符合运算前缀，但未找到有效 `bom_cost` |
| 已运算 | 符合运算前缀，且存在对应 `bom_cost` |

## 9. 缓存读取规则

`GET /api/bom/tree` 当前规则：

- 如果 `bom_cost` 中存在当前 `pq + sid`，则直接返回缓存。
- 命中缓存时不递归 `Bom_parts`。
- 没有缓存时才递归 `Bom_parts`，返回树和预览平铺结果。

缓存失效规则：

- 保存 `Bom_parts` 后，只删除本次进入/保存的当前 BOM 的 `bom_cost` 缓存，让当前 BOM 回到未运算。
- 保存配件明细不额外反审；库存 BOM 本来就要求只有未审核主档才能编辑。
- 保存配件明细不递归处理上级 BOM，也不能按被改材料编码全库反查。例：从 `PQ-3182F1/N` 进入新增 `WSFX-PQ3182F1/N`，只让 `PQ-3182F1/N` 自己未运算。
- 纸格正式导入写入 `BAG-PQ3119B1/N`、`TAG-PQ3119B1/N` 这类下级 BOM 后，不修改引用它们的 `PQ-3119B1/N` 审核状态，也不删除该 PQ 原有 `bom_cost`。
- 重新运算时，必须覆盖旧缓存。
- 主档一键更新不重算缓存，只同步基础资料字段。

缓存风险提醒：

- 如果配件变化后缓存未清理，页面会继续看到旧成本用量。
- 如果 `hidePrefixes` 配置变化，旧缓存不会自动补回此前被排除的行。
- 如果在线新增表字段，进程内列缓存可能需要重启 API 才能识别。

## 10. 用量与成本规则

基础公式：

- 结构用量：`yl`
- 损耗率：`loss_rate`
- 含损耗合计：`total_qty = yl * (1 + loss_rate)`

普通递归：

- 第一层 `yl = kcac04`
- 下一层 `yl = 父 yl * 当前 kcac04`

损耗来源：

- 当前逻辑中，若 `kcac05 > 0`，使用 `kcac05`。
- 否则若 `kcaa33 > 0`，使用 `kcaa33`。
- 否则损耗为 0。

该规则中的 `kcac05 = 0` 是否代表“明确无损耗”不得猜测；未来调整必须由业务确认。

CUT 特殊规则：

- 编码以 `CUT-` 开头的节点是 CUT 裁片节点。
- 写入 `bom_cost` 时，CUT 自身的数量要继续放大其下层材料；如果下层材料本身还会继续展开成子 BOM，这个 CUT 数量也要继续传给更深层的后代行。
- CUT 上方父级的倍率仍继续传递到 CUT 下层。
- 树形预览的原始平铺数据可以保持展示口径；最终成本用量以 `bom_cost` 写库口径为准。

## 11. 纸格导入规则

纸格导入写入三类配件行：

| 行别 | 父 BOM | 子件编码 | 用量规则 |
|---|---|---|---|
| CUT 预览 | 主 BOM | CUT BOM 编码 | `kcac04` 为 CUT 数量，`kcac05/kcac06` 可为 NULL，`Seq=0` |
| Accessory | 主 BOM | ERP 辅料编码 | 用量来自 Excel E，损耗来自 H 或主档 `kcaa33`，合计可由 I 覆盖 |
| Material | CUT 子 BOM | 物料编码 | `kcac04` 取 CUT 单位用量，损耗取 Excel 或主档 `kcaa33` |

纸格导入的主 BOM 默认未审核；CUT 子档和配件行可默认已审核。库存界面编辑配件仍以父 BOM 审核状态为准。

## 12. 销售订单 PI BOM 规则

- 一张 PI 对应订单主从、PI BOM 和物料单。
- 订单明细款集合必须与 `UB_ERP_Bom_Sales.kcaa01` 集合一致。
- 新款入单时，从库存主 BOM 建 PI BOM。
- 删款时，删除该款 PI BOM 头和全部明细。
- 已在单且已有 PI BOM 的款，保存订单时不得被主 BOM 覆盖。
- 只有用户点击“同步 BOM”时，才按指定款从主 BOM 覆盖 PI BOM。
- PI BOM 可维护用量、损耗、备注。
- 保存 PI BOM 后订单标未运算。
- 一键运算只读 PI BOM。
- 运算结果不乘订货数量。
- 展示备料量时才按订货数量乘结构用量。
- PI BOM 标签页树形展示必须对标 BOM 资料的 BOM 用量树，父子关系按 `UB_ERP_Bom_Sales_list.kcac01 -> UB_ERP_Bom_Sales_list.kcac02` 展开。
- PI BOM 前端树行唯一键使用 `UB_ERP_Bom_Sales_list.id`，不要用 `systemcode`，因为同一子 BOM 可以在不同父路径下重复出现。
- 如果历史 PI BOM 行的 `kcac02` 本身缺失或错误，应说明为数据问题；展示修正不得批量改历史 PI BOM 数据。

## 13. 审核状态规则

库存 BOM：

- 主档 `pass='1'` 已审核，禁止编辑和删除。
- 主档 `pass='0'` 未审核，可编辑。
- 配件明细权限随父主档 `pass`。

销售订单：

- 已审核订单禁止保存、同步 BOM、维护 PI BOM、运算、软删和彻底删。
- 反审后可再次保存和运算。
- 审核/反审不自动重算物料单。
- 特例：`PI_BOM资料` 页面允许维护已审核订单的 PI BOM 配件明细；保存后订单标未运算，但不自动重算物料单。

## 14. 禁止事项

- 禁止猜测 `kcac01` 是父编码。
- 禁止猜测 `kcac02` 是子件编码。
- 禁止把库存 BOM 的 `sid` 与 PI BOM 的 `sid` 混用。
- 禁止在前端决定最终 BOM 递归结果。
- 禁止在前端决定缓存是否有效。
- 禁止在前端写入最终物料单。
- 禁止在 PI BOM 一键运算时偷拉主 BOM。
- 禁止把 `Bom_consumption` 当作当前库存 BOM 的有效结果表。
- 禁止绕过父 BOM 审核状态修改配件。
- 禁止只改基础字段后断言成本已重算。

## 15. 数据一致性要求

- `Bom_parts.kcac01` 必须能追溯到父 `bom_000.systemcode`。
- 有子 BOM 的配件行，`kcac02` 应能追溯到子 `bom_000.systemcode`。
- `bom_cost.pq + sid` 必须对应一个明确主 BOM。
- 配件变更后旧 `bom_cost` 必须失效。
- PI BOM 的款集合必须与销售订单明细款集合一致。
- PI 物料单只在订单已运算时有效。
- 纸格导入必须在事务内写主 BOM、CUT、配件和上传记录。
