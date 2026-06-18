export const BUY_ORDER_HEADER_TABLE = 'UB_ERP_Buy_order'

const HEADER_FROM = `dbo.[${BUY_ORDER_HEADER_TABLE}]`

function text(v) {
  return String(v ?? '').trim()
}

export function parseBuyOrderListQuery(query = {}) {
  const page = Math.max(1, Number(query.page ?? 1) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? 10) || 10))
  const recycledRaw = text(query.recycled).toLowerCase()
  const recycled = recycledRaw === '1' || recycledRaw === 'true' || recycledRaw === 'yes'
  return {
    page,
    pageSize,
    recycled,
    pass: ['0', '1'].includes(text(query.pass)) ? text(query.pass) : '',
    closed: ['0', '1'].includes(text(query.closed)) ? text(query.closed) : '',
    buyType: ['0', '1', '2'].includes(text(query.buyType ?? query.kcaj03)) ? text(query.buyType ?? query.kcaj03) : '',
    supplier: text(query.supplier ?? query.kcaj05),
    keyword: text(query.keyword),
    dateStart: text(query.dateStart),
    dateEnd: text(query.dateEnd),
  }
}

export function buildBuyOrderListWhereSql(opts = {}) {
  let whereSql = opts.recycled
    ? ` AND LTRIM(RTRIM(ISNULL(h.[del], N''))) = N'1' `
    : ` AND (ISNULL(h.[del], N'') = N'' OR h.[del] = N'0') `
  const params = {}
  if (opts.pass) {
    whereSql += ` AND LTRIM(RTRIM(ISNULL(h.[pass], N''))) = @pass `
    params.pass = opts.pass
  }
  if (opts.closed) {
    whereSql += ` AND LTRIM(RTRIM(ISNULL(h.[closed], N''))) = @closed `
    params.closed = opts.closed
  }
  if (opts.buyType) {
    whereSql += ` AND LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(h.[kcaj03], N'')))) = @buyType `
    params.buyType = opts.buyType
  }
  if (opts.supplier) {
    whereSql += ` AND (LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcaj05], N'')))) LIKE @supplier OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[kehu], N'')))) LIKE @supplier) `
    params.supplier = `%${opts.supplier}%`
  }
  if (opts.dateStart) {
    whereSql += ` AND h.[kcaj02] >= @dateStart `
    params.dateStart = opts.dateStart
  }
  if (opts.dateEnd) {
    whereSql += ` AND h.[kcaj02] < DATEADD(day, 1, @dateEnd) `
    params.dateEnd = opts.dateEnd
  }
  if (opts.keyword) {
    whereSql += `
      AND (
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcaj01], N'')))) LIKE @keyword
        OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[kcaj04], N'')))) LIKE @keyword
        OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[kcaj05], N'')))) LIKE @keyword
        OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[kehu], N'')))) LIKE @keyword
        OR LTRIM(RTRIM(CONVERT(nvarchar(1000), ISNULL(h.[remark], N'')))) LIKE @keyword
      )
    `
    params.keyword = `%${opts.keyword}%`
  }
  return { whereSql, params }
}

export function buildBuyOrderListPagedSql(opts = {}) {
  const whereSql = String(opts.whereSql ?? '')
  return {
    sql: `
      SELECT
        h.[id],
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcaj01], N'')))) AS buyOrderNo,
        h.[kcaj02] AS buyDate,
        LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(h.[kcaj03], N'')))) AS buyType,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[kcaj04], N'')))) AS referenceNo,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcaj05], N'')))) AS supplierCode,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[kehu], N'')))) AS supplierName,
        LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(h.[kcaj06], N'')))) AS taxIncluded,
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(h.[kcaj07], N'')))) AS currencyCode,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[rmb], N'')))) AS currencyName,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[kcaj08], N'')))) AS loadingPort,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[kcaj09], N'')))) AS dischargePort,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[kcaj10], N'')))) AS paymentTerms,
        LTRIM(RTRIM(CONVERT(nvarchar(1000), ISNULL(h.[remark], N'')))) AS remark,
        ISNULL(h.[decimal], 4) AS decimalPlaces,
        LTRIM(RTRIM(ISNULL(h.[pass], N''))) AS pass,
        LTRIM(RTRIM(ISNULL(h.[closed], N''))) AS closed,
        LTRIM(RTRIM(ISNULL(h.[del], N''))) AS del,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[systemcode], N'')))) AS systemCode,
        h.[uid], h.[uname], h.[utruename], h.[addtime], h.[edittime],
        ISNULL(lineAgg.[itemCount], 0) AS itemCount,
        ISNULL(lineAgg.[totalQty], 0) AS totalQty,
        ISNULL(lineAgg.[taxIncludedTotal], 0) AS taxIncludedTotal,
        ISNULL(lineAgg.[taxExcludedTotal], 0) AS taxExcludedTotal,
        ISNULL(inboundPendingAgg.[pendingInboundQty], 0) AS pendingInboundQty,
        ISNULL(feeAgg.[extraFeeTotal], 0) AS extraFeeTotal,
        h.[rn]
      FROM (
        SELECT h.*, ROW_NUMBER() OVER (
          ORDER BY
            CASE WHEN ISNULL(LTRIM(RTRIM(CONVERT(nvarchar(50), h.[addtime]))), N'') = N'' THEN 1 ELSE 0 END ASC,
            LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(h.[addtime], N'')))) DESC,
            h.[id] DESC
        ) AS rn
        FROM ${HEADER_FROM} AS h
        WHERE 1=1
        ${whereSql}
      ) AS h
      LEFT JOIN (
        SELECT LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcak01], N'')))) AS buyOrderNo,
               COUNT(1) AS itemCount,
               SUM(ISNULL(l.[kcak03], 0)) AS totalQty,
               SUM(ISNULL(l.[kcak051], 0)) AS taxIncludedTotal,
               SUM(ISNULL(l.[kcak05], 0)) AS taxExcludedTotal
        FROM dbo.[UB_ERP_Buy_order_list] AS l
        WHERE (ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')
        GROUP BY LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcak01], N''))))
      ) AS lineAgg ON lineAgg.[buyOrderNo] = LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcaj01], N''))))
      LEFT JOIN (
        SELECT LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(s.[kcan04], N'')))) AS buyOrderNo,
               SUM(ISNULL(l.[kcao03], 0)) AS pendingInboundQty
        FROM dbo.[UB_ERP_Stocks_Storage] AS s
        INNER JOIN dbo.[UB_ERP_Stocks_Storage_list] AS l
          ON l.[kcao01] = s.[kcan01]
         AND (ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')
        WHERE (ISNULL(s.[del], N'') = N'' OR s.[del] = N'0')
          AND LTRIM(RTRIM(ISNULL(s.[pass], N''))) = N'0'
        GROUP BY LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(s.[kcan04], N''))))
      ) AS inboundPendingAgg ON inboundPendingAgg.[buyOrderNo] = LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcaj01], N''))))
      LEFT JOIN (
        SELECT LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(m.[buy_code], N'')))) AS buyOrderNo,
               SUM(ISNULL(m.[money], 0)) AS extraFeeTotal
        FROM dbo.[UB_ERP_Buy_order_money] AS m
        GROUP BY LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(m.[buy_code], N''))))
      ) AS feeAgg ON feeAgg.[buyOrderNo] = LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcaj01], N''))))
      WHERE h.[rn] BETWEEN @startRow AND @endRow
      ORDER BY h.[rn] ASC
    `,
  }
}
