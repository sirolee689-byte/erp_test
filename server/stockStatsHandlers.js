/**
 * 库存统计表 API 路由
 */
import { sql } from './db.js'
import { safeDecimalExpr } from './buyOrderSqlSafe.js'
import { fetchStockStatsPrintHeader } from './stockStatsPrintHeader.js'

const WAREHOUSE_FROM = 'dbo.[UB_ERP_Stocks_Warehouse]'
const MATERIAL_FROM = 'dbo.[New_UB_ERP_Stocks_material]'
const COLOR_FROM = 'dbo.[UB_ERP_Stocks_colorcode]'
const BOM_FROM = 'dbo.[UB_ERP_Bom_000]'
const STORAGE_HEADER = 'dbo.[UB_ERP_Stocks_Storage]'
const STORAGE_LINE = 'dbo.[UB_ERP_Stocks_Storage_list]'
const OUT_HEADER = 'dbo.[UB_ERP_Stocks_out]'
const OUT_LINE = 'dbo.[UB_ERP_Stocks_out_list]'
const BUY_HEADER = 'dbo.[UB_ERP_Buy_order]'
const BUY_LINE = 'dbo.[UB_ERP_Buy_order_list]'
const PO_MIN_DATE = '2019-01-01'
const ALL_WAREHOUSE = '__ALL__'

function text(v) {
  return String(v ?? '').trim()
}

function likePattern(v) {
  return `%${text(v).replace(/[\\%_]/g, '\\$&')}%`
}

function normalizeBool(raw) {
  const v = String(raw ?? '').trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

function normalizeOptionPage(rawPage, rawPageSize) {
  const page = Math.max(1, Number.parseInt(rawPage, 10) || 1)
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(rawPageSize, 10) || 10))
  return { page, pageSize }
}

/** 将新旧类别参数统一成去重后的分类编码列表。 */
export function normalizeStockStatsCategoryCodes(raw) {
  const values = Array.isArray(raw) ? raw : String(raw ?? '').split(',')
  return [...new Set(values.map((value) => text(value)).filter(Boolean))]
}

function safeQty(alias, col) {
  return safeDecimalExpr(alias, col, 0)
}

/** 采购/入库明细数量按 kcaa26、kcaa27 换算到使用单位；除法且比率为 0 时按 0 处理。 */
function buildUnitConvertQtySql(alias, qtyCol) {
  const qty = safeDecimalExpr(alias, qtyCol, 0)
  const ratio = safeDecimalExpr(alias, 'kcaa26', 0)
  const dirIsOne = `LTRIM(RTRIM(ISNULL(${alias}.[kcaa27], N''))) = N'1'`
  return `CASE
    WHEN ${dirIsOne} THEN
      CASE WHEN ${ratio} > 0.000001 THEN ${qty} / ${ratio} ELSE 0 END
    ELSE ${qty} * ${ratio}
  END`
}

function buildPoHeaderActiveSql(alias) {
  return `(ISNULL(${alias}.[del], N'') = N'' OR ${alias}.[del] = N'0')
    AND LTRIM(RTRIM(ISNULL(${alias}.[pass], N''))) = N'1'
    AND ${alias}.[kcaj02] >= @poMinDate
    AND ${alias}.[kcaj02] < @cutoffEnd`
}

async function fetchStockStatsWarehouseOptions(pool, keyword = '') {
  const req = pool.request()
  let kwSql = ''
  if (keyword) {
    req.input('kw', sql.NVarChar(400), likePattern(keyword))
    kwSql = `AND (
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([code], N'')))) LIKE @kw
      OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([name], N'')))) LIKE @kw
    )`
  }
  const r = await req.query(`
    SELECT TOP 100
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([code], N'')))) AS code,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([name], N'')))) AS name
    FROM ${WAREHOUSE_FROM}
    WHERE (ISNULL([del], N'') = N'' OR [del] = N'0')
      AND LTRIM(RTRIM(ISNULL([pass], N''))) = N'1'
      ${kwSql}
    ORDER BY [code] ASC
  `)
  return r.recordset ?? []
}

async function fetchStockStatsMaterialOptions(pool, keyword = '') {
  const req = pool.request()
  let kwSql = ''
  if (keyword) {
    req.input('kw', sql.NVarChar(400), likePattern(keyword))
    kwSql = `AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([kcaa01], N'')))) LIKE @kw`
  }
  const r = await req.query(`
    SELECT TOP 100
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([kcaa01], N'')))) AS code,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([kcaa02], N'')))) AS name,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([kcaa02_en], N'')))) AS ename,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([kcaa03], N'')))) AS spec,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL([kcaa04], N'')))) AS unit,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL([kcaa05], N'')))) AS categoryCode,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL([kcaa11], N'')))) AS colorCode
    FROM ${BOM_FROM}
    WHERE (ISNULL([del], N'') = N'' OR [del] = N'0')
      AND LTRIM(RTRIM(ISNULL([pass], N''))) = N'1'
      AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([kcaa01], N'')))) <> N''
      ${kwSql}
    ORDER BY [kcaa01] ASC, [id] DESC
  `)
  return r.recordset ?? []
}

