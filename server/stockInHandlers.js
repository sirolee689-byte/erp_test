import { sql } from './db.js'
import {
  STOCK_IN_HEADER_TABLE,
  STOCK_IN_LINE_TABLE,
  buildStockInListPagedSql,
  buildStockInListWhereSql,
  parseStockInListQuery,
} from './stockInListQuery.js'
import {
  createStockIn,
  fetchStockInInventorySummary,
  suggestStockInNo,
  updateStockIn,
} from './stockInSaveService.js'
import { applyStockInLifecycleAction } from './stockInLifecycle.js'
import { resolveActorAuditTripletFromReq } from './businessAuditFields.js'

const HEADER_FROM = `dbo.[${STOCK_IN_HEADER_TABLE}]`
const LINE_FROM = `dbo.[${STOCK_IN_LINE_TABLE}]`
const WAREHOUSE_FROM = 'dbo.[UB_ERP_Stocks_Warehouse]'
const BOM_FROM = 'dbo.[UB_ERP_Bom_000]'
const SUPPLIER_FROM = 'dbo.[System_supplier]'
const WORKSHOP_FROM = 'dbo.[UB_ERP_Stocks_workshop]'
const CUSTOMER_FROM = 'dbo.[UB_ERP_Customer]'

function bindListParams(req, params) {
  for (const [key, value] of Object.entries(params ?? {})) req.input(key, sql.NVarChar(500), value)
}

function serializeRow(row) {
  const out = {}
  for (const [k, v] of Object.entries(row ?? {})) out[k] = v instanceof Date ? v.toISOString() : v
  if (out.id != null) out.id = Number(out.id)
  return out
}

function normalizeId(raw) {
  const id = Number(raw)
  return Number.isInteger(id) && id > 0 ? id : null
}

function text(v) {
  return String(v ?? '').trim()
}

async function getActor(pool, req) {
  const auditActor = await resolveActorAuditTripletFromReq(pool, req)
  return { ...(req.user ?? req.session?.user ?? {}), ...auditActor }
}

function sendSave(res, result, msg) {
  if (!result?.ok) {
    res.status(result?.status ?? 400).json({ code: result?.status ?? 400, msg: result?.msg || '保存失败', data: null })
    return
  }
  res.json({ code: 200, msg, data: result })
}

function sourceMeta(type) {
  const t = text(type)
  if (t === '1') return { header: 'dbo.[UB_ERP_Buy_order]', line: 'dbo.[UB_ERP_Buy_order_list]', noCol: 'cgad01', partyCol: 'cgad05', lineOrderCol: 'cgae01', qtyCol: 'cgae03', priceCol: 'cgae04' }
  if (t === '2' || t === '3') return { header: 'dbo.[UB_ERP_assist_order]', line: 'dbo.[UB_ERP_assist_order_list]', noCol: 'wxaj01', partyCol: 'wxaj05', lineOrderCol: 'wxak01', qtyCol: 'wxak03', priceCol: 'wxak04' }
  if (t === '4' || t === '5') return { header: 'dbo.[UB_ERP_Dispatch_order]', line: 'dbo.[UB_ERP_Dispatch_order_list]', noCol: 'scaj01', partyCol: 'scaj05', lineOrderCol: 'scak01', qtyCol: 'scak03', priceCol: 'cost_price' }
  if (t === '6') return { header: 'dbo.[UB_ERP_Sales_order]', line: 'dbo.[UB_ERP_Sales_order_list]', noCol: 'xsaj01', partyCol: 'xsaj04', lineOrderCol: 'xsak01', qtyCol: 'xsak03', priceCol: 'sale_price' }
  return null
}

