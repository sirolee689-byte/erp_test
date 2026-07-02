/**
 * 普通库存统计计算：类型编号与加权公式单源（SQL Server 2008 R2）
 * 金额口径：入库 kcao05、出库 kcaq05（不含税金额，与旧库存统计加权习惯一致）
 */
import { safeDecimalExpr, safeIntExpr, nvarcharTextExpr } from './buyOrderSqlSafe.js'
import { buildStockStatsMaterialExcludeSql } from './stockStatsMaterialExclude.js'

const STORAGE_HEADER = 'dbo.[UB_ERP_Stocks_Storage]'
const STORAGE_LINE = 'dbo.[UB_ERP_Stocks_Storage_list]'
const OUT_HEADER = 'dbo.[UB_ERP_Stocks_out]'
const OUT_LINE = 'dbo.[UB_ERP_Stocks_out_list]'

function text(v) {
  return String(v ?? '').trim()
}

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function roundQty(n) {
  return Math.round(n * 1000) / 1000
}

function roundPrice(n) {
  return Math.round(n * 1000000) / 1000000
}

function roundMoney(n) {
  return Math.round(n * 100) / 100
}

function headerActiveSql(alias) {
  return `(ISNULL(${alias}.[del], N'') = N'' OR ${alias}.[del] = N'0') AND LTRIM(RTRIM(ISNULL(${alias}.[pass], N''))) = N'1'`
}

function lineActiveSql(alias) {
  return `(ISNULL(${alias}.[del], N'') = N'' OR ${alias}.[del] = N'0')`
}

const MATERIAL_COL_IN = nvarcharTextExpr('l', 'kcaa01')
const WAREHOUSE_COL_IN = nvarcharTextExpr('h', 'kcan06')
const MATERIAL_COL_OUT = nvarcharTextExpr('l', 'kcaa01')
const WAREHOUSE_COL_OUT = nvarcharTextExpr('h', 'kcap06')
const IN_TYPE_EXPR = safeIntExpr('h', 'kcan03', -1)
const OUT_TYPE_EXPR = safeIntExpr('h', 'kcap03', -1)
const IN_DATE_EXPR = `CONVERT(date, h.[kcan02])`
const OUT_DATE_EXPR = `CONVERT(date, h.[kcap02])`
const IN_QTY_EXPR = safeDecimalExpr('l', 'kcao03', 0)
const IN_MONEY_EXPR = safeDecimalExpr('l', 'kcao05', 0)
const OUT_QTY_EXPR = safeDecimalExpr('l', 'kcaq03', 0)
const OUT_MONEY_EXPR = safeDecimalExpr('l', 'kcaq05', 0)

/**
 * 由 SQL 聚合原始分量计算一行统计（纯函数，便于单测）
 * @param {object} raw
 */
export function computeStockStatsRow(raw = {}) {
  const openingInQty = num(raw.openingInQty)
  const openingOutQty = num(raw.openingOutQty)
  const openingInMoney = num(raw.openingInMoney)

  const lastsum = roundQty(openingInQty - openingOutQty)
  const lastprice = openingInQty > 0 ? roundPrice(openingInMoney / openingInQty) : 0
  const lastmoney = roundMoney(lastsum * lastprice)

  const nowin = roundQty(num(raw.periodIn010125Qty) - num(raw.periodOut1Qty))
  const nowmoney = roundMoney(num(raw.periodIn010125Money) - num(raw.periodOut1Money))
  const nowinprice = nowin > 0 ? roundPrice(nowmoney / nowin) : 0

  const nowout = roundQty(num(raw.periodOut407102Qty) - num(raw.periodIn34Qty))
  const weightedDenom = lastsum + nowin
  const nowoutprice = weightedDenom > 0 ? roundPrice((lastmoney + nowmoney) / weightedDenom) : 0
  const nowoutmoney = roundMoney(nowout * nowoutprice)

  const nowbs = roundQty(num(raw.periodOut8Qty))
  const nowbsprice = nowoutprice
  const nowbsmonney = roundMoney(nowbs * nowbsprice)

  const hzkcm = roundQty(num(raw.periodIn7Qty) - num(raw.periodOut9Qty))
  const hzmoney = roundMoney(num(raw.periodIn7Money) - num(raw.periodOut9Money))

  const nowsum = roundQty(lastsum + nowin - nowout - nowbs + hzkcm)
  const nowmoneys = roundMoney(lastmoney + nowmoney - nowoutmoney - nowbsmonney + hzmoney)
  const nowprice = nowsum > 0 ? roundPrice(nowmoneys / nowsum) : 0

  return {
    kcaa01: text(raw.kcaa01),
    warehouseCode: text(raw.warehouseCode),
    kcaa02: text(raw.kcaa02),
    kcaa03: text(raw.kcaa03),
    kcaa04: text(raw.kcaa04),
    lastsum,
    lastprice,
    lastmoney,
    nowin,
    nowinprice,
    nowmoney,
    nowout,
    nowoutprice,
    nowoutmoney,
    nowbs,
    nowbsprice,
    nowbsmonney,
    hzkcm,
    hzmoney,
    nowsum,
    nowprice,
    nowmoneys,
  }
}

