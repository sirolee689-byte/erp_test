# BOM 主档（bom_000）模块说明

## 页面路径

- `存货管理 → BOM资料查询`：`/inv/bom`
- `库存管理 → 基本资料 → BOM资料`：`/inventory/basic/bom-data`（内嵌本组件）

## 物理表与键

- 主表：`bom_000`（可用环境变量 `INV_BOM_MASTER_TABLE` 覆盖）
- **稳定键**：`systemcode`（配件 `Bom_parts.kcac01` 等关联此字段）
- **业务编码**：`kcaa01`（列表 `code`）；状态：`pass`（审核）、`del`（逻辑删除）

## 接口一览（`server/index.js`）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/inv/bom/list` | 分页列表；`recycled=1` 回收站；否则 `pass` + 在册 `del`；返回含 **`systemcode`** |
| GET | `/api/inventory/bom/:id` | 详情，`:id` = `kcaa01`（URL 编码）；**含已删行**（便于回收站查看） |
| POST | `/api/inventory/bom/save-main` | **新增主档（标准）**：与旧版 `POST /api/inventory/bom` 共用逻辑 |
| POST | `/api/inventory/bom` | 新增主档（兼容；与 `save-main` 相同） |
| PUT | `/api/inventory/bom` | 保存（body 含 `systemcode`，**未审且在册**） |
| PUT | `/api/inventory/bom/audit` | 审核 `body: { systemcode }` |
| PUT | `/api/inventory/bom/unaudit` | 反审 |
| PUT | `/api/inventory/bom/restore` | 回收站恢复 |
| DELETE | `/api/inventory/bom/systemcode/:systemcode` | 软删（**已审拒绝**） |
| DELETE | `/api/inventory/bom/systemcode/:systemcode/permanent` | 物理删（**仅回收站**） |
| GET | `/api/inventory/bom/check-code` | 编码冲突提示 |
| GET | `/api/inventory/bom/unit-rate-suggest` | 单位换算建议 |
| GET/PUT | `/api/inventory/bom/parts/:systemcode` 等 | 配件明细（见 `database_map.md` §3.6.x） |

## 标准件交互（对齐颜色编码）

- **默认**：列表 `pass=1`（已审核）
- **显示未审核**：`pass=0`；此时显示「编辑」入口
- **回收站**：仅 `del=1`；操作「恢复」「彻底删除」；与「显示未审核」互斥
- **二次确认**：审核 / 反审 / 软删 / 恢复 / 彻底删除均需 `ElMessageBox.confirm`；彻底删除为危险确认
- **已审核**：禁止编辑、禁止软删；彻底删除在回收站内对已审行按钮禁用（需先恢复再反审后再删，按业务）

## 权限（`apiPermissionGate.js`）

菜单 path：`inv/bom` 或 `inventory/basic/bom-data`：`view` / `add` / `edit` / `audit` / `delete`
