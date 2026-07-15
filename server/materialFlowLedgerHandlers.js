/**
 * 材料流水账 API。
 * 业务口径：单个物料在指定日期、仓库下的已审和未审入库/出库流水，后端逐行计算结存。
 */
import { sql } from './db.js'
import { safeDecimalExpr, nvarcharTextExpr } from './buyOrderSqlSafe.js'
import { fetchStockStatsPrintHeader } from './stockStatsPrintHeader.js'

const WAREHOUSE_FROM = 'dbo.[UB_ERP_Stocks_Warehouse]'
const MATERIAL_CATEGORY_FROM = 'dbo.[UB_ERP_Stocks_material]'
const BOM_FROM = 'dbo.[UB_ERP_Bom_000]'
const STOCK_IN_HEADER_FROM = 'dbo.[UB_ERP_Stocks_Storage]'
const STOCK_IN_LINE_FROM = 'dbo.[UB_ERP_Stocks_Storage_list]'
const STOCK_OUT_HEADER_FROM = 'dbo.[UB_ERP_Stocks_out]'
const STOCK_OUT_LINE_FROM = 'dbo.[UB_ERP_Stocks_out_list]'
const BUY_HEADER_FROM = 'dbo.[UB_ERP_Buy_order]'
const BUY_LINE_FROM = 'dbo.[UB_ERP_Buy_order_list]'
const MENU_PATH = 'inventory/analysis/flow-ledger'
const ALL_WAREHOUSE = '__ALL__'

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

function parseCategoryList(value) {
  const raw = Array.isArray(value) ? value : String(value ?? '').split(',')
  const out = []
  const seen = new Set()
  for (const item of raw) {
    const v = text(item)
    if (!v || seen.has(v)) continue
    seen.add(v)
    out.push(v)
    if (out.length >= 20) break
  }
  return out
}

function parseBooleanFlag(value) {
  const s = text(value).toLowerCase()
  return s === '1' || s === 'true' || s === 'yes'
}

function parseReportQuery(query = {}) {
  return {
    startDate: normalizeDate(query.startDate),
    endDate: normalizeDate(query.endDate),
    warehouseCode: text(query.warehouseCode),
    allWarehouse: text(query.warehouseCode) === ALL_WAREHOUSE,
    materialCode: text(query.materialCode),
    materialName: text(query.materialName),
    materialSpec: text(query.materialSpec),
    materialUnit: text(query.materialUnit),
    materialCategories: parseCategoryList(query.materialCategories ?? query.materialCategory),
    includePurchaseInTransit: parseBooleanFlag(query.includePurchaseInTransit),
  }
}

function validateReportQuery(q) {
  if (!q.startDate) return '开始日期不能为空'
  if (!q.endDate) return '结束日期不能为空'
  if (!q.warehouseCode) return '仓库不能为空'
  if (!q.materialCode) return '物料编码不能为空'
  return ''
}

function bindReportParams(req, q) {
  req.input('startDate', sql.DateTime, new Date(`${q.startDate}T00:00:00`))
  const endDateExclusive = new Date(`${q.endDate}T00:00:00`)
  endDateExclusive.setDate(endDateExclusive.getDate() + 1)
  req.input('endDateExclusive', sql.DateTime, endDateExclusive)
  req.input('warehouseCode', sql.NVarChar(200), q.warehouseCode)
  req.input('allWarehouse', sql.Bit, q.allWarehouse)
  req.input('materialCode', sql.NVarChar(200), q.materialCode)
  q.materialCategories.forEach((code, index) => req.input(`category${index}`, sql.NVarChar(200), code))
}

function buildCategoryWhereSql(categories) {
  if (!categories.length) return ''
  const tokens = categories.map((_, index) => `@category${index}`).join(', ')
  return `${nvarcharTextExpr('l', 'kcaa05', 200)} IN (${tokens})`
}