function buildAggSql({ materialFilter = '' } = {}) {
  const excludeIn = buildStockStatsMaterialExcludeSql('l')
  const excludeOut = buildStockStatsMaterialExcludeSql('l')
  let materialInSql = ''
  let materialOutSql = ''
  if (materialFilter) {
    materialInSql = `AND ${MATERIAL_COL_IN} LIKE @materialFilter`
    materialOutSql = `AND ${MATERIAL_COL_OUT} LIKE @materialFilter`
  }

  return `
    WITH in_base AS (
      SELECT
        ${MATERIAL_COL_IN} AS materialCode,
        ${WAREHOUSE_COL_IN} AS warehouseCode,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa02], N'')))) AS kcaa02,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa03], N'')))) AS kcaa03,
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(l.[kcaa04], N'')))) AS kcaa04,
        ${IN_DATE_EXPR} AS docDate,
        ${IN_TYPE_EXPR} AS docType,
        ${IN_QTY_EXPR} AS qty,
        ${IN_MONEY_EXPR} AS money
      FROM ${STORAGE_LINE} AS l
      INNER JOIN ${STORAGE_HEADER} AS h
        ON LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan01], N'')))) =
           LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcao01], N''))))
      WHERE ${headerActiveSql('h')}
        AND ${lineActiveSql('l')}
        AND ${WAREHOUSE_COL_IN} = @warehouseCode
        AND ${excludeIn}
        ${materialInSql}
    ),
    in_agg AS (
      SELECT
        materialCode,
        warehouseCode,
        MAX(kcaa02) AS kcaa02,
        MAX(kcaa03) AS kcaa03,
        MAX(kcaa04) AS kcaa04,
        SUM(CASE WHEN docDate < @startDate THEN qty ELSE 0 END) AS openingInQty,
        SUM(CASE WHEN docDate < @startDate THEN money ELSE 0 END) AS openingInMoney,
        SUM(CASE WHEN docDate >= @startDate AND docDate <= @endDate AND docType IN (0, 1, 2, 5) THEN qty ELSE 0 END) AS periodIn010125Qty,
        SUM(CASE WHEN docDate >= @startDate AND docDate <= @endDate AND docType IN (0, 1, 2, 5) THEN money ELSE 0 END) AS periodIn010125Money,
        SUM(CASE WHEN docDate >= @startDate AND docDate <= @endDate AND docType IN (3, 4) THEN qty ELSE 0 END) AS periodIn34Qty,
        SUM(CASE WHEN docDate >= @startDate AND docDate <= @endDate AND docType = 7 THEN qty ELSE 0 END) AS periodIn7Qty,
        SUM(CASE WHEN docDate >= @startDate AND docDate <= @endDate AND docType = 7 THEN money ELSE 0 END) AS periodIn7Money
      FROM in_base
      GROUP BY materialCode, warehouseCode
    ),
    out_base AS (
      SELECT
        ${MATERIAL_COL_OUT} AS materialCode,
        ${WAREHOUSE_COL_OUT} AS warehouseCode,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa02], N'')))) AS kcaa02,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa03], N'')))) AS kcaa03,
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(l.[kcaa04], N'')))) AS kcaa04,
        ${OUT_DATE_EXPR} AS docDate,
        ${OUT_TYPE_EXPR} AS docType,
        ${OUT_QTY_EXPR} AS qty,
        ${OUT_MONEY_EXPR} AS money
      FROM ${OUT_LINE} AS l
      INNER JOIN ${OUT_HEADER} AS h
        ON LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcap01], N'')))) =
           LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaq01], N''))))
      WHERE ${headerActiveSql('h')}
        AND ${lineActiveSql('l')}
        AND ${WAREHOUSE_COL_OUT} = @warehouseCode
        AND ${excludeOut}
        ${materialOutSql}
    ),
    out_agg AS (
      SELECT
        materialCode,
        warehouseCode,
        MAX(kcaa02) AS kcaa02,
        MAX(kcaa03) AS kcaa03,
        MAX(kcaa04) AS kcaa04,
        SUM(CASE WHEN docDate < @startDate THEN qty ELSE 0 END) AS openingOutQty,
        SUM(CASE WHEN docDate >= @startDate AND docDate <= @endDate AND docType = 1 THEN qty ELSE 0 END) AS periodOut1Qty,
        SUM(CASE WHEN docDate >= @startDate AND docDate <= @endDate AND docType = 1 THEN money ELSE 0 END) AS periodOut1Money,
        SUM(CASE WHEN docDate >= @startDate AND docDate <= @endDate AND docType IN (0, 4, 7, 10, 2) THEN qty ELSE 0 END) AS periodOut407102Qty,
        SUM(CASE WHEN docDate >= @startDate AND docDate <= @endDate AND docType = 8 THEN qty ELSE 0 END) AS periodOut8Qty,
        SUM(CASE WHEN docDate >= @startDate AND docDate <= @endDate AND docType = 9 THEN qty ELSE 0 END) AS periodOut9Qty,
        SUM(CASE WHEN docDate >= @startDate AND docDate <= @endDate AND docType = 9 THEN money ELSE 0 END) AS periodOut9Money
      FROM out_base
      GROUP BY materialCode, warehouseCode
    ),
    keys AS (
      SELECT materialCode, warehouseCode FROM in_agg
      UNION
      SELECT materialCode, warehouseCode FROM out_agg
    )
    SELECT
      k.materialCode AS kcaa01,
      k.warehouseCode,
      COALESCE(i.kcaa02, o.kcaa02, N'') AS kcaa02,
      COALESCE(i.kcaa03, o.kcaa03, N'') AS kcaa03,
      COALESCE(i.kcaa04, o.kcaa04, N'') AS kcaa04,
      ISNULL(i.openingInQty, 0) AS openingInQty,
      ISNULL(i.openingInMoney, 0) AS openingInMoney,
      ISNULL(o.openingOutQty, 0) AS openingOutQty,
      ISNULL(i.periodIn010125Qty, 0) AS periodIn010125Qty,
      ISNULL(i.periodIn010125Money, 0) AS periodIn010125Money,
      ISNULL(o.periodOut1Qty, 0) AS periodOut1Qty,
      ISNULL(o.periodOut1Money, 0) AS periodOut1Money,
      ISNULL(o.periodOut407102Qty, 0) AS periodOut407102Qty,
      ISNULL(i.periodIn34Qty, 0) AS periodIn34Qty,
      ISNULL(o.periodOut8Qty, 0) AS periodOut8Qty,
      ISNULL(i.periodIn7Qty, 0) AS periodIn7Qty,
      ISNULL(i.periodIn7Money, 0) AS periodIn7Money,
      ISNULL(o.periodOut9Qty, 0) AS periodOut9Qty,
      ISNULL(o.periodOut9Money, 0) AS periodOut9Money
    FROM keys AS k
    LEFT JOIN in_agg AS i
      ON i.materialCode = k.materialCode AND i.warehouseCode = k.warehouseCode
    LEFT JOIN out_agg AS o
      ON o.materialCode = k.materialCode AND o.warehouseCode = k.warehouseCode
    WHERE k.materialCode <> N''
    ORDER BY k.materialCode ASC
  `
}

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {{ startDate: string, endDate: string, warehouseCode: string, materialFilter?: string }} params
 */
