/**
 * Assist order list query helpers.
 * SQL Server 2008 R2 only: use ROW_NUMBER pagination, never OFFSET/FETCH.
 */

export const ASSIST_ORDER_HEADER_TABLE = 'UB_ERP_assist_order'

const HEADER_FROM = `dbo.[${ASSIST_ORDER_HEADER_TABLE}]`

export function parseAssistOrderListQuery(query) {
  const page = Math.max(1, Number(query?.page ?? 1) || 1)
  const pageSizeRaw = Number(query?.pageSize ?? 10) || 10
  const pageSize = Math.min(100, Math.max(1, pageSizeRaw))
  const recycledRaw = String(query?.recycled ?? '').trim().toLowerCase()
  const recycled = recycledRaw === '1' || recycledRaw === 'true' || recycledRaw === 'yes'
  const showUnauditedRaw = String(query?.showUnaudited ?? '').trim().toLowerCase()
  const showUnaudited = showUnauditedRaw === '1' || showUnauditedRaw === 'true' || showUnauditedRaw === 'yes'

  return {
    page,
    pageSize,
    recycled,
    showUnaudited,
    pass: recycled ? '' : showUnaudited ? '0' : normalizeAssistOrderPass(query?.pass),
    closed: normalizeClosed(query?.closed),
    keyword: String(query?.keyword ?? '').trim(),
    supplier: String(query?.supplier ?? '').trim(),
    assistType: normalizeAssistType(query?.assistType),
    sortBy: normalizeSortBy(query?.sortBy),
  }
}

function normalizeAssistOrderPass(v) {
  const s = String(v ?? '').trim()
  if (s === '0' || s === '1') return s
  return '1'
}

function normalizeClosed(v) {
  const s = String(v ?? '').trim()
  if (s === '0' || s === '1') return s
  return ''
}

function normalizeAssistType(v) {
  const s = String(v ?? '').trim()
  if (s === '0' || s === '1' || s === '2') return s
  return ''
}

function normalizeSortBy(v) {
  const s = String(v ?? '').trim()
  if (s === 'deliveryDate' || s === 'assistDate' || s === 'supplier') return s
  return ''
}

export function buildAssistOrderListWhereSql(opts) {
  const recycled = Boolean(opts?.recycled)
  let whereSql = ''
  const params = {}

  if (recycled) {
    whereSql += ` AND LTRIM(RTRIM(ISNULL(h.[del], N''))) = N'1' `
  } else {
    whereSql += ` AND (ISNULL(h.[del], N'') = N'' OR h.[del] = N'0') `
  }

  if (!recycled && opts?.pass) {
    whereSql += ` AND LTRIM(RTRIM(ISNULL(h.[pass], N''))) = @pass `
    params.pass = opts.pass
  }

  if (opts?.closed) {
    whereSql += ` AND LTRIM(RTRIM(ISNULL(h.[closed], N''))) = @closed `
    params.closed = opts.closed
  }

  if (opts?.assistType) {
    whereSql += ` AND LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(h.[wxaj03], N'')))) = @assistType `
    params.assistType = opts.assistType
  }

  if (opts?.supplier) {
    whereSql += `
      AND (
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[wxaj05], N'')))) LIKE @supplier
        OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[kehu], N'')))) LIKE @supplier
      )
    `
    params.supplier = `%${opts.supplier}%`
  }

  if (opts?.keyword) {
    whereSql += `
      AND (
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[wxaj01], N'')))) LIKE @keyword
        OR CONVERT(nvarchar(30), h.[wxaj02], 120) LIKE @keyword
        OR LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[wxaj04], N'')))) LIKE @keyword
        OR LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[wxaj05], N'')))) LIKE @keyword
        OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[kehu], N'')))) LIKE @keyword
        OR LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[rmb], N'')))) LIKE @keyword
        OR LTRIM(RTRIM(CONVERT(nvarchar(1000), ISNULL(h.[remark], N'')))) LIKE @keyword
        OR LTRIM(RTRIM(CONVERT(nvarchar(1000), ISNULL(h.[notes], N'')))) LIKE @keyword
      )
    `
    params.keyword = `%${opts.keyword}%`
  }

  return { whereSql, params }
}