async function fetchStockStatsCategoryOptions(pool, keyword = '', page = 1, pageSize = 10) {
  const req = pool.request()
  const rowStart = (page - 1) * pageSize + 1
  const rowEnd = page * pageSize
  req.input('categoryRowStart', sql.Int, rowStart)
  req.input('categoryRowEnd', sql.Int, rowEnd)
  let kwSql = ''
  if (keyword) {
    req.input('kw', sql.NVarChar(400), likePattern(keyword))
    kwSql = `AND (
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([code], N'')))) LIKE @kw
      OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([name], N'')))) LIKE @kw
    )`
  }
  const r = await req.query(`
    ;WITH categorySource AS (
      SELECT
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([code], N'')))) AS code,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([name], N'')))) AS name,
        [px] AS sortNo
      FROM ${MATERIAL_FROM}
      WHERE (ISNULL([del], N'') = N'' OR [del] = N'0')
        AND LTRIM(RTRIM(ISNULL([pass], N''))) = N'1'
        ${kwSql}
    ), numbered AS (
      SELECT
        code,
        name,
        sortNo,
        ROW_NUMBER() OVER (ORDER BY CASE WHEN sortNo IS NULL THEN 1 ELSE 0 END, sortNo ASC, code ASC) AS rowNo,
        COUNT(1) OVER () AS total
      FROM categorySource
    )
    SELECT code, name, sortNo, total
    FROM numbered
    WHERE rowNo BETWEEN @categoryRowStart AND @categoryRowEnd
    ORDER BY rowNo ASC
  `)
  const list = r.recordset ?? []
  return { list, total: Number(list[0]?.total ?? 0) }
}

async function fetchStockStatsColorOptions(pool, keyword = '') {
  const req = pool.request()
  let kwSql = ''
  if (keyword) {
    req.input('kw', sql.NVarChar(400), likePattern(keyword))
    kwSql = `AND (
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([code], N'')))) LIKE @kw
      OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([name], N'')))) LIKE @kw
    )`
  }
  const r = await req.query(`
    SELECT TOP 100
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([code], N'')))) AS code,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([name], N'')))) AS name
    FROM ${COLOR_FROM}
    WHERE (ISNULL([del], N'') = N'' OR [del] = N'0')
      AND LTRIM(RTRIM(ISNULL([pass], N''))) = N'1'
      ${kwSql}
    ORDER BY [code] ASC
  `)
  return r.recordset ?? []
}

