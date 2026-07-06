/**
 * 出库统计表 API 路由。
 * 业务口径：本报表按出库单明细逐行统计，不按库存余额汇总。
 */
import { sql } from './db.js'
import { safeDecimalExpr } from './buyOrderSqlSafe.js'
import { assertUserHasAction } from './apiPermissionGate.js'
import { resolveSysUserIsAdminByUserId } from './sysUsersDb.js'
import { fetchStockStatsPrintHeader } from './stockStatsPrintHeader.js'

const WAREHOUSE_FROM = 'dbo.[UB_ERP_Stocks_Warehouse]'
const MATERIAL_CATEGORY_FROM = 'dbo.[UB_ERP_Stocks_material]'
const BOM_FROM = 'dbo.[UB_ERP_Bom_000]'
const STOCK_OUT_HEADER_FROM = 'dbo.[UB_ERP_Stocks_out]'
const STOCK_OUT_LINE_FROM = 'dbo.[UB_ERP_Stocks_out_list]'
const MENU_PATH = 'inventory/analysis/stock-out-stats'
const ALL_WAREHOUSE = '__ALL__'

function text(v) {
  return String(v ?? '').trim()
}

function likePattern(v) {
  return `%${text(v).replace(/[\\%_]/g, '\\$&')}%`
}

function normalizeOutboundType(v) {
  const s = text(v)
  return /^[0-9]$/.test(s) ? s : ''
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

function parseReportQuery(query = {}) {
  const startDate = normalizeDate(query.startDate)
  const endDate = normalizeDate(query.endDate)
  const warehouseCode = text(query.warehouseCode)
  return {
    startDate,
    endDate,
    warehouseCode,
    allWarehouse: warehouseCode === ALL_WAREHOUSE,
    outboundType: normalizeOutboundType(query.outboundType),
    materialSystemcode: text(query.materialSystemcode),
    materialName: text(query.materialName),
    materialSpec: text(query.materialSpec),
    materialCategories: parseCategoryList(query.materialCategories ?? query.materialCategory),
    relatedParty: text(query.relatedParty),
  }
}

function bindReportParams(req, q) {
  req.input('startDate', sql.DateTime, new Date(`${q.startDate}T00:00:00`))
  req.input('endDate', sql.DateTime, new Date(`${q.endDate}T23:59:59`))
  if (!q.allWarehouse) req.input('warehouseCode', sql.NVarChar(200), q.warehouseCode)
  if (q.outboundType) req.input('outboundType', sql.NVarChar(20), q.outboundType)
  if (q.materialSystemcode) req.input('materialSystemcode', sql.NVarChar(200), q.materialSystemcode)
  if (q.materialName) req.input('materialName', sql.NVarChar(400), likePattern(q.materialName))
  if (q.materialSpec) req.input('materialSpec', sql.NVarChar(400), likePattern(q.materialSpec))
  q.materialCategories.forEach((code, index) => req.input(`category${index}`, sql.NVarChar(200), code))
  if (q.relatedParty) req.input('relatedParty', sql.NVarChar(400), likePattern(q.relatedParty))
}

function buildCategoryWhereSql(categories) {
  if (!categories.length) return ''
  const tokens = categories.map((_, index) => `@category${index}`).join(', ')
  return `LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa05], N'')))) IN (${tokens})`
}

function buildReportWhereSql(q) {
  const parts = [
    "(ISNULL(h.[del], N'') = N'' OR h.[del] = N'0')",
    "(ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')",
    'h.[kcap02] >= @startDate',
    'h.[kcap02] <= @endDate',
  ]
  if (!q.allWarehouse) {
    parts.push("LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcap06], N'')))) = @warehouseCode")
  }
  if (q.outboundType) {
    parts.push("LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(h.[kcap03], N'')))) = @outboundType")
  }
  if (q.materialSystemcode) {
    parts.push("LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[systemcode], N'')))) = @materialSystemcode")
  }
  if (q.materialName) {
    parts.push("LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa02], N'')))) LIKE @materialName ESCAPE '\\'")
  }
  if (q.materialSpec) {
    parts.push("LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa03], N'')))) LIKE @materialSpec ESCAPE '\\'")
  }
  const categoryWhere = buildCategoryWhereSql(q.materialCategories)
  if (categoryWhere) parts.push(categoryWhere)
  if (q.relatedParty) {
    parts.push(`(
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcap05], N'')))) LIKE @relatedParty ESCAPE '\\'
      OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[kehu], N'')))) LIKE @relatedParty ESCAPE '\\'
    )`)
  }
  return `WHERE ${parts.join('\n      AND ')}`
}

function buildStockOutStatsReportSql(q) {
  const whereSql = buildReportWhereSql(q)
  return `
    SELECT
      LTRIM(RTRIM(ISNULL(h.[pass], N''))) AS auditFlag,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcap01], N'')))) AS outboundNo,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcap08], N'')))) AS sourceOrderNo,
      h.[kcap02] AS outboundDate,
      LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(h.[kcap03], N'')))) AS outboundType,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcap05], N'')))) AS relatedPartyCode,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[kehu], N'')))) AS relatedPartyName,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcap06], N'')))) AS warehouseCode,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[ck], N'')))) AS warehouseName,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[systemcode], N'')))) AS materialSystemcode,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) AS materialCode,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa02], N'')))) AS materialName,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa03], N'')))) AS materialSpec,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(l.[kcaa04], N'')))) AS unit,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa05], N'')))) AS materialCategory,
      ${safeDecimalExpr('l', 'kcaq03', 0)} AS quantity,
      ${safeDecimalExpr('l', 'kcaq04', 0)} AS unitPrice,
      ${safeDecimalExpr('l', 'kcaq05', 0)} AS amount,
      ${safeDecimalExpr('l', 'kcaq041', 0)} AS unitPriceTax,
      ${safeDecimalExpr('l', 'kcaq051', 0)} AS amountTax,
      LTRIM(RTRIM(COALESCE(
        NULLIF(CONVERT(nvarchar(1000), l.[Describe]), N''),
        NULLIF(CONVERT(nvarchar(1000), h.[remark]), N''),
        N''
      ))) AS remark,
      l.[id] AS lineId
    FROM ${STOCK_OUT_HEADER_FROM} AS h
    INNER JOIN ${STOCK_OUT_LINE_FROM} AS l
      ON LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaq01], N''))))
       = LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcap01], N''))))
    ${whereSql}
    ORDER BY
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcap06], N'')))) ASC,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[ck], N'')))) ASC,
      h.[kcap02] ASC,
      h.[kcap01] ASC,
      l.[id] ASC
  `
}

function outboundTypeLabel(type) {
  const map = {
    1: '采购退货',
    2: '外协出库',
    3: '外协退货',
    4: '生产领料',
    6: '销售出库',
    7: '生产领料',
    8: '报损',
    9: '盘亏',
  }
  const key = text(type)
  return map[key] || (key ? `${key} 未知类别` : '')
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
    rowKey: `${text(row.outboundNo)}-${Number(row.lineId ?? 0)}`,
    auditStatus: auditLabel(row.auditFlag),
    outboundNo: text(row.outboundNo),
    sourceOrderNo: text(row.sourceOrderNo),
    outboundDate: serializeDate(row.outboundDate),
    outboundType: text(row.outboundType),
    outboundTypeLabel: outboundTypeLabel(row.outboundType),
    relatedParty: relatedName,
    relatedPartyCode: text(row.relatedPartyCode),
    relatedPartyName: text(row.relatedPartyName),
    warehouseCode: text(row.warehouseCode),
    warehouseName: text(row.warehouseName) || text(row.warehouseCode),
    materialSystemcode: text(row.materialSystemcode),
    materialCode: text(row.materialCode),
    materialName: text(row.materialName),
    materialSpec: text(row.materialSpec),
    unit: text(row.unit),
    materialCategory: text(row.materialCategory),
    quantity: numberValue(row.quantity),
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
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([systemcode], N'')))) AS systemcode,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([kcaa01], N'')))) AS code,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([kcaa02], N'')))) AS name,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([kcaa03], N'')))) AS spec
    FROM ${BOM_FROM}
    WHERE (ISNULL([del], N'') = N'' OR [del] = N'0')
      AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([kcaa01], N'')))) <> N''
      AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([systemcode], N'')))) <> N''
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
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([kcap05], N'')))) LIKE @kw ESCAPE '\\'
      OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([kehu], N'')))) LIKE @kw ESCAPE '\\'
    )`
  }
  const r = await req.query(`
    SELECT TOP 100 code, name
    FROM (
      SELECT DISTINCT
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([kcap05], N'')))) AS code,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([kehu], N'')))) AS name
      FROM ${STOCK_OUT_HEADER_FROM}
      WHERE (ISNULL([del], N'') = N'' OR [del] = N'0')
        AND (
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([kcap05], N'')))) <> N''
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