function buildInboundBaseWhereSql(q, { beforeStart = false } = {}) {
  const parts = [
    `${nvarcharTextExpr('h', 'del', 20)} IN (N'', N'0')`,
    `${nvarcharTextExpr('l', 'del', 20)} IN (N'', N'0')`,
    `${nvarcharTextExpr('h', 'pass', 20)} IN (N'0', N'1')`,
    `(@allWarehouse = 1 OR ${nvarcharTextExpr('h', 'kcan06', 200)} = @warehouseCode)`,
    `${nvarcharTextExpr('l', 'kcaa01', 200)} = @materialCode`,
    beforeStart ? 'h.[kcan02] < @startDate' : 'h.[kcan02] >= @startDate',
  ]
  if (!beforeStart) parts.push('h.[kcan02] < @endDateExclusive')
  const categoryWhere = buildCategoryWhereSql(q.materialCategories)
  if (categoryWhere) parts.push(categoryWhere)
  return parts.join('\n      AND ')
}

function buildOutboundBaseWhereSql(q, { beforeStart = false } = {}) {
  const parts = [
    `${nvarcharTextExpr('h', 'del', 20)} IN (N'', N'0')`,
    `${nvarcharTextExpr('l', 'del', 20)} IN (N'', N'0')`,
    `${nvarcharTextExpr('h', 'pass', 20)} IN (N'0', N'1')`,
    `(@allWarehouse = 1 OR ${nvarcharTextExpr('h', 'kcap06', 200)} = @warehouseCode)`,
    `${nvarcharTextExpr('l', 'kcaa01', 200)} = @materialCode`,
    beforeStart ? 'h.[kcap02] < @startDate' : 'h.[kcap02] >= @startDate',
  ]
  if (!beforeStart) parts.push('h.[kcap02] < @endDateExclusive')
  const categoryWhere = buildCategoryWhereSql(q.materialCategories)
  if (categoryWhere) parts.push(categoryWhere)
  return parts.join('\n      AND ')
}

function buildOpeningBalanceSql(q) {
  return `
    SELECT
      ISNULL((
        SELECT SUM(${safeDecimalExpr('l', 'kcao03', 0)})
        FROM ${STOCK_IN_HEADER_FROM} AS h
        INNER JOIN ${STOCK_IN_LINE_FROM} AS l
          ON ${nvarcharTextExpr('l', 'kcao01', 200)}
           = ${nvarcharTextExpr('h', 'kcan01', 200)}
        WHERE ${buildInboundBaseWhereSql(q, { beforeStart: true })}
      ), 0)
      -
      ISNULL((
        SELECT SUM(${safeDecimalExpr('l', 'kcaq03', 0)})
        FROM ${STOCK_OUT_HEADER_FROM} AS h
        INNER JOIN ${STOCK_OUT_LINE_FROM} AS l
          ON ${nvarcharTextExpr('l', 'kcaq01', 200)}
           = ${nvarcharTextExpr('h', 'kcap01', 200)}
        WHERE ${buildOutboundBaseWhereSql(q, { beforeStart: true })}
      ), 0) AS openingBalance
  `
}