function buildReportSql() {
  return `
    DECLARE @materialCode nvarchar(200) = LTRIM(RTRIM(ISNULL(@materialCodeRaw, N'')));
    DECLARE @materialName nvarchar(500) = LTRIM(RTRIM(ISNULL(@materialNameRaw, N'')));
    DECLARE @materialNameEn nvarchar(500) = LTRIM(RTRIM(ISNULL(@materialNameEnRaw, N'')));
    DECLARE @materialSpec nvarchar(500) = LTRIM(RTRIM(ISNULL(@materialSpecRaw, N'')));
    DECLARE @materialCategory nvarchar(100) = LTRIM(RTRIM(ISNULL(@materialCategoryRaw, N'')));
    DECLARE @unit nvarchar(100) = LTRIM(RTRIM(ISNULL(@unitRaw, N'')));
    DECLARE @colorCode nvarchar(100) = LTRIM(RTRIM(ISNULL(@colorCodeRaw, N'')));
    DECLARE @materialNameLike nvarchar(1010) = N'%' + REPLACE(REPLACE(REPLACE(@materialName, N'\\', N'\\\\'), N'%', N'\\%'), N'_', N'\\_') + N'%';
    DECLARE @materialNameEnLike nvarchar(1010) = N'%' + REPLACE(REPLACE(REPLACE(@materialNameEn, N'\\', N'\\\\'), N'%', N'\\%'), N'_', N'\\_') + N'%';
    DECLARE @materialSpecLike nvarchar(1010) = N'%' + REPLACE(REPLACE(REPLACE(@materialSpec, N'\\', N'\\\\'), N'%', N'\\%'), N'_', N'\\_') + N'%';
    DECLARE @materialCategoryLike nvarchar(210) = N'%' + REPLACE(REPLACE(REPLACE(@materialCategory, N'\\', N'\\\\'), N'%', N'\\%'), N'_', N'\\_') + N'%';
    DECLARE @cutoffEnd datetime = DATEADD(day, 1, @cutoffDate);
    DECLARE @poMinDate datetime = '${PO_MIN_DATE}';

    WITH base_in AS (
      SELECT
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) AS materialCode,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan06], N'')))) AS warehouseCode,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[ck], N'')))) AS warehouseName
      FROM ${STORAGE_HEADER} AS h
      INNER JOIN ${STORAGE_LINE} AS l
        ON LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcao01], N'')))) =
           LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan01], N''))))
      WHERE h.[kcan02] < @cutoffEnd
        AND (@allWarehouse = 1 OR LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan06], N'')))) = @warehouseCode)
        AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) <> N''
        AND (
          @materialCode = N''
          OR LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) = @materialCode
        )
      GROUP BY
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))),
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan06], N'')))),
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[ck], N''))))
    ),
    base_out AS (
      SELECT
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) AS materialCode,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcap06], N'')))) AS warehouseCode,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[ck], N'')))) AS warehouseName
      FROM ${OUT_HEADER} AS h
      INNER JOIN ${OUT_LINE} AS l
        ON LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaq01], N'')))) =
           LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcap01], N''))))
      WHERE h.[kcap02] < @cutoffEnd
        AND (@allWarehouse = 1 OR LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcap06], N'')))) = @warehouseCode)
        AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) <> N''
        AND (
          @materialCode = N''
          OR LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) = @materialCode
        )
      GROUP BY
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))),
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcap06], N'')))),
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[ck], N''))))
    ),
    base AS (
      SELECT materialCode, warehouseCode, warehouseName FROM base_in
      UNION
      SELECT materialCode, warehouseCode, warehouseName FROM base_out
    ),
    approved_in AS (
      SELECT
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) AS materialCode,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan06], N'')))) AS warehouseCode,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[ck], N'')))) AS warehouseName,
        SUM(${safeQty('l', 'kcao03')}) AS qty,
        MAX(CONVERT(date, h.[kcan02])) AS lastInDate
      FROM ${STORAGE_HEADER} AS h
      INNER JOIN ${STORAGE_LINE} AS l
        ON LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcao01], N'')))) =
           LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan01], N''))))
      WHERE (ISNULL(h.[del], N'') = N'' OR h.[del] = N'0')
        AND (ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')
        AND LTRIM(RTRIM(ISNULL(h.[pass], N''))) = N'1'
        AND h.[kcan02] < @cutoffEnd
        AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan06], N'')))) = @warehouseCode
        AND (
          @materialCode = N''
          OR LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) = @materialCode
        )
      GROUP BY
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))),
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan06], N'')))),
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[ck], N''))))
    ),
    unapproved_in AS (
      SELECT
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) AS materialCode,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan06], N'')))) AS warehouseCode,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[ck], N'')))) AS warehouseName,
        SUM(${safeQty('l', 'kcao03')}) AS qty
      FROM ${STORAGE_HEADER} AS h
      INNER JOIN ${STORAGE_LINE} AS l
        ON LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcao01], N'')))) =
           LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan01], N''))))
      WHERE LTRIM(RTRIM(ISNULL(h.[pass], N''))) = N'0'
        AND h.[kcan02] < @cutoffEnd
        AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan06], N'')))) = @warehouseCode
        AND (
          @materialCode = N''
          OR LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) = @materialCode
        )
      GROUP BY
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))),
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan06], N'')))),
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[ck], N''))))
    ),
    out_agg AS (
      SELECT
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) AS materialCode,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcap06], N'')))) AS warehouseCode,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[ck], N'')))) AS warehouseName,
        SUM(CASE WHEN LTRIM(RTRIM(ISNULL(h.[pass], N''))) = N'1' THEN ${safeQty('l', 'kcaq03')} ELSE 0 END) AS approvedOutQty,
        SUM(CASE WHEN LTRIM(RTRIM(ISNULL(h.[pass], N''))) = N'0' THEN ${safeQty('l', 'kcaq03')} ELSE 0 END) AS unapprovedOutQty,
        MAX(CASE WHEN LTRIM(RTRIM(ISNULL(h.[pass], N''))) = N'1' THEN CONVERT(date, h.[kcap02]) ELSE NULL END) AS lastOutDate
      FROM ${OUT_HEADER} AS h
      INNER JOIN ${OUT_LINE} AS l
        ON LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaq01], N'')))) =
           LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcap01], N''))))
      WHERE (ISNULL(h.[del], N'') = N'' OR h.[del] = N'0')
        AND (ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')
        AND h.[kcap02] < @cutoffEnd
        AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcap06], N'')))) = @warehouseCode
        AND (
          @materialCode = N''
          OR LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) = @materialCode
        )
      GROUP BY
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))),
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcap06], N'')))),
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[ck], N''))))
    ),
    bom_latest AS (
      SELECT *
      FROM (
        SELECT
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(x.[kcaa01], N'')))) AS materialCode,
          LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(x.[location], N'')))) AS [location],
          LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(x.[kcaa02], N'')))) AS [kcaa02],
          LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(x.[kcaa02_en], N'')))) AS [kcaa02_en],
          LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(x.[kcaa03], N'')))) AS [kcaa03],
          LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(x.[kcaa04], N'')))) AS [kcaa04],
          LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(x.[kcaa05], N'')))) AS [kcaa05],
          LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(x.[kcaa11], N'')))) AS [kcaa11],
          ROW_NUMBER() OVER (
            PARTITION BY LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(x.[kcaa01], N''))))
            ORDER BY x.[id] DESC
          ) AS rn
        FROM ${BOM_FROM} AS x
        WHERE (ISNULL(x.[del], N'') = N'' OR x.[del] = N'0')
          AND LTRIM(RTRIM(ISNULL(x.[pass], N''))) = N'1'
      ) AS q
      WHERE q.rn = 1
    ),
    po_purchase_qty AS (
      SELECT
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) AS materialCode,
        SUM(${buildUnitConvertQtySql('l', 'kcak03')}) AS convertedQty
      FROM ${BUY_LINE} AS l
      INNER JOIN ${BUY_HEADER} AS h
        ON LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcak01], N'')))) =
           LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcaj01], N''))))
      WHERE ${buildPoHeaderActiveSql('h')}
        AND (ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')
        AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) <> N''
        AND (
          @materialCode = N''
          OR LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) = @materialCode
        )
      GROUP BY LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N''))))
    ),
    po_inbound_qty AS (
      SELECT
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) AS materialCode,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan06], N'')))) AS warehouseCode,
        SUM(${buildUnitConvertQtySql('l', 'kcao03')}) AS convertedQty
      FROM ${STORAGE_HEADER} AS h
      INNER JOIN ${STORAGE_LINE} AS l
        ON LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcao01], N'')))) =
           LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan01], N''))))
      INNER JOIN ${BUY_HEADER} AS poh
        ON LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan04], N'')))) =
           LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(poh.[kcaj01], N''))))
      WHERE (ISNULL(h.[del], N'') = N'' OR h.[del] = N'0')
        AND LTRIM(RTRIM(ISNULL(h.[pass], N''))) = N'1'
        AND (ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')
        AND LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(h.[kcan03], N'')))) = N'1'
        AND h.[kcan02] < @cutoffEnd
        AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan06], N'')))) = @warehouseCode
        AND ${buildPoHeaderActiveSql('poh')}
        AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) <> N''
        AND (
          @materialCode = N''
          OR LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) = @materialCode
        )
      GROUP BY
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))),
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan06], N''))))
    ),
    final_rows AS (
      SELECT
        b.materialCode,
        b.warehouseCode,
        b.warehouseName,
        ISNULL(ai.qty, 0) AS approvedInQty,
        ISNULL(ui.qty, 0) AS unapprovedInQty,
        ISNULL(o.approvedOutQty, 0) AS approvedOutQty,
        ISNULL(o.unapprovedOutQty, 0) AS unapprovedOutQty,
        ai.lastInDate,
        o.lastOutDate,
        ISNULL(bl.[location], N'') AS [location],
        ISNULL(bl.materialCode, b.materialCode) AS [kcaa01],
        ISNULL(bl.[kcaa02], N'') AS [kcaa02],
        ISNULL(bl.[kcaa02_en], N'') AS [kcaa02_en],
        ISNULL(bl.[kcaa03], N'') AS [kcaa03],
        ISNULL(bl.[kcaa04], N'') AS [kcaa04],
        ISNULL(bl.[kcaa05], N'') AS [kcaa05],
        ISNULL(bl.[kcaa11], N'') AS [kcaa11],
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(cat.[name], N'')))) AS categoryName,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(color.[name], N'')))) AS colorName,
        ISNULL(ai.qty, 0) - ISNULL(o.approvedOutQty, 0) AS bookedQty,
        (ISNULL(ai.qty, 0) - ISNULL(o.approvedOutQty, 0) - ISNULL(o.unapprovedOutQty, 0)) AS actualQty,
        CASE
          WHEN ISNULL(pp.convertedQty, 0) - ISNULL(pi.convertedQty, 0) > 0.000001
            THEN ISNULL(pp.convertedQty, 0) - ISNULL(pi.convertedQty, 0)
          ELSE 0
        END AS inTransitQty
      FROM base AS b
      LEFT JOIN approved_in AS ai
        ON ai.materialCode = b.materialCode AND ai.warehouseCode = b.warehouseCode AND ai.warehouseName = b.warehouseName
      LEFT JOIN unapproved_in AS ui
        ON ui.materialCode = b.materialCode AND ui.warehouseCode = b.warehouseCode AND ui.warehouseName = b.warehouseName
      LEFT JOIN out_agg AS o
        ON o.materialCode = b.materialCode AND o.warehouseCode = b.warehouseCode AND o.warehouseName = b.warehouseName
      LEFT JOIN bom_latest AS bl
        ON bl.materialCode = b.materialCode
      LEFT JOIN ${MATERIAL_FROM} AS cat
        ON LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(cat.[code], N'')))) = ISNULL(bl.[kcaa05], N'')
        AND (ISNULL(cat.[del], N'') = N'' OR cat.[del] = N'0')
        AND LTRIM(RTRIM(ISNULL(cat.[pass], N''))) = N'1'
      LEFT JOIN ${COLOR_FROM} AS color
        ON LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(color.[code], N'')))) = ISNULL(bl.[kcaa11], N'')
        AND (ISNULL(color.[del], N'') = N'' OR color.[del] = N'0')
        AND LTRIM(RTRIM(ISNULL(color.[pass], N''))) = N'1'
      LEFT JOIN po_purchase_qty AS pp
        ON pp.materialCode = b.materialCode
      LEFT JOIN po_inbound_qty AS pi
        ON pi.materialCode = b.materialCode AND pi.warehouseCode = b.warehouseCode
    )
    SELECT
      materialCode,
      warehouseCode,
      warehouseName,
      approvedInQty,
      unapprovedInQty,
      approvedOutQty,
      unapprovedOutQty,
      lastInDate,
      lastOutDate,
      [location],
      [kcaa01],
      [kcaa02],
      [kcaa02_en],
      [kcaa03],
      [kcaa04],
      [kcaa05],
      [kcaa11],
      categoryName,
      colorName,
      bookedQty,
      actualQty,
      inTransitQty
    FROM final_rows
    WHERE
      (@materialName = N'' OR [kcaa02] LIKE @materialNameLike ESCAPE N'\\')
      AND (@materialNameEn = N'' OR [kcaa02_en] LIKE @materialNameEnLike ESCAPE N'\\')
      AND (@materialSpec = N'' OR [kcaa03] LIKE @materialSpecLike ESCAPE N'\\')
      AND (
        @materialCategory = N''
        OR [kcaa05] LIKE @materialCategoryLike ESCAPE N'\\'
        OR categoryName LIKE @materialCategoryLike ESCAPE N'\\'
      )
      AND (@unit = N'' OR [kcaa04] = @unit)
      AND (@colorCode = N'' OR [kcaa11] = @colorCode)
      AND (@onlyMaterial = 0 OR categoryName NOT LIKE N'%成品%')
      AND (@onlyFinished = 0 OR categoryName LIKE N'%成品%')
      -- “库存不等于零”在业务上按“只看正库存”处理：过滤掉 0 和负数账存。
      AND (@nonZero = 0 OR bookedQty > 0.000001)
      AND (@availableNegative = 0 OR actualQty < 0)
      AND (
        @dormantDaysGt <= 0
        OR (lastInDate IS NOT NULL AND DATEDIFF(day, lastInDate, @cutoffDate) > @dormantDaysGt)
      )
    ORDER BY materialCode ASC, warehouseCode ASC, warehouseName ASC
  `
}

