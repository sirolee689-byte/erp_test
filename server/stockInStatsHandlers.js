/**
 * 入库统计表 API 路由。
 * 说明：本报表按入库明细逐行统计，不按库存余额汇总。
 */
import { sql } from './db.js'
import { safeDecimalExpr } from './buyOrderSqlSafe.js'
import { assertUserHasAction } from './apiPermissionGate.js'
import { resolveSysUserIsAdminByUserId } from './sysUsersDb.js'
import { fetchStockStatsPrintHeader } from './stockStatsPrintHeader.js'

const WAREHOUSE_FROM = 'dbo.[UB_ERP_Stocks_Warehouse]'
const MATERIAL_CATEGORY_FROM = 'dbo.[New_UB_ERP_Stocks_material]'
const BOM_FROM = 'dbo.[UB_ERP_Bom_000]'
const STOCK_IN_HEADER_FROM = 'dbo.[UB_ERP_Stocks_Storage]'
const STOCK_IN_LINE_FROM = 'dbo.[UB_ERP_Stocks_Storage_list]'
const MENU_PATH = 'inventory/analysis/stock-in-stats'
const ALL_WAREHOUSE = '__ALL__'

function text(v) {
  return String(v ?? '').trim()
}

function likePattern(v) {
  return `%${text(v).replace(/[\\%_]/g, '\\$&')}%`
}

function normalizeInboundType(v) {
  const s = text(v)
  return /^[0-9]$/.test(s) ? s : ''
}

function normalizeDate(value) {
  const s = text(value)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''
}

function parseReportQuery(query = {}) {
  const startDate = normalizeDate(query.startDate)
  const endDate = normalizeDate(query.endDate)
  const warehouseCode = text(query.warehouseCode)
  return {
    startDate,
    endDate,
    warehouseCode,
    allWarehouse: warehouseCode === ALL_WAREHOUSE,
    inboundType: normalizeInboundType(query.inboundType),
    materialCode: text(query.materialCode),
    materialName: text(query.materialName),
    materialSpec: text(query.materialSpec),
    materialCategory: text(query.materialCategory),
    relatedParty: text(query.relatedParty),
  }
}

function bindReportParams(req, q) {
  req.input('startDate', sql.DateTime, new Date(`${q.startDate}T00:00:00`))
  req.input('endDate', sql.DateTime, new Date(`${q.endDate}T23:59:59`))
  if (!q.allWarehouse) req.input('warehouseCode', sql.NVarChar(200), q.warehouseCode)
  if (q.inboundType) req.input('inboundType', sql.NVarChar(20), q.inboundType)
  if (q.materialCode) req.input('materialCode', sql.NVarChar(200), q.materialCode)
  if (q.materialName) req.input('materialName', sql.NVarChar(400), likePattern(q.materialName))
  if (q.materialSpec) req.input('materialSpec', sql.NVarChar(400), likePattern(q.materialSpec))
  if (q.materialCategory) req.input('materialCategory', sql.NVarChar(200), q.materialCategory)
  if (q.relatedParty) req.input('relatedParty', sql.NVarChar(400), likePattern(q.relatedParty))
}

function buildReportWhereSql(q) {
  const parts = [
    "(ISNULL(h.[del], N'') = N'' OR h.[del] = N'0')",
    "(ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')",
    'h.[kcan02] >= @startDate',
    'h.[kcan02] <= @endDate',
  ]
  if (!q.allWarehouse) {
    parts.push("LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan06], N'')))) = @warehouseCode")
  }
  if (q.inboundType) {
    parts.push("LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(h.[kcan03], N'')))) = @inboundType")
  }
  if (q.materialCode) {
    parts.push("LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) = @materialCode")
  }
  if (q.materialName) {
    parts.push("LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa02], N'')))) LIKE @materialName ESCAPE '\\'")
  }
  if (q.materialSpec) {
    parts.push("LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa03], N'')))) LIKE @materialSpec ESCAPE '\\'")
  }
  if (q.materialCategory) {
    parts.push("LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa05], N'')))) = @materialCategory")
  }
  if (q.relatedParty) {
    parts.push(`(
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan05], N'')))) LIKE @relatedParty ESCAPE '\\'
      OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[kehu], N'')))) LIKE @relatedParty ESCAPE '\\'
    )`)
  }
  return `WHERE ${parts.join('\n      AND ')}`
}

