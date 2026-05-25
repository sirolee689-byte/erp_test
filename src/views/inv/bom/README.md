# BOM 主档（bom_000）模块说明

## 页面路径

- `存货管理 → BOM资料查询`：`/inv/bom`
- `库存管理 → 基本资料 → BOM资料`：`/inventory/basic/bom-data`（内嵌本组件）

## 物理表与键

- 主表：`bom_000`（可用环境变量 `INV_BOM_MASTER_TABLE` 覆盖）
- **稳定键**：`systemcode`（配件 `Bom_parts.kcac01` 等关联此字段）
- **业务编码**：`kcaa01`（列表 `code`）；状态：`pass`（审核）、`del`（逻辑删除）

## 详情弹窗标签页

- **基础资料 / 配件明细**：既有功能。
- **BOM用量表运算**：「运算」/「刷新」请求 **`GET /api/bom/tree?systemcode=`**，返回 **嵌套 `children` 的树**；单层 SQL **只按 `kcac01` 匹配**（不按 `del` 过滤，与配件 GET 一致，避免旧库 `del` 空值导致子层 0 行）；**`kcac01`/`kcac02` 用 500 长 nvarchar 比较**防截断。前端 **`el-table` 树形表** + 展开/关闭全部。
- **成本BOM用量表 / 成本BOM真实用量表**：占位页，后续迭代。

## 配件明细（`Bom_parts`）

- **`GET /api/inventory/bom/parts/:systemcode`**：`kcaa01`/`kcaa02`/`kcaa03`/`kcaa11` 优先按 **`bom_000.kcaa01`**（在册主档，`OUTER APPLY` **TOP 1**）展示；无匹配则用配件表原列。
- **`PUT /api/inventory/bom/parts/:systemcode`**（及 **`POST /api/inventory/bom/save-parts`**）：保存时每行 **UPDATE** 使用 **`id` + `kcac01`（主档 `systemcode`）** 双重锁定；按配件 **`kcaa01`** 关联 **`bom_000`** 最新在册行，将表中存在的 **`kcaa01`～`kcaa35`**、**`kcac02`** 与 **`systemcode`**（若明细表有该列，同子 BOM `systemcode`）从主档写回明细；用量/单价/备注/排序仍以请求为准。新增行先 **INSERT OUTPUT id** 再执行同一套 UPDATE。详见 `docs/sql/database_map.md`（`Bom_parts` 条目）。
- **`kcac06`**：用量合计 = **`kcac04 × (1 + kcac05)`**；前端损耗按 **百分比** 编辑，库内 **`kcac05`** 为小数；保存时写入 **`kcac04`/`kcac05`/`kcac06`**（若库中存在 **`kcac06`** 列）。
- **审计**：用量变更成功：`[更新]了配件用量，BOM：[主档 kcaa01]，配件：[kcaa01]，用量：[kcac04]，损耗：[kcac05]`。若配件在 **`bom_000`** 存在子档，另记：`[同步]了BOM配件属性，主BOM：[systemcode]，配件：[kcaa01]，已同步kcaa01-kcaa35共35个字段。`

## 接口一览（`server/index.js`）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/inv/bom/list` | 分页列表；`recycled=1` 回收站；否则 `pass` + 在册 `del`；可选 **`bom_code_id`**（`Bom_code.id`，按 flag5 前缀筛 `kcaa01`）；返回含 **`systemcode`** |
| GET | `/api/inv/bom/bom-code-categories` | BOM 分类下拉（`Bom_code`，按 `id` 升序） |
| GET | `/api/inventory/bom/:id` | 详情，`:id` = `kcaa01`（URL 编码）；**含已删行**（便于回收站查看） |
| POST | `/api/inventory/bom/save-main` | **新增主档（标准）**：与旧版 `POST /api/inventory/bom` 共用逻辑 |
| POST | `/api/inventory/bom` | 新增主档（兼容；与 `save-main` 相同） |
| PUT | `/api/inventory/bom` | 保存（body 含 `systemcode`，**未审且在册**） |
| PUT | `/api/inventory/bom/audit` | 审核 `body: { systemcode }` |
| PUT | `/api/inventory/bom/audit-batch` | 批量审核 `body: { systemcodes }`（仅当前页，最多 200） |
| PUT | `/api/inventory/bom/unaudit` | 反审 |
| PUT | `/api/inventory/bom/restore` | 回收站恢复 |
| DELETE | `/api/inventory/bom/systemcode/:systemcode` | 软删（**已审拒绝**） |
| DELETE | `/api/inventory/bom/systemcode/:systemcode/permanent` | 物理删（**仅回收站**） |
| GET | `/api/inventory/bom/check-code` | 编码冲突提示 |
| GET | `/api/inventory/bom/unit-rate-suggest` | 单位换算建议 |
| GET/PUT | `/api/inventory/bom/parts/:systemcode` 等 | 配件明细（见 `database_map.md` §3.6.x） |

## 标准件交互（对齐颜色编码）

- **BOM 分类筛选**：工具栏下拉来自 **`Bom_code`**（按 `id` 排序，展示 `flag1` 如「产品」）；查询传 **`bom_code_id`**，按该分类 **`flag5` 前缀** 匹配物料编码 `kcaa01`；默认「全部分类」。列表「分类」列仍为材料分类（`Bom_material` / `kcaa05`），与筛选项不是同一张表
- **默认**：列表 `pass=1`（已审核）
- **显示未审核**：`pass=0`；此时显示「编辑」入口；工具栏 **批量审核（仅当前页）** 只审当前分页行（如 10 条/页最多 10 条）
- **回收站**：仅 `del=1`；操作「恢复」「彻底删除」；与「显示未审核」互斥
- **二次确认**：审核 / 反审 / 软删 / 恢复 / 彻底删除均需 `ElMessageBox.confirm`；彻底删除为危险确认
- **已审核**：禁止编辑、禁止软删；彻底删除在回收站内对已审行按钮禁用（需先恢复再反审后再删，按业务）

## 权限（`apiPermissionGate.js`）

菜单 path：`inv/bom` 或 `inventory/basic/bom-data`：`view` / `add` / `edit` / `audit` / `delete`
## 打印

- **成本BOM用量表**：点击「点击此处打印」后，页面使用独立的打印专用表格输出，不再直接打印弹窗里的滚动表格，避免只打印当前可视区域；打印模式会隐藏侧栏/页签/内容卡片占位，让表格尽量居中并铺满横向纸面。打印抬头包含编码、名称、规格、客户款号；打印明细包含编码、名称、规格、单位、备注、用量、损耗、合计以及底部合计行。
- **数据库变更**：本次无数据库变更。
- **已知问题/下一步**：浏览器打印预览仍由本机浏览器控制，纸张方向建议使用横向；后续如需要固定公司抬头或页码，可继续在打印专用表格上补。