function buildSelectedCategorySetupSql(categoryParamNames) {
  const inserts = categoryParamNames
    .map((paramName) => `INSERT INTO #selectedCategory ([code]) VALUES (LTRIM(RTRIM(ISNULL(@${paramName}, N''))));`)
    .join('\n    ')
  return `
    CREATE TABLE #selectedCategory ([code] nvarchar(100) NOT NULL PRIMARY KEY);
    ${inserts}
  `
}

function buildSelectedCategoryFilter(lineAlias = 'l') {
  return `AND (
      NOT EXISTS (SELECT 1 FROM #selectedCategory)
      OR EXISTS (
        SELECT 1
        FROM #selectedCategory AS selectedCategory
        WHERE selectedCategory.[code] = LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(${lineAlias}.[kcaa05], N''))))
      )
    )`
}

export function buildStockStatsReportTempTableSql(categoryParamNames = []) {
  const selectedCategorySetupSql = buildSelectedCategorySetupSql(categoryParamNames)
  const selectedCategoryFilter = buildSelectedCategoryFilter('l')
  return `
    DECLARE @materialCode nvarchar(200) = LTRIM(RTRIM(ISNULL(@materialCodeRaw, N'')));
    DECLARE @materialName nvarchar(500) = LTRIM(RTRIM(ISNULL(@materialNameRaw, N'')));
    DECLARE @materialNameEn nvarchar(500) = LTRIM(RTRIM(ISNULL(@materialNameEnRaw, N'')));
    DECLARE @materialSpec nvarchar(500) = LTRIM(RTRIM(ISNULL(@materialSpecRaw, N'')));
    DECLARE @unit nvarchar(100) = LTRIM(RTRIM(ISNULL(@unitRaw, N'')));
    DECLARE @colorCode nvarchar(100) = LTRIM(RTRIM(ISNULL(@colorCodeRaw, N'')));
    DECLARE @materialNameLike nvarchar(1010) = N'%' + REPLACE(REPLACE(REPLACE(@materialName, N'\\', N'\\\\'), N'%', N'\\%'), N'_', N'\\_') + N'%';
    DECLARE @materialNameEnLike nvarchar(1010) = N'%' + REPLACE(REPLACE(REPLACE(@materialNameEn, N'\\', N'\\\\'), N'%', N'\\%'), N'_', N'\\_') + N'%';
    DECLARE @materialSpecLike nvarchar(1010) = N'%' + REPLACE(REPLACE(REPLACE(@materialSpec, N'\\', N'\\\\'), N'%', N'\\%'), N'_', N'\\_') + N'%';
    DECLARE @cutoffEnd datetime = DATEADD(day, 1, @cutoffDate);
    DECLARE @poMinDate datetime = '${PO_MIN_DATE}';

    IF OBJECT_ID('tempdb..#base') IS NOT NULL DROP TABLE #base;
    IF OBJECT_ID('tempdb..#ai') IS NOT NULL DROP TABLE #ai;
    IF OBJECT_ID('tempdb..#ui') IS NOT NULL DROP TABLE #ui;
    IF OBJECT_ID('tempdb..#oa') IS NOT NULL DROP TABLE #oa;
    IF OBJECT_ID('tempdb..#bom') IS NOT NULL DROP TABLE #bom;
    IF OBJECT_ID('tempdb..#pp') IS NOT NULL DROP TABLE #pp;
    IF OBJECT_ID('tempdb..#pi') IS NOT NULL DROP TABLE #pi;
    IF OBJECT_ID('tempdb..#selectedCategory') IS NOT NULL DROP TABLE #selectedCategory;
${selectedCategorySetupSql}

    SELECT materialCode, warehouseCode, warehouseName
    INTO #base
    FROM (
      SELECT
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) AS materialCode,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan06], N'')))) AS warehouseCode,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[ck], N'')))) AS warehouseName
      FROM ${STORAGE_HEADER} AS h
      INNER JOIN ${STORAGE_LINE} AS l
        ON LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcao01], N'')))) =
           LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan01], N''))))
      WHERE h.[kcan02] < @cutoffEnd
        AND (@allWarehouse = 1 OR LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan06], N'')))) = @warehouseCode)
        AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) <> N''
        AND (@materialCode = N'' OR LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) = @materialCode)
        ${selectedCategoryFilter}
      GROUP BY
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))),
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan06], N'')))),
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[ck], N''))))
      UNION
      SELECT
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) AS materialCode,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcap06], N'')))) AS warehouseCode,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[ck], N'')))) AS warehouseName
      FROM ${OUT_HEADER} AS h
      INNER JOIN ${OUT_LINE} AS l
        ON LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaq01], N'')))) =
           LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcap01], N''))))
      WHERE h.[kcap02] < @cutoffEnd
        AND (@allWarehouse = 1 OR LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcap06], N'')))) = @warehouseCode)
        AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) <> N''
        AND (@materialCode = N'' OR LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) = @materialCode)
        AND NOT EXISTS (SELECT 1 FROM #selectedCategory)
      GROUP BY
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))),
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcap06], N'')))),
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[ck], N''))))
    ) AS s;
    CREATE INDEX IX_stock_stats_base ON #base(materialCode, warehouseCode, warehouseName);

    SELECT
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) AS materialCode,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan06], N'')))) AS warehouseCode,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[ck], N'')))) AS warehouseName,
      SUM(${safeQty('l', 'kcao03')}) AS qty,
      MAX(CONVERT(date, h.[kcan02])) AS lastInDate
    INTO #ai
    FROM ${STORAGE_HEADER} AS h
    INNER JOIN ${STORAGE_LINE} AS l
      ON LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcao01], N'')))) =
         LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan01], N''))))
    WHERE (ISNULL(h.[del], N'') = N'' OR h.[del] = N'0')
      AND (ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')
      AND LTRIM(RTRIM(ISNULL(h.[pass], N''))) = N'1'
      AND h.[kcan02] < @cutoffEnd
      AND (@allWarehouse = 1 OR LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan06], N'')))) = @warehouseCode)
      AND (@materialCode = N'' OR LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) = @materialCode)
      ${selectedCategoryFilter}
    GROUP BY
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))),
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan06], N'')))),
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[ck], N''))));
    CREATE INDEX IX_stock_stats_ai ON #ai(materialCode, warehouseCode, warehouseName);

    SELECT
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) AS materialCode,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan06], N'')))) AS warehouseCode,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[ck], N'')))) AS warehouseName,
      SUM(${safeQty('l', 'kcao03')}) AS qty
    INTO #ui
    FROM ${STORAGE_HEADER} AS h
    INNER JOIN ${STORAGE_LINE} AS l
      ON LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcao01], N'')))) =
         LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan01], N''))))
    WHERE LTRIM(RTRIM(ISNULL(h.[pass], N''))) = N'0'
      AND h.[kcan02] < @cutoffEnd
      AND (@allWarehouse = 1 OR LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan06], N'')))) = @warehouseCode)
      AND (@materialCode = N'' OR LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) = @materialCode)
      ${selectedCategoryFilter}
    GROUP BY
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))),
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan06], N'')))),
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[ck], N''))));
    CREATE INDEX IX_stock_stats_ui ON #ui(materialCode, warehouseCode, warehouseName);

    SELECT
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) AS materialCode,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcap06], N'')))) AS warehouseCode,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[ck], N'')))) AS warehouseName,
      SUM(CASE WHEN LTRIM(RTRIM(ISNULL(h.[pass], N''))) = N'1' THEN ${safeQty('l', 'kcaq03')} ELSE 0 END) AS approvedOutQty,
      SUM(CASE WHEN LTRIM(RTRIM(ISNULL(h.[pass], N''))) = N'0' THEN ${safeQty('l', 'kcaq03')} ELSE 0 END) AS unapprovedOutQty,
      MAX(CASE WHEN LTRIM(RTRIM(ISNULL(h.[pass], N''))) = N'1' THEN CONVERT(date, h.[kcap02]) ELSE NULL END) AS lastOutDate
    INTO #oa
    FROM ${OUT_HEADER} AS h
    INNER JOIN ${OUT_LINE} AS l
      ON LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaq01], N'')))) =
         LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcap01], N''))))
    WHERE (ISNULL(h.[del], N'') = N'' OR h.[del] = N'0')
      AND (ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')
      AND h.[kcap02] < @cutoffEnd
      AND (@allWarehouse = 1 OR LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcap06], N'')))) = @warehouseCode)
      AND (@materialCode = N'' OR LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) = @materialCode)
    GROUP BY
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))),
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcap06], N'')))),
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[ck], N''))));
    CREATE INDEX IX_stock_stats_oa ON #oa(materialCode, warehouseCode, warehouseName);

    SELECT
      materialCode,
      [location],
      [kcaa02],
      [kcaa02_en],
      [kcaa03],
      [kcaa04],
      [kcaa05],
      [kcaa11]
    INTO #bom
    FROM (
      SELECT
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(x.[kcaa01], N'')))) AS materialCode,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(x.[location], N'')))) AS [location],
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(x.[kcaa02], N'')))) AS [kcaa02],
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(x.[kcaa02_en], N'')))) AS [kcaa02_en],
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(x.[kcaa03], N'')))) AS [kcaa03],
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(x.[kcaa04], N'')))) AS [kcaa04],
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(x.[kcaa05], N'')))) AS [kcaa05],
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(x.[kcaa11], N'')))) AS [kcaa11],
        ROW_NUMBER() OVER (
          PARTITION BY LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(x.[kcaa01], N''))))
          ORDER BY x.[id] DESC
        ) AS rn
      FROM ${BOM_FROM} AS x
      WHERE (ISNULL(x.[del], N'') = N'' OR x.[del] = N'0')
        AND LTRIM(RTRIM(ISNULL(x.[pass], N''))) = N'1'
    ) AS q
    WHERE q.rn = 1;
    CREATE INDEX IX_stock_stats_bom ON #bom(materialCode);

    SELECT
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) AS materialCode,
      SUM(${buildUnitConvertQtySql('l', 'kcak03')}) AS convertedQty
    INTO #pp
    FROM ${BUY_LINE} AS l
    INNER JOIN ${BUY_HEADER} AS h
      ON LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcak01], N'')))) =
         LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcaj01], N''))))
    WHERE ${buildPoHeaderActiveSql('h')}
      AND (ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')
      AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) <> N''
      AND (@materialCode = N'' OR LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) = @materialCode)
    GROUP BY LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N''))));
    CREATE INDEX IX_stock_stats_pp ON #pp(materialCode);

    SELECT
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) AS materialCode,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan06], N'')))) AS warehouseCode,
      SUM(${buildUnitConvertQtySql('l', 'kcao03')}) AS convertedQty
    INTO #pi
    FROM ${STORAGE_HEADER} AS h
    INNER JOIN ${STORAGE_LINE} AS l
      ON LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcao01], N'')))) =
         LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan01], N''))))
    INNER JOIN ${BUY_HEADER} AS poh
      ON LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan04], N'')))) =
         LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(poh.[kcaj01], N''))))
    WHERE (ISNULL(h.[del], N'') = N'' OR h.[del] = N'0')
      AND LTRIM(RTRIM(ISNULL(h.[pass], N''))) = N'1'
      AND (ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')
      AND LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(h.[kcan03], N'')))) = N'1'
      AND h.[kcan02] < @cutoffEnd
      AND (@allWarehouse = 1 OR LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan06], N'')))) = @warehouseCode)
      AND ${buildPoHeaderActiveSql('poh')}
      AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) <> N''
      AND (@materialCode = N'' OR LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) = @materialCode)
      ${selectedCategoryFilter}
    GROUP BY
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))),
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan06], N''))));
    CREATE INDEX IX_stock_stats_pi ON #pi(materialCode, warehouseCode);

    SELECT
      r.materialCode,
      r.warehouseCode,
      r.warehouseName,
      r.approvedInQty,
      r.unapprovedInQty,
      r.approvedOutQty,
      r.unapprovedOutQty,
      r.lastInDate,
      r.lastOutDate,
      r.[location],
      r.[kcaa01],
      r.[kcaa02],
      r.[kcaa02_en],
      r.[kcaa03],
      r.[kcaa04],
      r.[kcaa05],
      r.[kcaa11],
      r.categoryName,
      r.colorName,
      r.bookedQty,
      r.actualQty,
      r.inTransitQty
    FROM (
      SELECT
        b.materialCode,
        b.warehouseCode,
        b.warehouseName,
        ISNULL(ai.qty, 0) AS approvedInQty,
        ISNULL(ui.qty, 0) AS unapprovedInQty,
        ISNULL(o.approvedOutQty, 0) AS approvedOutQty,
        ISNULL(o.unapprovedOutQty, 0) AS unapprovedOutQty,
        ai.lastInDate,
        o.lastOutDate,
        ISNULL(bl.[location], N'') AS [location],
        ISNULL(bl.materialCode, b.materialCode) AS [kcaa01],
        ISNULL(bl.[kcaa02], N'') AS [kcaa02],
        ISNULL(bl.[kcaa02_en], N'') AS [kcaa02_en],
        ISNULL(bl.[kcaa03], N'') AS [kcaa03],
        ISNULL(bl.[kcaa04], N'') AS [kcaa04],
        ISNULL(bl.[kcaa05], N'') AS [kcaa05],
        ISNULL(bl.[kcaa11], N'') AS [kcaa11],
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(cat.[name], N'')))) AS categoryName,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(color.[name], N'')))) AS colorName,
        ISNULL(ai.qty, 0) - ISNULL(o.approvedOutQty, 0) AS bookedQty,
        (ISNULL(ai.qty, 0) - ISNULL(o.approvedOutQty, 0) - ISNULL(o.unapprovedOutQty, 0)) AS actualQty,
        CASE
          WHEN ISNULL(pp.convertedQty, 0) - ISNULL(pi.convertedQty, 0) > 0.000001
            THEN ISNULL(pp.convertedQty, 0) - ISNULL(pi.convertedQty, 0)
          ELSE 0
        END AS inTransitQty
      FROM #base AS b
      LEFT JOIN #ai AS ai
        ON ai.materialCode = b.materialCode AND ai.warehouseCode = b.warehouseCode AND ai.warehouseName = b.warehouseName
      LEFT JOIN #ui AS ui
        ON ui.materialCode = b.materialCode AND ui.warehouseCode = b.warehouseCode AND ui.warehouseName = b.warehouseName
      LEFT JOIN #oa AS o
        ON o.materialCode = b.materialCode AND o.warehouseCode = b.warehouseCode AND o.warehouseName = b.warehouseName
      LEFT JOIN #bom AS bl
        ON bl.materialCode = b.materialCode
      LEFT JOIN ${MATERIAL_FROM} AS cat
        ON LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(cat.[code], N'')))) = ISNULL(bl.[kcaa05], N'')
        AND (ISNULL(cat.[del], N'') = N'' OR cat.[del] = N'0')
        AND LTRIM(RTRIM(ISNULL(cat.[pass], N''))) = N'1'
      LEFT JOIN ${COLOR_FROM} AS color
        ON LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(color.[code], N'')))) = ISNULL(bl.[kcaa11], N'')
        AND (ISNULL(color.[del], N'') = N'' OR color.[del] = N'0')
        AND LTRIM(RTRIM(ISNULL(color.[pass], N''))) = N'1'
      LEFT JOIN #pp AS pp
        ON pp.materialCode = b.materialCode
      LEFT JOIN #pi AS pi
        ON pi.materialCode = b.materialCode AND pi.warehouseCode = b.warehouseCode
    ) AS r
    WHERE
      (@materialName = N'' OR r.[kcaa02] LIKE @materialNameLike ESCAPE N'\\')
      AND (@materialNameEn = N'' OR r.[kcaa02_en] LIKE @materialNameEnLike ESCAPE N'\\')
      AND (@materialSpec = N'' OR r.[kcaa03] LIKE @materialSpecLike ESCAPE N'\\')
      AND (@unit = N'' OR r.[kcaa04] = @unit)
      AND (@colorCode = N'' OR r.[kcaa11] = @colorCode)
      AND (@onlyMaterial = 0 OR r.categoryName NOT LIKE N'%成品%')
      AND (@onlyFinished = 0 OR r.categoryName LIKE N'%成品%')
      AND (@nonZero = 0 OR r.bookedQty > 0.000001)
      AND (@availableNegative = 0 OR r.actualQty < 0)
      AND (
        @dormantDaysGt <= 0
        OR (r.lastInDate IS NOT NULL AND DATEDIFF(day, r.lastInDate, @cutoffDate) > @dormantDaysGt)
      )
    ORDER BY r.materialCode ASC, r.warehouseCode ASC, r.warehouseName ASC;
  `
}

