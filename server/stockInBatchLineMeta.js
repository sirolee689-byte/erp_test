/**
 * 入库/出库明细表物理列名探测（SQL Server 2008 R2：COL_LENGTH）。
 * 出库明细关联键为 kcaq02，入库明细为 kcao02，禁止混用。
 */
function text(v) {
  return String(v ?? '').trim()
}

/** 入库明细 UB_ERP_Stocks_Storage_list：单据行号、来源明细键、数量 */
export async function getStockInLineMeta(pool) {
  const r = await pool.request().query(`
    SELECT
      CASE
        WHEN COL_LENGTH('dbo.UB_ERP_Stocks_Storage_list', 'kcao01') IS NOT NULL THEN N'kcao01'
        ELSE N''
      END AS lineDocCol,
      CASE
        WHEN COL_LENGTH('dbo.UB_ERP_Stocks_Storage_list', 'kcao02') IS NOT NULL THEN N'kcao02'
        WHEN COL_LENGTH('dbo.UB_ERP_Stocks_Storage_list', 'kcaq02') IS NOT NULL THEN N'kcaq02'
        ELSE N'kcao02'
      END AS detailKeyCol,
      CASE
        WHEN COL_LENGTH('dbo.UB_ERP_Stocks_Storage_list', 'kcao03') IS NOT NULL THEN N'kcao03'
        WHEN COL_LENGTH('dbo.UB_ERP_Stocks_Storage_list', 'kcaq03') IS NOT NULL THEN N'kcaq03'
        ELSE N'kcao03'
      END AS qtyCol
  `)
  const row = r.recordset?.[0] ?? {}
  return {
    lineDocCol: text(row.lineDocCol) || 'kcao01',
    detailKeyCol: text(row.detailKeyCol) || 'kcao02',
    qtyCol: text(row.qtyCol) || 'kcao03',
  }
}

/** 出库主表+明细：关联单号列、数量列、行单据号、来源明细键（kcaq02） */
export async function getStockOutLineMeta(pool) {
  const r = await pool.request().query(`
    SELECT
      CASE
        WHEN COL_LENGTH('dbo.UB_ERP_Stocks_out', 'kcap04') IS NOT NULL THEN N'kcap04'
        WHEN COL_LENGTH('dbo.UB_ERP_Stocks_out', 'kcan04') IS NOT NULL THEN N'kcan04'
        WHEN COL_LENGTH('dbo.UB_ERP_Stocks_out', 'sourceOrderNo') IS NOT NULL THEN N'sourceOrderNo'
        ELSE N''
      END AS linkCol,
      CASE
        WHEN COL_LENGTH('dbo.UB_ERP_Stocks_out_list', 'kcaq03') IS NOT NULL THEN N'kcaq03'
        WHEN COL_LENGTH('dbo.UB_ERP_Stocks_out_list', 'kcao03') IS NOT NULL THEN N'kcao03'
        ELSE N'kcaq03'
      END AS qtyCol,
      CASE
        WHEN COL_LENGTH('dbo.UB_ERP_Stocks_out_list', 'kcaq01') IS NOT NULL THEN N'kcaq01'
        WHEN COL_LENGTH('dbo.UB_ERP_Stocks_out_list', 'kcao01') IS NOT NULL THEN N'kcao01'
        ELSE N'kcaq01'
      END AS lineDocCol,
      CASE
        WHEN COL_LENGTH('dbo.UB_ERP_Stocks_out_list', 'kcaq02') IS NOT NULL THEN N'kcaq02'
        WHEN COL_LENGTH('dbo.UB_ERP_Stocks_out_list', 'kcao02') IS NOT NULL THEN N'kcao02'
        ELSE N'kcaq02'
      END AS detailKeyCol
  `)
  const row = r.recordset?.[0] ?? {}
  return {
    linkCol: text(row.linkCol),
    qtyCol: text(row.qtyCol) || 'kcaq03',
    lineDocCol: text(row.lineDocCol) || 'kcaq01',
    detailKeyCol: text(row.detailKeyCol) || 'kcaq02',
  }
}
