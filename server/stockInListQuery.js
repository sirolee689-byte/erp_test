/**
 * 入库单列表查询工具。
 * SQL Server 2008 R2 只使用 ROW_NUMBER 分页，不使用 OFFSET/FETCH。
 */

export const STOCK_IN_HEADER_TABLE = 'UB_ERP_Stocks_Storage'
export const STOCK_IN_LINE_TABLE = 'UB_ERP_Stocks_Storage_list'

const HEADER_FROM = `dbo.[${STOCK_IN_HEADER_TABLE}]`
const LINE_FROM = `dbo.[${STOCK_IN_LINE_TABLE}]`

function flag(v) {
  const s = String(v ?? '').trim().toLowerCase()
  return s === '1' || s === 'true' || s === 'yes'
}

function text(v) {
  return String(v ?? '').trim()
}

function normalizePass(v) {
  const s = text(v)
  if (s === '0' || s === '1') return s
  return ''
}

function normalizeInboundType(v) {
  const s = text(v)
  if (/^[0-8]$/.test(s)) return s
  return ''
}

export function parseStockInListQuery(query) {
  const page = Math.max(1, Number(query?.page ?? 1) || 1)
  const pageSizeRaw = Number(query?.pageSize ?? 20) || 20
  const pageSize = Math.min(100, Math.max(1, pageSizeRaw))
  const recycled = flag(query?.recycled)
  const showUnaudited = flag(query?.showUnaudited)
  const showUnreviewed = flag(query?.showUnreviewed)
  return {
    page,
    pageSize,
    recycled,
    showUnaudited,
    showUnreviewed,
    pass: recycled ? '' : showUnaudited ? '0' : normalizePass(query?.pass),
    receiptNo: text(query?.receiptNo ?? query?.kcan01),
    inboundType: normalizeInboundType(query?.inboundType ?? query?.kcan03),
    warehouseCode: text(query?.warehouseCode ?? query?.kcan06),
    relatedParty: text(query?.relatedParty ?? query?.kehu),
    sourceOrderNo: text(query?.sourceOrderNo ?? query?.kcan04),
    inboundDateStart: text(query?.inboundDateStart),
    inboundDateEnd: text(query?.inboundDateEnd),
    paperNo: text(query?.paperNo ?? query?.kcan08),
    keyword: text(query?.keyword),
  }
}

export function buildStockInListWhereSql(opts) {
  const params = {}
  let whereSql = ''

  if (opts?.recycled) {
    whereSql += ` AND LTRIM(RTRIM(ISNULL(h.[del], N''))) = N'1' `
  } else {
    whereSql += ` AND (ISNULL(h.[del], N'') = N'' OR h.[del] = N'0') `
  }

  if (!opts?.recycled && opts?.pass) {
    whereSql += ` AND LTRIM(RTRIM(ISNULL(h.[pass], N''))) = @pass `
    params.pass = opts.pass
  }
  // 未复核：sp_flag 非 '1'（空值视同未复核）
  if (!opts?.recycled && opts?.showUnreviewed) {
    whereSql += ` AND LTRIM(RTRIM(ISNULL(h.[sp_flag], N''))) <> N'1' `
  }
  if (opts?.receiptNo) {
    whereSql += ` AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan01], N'')))) LIKE @receiptNo `
    params.receiptNo = `%${opts.receiptNo}%`
  }
  if (opts?.inboundType) {
    whereSql += ` AND LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(h.[kcan03], N'')))) = @inboundType `
    params.inboundType = opts.inboundType
  }
  if (opts?.warehouseCode) {
    whereSql += ` AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan06], N'')))) = @warehouseCode `
    params.warehouseCode = opts.warehouseCode
  }
  if (opts?.relatedParty) {
    whereSql += ` AND (LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[kehu], N'')))) LIKE @relatedParty OR LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan05], N'')))) LIKE @relatedParty) `
    params.relatedParty = `%${opts.relatedParty}%`
  }
  if (opts?.sourceOrderNo) {
    whereSql += ` AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan04], N'')))) LIKE @sourceOrderNo `
    params.sourceOrderNo = `%${opts.sourceOrderNo}%`
  }
  if (opts?.paperNo) {
    whereSql += ` AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan08], N'')))) LIKE @paperNo `
    params.paperNo = `%${opts.paperNo}%`
  }
  if (opts?.inboundDateStart) {
    whereSql += ` AND CONVERT(nvarchar(30), h.[kcan02], 120) >= @inboundDateStart `
    params.inboundDateStart = opts.inboundDateStart
  }
  if (opts?.inboundDateEnd) {
    whereSql += ` AND CONVERT(nvarchar(30), h.[kcan02], 120) <= @inboundDateEnd `
    params.inboundDateEnd = `${opts.inboundDateEnd} 23:59:59`
  }
  if (opts?.keyword) {
    whereSql += `
      AND (
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan01], N'')))) LIKE @keyword
        OR LTRIM(RTRIM(CONVERT(nvarchar(30), h.[kcan02], 120))) LIKE @keyword
        OR LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan04], N'')))) LIKE @keyword
        OR LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan08], N'')))) LIKE @keyword
        OR LTRIM(RTRIM(CONVERT(nvarchar(1000), ISNULL(h.[remark], N'')))) LIKE @keyword
      )
    `
    params.keyword = `%${opts.keyword}%`
  }

  return { whereSql, params }
}

