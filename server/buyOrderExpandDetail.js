import { sql } from './db.js'
import { safeDecimalExpr, nvarcharTextExpr } from './buyOrderSqlSafe.js'

const HEADER_FROM = 'dbo.[UB_ERP_Buy_order]'
const LINE_FROM = 'dbo.[UB_ERP_Buy_order_list]'
const FEE_FROM = 'dbo.[UB_ERP_Buy_order_money]'
const COLOR_FROM = 'dbo.[UB_ERP_Stocks_colorcode]'
const STOCK_IN_FROM = 'dbo.[UB_ERP_Stocks_Storage]'
const STOCK_IN_LINE_FROM = 'dbo.[UB_ERP_Stocks_Storage_list]'
const STOCK_OUT_FROM = 'dbo.[UB_ERP_Stocks_out]'
const STOCK_OUT_LINE_FROM = 'dbo.[UB_ERP_Stocks_out_list]'

function text(v) {
  return String(v ?? '').trim()
}

function toNumber(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function round(n, p = 4) {
  const m = 10 ** p
  return Math.round((toNumber(n) + Number.EPSILON) * m) / m
}

function convertQty(qty, ratioRaw, directionRaw) {
  const ratio = toNumber(ratioRaw)
  if (!(ratio > 0)) return round(qty, 4)
  const direction = text(directionRaw)
  if (direction === '1') return round(toNumber(qty) * ratio, 4)
  if (direction === '0') return round(toNumber(qty) / ratio, 4)
  return round(qty, 4)
}

function serialize(row) {
  const out = {}
  for (const [key, value] of Object.entries(row ?? {})) out[key] = value instanceof Date ? value.toISOString() : value
  return out
}

async function getStockOutMeta(pool) {
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
        ELSE N''
      END AS qtyCol,
      CASE WHEN COL_LENGTH('dbo.UB_ERP_Stocks_out_list', 'kcaa04') IS NOT NULL THEN N'kcaa04' ELSE N'' END AS unitCol,
      CASE WHEN COL_LENGTH('dbo.UB_ERP_Stocks_out_list', 'kcaa26') IS NOT NULL THEN N'kcaa26' ELSE N'' END AS ratioCol,
      CASE WHEN COL_LENGTH('dbo.UB_ERP_Stocks_out_list', 'kcaa27') IS NOT NULL THEN N'kcaa27' ELSE N'' END AS directionCol
  `)
  const row = r.recordset?.[0] ?? {}
  return { linkCol: text(row.linkCol), qtyCol: text(row.qtyCol), unitCol: text(row.unitCol), ratioCol: text(row.ratioCol), directionCol: text(row.directionCol) }
}

function attachInbound(lines, inboundRows) {
  const inboundList = (inboundRows ?? []).map(serialize)
  return lines.map((line) => {
    const materialCode = text(line.kcaa01)
    const bomSystemCode = text(line.kcak02 || line.systemcode)
    const matched = inboundList
      .filter((row) => {
        const inMat = text(row.materialCode)
        const inBom = text(row.materialSystemCode)
        return (materialCode && inMat === materialCode) || (bomSystemCode && inBom === bomSystemCode)
      })
      .map((row) => ({
        ...row,
        convertedQty: convertQty(row.kcao03, line.kcaa26, line.kcaa27),
      }))
    return { ...line, inboundList: matched }
  })
}

function attachReturns(lines, returnRows) {
  const returnList = (returnRows ?? []).map(serialize)
  return lines.map((line) => {
    const materialCode = text(line.kcaa01)
    const matched = returnList.filter((row) => materialCode && text(row.materialCode) === materialCode)
    const returnedQty = matched.reduce((sum, row) => sum + toNumber(row.returnQty), 0)
    const returnedConvertedQty = matched.reduce((sum, row) => sum + convertQty(row.returnQty, row.kcaa26, row.kcaa27), 0)
    return { ...line, returnQty: round(returnedQty, 4), returnConvertedQty: round(returnedConvertedQty, 4), returnList: matched }
  })
}

function buildSummary(lines, fees) {
  const lineRows = Array.isArray(lines) ? lines : []
  const feeRows = Array.isArray(fees) ? fees : []
  return {
    quantity: round(lineRows.reduce((sum, row) => sum + toNumber(row.kcak03), 0), 2),
    taxExcludedPrice: round(lineRows.reduce((sum, row) => sum + toNumber(row.kcak04), 0), 4),
    taxIncludedPrice: round(lineRows.reduce((sum, row) => sum + toNumber(row.kcak041), 0), 4),
    taxExcludedAmount: round(lineRows.reduce((sum, row) => sum + toNumber(row.kcak05), 0), 2),
    taxIncludedAmount: round(
      lineRows.reduce((sum, row) => sum + toNumber(row.kcak051), 0) +
      feeRows.reduce((sum, row) => sum + toNumber(row.money), 0),
      2,
    ),
  }
}

export async function fetchBuyOrderExpandDetail(pool, id) {
  const orderId = Number(id)
  if (!Number.isInteger(orderId) || orderId <= 0) return { ok: false, status: 400, msg: '采购单参数无效' }
  const headerR = await pool.request().input('id', sql.Int, orderId).query(`
    SELECT TOP 1
      [id],
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([kcaj01], N'')))) AS buyOrderNo,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([kcaj04], N'')))) AS referenceNo
    FROM ${HEADER_FROM}
    WHERE [id] = @id
  `)
  const header = headerR.recordset?.[0]
  if (!header) return { ok: false, status: 404, msg: '采购单不存在' }
  const orderNo = text(header.buyOrderNo)

  const lineReq = pool.request().input('orderNo', sql.NVarChar(200), orderNo)
  const lineR = await lineReq.query(`
    SELECT
      l.[id],
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcak01], N'')))) AS kcak01,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcak02], N'')))) AS kcak02,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[systemcode], N'')))) AS systemcode,
      ISNULL(l.[seq], l.[id]) AS seq,
      LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa01], N'')))) AS kcaa01,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa02], N'')))) AS kcaa02,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa03], N'')))) AS kcaa03,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa11], N'')))) AS kcaa11,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.[name], N'')))) AS colorName,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa25], N'')))) AS kcaa25,
      ${safeDecimalExpr('l', 'kcak03')} AS kcak03,
      ${safeDecimalExpr('l', 'kcak04')} AS kcak04,
      ${safeDecimalExpr('l', 'kcak041')} AS kcak041,
      ${safeDecimalExpr('l', 'kcak05')} AS kcak05,
      ${safeDecimalExpr('l', 'kcak051')} AS kcak051,
      ${safeDecimalExpr('l', 'tax')} AS tax,
      l.[delivery_date],
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[Reference], N'')))) AS [Reference],
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[OrderNo], N'')))) AS [OrderNo],
      LTRIM(RTRIM(CONVERT(nvarchar(1000), ISNULL(l.[info], N'')))) AS info,
      ${nvarcharTextExpr('l', 'kcak06', 500)} AS topKcaa01,
      ${safeDecimalExpr('l', 'kcaa26')} AS kcaa26,
      LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(l.[kcaa27], N'')))) AS kcaa27
    FROM ${LINE_FROM} AS l
    LEFT JOIN ${COLOR_FROM} AS c
      ON LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(c.[code], N'')))) =
        CASE
          WHEN CHARINDEX(N'/', LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa01], N''))))) > 0
          THEN RIGHT(
            LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa01], N'')))),
            LEN(LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa01], N''))))) - CHARINDEX(N'/', LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa01], N'')))))
          )
          ELSE N''
        END
     AND LTRIM(RTRIM(ISNULL(c.[pass], N''))) = N'1'
     AND (ISNULL(c.[del], N'') = N'' OR c.[del] = N'0')
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcak01], N'')))) = @orderNo
      AND (ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')
    ORDER BY ISNULL(l.[seq], l.[id]), l.[id]
  `)
  const rawLines = (lineR.recordset ?? []).map(serialize)

  const inboundR = await pool.request().input('orderNo', sql.NVarChar(200), orderNo).query(`
    SELECT
      LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(il.[kcaa01], N'')))) AS materialCode,
      LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(il.[kcao02], N'')))) AS materialSystemCode,
      SUM(${safeDecimalExpr('il', 'kcao03')}) AS kcao03,
      SUM(${safeDecimalExpr('il', 'kcao031')}) AS kcao031,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(il.[kcaa04], N'')))) AS kcaa04,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(s.[kcan01], N'')))) AS kcan01,
      s.[kcan02],
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(s.[kcan08], N'')))) AS kcan08,
      LTRIM(RTRIM(CONVERT(nvarchar(1000), ISNULL(s.[remark], N'')))) AS remark,
      LTRIM(RTRIM(ISNULL(s.[pass], N''))) AS pass
    FROM ${STOCK_IN_FROM} AS s
    INNER JOIN ${STOCK_IN_LINE_FROM} AS il
      ON LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(s.[kcan01], N'')))) = LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(il.[kcao01], N''))))
     AND (ISNULL(il.[del], N'') = N'' OR il.[del] = N'0')
    WHERE (ISNULL(s.[del], N'') = N'' OR s.[del] = N'0')
      AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(s.[kcan04], N'')))) = @orderNo
      AND LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(s.[kcan03], N'')))) = N'1'
    GROUP BY il.[kcaa01], il.[kcao02], il.[kcaa04], s.[kcan01], s.[kcan02], s.[kcan08], s.[remark], s.[pass]
  `)

  let returnRows = []
  const outMeta = await getStockOutMeta(pool)
  if (outMeta.linkCol && outMeta.qtyCol) {
    const unitSelect = outMeta.unitCol ? `LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(ol.[${outMeta.unitCol}], N''))))` : `N''`
    const ratioSelect = outMeta.ratioCol ? `${safeDecimalExpr('ol', outMeta.ratioCol)}` : `0`
    const directionSelect = outMeta.directionCol ? `LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(ol.[${outMeta.directionCol}], N''))))` : `N''`
    const unitGroup = outMeta.unitCol ? `, ol.[${outMeta.unitCol}]` : ''
    const ratioGroup = outMeta.ratioCol ? `, ol.[${outMeta.ratioCol}]` : ''
    const directionGroup = outMeta.directionCol ? `, ol.[${outMeta.directionCol}]` : ''
    const returnR = await pool.request().input('orderNo', sql.NVarChar(200), orderNo).query(`
      SELECT
        LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(ol.[kcaa01], N'')))) AS materialCode,
        SUM(${safeDecimalExpr('ol', outMeta.qtyCol)}) AS returnQty,
        ${unitSelect} AS kcaa04,
        ${ratioSelect} AS kcaa26,
        ${directionSelect} AS kcaa27
      FROM ${STOCK_OUT_FROM} AS o
      INNER JOIN ${STOCK_OUT_LINE_FROM} AS ol
        ON LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(o.[kcap01], N'')))) = LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(ol.[kcaq01], N''))))
       AND (ISNULL(ol.[del], N'') = N'' OR ol.[del] = N'0')
      WHERE (ISNULL(o.[del], N'') = N'' OR o.[del] = N'0')
        AND LTRIM(RTRIM(ISNULL(o.[pass], N''))) = N'1'
        AND LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(o.[kcap03], N'')))) = N'1'
        AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(o.[${outMeta.linkCol}], N'')))) = @orderNo
      GROUP BY ol.[kcaa01]${unitGroup}${ratioGroup}${directionGroup}
    `)
    returnRows = returnR.recordset ?? []
  }

  const feesR = await pool.request().input('orderNo', sql.NVarChar(200), orderNo).query(`
    SELECT
      f.[id],
      ISNULL(f.[kid], f.[id]) AS seq,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(f.[buy_code], N'')))) AS buy_code,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(f.[kcaa01], N'')))) AS kcaa01,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(f.[kcaa02], N'')))) AS kcaa02,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(f.[kcaa03], N'')))) AS kcaa03,
      ${safeDecimalExpr('f', 'money')} AS money,
      ${safeDecimalExpr('f', 'tax')} AS tax,
      LTRIM(RTRIM(CONVERT(nvarchar(1000), ISNULL(f.[remark], N'')))) AS remark
    FROM ${FEE_FROM} AS f
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(f.[buy_code], N'')))) = @orderNo
    ORDER BY ISNULL(f.[kid], f.[id]), f.[id]
  `)

  const fees = (feesR.recordset ?? []).map(serialize)
  const lines = attachReturns(attachInbound(rawLines, inboundR.recordset ?? []), returnRows)
  return {
    ok: true,
    data: {
      header: serialize(header),
      lines,
      fees,
      summary: buildSummary(lines, fees),
    },
  }
}
