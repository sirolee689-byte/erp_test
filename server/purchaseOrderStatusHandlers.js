/**
 * 采购订单情况表 API。
 * 只读统计报表：对比采购明细、采购入库和采购退货，不写回任何单据状态。
 */
import { sql } from './db.js'
import { safeDecimalExpr, nvarcharTextExpr } from './buyOrderSqlSafe.js'
import { assertUserHasAction } from './apiPermissionGate.js'
import { resolveSysUserIsAdminByUserId } from './sysUsersDb.js'
import { fetchStockStatsPrintHeader } from './stockStatsPrintHeader.js'

const MENU_PATH = 'supply-chain/analysis/order-status'
const BUY_HEADER_FROM = 'dbo.[UB_ERP_Buy_order]'
const BUY_LINE_FROM = 'dbo.[UB_ERP_Buy_order_list]'
const STOCK_IN_HEADER_FROM = 'dbo.[UB_ERP_Stocks_Storage]'
const STOCK_IN_LINE_FROM = 'dbo.[UB_ERP_Stocks_Storage_list]'
const STOCK_OUT_HEADER_FROM = 'dbo.[UB_ERP_Stocks_out]'
const STOCK_OUT_LINE_FROM = 'dbo.[UB_ERP_Stocks_out_list]'
const SUPPLIER_FROM = 'dbo.[UB_ERP_System_supplier]'
const BOM_FROM = 'dbo.[UB_ERP_Bom_000]'
const COLOR_FROM = 'dbo.[UB_ERP_Stocks_colorcode]'

function text(v) {
  return String(v ?? '').trim()
}

function likePattern(v) {
  return `%${text(v).replace(/[\\%_]/g, '\\$&')}%`
}

function normalizeDate(value) {
  const s = text(value)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''
}

function parseBooleanFlag(value, defaultValue = false) {
  const s = text(value).toLowerCase()
  if (!s) return defaultValue
  return ['1', 'true', 'yes', 'y', '是'].includes(s)
}

function addOneDay(dateText) {
  const d = new Date(`${dateText}T00:00:00`)
  d.setDate(d.getDate() + 1)
  return d
}

function parseReportQuery(query = {}) {
  return {
    startDate: normalizeDate(query.startDate),
    endDate: normalizeDate(query.endDate),
    supplierCode: text(query.supplierCode),
    purchaseNo: text(query.purchaseNo),
    materialSystemcode: text(query.materialSystemcode),
    materialCode: text(query.materialCode),
    materialName: text(query.materialName),
    materialSpec: text(query.materialSpec),
    includeUnclosed: parseBooleanFlag(query.includeUnclosed, true),
    onlyDifference: parseBooleanFlag(query.onlyDifference, false),
  }
}

function validateReportQuery(q) {
  if (!q.startDate) return '查询开始日期不能为空'
  if (!q.endDate) return '查询结束日期不能为空'
  if (q.startDate > q.endDate) return '查询开始日期不能大于查询结束日期'
  return ''
}

function bindReportParams(req, q) {
  req.input('startDate', sql.DateTime, new Date(`${q.startDate}T00:00:00`))
  req.input('endDateExclusive', sql.DateTime, addOneDay(q.endDate))
  if (q.supplierCode) req.input('supplierCode', sql.NVarChar(200), q.supplierCode)
  if (q.purchaseNo) req.input('purchaseNo', sql.NVarChar(400), likePattern(q.purchaseNo))
  if (q.materialSystemcode) req.input('materialSystemcode', sql.NVarChar(200), q.materialSystemcode)
  if (q.materialCode) req.input('materialCode', sql.NVarChar(400), likePattern(q.materialCode))
  if (q.materialName) req.input('materialName', sql.NVarChar(400), likePattern(q.materialName))
  if (q.materialSpec) req.input('materialSpec', sql.NVarChar(400), likePattern(q.materialSpec))
}