export function buildStockInListPagedSql(opts) {
  const whereSql = String(opts?.whereSql ?? '')
  const sqlText = `
    SELECT
      h.[id],
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[systemcode], N'')))) AS systemCode,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan01], N'')))) AS receiptNo,
      h.[kcan02] AS inboundDate,
      LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(h.[kcan03], N'')))) AS inboundType,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan04], N'')))) AS sourceOrderNo,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan05], N'')))) AS relatedPartyCode,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan06], N'')))) AS warehouseCode,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[ck], N'')))) AS warehouseName,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan07], N'')))) AS handlerName,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan08], N'')))) AS paperNo,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[kehu], N'')))) AS relatedPartyName,
      LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(h.[in_tax], N'1')))) AS inTax,
      LTRIM(RTRIM(CONVERT(nvarchar(1000), ISNULL(h.[remark], N'')))) AS remark,
      LTRIM(RTRIM(ISNULL(h.[pass], N''))) AS pass,
      LTRIM(RTRIM(ISNULL(h.[sp_flag], N''))) AS spFlag,
      LTRIM(RTRIM(ISNULL(h.[closed], N''))) AS closed,
      LTRIM(RTRIM(ISNULL(h.[del], N''))) AS del,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[utruename], N'')))) AS creatorName,
      ISNULL(lineAgg.[itemCount], 0) AS itemCount,
      ISNULL(lineAgg.[totalQty], 0) AS totalQty,
      ISNULL(lineAgg.[inboundTotalQty], 0) AS inboundTotalQty,
      ISNULL(lineAgg.[taxExcludedTotal], 0) AS taxExcludedTotal,
      ISNULL(lineAgg.[taxIncludedTotal], 0) AS taxIncludedTotal,
      ISNULL(lineAgg.[taxTotal], 0) AS taxTotal,
      ISNULL(lineAgg.[totalAmount], 0) AS totalAmount,
      h.[rn]
    FROM (
      SELECT
        h.[id], h.[systemcode], h.[kcan01], h.[kcan02], h.[kcan03], h.[kcan04], h.[kcan05], h.[kcan06],
        h.[ck], h.[kcan07], h.[kcan08], h.[kehu], h.[in_tax], h.[remark], h.[pass], h.[sp_flag],
        h.[closed], h.[del], h.[utruename],
        ROW_NUMBER() OVER (ORDER BY h.[kcan02] DESC, h.[id] DESC) AS rn
      FROM ${HEADER_FROM} AS h
      WHERE 1 = 1
      ${whereSql}
    ) AS h
    LEFT JOIN (
      SELECT
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcao01], N'')))) AS receiptNo,
        COUNT(1) AS itemCount,
        SUM(ISNULL(l.[kcao031], ISNULL(l.[kcao03], 0))) AS totalQty,
        SUM(ISNULL(l.[kcao03], 0)) AS inboundTotalQty,
        SUM(ISNULL(l.[kcao05], 0)) AS taxExcludedTotal,
        SUM(ISNULL(l.[kcao051], ISNULL(l.[kcao05], 0))) AS taxIncludedTotal,
        SUM(ISNULL(l.[kcao051], ISNULL(l.[kcao05], 0)) - ISNULL(l.[kcao05], 0)) AS taxTotal,
        SUM(ISNULL(l.[kcao051], ISNULL(l.[kcao05], 0))) AS totalAmount
      FROM ${LINE_FROM} AS l
      WHERE (ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')
      GROUP BY LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcao01], N''))))
    ) AS lineAgg
      ON lineAgg.[receiptNo] = LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan01], N''))))
    WHERE h.[rn] BETWEEN @startRow AND @endRow
    ORDER BY h.[rn]
  `
  return { sql: sqlText }
}