function buildFlowSelectSql(q) {
  return `
    SELECT
      N'in' AS direction,
      h.[kcan02] AS docDate,
      COALESCE(l.[addtime], h.[addtime]) AS recordDate,
      ${nvarcharTextExpr('h', 'kcan01', 200)} AS docNo,
      ${nvarcharTextExpr('h', 'kcan03', 20)} AS flowType,
      ${nvarcharTextExpr('h', 'pass', 20)} AS auditStatus,
      ${nvarcharTextExpr('h', 'kcan04', 200)} AS relatedNo,
      ${nvarcharTextExpr('l', 'Reference', 500)} AS referenceText,
      ${nvarcharTextExpr('h', 'remark', 1000)} AS headerRemark,
      ${safeDecimalExpr('l', 'kcao03', 0)} AS quantity,
      ${nvarcharTextExpr('l', 'kcaa01', 200)} AS materialCode,
      ${nvarcharTextExpr('l', 'kcaa02', 500)} AS materialName,
      ${nvarcharTextExpr('l', 'kcaa03', 500)} AS materialSpec,
      ${nvarcharTextExpr('l', 'kcaa04', 100)} AS unit,
      ${nvarcharTextExpr('l', 'kcaa05', 200)} AS materialCategory,
      ${nvarcharTextExpr('h', 'kcan06', 200)} AS warehouseCode,
      ${nvarcharTextExpr('h', 'ck', 500)} AS warehouseName,
      l.[id] AS lineId
    FROM ${STOCK_IN_HEADER_FROM} AS h
    INNER JOIN ${STOCK_IN_LINE_FROM} AS l
      ON ${nvarcharTextExpr('l', 'kcao01', 200)}
       = ${nvarcharTextExpr('h', 'kcan01', 200)}
    WHERE ${buildInboundBaseWhereSql(q)}

    UNION ALL

    SELECT
      N'out' AS direction,
      h.[kcap02] AS docDate,
      COALESCE(l.[addtime], h.[addtime]) AS recordDate,
      ${nvarcharTextExpr('h', 'kcap01', 200)} AS docNo,
      ${nvarcharTextExpr('h', 'kcap03', 20)} AS flowType,
      ${nvarcharTextExpr('h', 'pass', 20)} AS auditStatus,
      ${nvarcharTextExpr('h', 'kcap04', 200)} AS relatedNo,
      ${nvarcharTextExpr('h', 'kcap08', 500)} AS referenceText,
      LTRIM(RTRIM(COALESCE(
        NULLIF(CONVERT(nvarchar(1000), l.[Describe]), N''),
        NULLIF(CONVERT(nvarchar(1000), h.[remark]), N''),
        N''
      ))) AS headerRemark,
      ${safeDecimalExpr('l', 'kcaq03', 0)} AS quantity,
      ${nvarcharTextExpr('l', 'kcaa01', 200)} AS materialCode,
      ${nvarcharTextExpr('l', 'kcaa02', 500)} AS materialName,
      ${nvarcharTextExpr('l', 'kcaa03', 500)} AS materialSpec,
      ${nvarcharTextExpr('l', 'kcaa04', 100)} AS unit,
      ${nvarcharTextExpr('l', 'kcaa05', 200)} AS materialCategory,
      ${nvarcharTextExpr('h', 'kcap06', 200)} AS warehouseCode,
      ${nvarcharTextExpr('h', 'ck', 500)} AS warehouseName,
      l.[id] AS lineId
    FROM ${STOCK_OUT_HEADER_FROM} AS h
    INNER JOIN ${STOCK_OUT_LINE_FROM} AS l
      ON ${nvarcharTextExpr('l', 'kcaq01', 200)}
       = ${nvarcharTextExpr('h', 'kcap01', 200)}
    WHERE ${buildOutboundBaseWhereSql(q)}
  `
}

function buildFlowReportSql(q) {
  return `
    WITH flow AS (
      ${buildFlowSelectSql(q)}
    )
    SELECT
      direction, docDate, recordDate, docNo, flowType, auditStatus, relatedNo, referenceText, headerRemark,
      quantity, materialCode, materialName, materialSpec, unit, materialCategory,
      warehouseCode, warehouseName, lineId
    FROM flow
    ORDER BY docDate ASC, direction ASC, docNo ASC, lineId ASC
  `
}