function buildReportWhereSql(q) {
  const parts = [
    `${nvarcharTextExpr('h', 'del', 20)} IN (N'', N'0')`,
    `${nvarcharTextExpr('l', 'del', 20)} IN (N'', N'0')`,
    'h.[kcaj02] >= @startDate',
    'h.[kcaj02] < @endDateExclusive',
  ]
  if (q.supplierCode) parts.push(`${nvarcharTextExpr('h', 'kcaj05', 200)} = @supplierCode`)
  if (q.purchaseNo) parts.push(`${nvarcharTextExpr('h', 'kcaj01', 200)} LIKE @purchaseNo ESCAPE '\\'`)
  if (q.materialSystemcode) {
    parts.push(`${nvarcharTextExpr('l', 'systemcode', 200)} = @materialSystemcode`)
  } else if (q.materialCode) {
    parts.push(`${nvarcharTextExpr('l', 'kcaa01', 200)} LIKE @materialCode ESCAPE '\\'`)
  }
  if (q.materialName) parts.push(`${nvarcharTextExpr('l', 'kcaa02', 500)} LIKE @materialName ESCAPE '\\'`)
  if (q.materialSpec) parts.push(`${nvarcharTextExpr('l', 'kcaa03', 500)} LIKE @materialSpec ESCAPE '\\'`)
  return `WHERE ${parts.join('\n      AND ')}`
}

function convertedPurchaseQtySql() {
  return `CASE
        WHEN b.convertDirection = N'1' AND b.convertRatio > 0 THEN b.purchaseQtyRaw / b.convertRatio
        WHEN b.convertDirection = N'0' AND b.convertRatio > 0 THEN b.purchaseQtyRaw * b.convertRatio
        ELSE b.purchaseQtyRaw
      END`
}

function conversionWarningSql() {
  return `CASE
        WHEN b.convertDirection IN (N'0', N'1') AND b.convertRatio <= 0 THEN N'单位换算字段异常，已按原始采购数量统计'
        ELSE N''
      END`
}