export function registerStockOutStatsRoutes(app, { getPool }) {
  app.get('/api/stock-out-stats/print-header', async (_req, res) => {
    try {
      const pool = await getPool()
      res.json({ code: 200, msg: 'success', data: await fetchStockStatsPrintHeader(pool) })
    } catch (err) {
      sendError(res, err, '读取出库统计打印抬头失败')
    }
  })

  app.get('/api/stock-out-stats/warehouse-options', async (req, res) => {
    try {
      const pool = await getPool()
      res.json({ code: 200, msg: 'success', data: { allValue: ALL_WAREHOUSE, list: await fetchWarehouseOptions(pool, text(req.query?.keyword)) } })
    } catch (err) {
      sendError(res, err, '读取出库统计仓库候选失败')
    }
  })

  app.get('/api/stock-out-stats/material-options', async (req, res) => {
    try {
      const pool = await getPool()
      res.json({ code: 200, msg: 'success', data: { list: await fetchMaterialOptions(pool, text(req.query?.keyword)) } })
    } catch (err) {
      sendError(res, err, '读取出库统计物料候选失败')
    }
  })

  app.get('/api/stock-out-stats/category-options', async (req, res) => {
    try {
      const pool = await getPool()
      res.json({ code: 200, msg: 'success', data: { list: await fetchCategoryOptions(pool, text(req.query?.keyword)) } })
    } catch (err) {
      sendError(res, err, '读取出库统计材料分类失败')
    }
  })

  app.get('/api/stock-out-stats/related-party-options', async (req, res) => {
    try {
      const pool = await getPool()
      res.json({ code: 200, msg: 'success', data: { list: await fetchRelatedPartyOptions(pool, text(req.query?.keyword)) } })
    } catch (err) {
      sendError(res, err, '读取出库统计关联单位失败')
    }
  })

  app.get('/api/stock-out-stats/report', async (req, res) => {
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
      const result = await dbReq.query(buildStockOutStatsReportSql(q))
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
      sendError(res, err, '读取出库统计表失败')
    }
  })
}

export const __stockOutStatsForTest = {
  ALL_WAREHOUSE,
  MENU_PATH,
  parseReportQuery,
  buildReportWhereSql,
  buildStockOutStatsReportSql,
  outboundTypeLabel,
  serializeReportRow,
}