function buildPurchaseInTransitSql(q) {
  const categoryWhere = q.materialCategories.length
    ? `AND ${nvarcharTextExpr('l', 'kcaa05', 200)} IN (${q.materialCategories.map((_, index) => `@category${index}`).join(', ')})`
    : ''
  return `
    SELECT
      h.[kcaj03] AS docDate,
      COALESCE(l.[addtime], h.[addtime]) AS recordDate,
      ${nvarcharTextExpr('h', 'kcaj01', 200)} AS docNo,
      ${nvarcharTextExpr('h', 'kcaj05', 200)} AS supplierCode,
      ${nvarcharTextExpr('h', 'kehu', 500)} AS supplierName,
      ${nvarcharTextExpr('h', 'kcaj04', 200)} AS piNo,
      ${nvarcharTextExpr('l', 'Reference', 500)} AS referenceText,
      ${safeDecimalExpr('l', 'kcak03', 0)} AS orderQty,
      ${nvarcharTextExpr('l', 'kcaa01', 200)} AS materialCode,
      ${nvarcharTextExpr('l', 'kcaa02', 500)} AS materialName,
      ${nvarcharTextExpr('l', 'kcaa03', 500)} AS materialSpec,
      ${nvarcharTextExpr('l', 'kcaa04', 100)} AS unit,
      ${nvarcharTextExpr('l', 'kcaa05', 200)} AS materialCategory,
      l.[id] AS lineId
    FROM ${BUY_HEADER_FROM} AS h
    INNER JOIN ${BUY_LINE_FROM} AS l
      ON ${nvarcharTextExpr('l', 'kcak01', 200)}
       = ${nvarcharTextExpr('h', 'kcaj01', 200)}
    WHERE ${nvarcharTextExpr('h', 'del', 20)} IN (N'', N'0')
      AND ${nvarcharTextExpr('l', 'del', 20)} IN (N'', N'0')
      AND ${nvarcharTextExpr('h', 'pass', 20)} = N'1'
      AND ${nvarcharTextExpr('h', 'closed', 20)} IN (N'', N'0')
      AND ${nvarcharTextExpr('l', 'kcaa01', 200)} = @materialCode
      ${categoryWhere}
    ORDER BY h.[kcaj03] ASC, h.[kcaj01] ASC, l.[id] ASC
  `
}

function inboundTypeLabel(type) {
  const map = {
    0: '其他入库',
    1: '采购入库',
    2: '外协入库',
    3: '外协退料',
    4: '生产入库',
    5: '生产退料',
    6: '成品退货',
    7: '盘盈入库',
    8: '加工入库',
    9: '其他入库',
  }
  const key = text(type)
  return map[key] || (key ? `${key} 未知类别` : '')
}

function outboundTypeLabel(type) {
  const map = {
    0: '其他出库',
    1: '采购退货',
    2: '外协领料',
    3: '外协退货',
    4: '生产领料',
    5: '生产返修',
    6: '成品出库',
    7: '生产领料（计划外）',
    8: '生产领料（补数）',
    9: '盘亏出库',
  }
  const key = text(type)
  return map[key] || (key ? `${key} 未知类别` : '')
}

function flowTypeLabel(direction, type) {
  return text(direction) === 'out' ? outboundTypeLabel(type) : inboundTypeLabel(type)
}

function serializeDate(value) {
  if (value instanceof Date) return value.toISOString()
  return value ?? ''
}