function buildReportSql(q) {
  const whereSql = buildReportWhereSql(q)
  const convertedQty = convertedPurchaseQtySql()
  return `
    WITH base AS (
      SELECT
        h.[id] AS headerId,
        l.[id] AS lineId,
        ${nvarcharTextExpr('h', 'pass', 20)} AS auditFlag,
        ${nvarcharTextExpr('h', 'kcaj01', 200)} AS purchaseNo,
        h.[kcaj02] AS purchaseDate,
        ${nvarcharTextExpr('h', 'kcaj04', 200)} AS piNo,
        ${nvarcharTextExpr('h', 'kcaj05', 200)} AS supplierCode,
        ${nvarcharTextExpr('h', 'kehu', 500)} AS supplierName,
        l.[delivery_date] AS deliveryDate,
        ${nvarcharTextExpr('l', 'GUID', 200)} AS lineGuid,
        ${nvarcharTextExpr('l', 'systemcode', 200)} AS materialSystemcode,
        ${nvarcharTextExpr('l', 'kcaa01', 200)} AS materialCode,
        ${nvarcharTextExpr('l', 'kcaa02', 500)} AS materialName,
        ${nvarcharTextExpr('l', 'kcaa03', 500)} AS materialSpec,
        ${nvarcharTextExpr('l', 'kcaa04', 100)} AS unit,
        ${nvarcharTextExpr('l', 'kcaa11', 100)} AS colorCode,
        ${safeDecimalExpr('l', 'kcak03', 0)} AS purchaseQtyRaw,
        ${safeDecimalExpr('l', 'kcaa26', 0)} AS convertRatio,
        ${nvarcharTextExpr('l', 'kcaa27', 20)} AS convertDirection
      FROM ${BUY_HEADER_FROM} AS h
      INNER JOIN ${BUY_LINE_FROM} AS l
        ON ${nvarcharTextExpr('h', 'kcaj01', 200)} = ${nvarcharTextExpr('l', 'kcak01', 200)}
      ${whereSql}
    ),
    inbound_keys AS (
      SELECT DISTINCT
        purchaseNo,
        lineGuid
      FROM base
      WHERE purchaseNo <> N''
        AND lineGuid <> N''
    ),
    return_keys AS (
      SELECT DISTINCT
        purchaseNo,
        materialCode
      FROM base
      WHERE purchaseNo <> N''
        AND materialCode <> N''
    ),
    inbound AS (
      SELECT
        ${nvarcharTextExpr('h', 'kcan04', 200)} AS purchaseNo,
        ${nvarcharTextExpr('l', 'GUID', 200)} AS lineGuid,
        SUM(CASE WHEN ${nvarcharTextExpr('h', 'pass', 20)} = N'1' THEN ${safeDecimalExpr('l', 'kcao031', 0)} ELSE 0 END) AS approvedInboundQty,
        SUM(CASE WHEN ${nvarcharTextExpr('h', 'pass', 20)} = N'0' THEN ${safeDecimalExpr('l', 'kcao031', 0)} ELSE 0 END) AS pendingInboundQty,
        SUM(CASE WHEN ${nvarcharTextExpr('h', 'pass', 20)} = N'1' THEN ${safeDecimalExpr('l', 'kcao051', 0)} ELSE 0 END) AS approvedInboundAmount
      FROM ${STOCK_IN_HEADER_FROM} AS h
      INNER JOIN ${STOCK_IN_LINE_FROM} AS l
        ON ${nvarcharTextExpr('h', 'kcan01', 200)} = ${nvarcharTextExpr('l', 'kcao01', 200)}
      INNER JOIN inbound_keys AS k
        ON k.purchaseNo = ${nvarcharTextExpr('h', 'kcan04', 200)}
       AND k.lineGuid = ${nvarcharTextExpr('l', 'GUID', 200)}
      WHERE ${nvarcharTextExpr('h', 'del', 20)} IN (N'', N'0')
        AND ${nvarcharTextExpr('l', 'del', 20)} IN (N'', N'0')
        AND ${nvarcharTextExpr('h', 'kcan04', 200)} <> N''
      GROUP BY h.[kcan04], l.[GUID]
    ),
    returns AS (
      SELECT
        ${nvarcharTextExpr('h', 'kcap04', 200)} AS purchaseNo,
        ${nvarcharTextExpr('l', 'kcaa01', 200)} AS materialCode,
        SUM(${safeDecimalExpr('l', 'kcaq03', 0)}) AS returnQty,
        SUM(${safeDecimalExpr('l', 'kcaq051', 0)}) AS returnAmount
      FROM ${STOCK_OUT_HEADER_FROM} AS h
      INNER JOIN ${STOCK_OUT_LINE_FROM} AS l
        ON ${nvarcharTextExpr('h', 'kcap01', 200)} = ${nvarcharTextExpr('l', 'kcaq01', 200)}
      INNER JOIN return_keys AS k
        ON k.purchaseNo = ${nvarcharTextExpr('h', 'kcap04', 200)}
       AND k.materialCode = ${nvarcharTextExpr('l', 'kcaa01', 200)}
      WHERE ${nvarcharTextExpr('h', 'del', 20)} IN (N'', N'0')
        AND ${nvarcharTextExpr('l', 'del', 20)} IN (N'', N'0')
        AND ${nvarcharTextExpr('h', 'pass', 20)} = N'1'
        AND ${nvarcharTextExpr('h', 'kcap03', 20)} = N'1'
        AND ${nvarcharTextExpr('h', 'kcap04', 200)} <> N''
      GROUP BY h.[kcap04], l.[kcaa01]
    )
    SELECT
      b.*,
      ${convertedQty} AS purchaseQty,
      ${conversionWarningSql()} AS warning,
      ISNULL(i.pendingInboundQty, 0) AS pendingInboundQty,
      ISNULL(i.approvedInboundQty, 0) AS inboundQty,
      ISNULL(i.approvedInboundAmount, 0) - ISNULL(r.returnAmount, 0) AS inboundAmount,
      ISNULL(r.returnQty, 0) AS returnQty,
      ${convertedQty} - (ISNULL(i.approvedInboundQty, 0) - ISNULL(r.returnQty, 0)) AS differenceQty,
      ${nvarcharTextExpr('cc', 'name', 500)} AS colorName
    FROM base AS b
    LEFT JOIN inbound AS i
      ON i.purchaseNo = b.purchaseNo
     AND i.lineGuid = b.lineGuid
    LEFT JOIN returns AS r
      ON r.purchaseNo = b.purchaseNo
     AND r.materialCode = b.materialCode
    LEFT JOIN ${COLOR_FROM} AS cc
      ON ${nvarcharTextExpr('cc', 'code', 100)} = b.colorCode
    ${q.onlyDifference ? `WHERE ${convertedQty} - (ISNULL(i.approvedInboundQty, 0) - ISNULL(r.returnQty, 0)) > 0` : ''}
    ORDER BY b.supplierCode ASC, b.supplierName ASC, b.purchaseNo ASC, b.lineId ASC
  `
}