export function buildAssistOrderListPagedSql(opts) {
  const whereSql = String(opts?.whereSql ?? '')
  const sortBy = normalizeSortBy(opts?.sortBy)
  const orderBy =
    sortBy === 'deliveryDate'
      ? 'h.[wxaj08] ASC, h.[id] DESC'
      : sortBy === 'assistDate'
        ? 'h.[wxaj02] DESC, h.[id] DESC'
        : sortBy === 'supplier'
          ? 'h.[kehu] ASC, h.[id] DESC'
          : 'h.[id] DESC'

  const sqlText = `
        SELECT
          h.[id],
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[wxaj01], N'')))) AS assistOrderNo,
          h.[wxaj02] AS assistDate,
          LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(h.[wxaj03], N'')))) AS assistType,
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[wxaj04], N'')))) AS referenceNo,
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[wxaj05], N'')))) AS supplierCode,
          LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[kehu], N'')))) AS supplierName,
          LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(h.[wxaj06], N'')))) AS taxIncluded,
          LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(h.[wxaj07], N'')))) AS currencyCode,
          h.[wxaj08] AS deliveryDate,
          LTRIM(RTRIM(CONVERT(nvarchar(1000), ISNULL(h.[remark], N'')))) AS remark,
          LTRIM(RTRIM(CONVERT(nvarchar(1000), ISNULL(h.[notes], N'')))) AS notes,
          LTRIM(RTRIM(ISNULL(h.[pass], N''))) AS pass,
          LTRIM(RTRIM(ISNULL(h.[closed], N''))) AS closed,
          LTRIM(RTRIM(ISNULL(h.[del], N''))) AS del,
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[systemcode], N'')))) AS systemCode,
          ISNULL(lineAgg.[itemCount], 0) AS itemCount,
          ISNULL(lineAgg.[totalQty], 0) AS totalQty,
          ISNULL(lineAgg.[taxIncludedTotal], 0) AS taxIncludedTotal,
          ISNULL(lineAgg.[taxExcludedTotal], 0) AS taxExcludedTotal,
          ISNULL(lineAgg.[taxDiffTotal], 0) AS taxDiffTotal,
          ISNULL(feeAgg.[extraFeeTotal], 0) AS extraFeeTotal,
          h.[rn]
        FROM (
          SELECT
            h.[id],
            h.[wxaj01],
            h.[wxaj02],
            h.[wxaj03],
            h.[wxaj04],
            h.[wxaj05],
            h.[kehu],
            h.[wxaj06],
            h.[wxaj07],
            h.[wxaj08],
            h.[remark],
            h.[notes],
            h.[pass],
            h.[closed],
            h.[del],
            h.[systemcode],
            ROW_NUMBER() OVER (ORDER BY ${orderBy}) AS rn
          FROM ${HEADER_FROM} AS h
          WHERE 1 = 1
          ${whereSql}
        ) AS h
        LEFT JOIN (
          SELECT
            LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[wxak01], N'')))) AS assistOrderNo,
            COUNT(1) AS itemCount,
            SUM(ISNULL(l.[wxak03], 0)) AS totalQty,
            SUM(ISNULL(l.[wxak051], 0)) AS taxIncludedTotal,
            SUM(ISNULL(l.[wxak05], 0)) AS taxExcludedTotal,
            SUM(ISNULL(l.[wxak051], 0) - ISNULL(l.[wxak05], 0)) AS taxDiffTotal
          FROM dbo.[UB_ERP_assist_order_list] AS l
          WHERE (ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')
          GROUP BY LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[wxak01], N''))))
        ) AS lineAgg
          ON lineAgg.[assistOrderNo] = LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[wxaj01], N''))))
        LEFT JOIN (
          SELECT
            LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(m.[assist_code], N'')))) AS assistOrderNo,
            SUM(ISNULL(m.[money], 0)) AS extraFeeTotal
          FROM dbo.[UB_ERP_assist_order_money] AS m
          WHERE (ISNULL(m.[del], N'') = N'' OR m.[del] = N'0')
          GROUP BY LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(m.[assist_code], N''))))
        ) AS feeAgg
          ON feeAgg.[assistOrderNo] = LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[wxaj01], N''))))
        WHERE h.rn BETWEEN @startRow AND @endRow
        ORDER BY h.rn
      `

  return { sql: sqlText }
}
