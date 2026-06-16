# 结算方式（供应链基本资料）

## 数据表

- 物理表：`UB_ERP_System_settlement_method`
- 主键：`id`
- 展示列：`code`（编码）、`name`（名称）、`payfor`（天数）
- 新增/编辑补充：`info`（备注）
- 状态约定（标准件）：
  - `pass`：审核（`'1'` 已审 / `'0'` 未审）
  - `del`：逻辑删除（`'1'` 删除；`'0'`/空/NULL 在册）

## 已完成功能（前端）

- 列表：分页（默认 `pageSize=20`）、关键字搜索、显示未审核开关、回收站开关（互斥）。
- 新增：打开新增弹窗时自动获取建议编码并填入；表单字段：编码/名称/天数/备注。
- 编辑：仅未审核且在册可改；编码只读不可改。
- 审核 / 反审：二次确认弹窗；审核后进入默认列表（已审核）。
- 删除（软删）：二次确认弹窗；仅未审核且在册允许删除，删除后进入回收站。
- 回收站：支持恢复与彻底删除（物理删除，不可恢复）。
- 按钮权限：`v-permission` 控制 add/edit/delete 等按钮显示。

## 接口（后端：`server/index.js`）

- `GET /api/supply-chain/settlement-methods/list`
  - 入参：`page`、`pageSize`、`keyword`、`pass` 或 `recycled=1`
  - 规则：默认 `pass=1` 且在册；`recycled=1` 仅查 `del=1`（不按 `pass` 过滤）
  - 返回：`{ code:200, data:{ total, list, recycled } }`
- `GET /api/supply-chain/settlement-methods/suggest-code`
  - 规则：按 `PT` + 数字尾号自增（如 `PT14` → `PT15`）；兜底 `MAX(id)+1`
  - 返回：`{ suggestedCode }`
- `POST /api/supply-chain/settlement-methods`
  - body：`{ code?, name, payfor, info? }`（`code` 为空则后端自动生成）
  - 默认：`pass='0'`、`del='0'`
- `PUT /api/supply-chain/settlement-methods`
  - body：`{ id, code, name, payfor, info? }`
  - 规则：仅在册且未审核可保存；`code` 只读不可改
- `PUT /api/supply-chain/settlement-methods/audit`：body `{ id }`
- `PUT /api/supply-chain/settlement-methods/unaudit`：body `{ id }`
- `PUT /api/supply-chain/settlement-methods/restore`：body `{ id }`
- `DELETE /api/supply-chain/settlement-methods/:id`：软删（仅未审核且在册）
- `DELETE /api/supply-chain/settlement-methods/:id/permanent`：彻底删除（仅回收站 del=1）

## 权限（按钮级）

- 菜单 path：`supply-chain/basic/payment-methods`
- `view`：`GET .../list`
- `add`：`GET .../suggest-code`、`POST ...`
- `edit`：`PUT ...`、`PUT .../restore`
- `audit`：`PUT .../audit`、`PUT .../unaudit`
- `delete`：`DELETE .../:id`、`DELETE .../:id/permanent`

## 操作日志

- 落库表：`UB_Date_ERP_Operation_log`
- 动作映射：`server/action_map.js`
- 自动写入：`server/operationAuditMiddleware.js` → `server/operationLogWriter.js`
- 文案要求：软删与彻底删除必须区分；编辑会记录关键字段差异（名称/天数/备注）。