function numberValue(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function serializeDate(value) {
  if (value instanceof Date) return value.toISOString()
  return value ?? ''
}

function serializeReportRow(row, canViewAmount) {
  const supplierName = text(row.supplierName) || text(row.supplierCode)
  const purchaseNo = text(row.purchaseNo)
  const auditFlag = text(row.auditFlag)
  const out = {
    rowKey: `${purchaseNo}-${Number(row.lineId ?? 0)}`,
    supplierCode: text(row.supplierCode),
    supplierName,
    supplier: [text(row.supplierCode), supplierName].filter(Boolean).join(' '),
    auditStatus: auditFlag === '1' ? '已审核' : '未审',
    purchaseNo,
    purchaseNoDisplay: auditFlag === '1' ? purchaseNo : `${purchaseNo}（未审）`,
    purchaseDate: serializeDate(row.purchaseDate),
    deliveryDate: serializeDate(row.deliveryDate),
    piNo: text(row.piNo),
    materialSystemcode: text(row.materialSystemcode),
    materialCode: text(row.materialCode),
    materialName: text(row.materialName),
    materialSpec: text(row.materialSpec),
    colorCode: text(row.colorCode),
    colorName: text(row.colorName) || text(row.colorCode),
    unit: text(row.unit),
    purchaseQty: numberValue(row.purchaseQty),
    pendingInboundQty: numberValue(row.pendingInboundQty),
    inboundQty: numberValue(row.inboundQty),
    returnQty: numberValue(row.returnQty),
    differenceQty: numberValue(row.differenceQty),
    warning: text(row.warning),
  }
  if (canViewAmount) {
    out.inboundAmount = numberValue(row.inboundAmount)
  }
  return out
}

async function canViewAmountColumns(pool, req) {
  const user = req.user ?? {}
  const uid = user.userId ?? user.UserID ?? user.id ?? user.uid
  if (await resolveSysUserIsAdminByUserId(pool, uid)) return true
  if (!uid) return false
  return assertUserHasAction(pool, uid, MENU_PATH, 'price')
}

async function fetchSupplierOptions(pool, keyword = '') {
  const req = pool.request()
  let keywordSql = ''
  if (keyword) {
    req.input('kw', sql.NVarChar(400), likePattern(keyword))
    keywordSql = `AND (
      ${nvarcharTextExpr('s', 's_code', 200)} LIKE @kw ESCAPE '\\'
      OR ${nvarcharTextExpr('s', 's_name', 500)} LIKE @kw ESCAPE '\\'
      OR ${nvarcharTextExpr('s', 'name', 500)} LIKE @kw ESCAPE '\\'
    )`
  }
  const r = await req.query(`
    SELECT TOP 100
      ${nvarcharTextExpr('s', 's_code', 200)} AS code,
      LTRIM(RTRIM(ISNULL(NULLIF(CONVERT(nvarchar(500), s.[s_name]), N''), ISNULL(CONVERT(nvarchar(500), s.[name]), N'')))) AS name
    FROM ${SUPPLIER_FROM} AS s
    WHERE ${nvarcharTextExpr('s', 's_lb', 50)} IN (N'采购', N'共用')
      AND ${nvarcharTextExpr('s', 'pass', 20)} = N'1'
      AND ${nvarcharTextExpr('s', 'del', 20)} IN (N'', N'0')
      ${keywordSql}
    ORDER BY s.[s_code] ASC
  `)
  return r.recordset ?? []
}

async function fetchMaterialOptions(pool, keyword = '') {
  const req = pool.request()
  let keywordSql = ''
  if (keyword) {
    req.input('kw', sql.NVarChar(400), likePattern(keyword))
    keywordSql = `AND (
      ${nvarcharTextExpr('b', 'kcaa01', 200)} LIKE @kw ESCAPE '\\'
      OR ${nvarcharTextExpr('b', 'kcaa02', 500)} LIKE @kw ESCAPE '\\'
      OR ${nvarcharTextExpr('b', 'kcaa03', 500)} LIKE @kw ESCAPE '\\'
    )`
  }
  const r = await req.query(`
    SELECT TOP 100
      ${nvarcharTextExpr('b', 'systemcode', 200)} AS systemcode,
      ${nvarcharTextExpr('b', 'kcaa01', 200)} AS code,
      ${nvarcharTextExpr('b', 'kcaa02', 500)} AS name,
      ${nvarcharTextExpr('b', 'kcaa03', 500)} AS spec
    FROM ${BOM_FROM} AS b
    WHERE ${nvarcharTextExpr('b', 'del', 20)} IN (N'', N'0')
      AND ${nvarcharTextExpr('b', 'kcaa01', 200)} <> N''
      AND ${nvarcharTextExpr('b', 'systemcode', 200)} <> N''
      ${keywordSql}
    ORDER BY b.[kcaa01] ASC, b.[id] DESC
  `)
  return r.recordset ?? []
}

function sendError(res, err, prefix) {
  res.status(500).json({ code: 500, msg: `${prefix}：${String(err?.message ?? err)}`, data: null })
}

export function registerPurchaseOrderStatusRoutes(app, { getPool }) {
  app.get('/api/purchase-order-status/print-header', async (_req, res) => {
    try {
      const pool = await getPool()
      res.json({ code: 200, msg: 'success', data: await fetchStockStatsPrintHeader(pool) })
    } catch (err) {
      sendError(res, err, '读取采购订单情况表打印抬头失败')
    }
  })

  app.get('/api/purchase-order-status/supplier-options', async (req, res) => {
    try {
      const pool = await getPool()
      res.json({ code: 200, msg: 'success', data: { list: await fetchSupplierOptions(pool, text(req.query?.keyword)) } })
    } catch (err) {
      sendError(res, err, '读取采购订单情况表供应商候选失败')
    }
  })

  app.get('/api/purchase-order-status/material-options', async (req, res) => {
    try {
      const pool = await getPool()
      res.json({ code: 200, msg: 'success', data: { list: await fetchMaterialOptions(pool, text(req.query?.keyword)) } })
    } catch (err) {
      sendError(res, err, '读取采购订单情况表物料候选失败')
    }
  })

  app.get('/api/purchase-order-status/report', async (req, res) => {
    try {
      const q = parseReportQuery(req.query ?? {})
      const errMsg = validateReportQuery(q)
      if (errMsg) {
        res.status(400).json({ code: 400, msg: errMsg, data: null })
        return
      }
      const pool = await getPool()
      const canViewAmount = await canViewAmountColumns(pool, req)
      const dbReq = pool.request()
      bindReportParams(dbReq, q)
      const result = await dbReq.query(buildReportSql(q))
      const list = (result.recordset ?? []).map((row) => serializeReportRow(row, canViewAmount))
      res.json({
        code: 200,
        msg: 'success',
        data: {
          list,
          total: list.length,
          startDate: q.startDate,
          endDate: q.endDate,
          supplierCode: q.supplierCode,
          purchaseNo: q.purchaseNo,
          materialSystemcode: q.materialSystemcode,
          materialCode: q.materialCode,
          materialName: q.materialName,
          materialSpec: q.materialSpec,
          includeUnclosed: q.includeUnclosed,
          onlyDifference: q.onlyDifference,
          canViewAmount,
        },
      })
    } catch (err) {
      sendError(res, err, '读取采购订单情况表失败')
    }
  })
}

export const __purchaseOrderStatusForTest = {
  MENU_PATH,
  parseReportQuery,
  validateReportQuery,
  buildReportWhereSql,
  buildReportSql,
  serializeReportRow,
}