export async function fetchStockStatsLines(pool, params = {}) {
  const startDate = text(params.startDate)
  const endDate = text(params.endDate)
  const warehouseCode = text(params.warehouseCode)
  const materialFilter = text(params.materialFilter)

  if (!startDate || !endDate) {
    return { ok: false, status: 400, msg: '请填写开始日期和结束日期' }
  }
  if (!warehouseCode) {
    return { ok: false, status: 400, msg: '请选择仓库' }
  }
  if (startDate > endDate) {
    return { ok: false, status: 400, msg: '开始日期不能晚于结束日期' }
  }

  const req = pool.request()
  req.input('startDate', startDate)
  req.input('endDate', endDate)
  req.input('warehouseCode', warehouseCode)
  if (materialFilter) {
    req.input('materialFilter', `${materialFilter}%`)
  }

  const r = await req.query(buildAggSql({ materialFilter }))
  const lines = (r.recordset ?? [])
    .map((row) => computeStockStatsRow(row))
    .filter((row) => {
      const keys = ['lastsum', 'nowin', 'nowout', 'nowbs', 'hzkcm', 'nowsum']
      return keys.some((k) => Math.abs(num(row[k])) > 0.0000001)
    })

  if (lines.length > 50000) {
    return { ok: false, status: 400, msg: `统计结果 ${lines.length} 行，超过 50000 行上限，请缩小物料或日期范围` }
  }

  return { ok: true, lines, rowEstimate: lines.length }
}
