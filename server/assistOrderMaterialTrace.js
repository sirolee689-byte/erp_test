/**
 * 外协订单 · 转向物料查询（只读）
 * 主数据：UB_ERP_assist_order_list（del=0/pass=1）+ 主表补充；入/出库按外协类型反查聚合。
 */
import { clampErpPageSize } from './erpPagination.js'
import { sql } from './db.js'
import { likeTextExpr, safeDecimalExpr } from './buyOrderSqlSafe.js'

const HEADER_FROM = 'dbo.[UB_ERP_assist_order]'
const LINE_FROM = 'dbo.[UB_ERP_assist_order_list]'
const BOM_CODE_FROM = 'dbo.[UB_ERP_Bom_code]'
const STORAGE_HEADER_FROM = 'dbo.[UB_ERP_Stocks_Storage]'
const STORAGE_LINE_FROM = 'dbo.[UB_ERP_Stocks_Storage_list]'
const OUT_HEADER_FROM = 'dbo.[UB_ERP_Stocks_out]'
const OUT_LINE_FROM = 'dbo.[UB_ERP_Stocks_out_list]'

const SEARCH_COLS = [
  'systemcode',
  'wxak01',
  'wxak02',
  'wxak03',
  'wxak04',
  'wxak041',
  'wxak05',
  'wxak051',
  'Tax',
  'info',
  'pi',
  'Reference',
  'Product',
  'Describe',
  'remark',
  'content',
  'kcaa01',
  'kcaa02',
  'kcaa03',
  'kcaa04',
  'kcaa05',
  'kcaa06',
  'kcaa07',
  'kcaa08',
  'kcaa09',
  'kcaa10',
  'kcaa11',
  'kcaa12',
  'kcaa13',
  'kcaa14',
  'kcaa15',
  'kcaa16',
  'kcaa17',
  'kcaa18',
  'kcaa19',
  'kcaa20',
  'kcaa21',
  'kcaa22',
  'kcaa23',
  'kcaa24',
  'kcaa25',
  'kcaa26',
  'kcaa27',
  'kcaa28',
  'kcaa29',
  'kcaa30',
  'kcaa31',
  'kcaa32',
  'kcaa33',
  'kcaa34',
  'kcaa35',
  'kcaa02_en',
  'kpname',
  'location',
  'sale_price',
  'cost_price',
  'Customer_supply',
  'Customer_Name',
]

function text(v) {
  return String(v ?? '').trim()
}

function parseIntPositive(v, fallback) {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.floor(n)
}

/** 旧系统分类名前缀兜底（Bom_code.flag5 为空时） */
function mapBomPrefixByName(name) {
  const key = text(name)
  if (!key) return ''
  if (key.includes('成品')) return 'PQ-'
  if (key.includes('主袋')) return 'BAG-'
  if (key.includes('拉牌') || key.includes('吊牌')) return 'TAG-'
  if (key.includes('裁片')) return 'CUT-'
  if (key.includes('肩带')) return 'STRAP-'
  return ''
}

function parseTraceQuery(query = {}) {
  return {
    page: parseIntPositive(query.page, 1),
    pageSize: clampErpPageSize(query.pageSize, 10),
    keyword: text(query.keyword),
    bomCodeId: parseIntPositive(query.bomCodeId, 0),
    bomPrefix: text(query.bomPrefix),
    all: ['1', 'true', 'yes'].includes(text(query.all).toLowerCase()),
  }
}

export async function fetchAssistOrderTraceBomCodes(pool) {
  const result = await pool.request().query(`
    SELECT
      [id],
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([flag1], N'')))) AS [flag1],
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([flag5], N'')))) AS [flag5]
    FROM ${BOM_CODE_FROM}
    WHERE [copen] = 1
    ORDER BY ISNULL([px], 2147483647), [id]
  `)
  return (result.recordset ?? []).map((row) => {
    const flag1 = text(row.flag1)
    const prefix = text(row.flag5) || mapBomPrefixByName(flag1)
    return {
      id: Number(row.id),
      flag1,
      name: flag1,
      prefix,
    }
  })
}

