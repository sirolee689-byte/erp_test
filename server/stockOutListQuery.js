/**
 * 出库单列表查询工具。
 * SQL Server 2008 R2 只使用 ROW_NUMBER 分页，不使用 OFFSET/FETCH。
 */

export const STOCK_OUT_HEADER_TABLE = 'UB_ERP_Stocks_out'
export const STOCK_OUT_LINE_TABLE = 'UB_ERP_Stocks_out_list'

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

function normalizeOutboundType(v) {
  const s = text(v)
  if (/^(?:[0-9]|10)$/.test(s)) return s
  return ''
}

export function parseStockOutListQuery(query) {
  const page = Math.max(1, Number(query?.page ?? 1) || 1)
  const pageSizeRaw = Number(query?.pageSize ?? 20) || 20
  const pageSize = Math.min(100, Math.max(1, pageSizeRaw))
  const recycled = flag(query?.recycled)
  const showUnaudited = flag(query?.showUnaudited)
  return {
    page,
    pageSize,
    recycled,
  // 非回收站且未开「显示未审核」时默认只查已审核（pass=1），与项目列表初始视图一致
    pass: recycled ? '' : showUnaudited ? '0' : (normalizePass(query?.pass) || '1'),
    outboundNo: text(query?.outboundNo ?? query?.kcap01),
    outboundType: normalizeOutboundType(query?.outboundType ?? query?.kcap03),
    warehouseCode: text(query?.warehouseCode ?? query?.kcap06),
    relatedParty: text(query?.relatedParty ?? query?.kehu),
    sourceOrderNo: text(query?.sourceOrderNo ?? query?.kcap04),
    outboundDateStart: text(query?.outboundDateStart),
    outboundDateEnd: text(query?.outboundDateEnd),
    keyword: text(query?.keyword),
  }
}

export function buildStockOutListWhereSql(opts) {
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
  if (opts?.outboundNo) {
    whereSql += ` AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcap01], N'')))) LIKE @outboundNo `
    params.outboundNo = `%${opts.outboundNo}%`
  }
  if (opts?.outboundType) {
    whereSql += ` AND LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(h.[kcap03], N'')))) = @outboundType `
    params.outboundType = opts.outboundType
  }
  if (opts?.warehouseCode) {
    whereSql += ` AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcap06], N'')))) = @warehouseCode `
    params.warehouseCode = opts.warehouseCode
  }
  if (opts?.relatedParty) {
    whereSql += ` AND (LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[kehu], N'')))) LIKE @relatedParty OR LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcap05], N'')))) LIKE @relatedParty) `
    params.relatedParty = `%${opts.relatedParty}%`
  }
  if (opts?.sourceOrderNo) {
    whereSql += ` AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcap04], N'')))) LIKE @sourceOrderNo `
    params.sourceOrderNo = `%${opts.sourceOrderNo}%`
  }
  if (opts?.outboundDateStart) {
    whereSql += ` AND CONVERT(nvarchar(30), h.[kcap02], 120) >= @outboundDateStart `
    params.outboundDateStart = opts.outboundDateStart
  }
  if (opts?.outboundDateEnd) {
    whereSql += ` AND CONVERT(nvarchar(30), h.[kcap02], 120) <= @outboundDateEnd `
    params.outboundDateEnd = `${opts.outboundDateEnd} 23:59:59`
  }
  if (opts?.keyword) {
    whereSql += `
      AND (
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcap01], N'')))) LIKE @keyword
        OR LTRIM(RTRIM(CONVERT(nvarchar(30), h.[kcap02], 120))) LIKE @keyword
        OR LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcap04], N'')))) LIKE @keyword
        OR LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcap08], N'')))) LIKE @keyword
        OR LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcap09], N'')))) LIKE @keyword
        OR LTRIM(RTRIM(CONVERT(nvarchar(1000), ISNULL(h.[remark], N'')))) LIKE @keyword
      )
    `
    params.keyword = `%${opts.keyword}%`
  }

  return { whereSql, params }
}

export function buildStockOutListPagedSql(opts) {
  const whereSql = String(opts?.whereSql ?? '')
  return {
    sql: `
      SELECT
        h.[id],
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[systemcode], N'')))) AS systemCode,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcap01], N'')))) AS outboundNo,
        h.[kcap02] AS outboundDate,
        LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(h.[kcap03], N'')))) AS outboundType,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcap04], N'')))) AS sourceOrderNo,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcap05], N'')))) AS relatedPartyCode,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcap06], N'')))) AS warehouseCode,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[ck], N'')))) AS warehouseName,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcap07], N'')))) AS handlerName,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcap08], N'')))) AS paperNo,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcap09], N'')))) AS reserveNo,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[kehu], N'')))) AS relatedPartyName,
        LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(h.[in_tax], N'1')))) AS inTax,
        LTRIM(RTRIM(CONVERT(nvarchar(1000), ISNULL(h.[remark], N'')))) AS remark,
        LTRIM(RTRIM(ISNULL(h.[pass], N''))) AS pass,
        LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(h.[Closed], 0)))) AS closed,
        LTRIM(RTRIM(ISNULL(h.[del], N''))) AS del,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[utruename], N'')))) AS creatorName,
        ISNULL(lineAgg.[itemCount], 0) AS itemCount,
        ISNULL(lineAgg.[totalQty], 0) AS totalQty,
        ISNULL(lineAgg.[taxExcludedTotal], 0) AS taxExcludedTotal,
        ISNULL(lineAgg.[taxIncludedTotal], 0) AS taxIncludedTotal,
        ISNULL(lineAgg.[taxTotal], 0) AS taxTotal,
        h.[rn]
      FROM (
        SELECT
          h.[id], h.[systemcode], h.[kcap01], h.[kcap02], h.[kcap03], h.[kcap04], h.[kcap05], h.[kcap06],
          h.[ck], h.[kcap07], h.[kcap08], h.[kcap09], h.[kehu], h.[in_tax], h.[remark], h.[pass],
          h.[Closed], h.[del], h.[utruename],
          ROW_NUMBER() OVER (ORDER BY h.[kcap02] DESC, h.[id] DESC) AS rn
        FROM dbo.[${STOCK_OUT_HEADER_TABLE}] AS h
        WHERE 1 = 1
        ${whereSql}
      ) AS h
      LEFT JOIN (
        SELECT
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaq01], N'')))) AS outboundNo,
          COUNT(1) AS itemCount,
          SUM(ISNULL(l.[kcaq03], 0)) AS totalQty,
          SUM(ISNULL(l.[kcaq05], 0)) AS taxExcludedTotal,
          SUM(ISNULL(l.[kcaq051], ISNULL(l.[kcaq05], 0))) AS taxIncludedTotal,
          SUM(ISNULL(l.[kcaq051], ISNULL(l.[kcaq05], 0)) - ISNULL(l.[kcaq05], 0)) AS taxTotal
        FROM dbo.[${STOCK_OUT_LINE_TABLE}] AS l
        WHERE (ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')
        GROUP BY LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaq01], N''))))
      ) AS lineAgg
        ON lineAgg.[outboundNo] = LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcap01], N''))))
      WHERE h.[rn] BETWEEN @startRow AND @endRow
      ORDER BY h.[rn]
    `,
  }
}
