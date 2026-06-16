/**
 * 派工单列表查询工具。
 * SQL Server 2008 R2 只使用 ROW_NUMBER 分页，不使用 OFFSET/FETCH。
 */

export const DISPATCH_ORDER_HEADER_TABLE = 'UB_ERP_Dispatch_order'
export const DISPATCH_ORDER_LINE_TABLE = 'UB_ERP_Dispatch_order_list'

const HEADER_FROM = `dbo.[${DISPATCH_ORDER_HEADER_TABLE}]`
const LINE_FROM = `dbo.[${DISPATCH_ORDER_LINE_TABLE}]`

function flag(v) {
  const s = String(v ?? '').trim().toLowerCase()
  return s === '1' || s === 'true' || s === 'yes'
}

function text(v) {
  return String(v ?? '').trim()
}

function normalizePass(v) {
  const s = text(v)
  if (s === '0' || s === '1' || s === '2') return s
  return '1'
}

function normalizeDispatchType(v) {
  const s = text(v)
  if (s === '0' || s === '1' || s === '2') return s
  return ''
}

export function parseDispatchOrderListQuery(query) {
  const page = Math.max(1, Number(query?.page ?? 1) || 1)
  const pageSizeRaw = Number(query?.pageSize ?? 20) || 20
  const pageSize = Math.min(100, Math.max(1, pageSizeRaw))
  const recycled = flag(query?.recycled)
  const showUnaudited = flag(query?.showUnaudited)
  return {
    page,
    pageSize,
    recycled,
    showUnaudited,
    pass: recycled ? '' : showUnaudited ? '0' : normalizePass(query?.pass),
    dispatchOrderNo: text(query?.dispatchOrderNo),
    referenceNo: text(query?.referenceNo),
    workshopCode: text(query?.workshopCode),
    dispatchType: normalizeDispatchType(query?.dispatchType),
    dispatchDateStart: text(query?.dispatchDateStart),
    dispatchDateEnd: text(query?.dispatchDateEnd),
    deliveryDateStart: text(query?.deliveryDateStart),
    deliveryDateEnd: text(query?.deliveryDateEnd),
    keyword: text(query?.keyword),
  }
}

export function buildDispatchOrderListWhereSql(opts) {
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
  if (opts?.dispatchOrderNo) {
    whereSql += ` AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[scaj01], N'')))) LIKE @dispatchOrderNo `
    params.dispatchOrderNo = `%${opts.dispatchOrderNo}%`
  }
  if (opts?.referenceNo) {
    whereSql += ` AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[scaj04], N'')))) LIKE @referenceNo `
    params.referenceNo = `%${opts.referenceNo}%`
  }
  if (opts?.workshopCode) {
    whereSql += ` AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[scaj05], N'')))) = @workshopCode `
    params.workshopCode = opts.workshopCode
  }
  if (opts?.dispatchType) {
    whereSql += ` AND LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(h.[scaj03], N'')))) = @dispatchType `
    params.dispatchType = opts.dispatchType
  }
  if (opts?.dispatchDateStart) {
    whereSql += ` AND CONVERT(nvarchar(30), h.[scaj02], 120) >= @dispatchDateStart `
    params.dispatchDateStart = opts.dispatchDateStart
  }
  if (opts?.dispatchDateEnd) {
    whereSql += ` AND CONVERT(nvarchar(30), h.[scaj02], 120) <= @dispatchDateEnd `
    params.dispatchDateEnd = `${opts.dispatchDateEnd} 23:59:59`
  }
  if (opts?.deliveryDateStart) {
    whereSql += ` AND CONVERT(nvarchar(30), h.[scaj06], 120) >= @deliveryDateStart `
    params.deliveryDateStart = opts.deliveryDateStart
  }
  if (opts?.deliveryDateEnd) {
    whereSql += ` AND CONVERT(nvarchar(30), h.[scaj06], 120) <= @deliveryDateEnd `
    params.deliveryDateEnd = `${opts.deliveryDateEnd} 23:59:59`
  }
  if (opts?.keyword) {
    whereSql += `
      AND (
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[scaj01], N'')))) LIKE @keyword
        OR LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[scaj04], N'')))) LIKE @keyword
        OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[cj], N'')))) LIKE @keyword
        OR LTRIM(RTRIM(CONVERT(nvarchar(1000), ISNULL(h.[remark], N'')))) LIKE @keyword
      )
    `
    params.keyword = `%${opts.keyword}%`
  }

  return { whereSql, params }
}

export function buildDispatchOrderListPagedSql(opts) {
  const whereSql = String(opts?.whereSql ?? '')
  const sqlText = `
    SELECT
      h.[id],
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[scaj01], N'')))) AS dispatchOrderNo,
      h.[scaj02] AS dispatchDate,
      LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(h.[scaj03], N'')))) AS dispatchType,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[scaj04], N'')))) AS referenceNo,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[scaj05], N'')))) AS workshopCode,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[cj], N'')))) AS workshopName,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kid], N'')))) AS supplierCode,
      h.[scaj06] AS deliveryDate,
      LTRIM(RTRIM(CONVERT(nvarchar(1000), ISNULL(h.[remark], N'')))) AS remark,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[systemcode], N'')))) AS systemCode,
      LTRIM(RTRIM(ISNULL(h.[pass], N''))) AS pass,
      LTRIM(RTRIM(ISNULL(h.[closed], N''))) AS closed,
      LTRIM(RTRIM(ISNULL(h.[del], N''))) AS del,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[utruename], N'')))) AS creatorName,
      ISNULL(lineAgg.[itemCount], 0) AS itemCount,
      ISNULL(lineAgg.[totalQty], 0) AS totalQty,
      h.[rn]
    FROM (
      SELECT
        h.[id], h.[scaj01], h.[scaj02], h.[scaj03], h.[scaj04], h.[scaj05], h.[cj], h.[kid],
        h.[scaj06], h.[remark], h.[systemcode], h.[pass], h.[closed], h.[del], h.[utruename],
        ROW_NUMBER() OVER (ORDER BY h.[scaj02] DESC, h.[id] DESC) AS rn
      FROM ${HEADER_FROM} AS h
      WHERE 1 = 1
      ${whereSql}
    ) AS h
    LEFT JOIN (
      SELECT
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[scak01], N'')))) AS dispatchOrderNo,
        COUNT(1) AS itemCount,
        SUM(ISNULL(l.[scak03], 0)) AS totalQty
      FROM ${LINE_FROM} AS l
      WHERE (ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')
      GROUP BY LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[scak01], N''))))
    ) AS lineAgg
      ON lineAgg.[dispatchOrderNo] = LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[scaj01], N''))))
    WHERE h.[rn] BETWEEN @startRow AND @endRow
    ORDER BY h.[rn]
  `
  return { sql: sqlText }
}