export function registerStockInRoutes(app, deps) {
  const { getPool } = deps

  app.get('/api/stock-in/list', async (req, res) => {
    try {
      const pool = await getPool()
      const q = parseStockInListQuery(req.query ?? {})
      const { whereSql, params } = buildStockInListWhereSql(q)
      const countReq = pool.request()
      bindListParams(countReq, params)
      const totalRow = await countReq.query(`SELECT COUNT(1) AS total FROM ${HEADER_FROM} AS h WHERE 1=1 ${whereSql}`)
      const total = Number(totalRow.recordset?.[0]?.total ?? 0)
      const listReq = pool.request().input('startRow', sql.Int, (q.page - 1) * q.pageSize + 1).input('endRow', sql.Int, q.page * q.pageSize)
      bindListParams(listReq, params)
      const listResult = await listReq.query(buildStockInListPagedSql({ whereSql }).sql)
      res.json({ code: 200, msg: 'success', data: { total, list: (listResult.recordset ?? []).map(serializeRow) } })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取入库单列表失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  app.get('/api/stock-in/suggest-doc-no', async (_req, res) => {
    try {
      const pool = await getPool()
      res.json({ code: 200, msg: 'success', data: { suggested: await suggestStockInNo(pool, new Date()) } })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `获取入库单号失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  app.get('/api/stock-in/warehouse-options', async (req, res) => {
    try {
      const pool = await getPool()
      const keyword = text(req.query?.keyword)
      const dbReq = pool.request()
      let kwSql = ''
      if (keyword) {
        dbReq.input('kw', sql.NVarChar(400), `%${keyword}%`)
        kwSql = `AND (LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([code], N'')))) LIKE @kw OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([name], N'')))) LIKE @kw)`
      }
      const r = await dbReq.query(`
        SELECT TOP 100 LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([code], N'')))) AS code,
               LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([name], N'')))) AS name
        FROM ${WAREHOUSE_FROM}
        WHERE (ISNULL([del], N'') = N'' OR [del] = N'0') ${kwSql}
        ORDER BY [code] ASC
      `)
      res.json({ code: 200, msg: 'success', data: { list: r.recordset ?? [] } })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取仓库失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  app.get('/api/stock-in/related-party-options', async (req, res) => {
    try {
      const pool = await getPool()
      const type = text(req.query?.inboundType)
      const keyword = text(req.query?.keyword)
      const dbReq = pool.request()
      if (keyword) dbReq.input('kw', sql.NVarChar(400), `%${keyword}%`)
      const kw = keyword
        ? `AND (LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([code], N'')))) LIKE @kw OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([name], N'')))) LIKE @kw)`
        : ''
      let sqlText = ''
      if (['1', '2', '3'].includes(type)) {
        sqlText = `
          SELECT TOP 100 LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([s_code], N'')))) AS code,
                 LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(NULLIF([s_name], N''), [name])))) AS name
          FROM ${SUPPLIER_FROM}
          WHERE (ISNULL([del], N'') = N'' OR [del] = N'0')
          ${keyword ? `AND (LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([s_code], N'')))) LIKE @kw OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(NULLIF([s_name], N''), [name])))) LIKE @kw)` : ''}
          ORDER BY [s_code] ASC
        `
      } else if (['4', '5'].includes(type)) {
        sqlText = `
          SELECT TOP 100 LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([code], N'')))) AS code,
                 LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([name], N'')))) AS name
          FROM ${WORKSHOP_FROM}
          WHERE (ISNULL([del], N'') = N'' OR [del] = N'0') ${kw}
          ORDER BY [code] ASC
        `
      } else {
        sqlText = `
          SELECT TOP 100 LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([khaa01], N'')))) AS code,
                 LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([khaa02], N'')))) AS name
          FROM ${CUSTOMER_FROM}
          WHERE (ISNULL([del], N'') = N'' OR [del] = N'0')
          ${keyword ? `AND (LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([khaa01], N'')))) LIKE @kw OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([khaa02], N'')))) LIKE @kw)` : ''}
          ORDER BY [khaa01] ASC
        `
      }
      const r = await dbReq.query(sqlText)
      res.json({ code: 200, msg: 'success', data: { list: r.recordset ?? [] } })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取关联方失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  app.get('/api/stock-in/material-options', async (req, res) => {
    try {
      const pool = await getPool()
      const keyword = text(req.query?.keyword)
      const dbReq = pool.request()
      let kwSql = ''
      if (keyword) {
        dbReq.input('kw', sql.NVarChar(400), `%${keyword}%`)
        kwSql = `AND (LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([kcaa01], N'')))) LIKE @kw OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([kcaa02], N'')))) LIKE @kw)`
      }
      const r = await dbReq.query(`
        SELECT TOP 100 *
        FROM ${BOM_FROM}
        WHERE (ISNULL([del], N'') = N'' OR [del] = N'0') ${kwSql}
        ORDER BY [id] DESC
      `)
      res.json({ code: 200, msg: 'success', data: { list: r.recordset ?? [] } })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取物料失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  app.get('/api/stock-in/source-options', async (req, res) => {
    try {
      const pool = await getPool()
      const meta = sourceMeta(req.query?.inboundType)
      if (!meta) return res.json({ code: 200, msg: 'success', data: { list: [] } })
      const partyCode = text(req.query?.relatedPartyCode)
      const keyword = text(req.query?.keyword)
      const dbReq = pool.request()
      let extra = ''
      if (partyCode) {
        dbReq.input('partyCode', sql.NVarChar(200), partyCode)
        extra += ` AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[${meta.partyCol}], N'')))) = @partyCode`
      }
      if (keyword) {
        dbReq.input('kw', sql.NVarChar(400), `%${keyword}%`)
        extra += ` AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[${meta.noCol}], N'')))) LIKE @kw`
      }
      const r = await dbReq.query(`
        SELECT TOP 100 LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[${meta.noCol}], N'')))) AS sourceOrderNo,
               LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[${meta.partyCol}], N'')))) AS relatedPartyCode
        FROM ${meta.header} AS h
        WHERE (ISNULL(h.[del], N'') = N'' OR h.[del] = N'0')
          AND LTRIM(RTRIM(ISNULL(h.[pass], N''))) = N'1'
          AND LTRIM(RTRIM(ISNULL(h.[closed], N'0'))) = N'0'
          ${extra}
        ORDER BY h.[id] DESC
      `)
      res.json({ code: 200, msg: 'success', data: { list: r.recordset ?? [] } })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取关联单据失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  app.get('/api/stock-in/source-lines', async (req, res) => {
    try {
      const pool = await getPool()
      const meta = sourceMeta(req.query?.inboundType)
      const sourceOrderNo = text(req.query?.sourceOrderNo)
      if (!meta || !sourceOrderNo) return res.json({ code: 200, msg: 'success', data: { list: [] } })
      const r = await pool.request().input('sourceOrderNo', sql.NVarChar(200), sourceOrderNo).query(`
        SELECT TOP 200
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[systemcode], ISNULL(l.[GUID], N''))))) AS kcao02,
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[${meta.lineOrderCol}], N'')))) AS kcan04,
          ISNULL(l.[${meta.qtyCol}], 0) AS availableQty,
          ISNULL(l.[${meta.priceCol}], 0) AS kcao04,
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) AS kcaa01,
          LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa02], N'')))) AS kcaa02,
          LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa03], N'')))) AS kcaa03,
          LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(l.[kcaa04], N'')))) AS kcaa04,
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa11], N'')))) AS kcaa11,
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[version], N'')))) AS version,
          LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[location], N'')))) AS location
        FROM ${meta.line} AS l
        WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[${meta.lineOrderCol}], N'')))) = @sourceOrderNo
          AND (ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')
        ORDER BY ISNULL(l.[seq], l.[id]), l.[id]
      `)
      res.json({ code: 200, msg: 'success', data: { list: r.recordset ?? [] } })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取关联明细失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  app.get('/api/stock-in/inventory-summary', async (req, res) => {
    try {
      const pool = await getPool()
      res.json({ code: 200, msg: 'success', data: { list: await fetchStockInInventorySummary(pool, req.query ?? {}) } })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取入库库存统计失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  app.get('/api/stock-in/print-data', async (req, res) => {
    req.params = { id: req.query?.id }
    return detail(req, res, true)
  })

  async function detail(req, res, forPrint = false) {
    try {
      const id = normalizeId(req.params?.id)
      if (!id) return res.status(400).json({ code: 400, msg: '入库单参数无效', data: null })
      const pool = await getPool()
      const headerR = await pool.request().input('id', sql.Int, id).query(`SELECT TOP 1 * FROM ${HEADER_FROM} WHERE [id] = @id`)
      const header = headerR.recordset?.[0]
      if (!header) return res.status(404).json({ code: 404, msg: '入库单不存在', data: null })
      const receiptNo = text(header.kcan01)
      const lineR = await pool.request().input('receiptNo', sql.NVarChar(200), receiptNo).query(`
        SELECT *
        FROM ${LINE_FROM}
        WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([kcao01], N'')))) = @receiptNo
        ORDER BY ISNULL([seq], [id]), [id]
      `)
      res.json({ code: 200, msg: 'success', data: { header: serializeRow(header), lines: (lineR.recordset ?? []).map(serializeRow), forPrint } })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取入库单详情失败：${String(err?.message ?? err)}`, data: null })
    }
  }

  app.get('/api/stock-in/:id', detail)

  app.post('/api/stock-in', async (req, res) => {
    try {
      const pool = await getPool()
      const actor = await getActor(pool, req)
      sendSave(res, await createStockIn({ pool, body: req.body, req, actor }), '保存成功')
    } catch (err) {
      res.status(500).json({ code: 500, msg: `保存入库单失败：${String(err?.message ?? err?.originalError?.message ?? err)}`, data: null })
    }
  })

  app.put('/api/stock-in/:id', async (req, res) => {
    try {
      const id = normalizeId(req.params?.id)
      if (!id) return res.status(400).json({ code: 400, msg: '入库单参数无效', data: null })
      const pool = await getPool()
      const actor = await getActor(pool, req)
      sendSave(res, await updateStockIn({ pool, id, body: req.body, req, actor }), '保存成功')
    } catch (err) {
      res.status(500).json({ code: 500, msg: `保存入库单失败：${String(err?.message ?? err?.originalError?.message ?? err)}`, data: null })
    }
  })

  async function lifecycle(req, res, action) {
    try {
      const id = normalizeId(req.params?.id)
      if (!id) return res.status(400).json({ code: 400, msg: '入库单参数无效', data: null })
      const pool = await getPool()
      const actor = await getActor(pool, req)
      const result = await applyStockInLifecycleAction({ pool, id, action, actor })
      if (!result.ok) return res.status(result.status ?? 400).json({ code: result.status ?? 400, msg: result.msg, data: null })
      res.json({ code: 200, msg: result.msg, data: result })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `入库单操作失败：${String(err?.message ?? err)}`, data: null })
    }
  }

  app.post('/api/stock-in/:id/audit', (req, res) => lifecycle(req, res, 'audit'))
  app.post('/api/stock-in/:id/unaudit', (req, res) => lifecycle(req, res, 'unaudit'))
  app.post('/api/stock-in/:id/restore', (req, res) => lifecycle(req, res, 'restore'))
  app.delete('/api/stock-in/:id', (req, res) => lifecycle(req, res, 'delete'))
  app.delete('/api/stock-in/:id/hard', (req, res) => lifecycle(req, res, 'hard-delete'))
}