function buildTraceWhereSql(q) {
  let whereSql = `
    WHERE (ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')
      AND LTRIM(RTRIM(ISNULL(l.[pass], N''))) = N'1'
  `
  const params = {}

  if (!q.all && q.keyword) {
    const parts = SEARCH_COLS.map((col) => `${likeTextExpr('l', col)} LIKE @kw`)
    whereSql += ` AND (${parts.join(' OR ')}) `
    params.kw = `%${q.keyword}%`
  }

  if (!q.all && q.bomPrefix) {
    whereSql += ` AND UPPER(${likeTextExpr('l', 'kcaa01', 300)}) LIKE UPPER(@bomPrefix) + N'%' `
    params.bomPrefix = q.bomPrefix
  } else if (!q.all && q.bomCodeId > 0) {
    // 业务注释：与其他外协批量选材一致——优先 flag5 前缀匹配 kcaa01；flag5 空时回退 kcaa05=分类 id
    whereSql += `
      AND EXISTS (
        SELECT 1
        FROM ${BOM_CODE_FROM} AS bc
        WHERE bc.[id] = @bomCodeId
          AND (
            (
              LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(bc.[flag5], N'')))) <> N''
              AND UPPER(${likeTextExpr('l', 'kcaa01', 500)})
                LIKE UPPER(LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(bc.[flag5], N''))))) + N'%'
            )
            OR (
              LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(bc.[flag5], N'')))) = N''
              AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa05], N''))))
                = LTRIM(RTRIM(CONVERT(nvarchar(50), bc.[id])))
            )
          )
      )
    `
    params.bomCodeId = q.bomCodeId
  }

  return { whereSql, params }
}

function bindTraceParams(req, params) {
  Object.entries(params).forEach(([key, value]) => {
    if (key === 'bomCodeId') {
      req.input(key, sql.Int, Number(value))
      return
    }
    req.input(key, sql.NVarChar(500), value)
  })
}

const KCAA_SELECT = Array.from({ length: 35 }, (_, i) => {
  const col = `kcaa${String(i + 1).padStart(2, '0')}`
  return `${likeTextExpr('l', col, 500)} AS [${col}]`
}).join(',\n        ')