function formatDateOnly(value) {
  if (!value) return ''
  const d = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(d.getTime())) return String(value).slice(0, 10)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function buildRow(row) {
  const approvedInQty = Number(row?.approvedInQty ?? 0)
  const unapprovedInQty = Number(row?.unapprovedInQty ?? 0)
  const approvedOutQty = Number(row?.approvedOutQty ?? 0)
  const unapprovedOutQty = Number(row?.unapprovedOutQty ?? 0)
  const bookedQty = approvedInQty - approvedOutQty
  const actualQty = bookedQty - unapprovedOutQty
  const inTransitQty = Math.max(0, Number(row?.inTransitQty ?? 0))

  return {
    rowKey: `${text(row?.materialCode)}|${text(row?.warehouseCode)}|${text(row?.warehouseName)}`,
    warehouseCode: text(row?.warehouseCode),
    warehouseName: text(row?.warehouseName),
    categoryCode: text(row?.kcaa05),
    categoryName: text(row?.categoryName),
    categoryText: text(row?.categoryName) ? `${text(row.categoryName)} / ${text(row.kcaa05)}` : text(row?.kcaa05),
    location: text(row?.location),
    materialCode: text(row?.kcaa01 || row?.materialCode),
    materialName: text(row?.kcaa02),
    materialNameEn: text(row?.kcaa02_en),
    materialSpec: text(row?.kcaa03),
    colorCode: text(row?.kcaa11),
    colorName: text(row?.colorName),
    unit: text(row?.kcaa04),
    bookedQty,
    unapprovedInQty,
    deductQty: '',
    actualQty,
    reservedQty: '',
    inTransitQty,
    availableQty: actualQty,
    lastInDate: formatDateOnly(row?.lastInDate),
    lastOutDate: formatDateOnly(row?.lastOutDate),
  }
}