function numberValue(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function buildRemark(row) {
  const dir = text(row.direction)
  const type = flowTypeLabel(dir, row.flowType)
  const docNo = text(row.docNo)
  const ref = text(row.referenceText)
  const related = text(row.relatedNo)
  const prefix = text(row.auditStatus) === '0' ? '(未审) ' : ''
  return `${prefix}单号：${docNo}，类别：${type}，PO/PI：${ref}，关联单号：${related}`
}

function serializeFlowRow(row, balance, seq) {
  const dir = text(row.direction)
  const qty = numberValue(row.quantity)
  return {
    rowKey: `${dir}-${text(row.docNo)}-${Number(row.lineId ?? 0)}`,
    rowType: 'flow',
    seq,
    docDate: serializeDate(row.docDate),
    recordDate: serializeDate(row.recordDate),
    inboundQty: dir === 'in' ? qty : null,
    outboundQty: dir === 'out' ? qty : null,
    balance,
    remark: buildRemark(row),
    isUnaudited: text(row.auditStatus) === '0',
    auditStatus: text(row.auditStatus),
    direction: dir,
    docNo: text(row.docNo),
    flowType: text(row.flowType),
    flowTypeLabel: flowTypeLabel(dir, row.flowType),
    materialCode: text(row.materialCode),
    materialName: text(row.materialName),
    materialSpec: text(row.materialSpec),
    unit: text(row.unit),
    materialCategory: text(row.materialCategory),
    warehouseCode: text(row.warehouseCode),
    warehouseName: text(row.warehouseName) || text(row.warehouseCode),
  }
}

function buildLedgerRows(openingBalance, rawRows) {
  let balance = numberValue(openingBalance)
  const rows = [{
    rowKey: 'opening-balance',
    rowType: 'opening',
    seq: 1,
    docDate: '',
    recordDate: '',
    inboundQty: null,
    outboundQty: null,
    balance,
    remark: '上期结存',
  }]
  for (const row of rawRows ?? []) {
    const qty = numberValue(row.quantity)
    balance += text(row.direction) === 'out' ? -qty : qty
    rows.push(serializeFlowRow(row, balance, rows.length + 1))
  }
  return rows
}

function serializePurchaseInTransitRow(row, seq) {
  const supplier = text(row.supplierName) || text(row.supplierCode)
  const parts = [
    `采购在途：${text(row.docNo)}`,
    supplier ? `供应商：${supplier}` : '',
    row.docDate ? `交货日期：${serializeDate(row.docDate).slice(0, 10)}` : '',
    text(row.piNo) ? `PI：${text(row.piNo)}` : '',
    text(row.referenceText) ? `来源备注：${text(row.referenceText)}` : '',
  ].filter(Boolean)
  return {
    rowKey: `purchase-in-transit-${text(row.docNo)}-${Number(row.lineId ?? 0)}`,
    rowType: 'purchaseInTransit',
    seq,
    docDate: serializeDate(row.docDate),
    recordDate: serializeDate(row.recordDate),
    inboundQty: numberValue(row.orderQty),
    outboundQty: null,
    balance: null,
    remark: parts.join('；'),
    materialCode: text(row.materialCode),
    materialName: text(row.materialName),
    materialSpec: text(row.materialSpec),
    unit: text(row.unit),
    materialCategory: text(row.materialCategory),
  }
}

async function fetchWarehouseOptions(pool, keyword = '') {
  const req = pool.request()
  let kwSql = ''
  if (keyword) {
    req.input('kw', sql.NVarChar(400), likePattern(keyword))
    kwSql = `AND (
      ${nvarcharTextExpr('', 'code', 200).replace(/\.\[/g, '[')} LIKE @kw ESCAPE '\\'
      OR ${nvarcharTextExpr('', 'name', 500).replace(/\.\[/g, '[')} LIKE @kw ESCAPE '\\'
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

async function fetchMaterialOptions(pool, keyword = '') {
  const req = pool.request()
  let kwSql = ''
  if (keyword) {
    req.input('kw', sql.NVarChar(400), likePattern(keyword))
    kwSql = `AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([kcaa01], N'')))) LIKE @kw ESCAPE '\\'`
  }
  const r = await req.query(`
    SELECT TOP 100
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([kcaa01], N'')))) AS code,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([kcaa02], N'')))) AS name,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([kcaa03], N'')))) AS spec,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL([kcaa04], N'')))) AS unit
    FROM ${BOM_FROM}
    WHERE (ISNULL([del], N'') = N'' OR [del] = N'0')
      AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([kcaa01], N'')))) <> N''
      ${kwSql}
    ORDER BY [kcaa01] ASC, [id] DESC
  `)
  return r.recordset ?? []
}

async function fetchCategoryOptions(pool, keyword = '') {
  const req = pool.request()
  let kwSql = ''
  if (keyword) {
    req.input('kw', sql.NVarChar(400), likePattern(keyword))
    kwSql = `AND (
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([code], N'')))) LIKE @kw ESCAPE '\\'
      OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([name], N'')))) LIKE @kw ESCAPE '\\'
    )`
  }
  const r = await req.query(`
    SELECT TOP 100
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([code], N'')))) AS code,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([name], N'')))) AS name
    FROM ${MATERIAL_CATEGORY_FROM}
    WHERE (ISNULL([del], N'') = N'' OR [del] = N'0')
      AND LTRIM(RTRIM(ISNULL([pass], N''))) = N'1'
      ${kwSql}
    ORDER BY [code] ASC
  `)
  return r.recordset ?? []
}

function sendError(res, err, prefix) {
  res.status(500).json({ code: 500, msg: `${prefix}：${String(err?.message ?? err)}`, data: null })
}

export function registerMaterialFlowLedgerRoutes(app, { getPool }) {
  app.get('/api/material-flow-ledger/print-header', async (_req, res) => {
    try {
      const pool = await getPool()
      res.json({ code: 200, msg: 'success', data: await fetchStockStatsPrintHeader(pool) })
    } catch (err) {
      sendError(res, err, '读取材料流水账打印抬头失败')
    }
  })

  app.get('/api/material-flow-ledger/warehouse-options', async (req, res) => {
    try {
      const pool = await getPool()
      res.json({ code: 200, msg: 'success', data: { list: await fetchWarehouseOptions(pool, text(req.query?.keyword)) } })
    } catch (err) {
      sendError(res, err, '读取材料流水账仓库候选失败')
    }
  })

  app.get('/api/material-flow-ledger/material-options', async (req, res) => {
    try {
      const pool = await getPool()
      res.json({ code: 200, msg: 'success', data: { list: await fetchMaterialOptions(pool, text(req.query?.keyword)) } })
    } catch (err) {
      sendError(res, err, '读取材料流水账物料候选失败')
    }
  })

  app.get('/api/material-flow-ledger/category-options', async (req, res) => {
    try {
      const pool = await getPool()
      res.json({ code: 200, msg: 'success', data: { list: await fetchCategoryOptions(pool, text(req.query?.keyword)) } })
    } catch (err) {
      sendError(res, err, '读取材料流水账材料分类失败')
    }
  })

  app.get('/api/material-flow-ledger/report', async (req, res) => {
    try {
      const q = parseReportQuery(req.query ?? {})
      const errMsg = validateReportQuery(q)
      if (errMsg) {
        res.status(400).json({ code: 400, msg: errMsg, data: null })
        return
      }

      const pool = await getPool()
      const openingReq = pool.request()
      bindReportParams(openingReq, q)
      const openingResult = await openingReq.query(buildOpeningBalanceSql(q))
      const openingBalance = numberValue(openingResult.recordset?.[0]?.openingBalance)

      const flowReq = pool.request()
      bindReportParams(flowReq, q)
      const flowResult = await flowReq.query(buildFlowReportSql(q))
      const list = buildLedgerRows(openingBalance, flowResult.recordset ?? [])

      if (q.includePurchaseInTransit) {
        const transitReq = pool.request()
        bindReportParams(transitReq, q)
        const transitResult = await transitReq.query(buildPurchaseInTransitSql(q))
        for (const row of transitResult.recordset ?? []) {
          list.push(serializePurchaseInTransitRow(row, list.length + 1))
        }
      }

      res.json({
        code: 200,
        msg: 'success',
        data: {
          list,
          openingBalance,
          startDate: q.startDate,
          endDate: q.endDate,
          warehouseCode: q.warehouseCode,
          allWarehouse: q.allWarehouse,
          materialCode: q.materialCode,
          materialName: q.materialName,
          materialSpec: q.materialSpec,
          materialUnit: q.materialUnit,
          includePurchaseInTransit: q.includePurchaseInTransit,
        },
      })
    } catch (err) {
      sendError(res, err, '读取材料流水账失败')
    }
  })
}

export const __materialFlowLedgerForTest = {
  MENU_PATH,
  ALL_WAREHOUSE,
  parseReportQuery,
  validateReportQuery,
  buildInboundBaseWhereSql,
  buildOutboundBaseWhereSql,
  buildOpeningBalanceSql,
  buildFlowSelectSql,
  buildFlowReportSql,
  buildPurchaseInTransitSql,
  inboundTypeLabel,
  outboundTypeLabel,
  flowTypeLabel,
  buildLedgerRows,
  serializePurchaseInTransitRow,
}
