/**
 * 库存统计打印抬头（读 UB_ERP_System_Head，供导出/打印使用）
 */
const PRINT_HEAD_FROM = 'dbo.[UB_ERP_System_Head]'

function text(value) {
  return String(value ?? '').trim()
}

export function buildStockStatsPrintHeaderSql() {
  return `
    SELECT TOP (1)
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([qyname], N'')))) AS qyname,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([qyenname], N'')))) AS qyenname,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([address], N'')))) AS address,
      LTRIM(RTRIM(CONVERT(nvarchar(120), ISNULL([title], N'')))) AS title,
      LTRIM(RTRIM(CONVERT(nvarchar(120), ISNULL([entitle], N'')))) AS entitle,
      [logo]
    FROM ${PRINT_HEAD_FROM}
    ORDER BY [id] ASC
  `
}

export async function fetchStockStatsPrintHeader(pool) {
  const { resolvePrintLogoSrc } = await import('./systemPrintLogo.js')
  const rs = await pool.request().query(buildStockStatsPrintHeaderSql())
  const row = rs.recordset?.[0] ?? {}
  return {
    qyname: text(row.qyname),
    qyenname: text(row.qyenname),
    address: text(row.address),
    title: text(row.title),
    entitle: text(row.entitle),
    logoSrc: resolvePrintLogoSrc(row.logo),
  }
}
