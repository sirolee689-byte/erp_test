# 库存统计改用快照表而非 tj/tj2

旧系统描述中的 `UB_ERP_Stocks_tj` / `UB_ERP_Stocks_tj2` 在现网 V2 库与旧系统环境中均未找到实体表，更像临时缓存。新系统第一期改为显式快照表 `UB_ERP_Stock_stats_snapshot`（生成条件与元数据）和 `UB_ERP_Stock_stats_snapshot_line`（统计明细行），便于历史查询、权限审计与导出复现；统计字段公式仍严格对齐旧库存统计口径（类型编号与加权逻辑见 `stockStatsCalculator.js`）。
