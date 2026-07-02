# 库存统计表（第一期）

路径：`/inventory/analysis/stock-stats`

## 已完成功能（第一期）

- **普通库存统计报表生成**：按开始/结束日期、仓库、物料编码前缀（可选）生成统计，写入快照表。
- **历史记录**：分页查看已生成快照，支持查看明细、逻辑删除。
- **导出**：当前快照明细支持 Excel（ExcelJS）与 PDF（浏览器打印另存为）。
- **打印抬头**：读 `UB_ERP_System_Head` 第一条配置（接口 `GET /api/stock-stats/print-header`）。
- **顶部占位**：材料分类统计、扣数表、超订量统计按钮置灰，提示下期开发。

## 统计口径（普通库存统计）

- 维度：**物料编码 `kcaa01` + 仓库**（入库 `kcan06` / 出库 `kcap06`）。
- 单据：`pass=1`、`del=0`；期间按主表业务日期 `kcan02` / `kcap02`。
- 金额：入库 `kcao05`、出库 `kcaq05`（不含税金额）。
- 类型编号对照与字段公式见 `server/stockStatsCalculator.js` 中文注释。
- 物料排除：`PQ-`、`BAG-`、`CUT-` 等前缀 + `%-OUT%`（`kt-%`、`kc-%` 例外），规则单源 `server/stockStatsMaterialExclude.js`。

## 接口

| 方法 | 路径 | 权限 |
|------|------|------|
| GET | `/api/stock-stats/warehouse-options` | view |
| GET | `/api/stock-stats/print-header` | view |
| GET | `/api/stock-stats/snapshots` | view |
| GET | `/api/stock-stats/snapshots/:id/lines` | view |
| POST | `/api/stock-stats/generate` | add |
| DELETE | `/api/stock-stats/snapshots/:id` | delete |

## 数据库

- 快照主表：`UB_ERP_Stock_stats_snapshot`
- 快照明细：`UB_ERP_Stock_stats_snapshot_line`
- 迁移脚本：`docs/sql/sqlserver_stock_stats_snapshot.txt`；执行 `node scripts/run-migration-sqlserver_stock_stats_snapshot.mjs`

## 已知限制 / 下期计划

- 大范围统计若超过 50000 行会拒绝生成，请缩小日期或物料条件。
- 第二期：材料分类统计；第三期：扣数表；第四期：超订量统计。
- 生成大数据量时仍为同步请求，超 30 秒体验待第二期改异步任务。

## 运维

修改 `server/**` 后请手动重启 API：`taskkill /F /IM node.exe /T` → `npm run dev:server`，并重新登录。