export async function fetchAssistOrderMaterialTrace(pool, query = {}) {
  const q = parseTraceQuery(query)
  const { whereSql, params } = buildTraceWhereSql(q)
  const startRow = (q.page - 1) * q.pageSize + 1
  const endRow = q.page * q.pageSize

  const countReq = pool.request()
  bindTraceParams(countReq, params)
  const countResult = await countReq.query(`
    SELECT COUNT(1) AS total
    FROM ${LINE_FROM} AS l
    ${whereSql}
  `)
  const total = Number(countResult.recordset?.[0]?.total ?? 0)

  const listReq = pool.request().input('startRow', sql.Int, startRow).input('endRow', sql.Int, endRow)
  bindTraceParams(listReq, params)

  const listResult = await listReq.query(`
    SELECT *
    FROM (
      SELECT
        ROW_NUMBER() OVER (
          ORDER BY
            CASE WHEN h.[wxaj02] IS NULL THEN 1 ELSE 0 END ASC,
            h.[wxaj02] DESC,
            l.[id] DESC
        ) AS rn,
        l.[id],
        h.[id] AS headerId,
        ${likeTextExpr('l', 'wxak01', 200)} AS assistOrderNo,
        ${likeTextExpr('h', 'wxaj04', 500)} AS referenceNo,
        h.[wxaj02] AS assistDate,
        ${likeTextExpr('h', 'wxaj03', 20)} AS assistType,
        ${likeTextExpr('h', 'wxaj05', 500)} AS supplierCode,
        ${likeTextExpr('h', 'kehu', 500)} AS supplierName,
        ${likeTextExpr('h', 'wxaj06', 20)} AS taxIncluded,
        ${likeTextExpr('h', 'wxaj07', 100)} AS currencyCode,
        ${likeTextExpr('h', 'rmb', 200)} AS currencyName,
        h.[wxaj08] AS deliveryDate,
        ${likeTextExpr('h', 'remark', 1000)} AS headerRemark,
        l.[seq] AS lineSeq,
        ${safeDecimalExpr('l', 'wxak03')} AS wxak03,
        ${safeDecimalExpr('l', 'wxak04')} AS wxak04,
        ${safeDecimalExpr('l', 'wxak041')} AS wxak041,
        ${safeDecimalExpr('l', 'wxak05')} AS wxak05,
        ${safeDecimalExpr('l', 'wxak051')} AS wxak051,
        ${safeDecimalExpr('l', 'Tax')} AS tax,
        ${likeTextExpr('l', 'pi', 500)} AS pi,
        ${likeTextExpr('l', 'Reference', 500)} AS poPi,
        ${likeTextExpr('l', 'Product', 500)} AS product,
        ${likeTextExpr('l', 'Describe', 500)} AS describeText,
        ${likeTextExpr('l', 'info', 1000)} AS info,
        ${likeTextExpr('l', 'content', 1000)} AS content,
        ${likeTextExpr('l', 'remark', 1000)} AS remark,
        ${likeTextExpr('l', 'systemcode', 300)} AS systemcode,
        ${likeTextExpr('l', 'kcaa02_en', 500)} AS kcaa02_en,
        ${likeTextExpr('l', 'kpname', 500)} AS kpname,
        ${likeTextExpr('l', 'location', 500)} AS location,
        ${likeTextExpr('l', 'sale_price', 500)} AS sale_price,
        ${likeTextExpr('l', 'cost_price', 500)} AS cost_price,
        ${likeTextExpr('l', 'Customer_supply', 100)} AS Customer_supply,
        ${likeTextExpr('l', 'Customer_Name', 500)} AS Customer_Name,
        l.[version] AS version,
        ${KCAA_SELECT},
        ISNULL(inboundAgg.inboundQty, 0) AS inboundQty,
        ISNULL(outboundAgg.outboundQty, 0) AS outboundQty
      FROM ${LINE_FROM} AS l
      LEFT JOIN ${HEADER_FROM} AS h
        ON ${likeTextExpr('h', 'wxaj01', 200)} = ${likeTextExpr('l', 'wxak01', 200)}
      LEFT JOIN (
        SELECT
          ${likeTextExpr('s', 'kcan04', 200)} AS assistOrderNo,
          ${likeTextExpr('sl', 'kcaa01', 300)} AS materialCode,
          SUM(${safeDecimalExpr('sl', 'kcao03')}) AS inboundQty
        FROM ${STORAGE_HEADER_FROM} AS s
        INNER JOIN ${STORAGE_LINE_FROM} AS sl
          ON ${likeTextExpr('sl', 'kcao01', 200)} = ${likeTextExpr('s', 'kcan01', 200)}
        WHERE (ISNULL(s.[del], N'') = N'' OR s.[del] = N'0')
          AND (ISNULL(sl.[del], N'') = N'' OR sl.[del] = N'0')
          AND LTRIM(RTRIM(ISNULL(s.[pass], N''))) = N'1'
          AND LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(s.[kcan03], N'')))) = N'2'
        GROUP BY ${likeTextExpr('s', 'kcan04', 200)}, ${likeTextExpr('sl', 'kcaa01', 300)}
      ) AS inboundAgg
        ON inboundAgg.assistOrderNo = ${likeTextExpr('l', 'wxak01', 200)}
       AND inboundAgg.materialCode = ${likeTextExpr('l', 'kcaa01', 300)}
      LEFT JOIN (
        SELECT
          ${likeTextExpr('o', 'kcap04', 200)} AS assistOrderNo,
          ${likeTextExpr('ol', 'kcaa01', 300)} AS materialCode,
          SUM(${safeDecimalExpr('ol', 'kcaq03')}) AS outboundQty
        FROM ${OUT_HEADER_FROM} AS o
        INNER JOIN ${OUT_LINE_FROM} AS ol
          ON ${likeTextExpr('ol', 'kcaq01', 200)} = ${likeTextExpr('o', 'kcap01', 200)}
        WHERE (ISNULL(o.[del], N'') = N'' OR o.[del] = N'0')
          AND (ISNULL(ol.[del], N'') = N'' OR ol.[del] = N'0')
          AND LTRIM(RTRIM(ISNULL(o.[pass], N''))) = N'1'
          AND LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(o.[kcap03], N'')))) = N'2'
        GROUP BY ${likeTextExpr('o', 'kcap04', 200)}, ${likeTextExpr('ol', 'kcaa01', 300)}
      ) AS outboundAgg
        ON outboundAgg.assistOrderNo = ${likeTextExpr('l', 'wxak01', 200)}
       AND outboundAgg.materialCode = ${likeTextExpr('l', 'kcaa01', 300)}
      ${whereSql}
    ) AS src
    WHERE src.rn BETWEEN @startRow AND @endRow
    ORDER BY src.rn ASC
  `)

  return {
    ok: true,
    page: q.page,
    pageSize: q.pageSize,
    total,
    list: listResult.recordset ?? [],
  }
}
