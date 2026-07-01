# 实测样例：其他出库批量选材

场景：出库类型「其他出库」→ 点击「批量添加」→ 选 `BM-0002/074` →「保存已选」。

仓库编码：`001`。数据库：内网 `UB_ERP_V2.0`。

## 优化前（基线）

| 编号 | 场景 | 耗时 | 说明 |
|------|------|------|------|
| Q1 | 首屏列表（无关键字） | ~2700ms | 重型库存 CTE |
| Q2 | 单独 COUNT | ~2700ms | 与 Q1 **同一 CTE 再跑一遍** |
| Q1+Q2 | 接口合计 | ~5400ms | 双倍耗时 |
| Q3 | 保存 1 条取价 | **>10min（已中止）** | 循环内逐条 `TOP 1`，触达 `UB_ERP_Stocks_Storage_list` 全表扫 |

根因摘要：

1. `JOIN`/`WHERE` 对字段包 `LTRIM(RTRIM(CONVERT(nvarchar,...)))` → 索引难用  
2. 列表与总数分两次查 → CTE 重复  
3. 取价 N+1 → 选中 N 条 ≈ N 次慢查询  

## 方案 A（已采纳）

| 改动 | 内容 |
|------|------|
| JOIN/WHERE | 直比 `ih.[kcan06] = @warehouseCode`、`il.[kcao01] = ih.[kcan01]` 等 |
| 列表 | `COUNT(1) OVER () AS totalCount`，去掉首屏必跑的 COUNT |
| 取价 | `buildOtherBatchPricesSql`：`IN (...)` + `ROW_NUMBER() PARTITION BY kcaa01` 一条批量 |

## 方案 A 实测

| 编号 | 场景 | 耗时 |
|------|------|------|
| Q1 | 首屏（无关键字） | ~2000ms |
| Q1 | 关键字 `BM-0002/074` | ~1300ms |
| Q3 | 保存 1 条取价 | ~118ms |

## 方案 B（未采纳）

加覆盖索引（需 DDL + 用户确认改库）。本案例方案 A 已满足体验，未走 B。

## 用户口令

`按方案 A 实现` → 改 `server/stockOutOtherBatchAdd.js` + 单测 + README。