function buildStockInStatsReportSql(q) {
  const whereSql = buildReportWhereSql(q)
  return `
    SELECT
      LTRIM(RTRIM(ISNULL(h.[pass], N''))) AS auditFlag,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan01], N'')))) AS receiptNo,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan04], N'')))) AS sourceOrderNo,
      h.[kcan02] AS inboundDate,
      LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(h.[kcan03], N'')))) AS inboundType,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan05], N'')))) AS relatedPartyCode,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[kehu], N'')))) AS relatedPartyName,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan06], N'')))) AS warehouseCode,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[ck], N'')))) AS warehouseName,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) AS materialCode,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa02], N'')))) AS materialName,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa03], N'')))) AS materialSpec,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(l.[kcaa04], N'')))) AS unit,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa05], N'')))) AS materialCategory,
      ${safeDecimalExpr('l', 'kcao03', 0)} AS quantity,
      (${safeDecimalExpr('l', 'kcao031', 0)} - ${safeDecimalExpr('l', 'kcao03', 0)}) AS transferQty,
      ${safeDecimalExpr('l', 'kcao04', 0)} AS unitPrice,
      ${safeDecimalExpr('l', 'kcao05', 0)} AS amount,
      ${safeDecimalExpr('l', 'kcao041', 0)} AS unitPriceTax,
      ${safeDecimalExpr('l', 'kcao051', 0)} AS amountTax,
      LTRIM(RTRIM(COALESCE(
        NULLIF(CONVERT(nvarchar(1000), l.[remark]), N''),
        NULLIF(CONVERT(nvarchar(1000), h.[remark]), N''),
        N''
      ))) AS remark,
      l.[id] AS lineId
    FROM ${STOCK_IN_HEADER_FROM} AS h
    INNER JOIN ${STOCK_IN_LINE_FROM} AS l
      ON LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcao01], N''))))
       = LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan01], N''))))
    ${whereSql}
    ORDER BY
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan06], N'')))) ASC,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[ck], N'')))) ASC,
      h.[kcan02] ASC,
      h.[kcan01] ASC,
      l.[id] ASC
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
  return map[text(type)] || text(type)
}

function auditLabel(flag) {
  return text(flag) === '1' ? '已审核' : '未审核'
}

function serializeDate(value) {
  if (value instanceof Date) return value.toISOString()
  return value ?? ''
}

function numberValue(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function serializeReportRow(row, canViewPrice) {
  const relatedName = text(row.relatedPartyName) || text(row.relatedPartyCode)
  const out = {
    rowKey: `${text(row.receiptNo)}-${Number(row.lineId ?? 0)}`,
    auditStatus: auditLabel(row.auditFlag),
    receiptNo: text(row.receiptNo),
    sourceOrderNo: text(row.sourceOrderNo),
    inboundDate: serializeDate(row.inboundDate),
    inboundType: text(row.inboundType),
    inboundTypeLabel: inboundTypeLabel(row.inboundType),
    relatedParty: relatedName,
    relatedPartyCode: text(row.relatedPartyCode),
    relatedPartyName: text(row.relatedPartyName),
    warehouseCode: text(row.warehouseCode),
    warehouseName: text(row.warehouseName) || text(row.warehouseCode),
    materialCode: text(row.materialCode),
    materialName: text(row.materialName),
    materialSpec: text(row.materialSpec),
    unit: text(row.unit),
    materialCategory: text(row.materialCategory),
    quantity: numberValue(row.quantity),
    transferQty: numberValue(row.transferQty),
    remark: text(row.remark),
  }
  if (canViewPrice) {
    out.unitPrice = numberValue(row.unitPrice)
    out.amount = numberValue(row.amount)
    out.unitPriceTax = numberValue(row.unitPriceTax)
    out.amountTax = numberValue(row.amountTax)
  }
  return out
}

async function canViewPriceColumns(pool, req) {
  const user = req.user ?? {}
  const uid = user.userId ?? user.UserID ?? user.id ?? user.uid
  if (await resolveSysUserIsAdminByUserId(pool, uid)) return true
  if (!uid) return false
  return assertUserHasAction(pool, uid, MENU_PATH, 'price')
}

async function fetchWarehouseOptions(pool, keyword = '') {
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
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([kcaa03], N'')))) AS spec
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

async function fetchRelatedPartyOptions(pool, keyword = '') {
  const req = pool.request()
  let kwSql = ''
  if (keyword) {
    req.input('kw', sql.NVarChar(400), likePattern(keyword))
    kwSql = `AND (
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([kcan05], N'')))) LIKE @kw ESCAPE '\\'
      OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([kehu], N'')))) LIKE @kw ESCAPE '\\'
    )`
  }
  const r = await req.query(`
    SELECT TOP 100 code, name
    FROM (
      SELECT DISTINCT
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([kcan05], N'')))) AS code,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([kehu], N'')))) AS name
      FROM ${STOCK_IN_HEADER_FROM}
      WHERE (ISNULL([del], N'') = N'' OR [del] = N'0')
        AND (
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([kcan05], N'')))) <> N''
          OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([kehu], N'')))) <> N''
        )
        ${kwSql}
    ) AS x
    ORDER BY code ASC, name ASC
  `)
  return r.recordset ?? []
}

function sendError(res, err, prefix) {
  res.status(500).json({ code: 500, msg: `${prefix}：${String(err?.message ?? err)}`, data: null })
}

export function registerStockInStatsRoutes(app, { getPool }) {
  app.get('/api/stock-in-stats/print-header', async (_req, res) => {
    try {
      const pool = await getPool()
      res.json({ code: 200, msg: 'success', data: await fetchStockStatsPrintHeader(pool) })
    } catch (err) {
      sendError(res, err, '读取入库统计打印抬头失败')
    }
  })

  app.get('/api/stock-in-stats/warehouse-options', async (req, res) => {
    try {
      const pool = await getPool()
      res.json({ code: 200, msg: 'success', data: { allValue: ALL_WAREHOUSE, list: await fetchWarehouseOptions(pool, text(req.query?.keyword)) } })
    } catch (err) {
      sendError(res, err, '读取入库统计仓库候选失败')
    }
  })

  app.get('/api/stock-in-stats/material-options', async (req, res) => {
    try {
      const pool = await getPool()
      res.json({ code: 200, msg: 'success', data: { list: await fetchMaterialOptions(pool, text(req.query?.keyword)) } })
    } catch (err) {
      sendError(res, err, '读取入库统计物料候选失败')
    }
  })

  app.get('/api/stock-in-stats/category-options', async (req, res) => {
    try {
      const pool = await getPool()
      res.json({ code: 200, msg: 'success', data: { list: await fetchCategoryOptions(pool, text(req.query?.keyword)) } })
    } catch (err) {
      sendError(res, err, '读取入库统计材料分类失败')
    }
  })

  app.get('/api/stock-in-stats/related-party-options', async (req, res) => {
    try {
      const pool = await getPool()
      res.json({ code: 200, msg: 'success', data: { list: await fetchRelatedPartyOptions(pool, text(req.query?.keyword)) } })
    } catch (err) {
      sendError(res, err, '读取入库统计关联单位失败')
    }
  })

  app.get('/api/stock-in-stats/report', async (req, res) => {
    try {
      const q = parseReportQuery(req.query ?? {})
      if (!q.startDate) {
        res.status(400).json({ code: 400, msg: '统计开始日期不能为空', data: null })
        return
      }
      if (!q.endDate) {
        res.status(400).json({ code: 400, msg: '统计结束日期不能为空', data: null })
        return
      }
      if (!q.warehouseCode) {
        res.status(400).json({ code: 400, msg: '仓库不能为空', data: null })
        return
      }

      const pool = await getPool()
      const canViewPrice = await canViewPriceColumns(pool, req)
      const dbReq = pool.request()
      bindReportParams(dbReq, q)
      const result = await dbReq.query(buildStockInStatsReportSql(q))
      res.json({
        code: 200,
        msg: 'success',
        data: {
          list: (result.recordset ?? []).map((row) => serializeReportRow(row, canViewPrice)),
          startDate: q.startDate,
          endDate: q.endDate,
          warehouseCode: q.warehouseCode,
          allWarehouse: q.allWarehouse,
          canViewPrice,
        },
      })
    } catch (err) {
      sendError(res, err, '读取入库统计表失败')
    }
  })
}

export const __stockInStatsForTest = {
  ALL_WAREHOUSE,
  MENU_PATH,
  parseReportQuery,
  buildReportWhereSql,
  buildStockInStatsReportSql,
  inboundTypeLabel,
  serializeReportRow,
}
