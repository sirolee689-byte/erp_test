# BOM 资料查询（v1.1.8）

## 已完成功能

- 分页列表：调用 `GET /api/inv/bom/list`，服务端使用 `ROW_NUMBER()` 分页（兼容 SQL Server 2008 R2），默认排序为编码升序、版本降序。
- 搜索：物料编码 `code`、物料名称 `name` 独立输入；**满 3 个字符**才传给后端做参数化 `LIKE`，减少大表模糊查询压力。
- 裁片过滤（`bom_cut`）：前端 `searchQuery.bom_cut` 默认 **0**（不搜索包含裁片），后端在 `WHERE` 中强制执行 `kcaa01 NOT LIKE N'CUT-%'`；选 **1**（搜索包含裁片）时取消该条件。重置查询会恢复为 0。
- 裁片深度搜索：物料编码框以 **`CUT-`** 开头且不含 **`<`** 时，使用右模糊 `kcaa01 LIKE '关键词%'`（参数化，利于 `kcaa01` 前缀索引）；含 `<` 时回退 `%关键词%`。**显式搜 CUT- 时**即使 `bom_cut=0` 也会临时取消全局 `NOT LIKE CUT-%`，否则无法命中裁片行。
- 成品关联附件搜索（`code` / kcaa01）：后端按 `Bom_code(copen=1).flag5` 生成可剥离前缀（含 `RP-PQ-` 与各 `FLAG-`），从用户输入中反复去掉前缀得到「核心款号」；若核心长度≥3，则使用 `kcaa01 LIKE '%核心'`（参数化）以匹配 `STRAP-…2954C1/BO` 等同后缀；否则回退为 `%关键字%` 包含匹配。COUNT/LIST 单次超过 500ms 会打 `console.warn` 提示评估索引/全文检索。
- 用量汇总统计列（动态规则）：后端从配置表 `Bom_code` 读取 `copen=1` 的 `flag5` 动态生成“需要运算”的编码规则，并做 TTL 缓存（默认 60 秒，避免每次请求都扫配置表）。规则如下：\n  - `OUT`：编码包含 `-OUT`\n  - `RP`：编码以 `RP-PQ` 开头\n  - 其它：编码以 `${flag5}-` 开头（如 `PQ-`）\n  对“已运算/未运算”的行，后端对当前页一次性汇总 `Bom_cost` 与 `Bom_consumption`（`SUM(kcac04)`、`SUM(kcac06)`），并在单元格中按两行展示「成本/成品」；不需运算行留空。
- 是否运算用量：匹配规则的物料，若 `Bom_cost` 存在记录则标记【已运算】（绿），否则【未运算】（红）；不匹配规则则【不需运算】（灰）。`Bom_consumption` 仅参与汇总显示，不作为已/未运算判定依据。
- UI 字段调整（v1.1.7 Final）：新增【输入时间(addtime)】【修改时间(edittime)】【备注(remark)】；移除【版本】【状态】；“托工/自制”列名改为“外协/自产”。时间显示格式为 `YYYY-MM-DD HH:mm`。
- 审核视图：开关「显示未审核」切换 `pass=0` / 默认 `pass=1`；已审核行禁用「编辑」按钮。
- 操作列：查看详情（弹窗）、复制（剪贴板 JSON）、编辑（主档表单保存尚未对接；配件明细已有保存接口）。
- **详情弹窗 Tab「配件明细」**：表格含 **序号** 列；`GET /api/inventory/bom/parts/:systemcode` 加载 `Bom_parts`（父键 `kcac01` = 主档 `systemcode`）；「添加配件」复用采购报价的 `MaterialSelector`（`bom_000` 已审列表）；保存时 `PUT /api/inventory/bom/parts/:systemcode` 批量更新/新增（后端仍支持按行软删字段，界面删除入口待编辑模式再加）。用量合计 `kcac04*(1+kcac05)`，成本合计×单价；表底汇总实际用量总和与总成本。主档已审核时配件只读。**「查看」**：按配件编码拉取 `GET /api/inventory/bom/:id` 并切换到该料的「配件明细」Tab，便于逐层下钻。

## 数据库说明

- 目标表默认 `dbo.bom_000`，可通过环境变量 `INV_BOM_MASTER_TABLE` 改为其他表名（仅字母数字下划线）。
- 接口假设存在字段：`kcaa01`～`kcaa14`、`sign`、`version`、`pass`、`del`（与项目其它模块一致的审核与逻辑删除约定）。**配件子表**默认 **`Bom_parts`**（`INV_BOM_PARTS_TABLE` 可覆盖）；主档需有 **`systemcode`** 供子表 `kcac01` 关联。若旧库缺列，请在 Navicat 补齐或联系开发调整 SQL。

## 路由说明

- `存货管理 → BOM资料查询`：`/inv/bom`，使用本页默认标题。
- `库存管理 → 基本资料 → BOM资料`：`/inventory/basic/bom-data`，通过 `embedded-title="BOM资料"` 内嵌本组件（见 `src/views/inventory/basic/bom-data/index.vue`）。

## 已知问题 / 下一步

- 列表「编辑」主档基础资料尚未对接 `PUT`；配件明细已支持保存。若库表 `bom_000` 无 `systemcode` 列或 `Bom_parts` 结构不一致，需在库端对齐后再试接口。