function sumRows(rows) {
  return rows.reduce(
    (acc, row) => {
      acc.bookedQty += Number(row.bookedQty ?? 0)
      acc.unapprovedInQty += Number(row.unapprovedInQty ?? 0)
      acc.actualQty += Number(row.actualQty ?? 0)
      acc.availableQty += Number(row.availableQty ?? 0)
      return acc
    },
    { bookedQty: 0, unapprovedInQty: 0, actualQty: 0, availableQty: 0 },
  )
}

export function registerStockStatsRoutes(app, { getPool }) {
  app.get('/api/stock-stats/print-header', async (req, res) => {
    try {
      const pool = await getPool()
      res.json({ code: 200, msg: 'success', data: await fetchStockStatsPrintHeader(pool) })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取打印抬头失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  app.get('/api/stock-stats/warehouse-options', async (req, res) => {
    try {
      const pool = await getPool()
      const list = await fetchStockStatsWarehouseOptions(pool, text(req.query?.keyword))
      res.json({ code: 200, msg: 'success', data: { list } })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取仓库失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  app.get('/api/stock-stats/material-options', async (req, res) => {
    try {
      const pool = await getPool()
      const list = await fetchStockStatsMaterialOptions(pool, text(req.query?.keyword))
      res.json({ code: 200, msg: 'success', data: { list } })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取物料候选失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  app.get('/api/stock-stats/category-options', async (req, res) => {
    try {
      const pool = await getPool()
      const { page, pageSize } = normalizeOptionPage(req.query?.page, req.query?.pageSize)
      const result = await fetchStockStatsCategoryOptions(pool, text(req.query?.keyword), page, pageSize)
      res.json({ code: 200, msg: 'success', data: { ...result, page, pageSize } })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取类别候选失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  app.get('/api/stock-stats/color-options', async (req, res) => {
    try {
      const pool = await getPool()
      const list = await fetchStockStatsColorOptions(pool, text(req.query?.keyword))
      res.json({ code: 200, msg: 'success', data: { list } })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取颜色候选失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  app.get('/api/stock-stats/report', async (req, res) => {
    try {
      const cutoffDate = text(req.query?.cutoffDate)
      const warehouseCode = text(req.query?.warehouseCode)
      const allWarehouse = warehouseCode === ALL_WAREHOUSE
      if (!cutoffDate) return res.status(400).json({ code: 400, msg: '库存截止日期不能为空', data: null })
      if (!warehouseCode) return res.status(400).json({ code: 400, msg: '仓库不能为空', data: null })

      const pool = await getPool()
      const dbReq = pool.request()
      dbReq.input('cutoffDate', sql.Date, cutoffDate)
      dbReq.input('warehouseCode', sql.NVarChar(200), warehouseCode)
      dbReq.input('allWarehouse', sql.Bit, allWarehouse)
      dbReq.input('materialCodeRaw', sql.NVarChar(200), text(req.query?.materialCode))
      dbReq.input('materialNameRaw', sql.NVarChar(500), text(req.query?.materialName))
      dbReq.input('materialNameEnRaw', sql.NVarChar(500), text(req.query?.materialNameEn))
      dbReq.input('materialSpecRaw', sql.NVarChar(500), text(req.query?.materialSpec))
      const categoryCodes = normalizeStockStatsCategoryCodes(
        req.query?.materialCategoryCodes ?? req.query?.materialCategory,
      )
      const categoryParamNames = categoryCodes.map((_, index) => `selectedCategory${index}`)
      categoryCodes.forEach((categoryCode, index) => {
        dbReq.input(categoryParamNames[index], sql.NVarChar(100), categoryCode)
      })
      dbReq.input('unitRaw', sql.NVarChar(100), text(req.query?.unit))
      dbReq.input('colorCodeRaw', sql.NVarChar(100), text(req.query?.colorCode))
      dbReq.input('onlyMaterial', sql.Bit, normalizeBool(req.query?.onlyMaterial))
      dbReq.input('onlyFinished', sql.Bit, normalizeBool(req.query?.onlyFinished))
      dbReq.input('nonZero', sql.Bit, normalizeBool(req.query?.nonZero))
      dbReq.input('availableNegative', sql.Bit, normalizeBool(req.query?.availableNegative))
      dbReq.input('dormantDaysGt', sql.Int, Math.max(0, Number(req.query?.dormantDaysGt ?? 0) || 0))
      const result = await dbReq.query(buildStockStatsReportTempTableSql(categoryParamNames))
      const rows = (result.recordset ?? []).map(buildRow)

      res.json({
        code: 200,
        msg: 'success',
        data: {
          cutoffDate,
          warehouseCode,
          allWarehouse,
          total: rows.length,
          totals: sumRows(rows),
          list: rows,
        },
      })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取库存统计报表失败：${String(err?.message ?? err)}`, data: null })
    }
  })
}
