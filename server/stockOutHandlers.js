import { sql } from './db.js'
import { getActorAuditTripletFromReq } from './businessAuditFields.js'
import {
  buildStockOutListPagedSql,
  buildStockOutListWhereSql,
  parseStockOutListQuery,
} from './stockOutListQuery.js'
import { suggestStockOutNo, createStockOut, updateStockOut } from './stockOutSaveService.js'
import { applyStockOutLifecycleAction } from './stockOutLifecycle.js'
import { buildStockOutAvailabilitySql } from './stockOutAvailability.js'
import { queryStockOutSourceLines } from './stockOutSourceLines.js'

const HEADER_FROM = 'dbo.[UB_ERP_Stocks_out]'
const LINE_FROM = 'dbo.[UB_ERP_Stocks_out_list]'
const WAREHOUSE_FROM = 'dbo.[UB_ERP_Stocks_Warehouse]'
const SUPPLIER_FROM = 'dbo.[UB_ERP_System_supplier]'
const WORKSHOP_FROM = 'dbo.[UB_ERP_Stocks_workshop]'
const CUSTOMER_FROM = 'dbo.[UB_ERP_Customer]'

function text(v) {
  return String(v ?? '').trim()
}

function normalizeId(v) {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : 0
}

function bindListParams(req, params) {
  for (const [key, value] of Object.entries(params ?? {})) req.input(key, sql.NVarChar(500), value)
}

function serializeRow(row = {}) {
  return { ...row }
}

async function getActor(pool, req) {
  const triplet = await getActorAuditTripletFromReq(pool, req)
  return {
    uid: triplet.uid,
    uname: triplet.uname,
    utruename: triplet.utruename,
    userName: req?.user?.userName,
    isAdmin: req?.user?.isAdmin === true || req?.user?.is_admin === 1 || req?.user?.is_admin === '1',
  }
}

function sendSave(res, result, fallback = '保存成功') {
  if (!result.ok) {
    res.status(result.status ?? 400).json({ code: result.status ?? 400, msg: result.msg, data: null })
    return
  }
  res.json({ code: 200, msg: result.msg || fallback, data: result })
}

export function registerStockOutRoutes(app, deps) {
  const { getPool } = deps

  app.get('/api/stock-out/list', async (req, res) => {
    try {
      const pool = await getPool()
      const q = parseStockOutListQuery(req.query ?? {})
      const { whereSql, params } = buildStockOutListWhereSql(q)
      const countReq = pool.request()
      bindListParams(countReq, params)
      const totalRow = await countReq.query(`SELECT COUNT(1) AS total FROM ${HEADER_FROM} AS h WHERE 1=1 ${whereSql}`)
      const total = Number(totalRow.recordset?.[0]?.total ?? 0)
      const listReq = pool.request().input('startRow', sql.Int, (q.page - 1) * q.pageSize + 1).input('endRow', sql.Int, q.page * q.pageSize)
      bindListParams(listReq, params)
      const listResult = await listReq.query(buildStockOutListPagedSql({ whereSql }).sql)
      res.json({ code: 200, msg: 'success', data: { total, list: (listResult.recordset ?? []).map(serializeRow) } })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取出库单列表失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  app.get('/api/stock-out/suggest-doc-no', async (_req, res) => {
    try {
      const pool = await getPool()
      res.json({ code: 200, msg: 'success', data: { suggested: await suggestStockOutNo(pool, new Date()) } })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `获取出库单号失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  app.get('/api/stock-out/warehouse-options', async (req, res) => {
    try {
      const keyword = text(req.query?.keyword)
      const pool = await getPool()
      const dbReq = pool.request()
      if (keyword) dbReq.input('kw', sql.NVarChar(400), `%${keyword}%`)
      const r = await dbReq.query(`
        SELECT TOP 100 LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([code], N'')))) AS code,
               LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([name], N'')))) AS name
        FROM ${WAREHOUSE_FROM}
        WHERE (ISNULL([del], N'') = N'' OR [del] = N'0')
        ${keyword ? `AND (LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([code], N'')))) LIKE @kw OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([name], N'')))) LIKE @kw)` : ''}
        ORDER BY [code] ASC
      `)
      res.json({ code: 200, msg: 'success', data: { list: r.recordset ?? [] } })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取仓库失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  /** 列表筛选：供应商/外协商联想（点击可直接下拉，关键字可选） */
  app.get('/api/stock-out/list-related-party-options', async (req, res) => {
    try {
      const keyword = text(req.query?.keyword)
      const pool = await getPool()
      const dbReq = pool.request()
      if (keyword) dbReq.input('kw', sql.NVarChar(400), `%${keyword}%`)
      const r = await dbReq.query(`
        SELECT TOP 50
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([s_code], N'')))) AS code,
          LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(NULLIF([s_name], N''), [name])))) AS name
        FROM ${SUPPLIER_FROM}
        WHERE (ISNULL([del], N'') = N'' OR [del] = N'0')
          AND LTRIM(RTRIM(ISNULL([pass], N''))) = N'1'
          ${keyword
    ? `AND (
            LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([s_code], N'')))) LIKE @kw
            OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(NULLIF([s_name], N''), [name])))) LIKE @kw
          )`
    : ''}
        ORDER BY [s_code] ASC
      `)
      res.json({ code: 200, msg: 'success', data: { list: r.recordset ?? [] } })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取供应商候选失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  app.get('/api/stock-out/related-party-options', async (req, res) => {
    try {
      const pool = await getPool()
      const type = text(req.query?.outboundType)
      const keyword = text(req.query?.keyword)
      const dbReq = pool.request()
      if (keyword) dbReq.input('kw', sql.NVarChar(400), `%${keyword}%`)
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
          WHERE (ISNULL([del], N'') = N'' OR [del] = N'0')
          ${keyword ? `AND (LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([code], N'')))) LIKE @kw OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([name], N'')))) LIKE @kw)` : ''}
          ORDER BY [code] ASC
        `
      } else {
        sqlText = `
          SELECT TOP 100 LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([khaa01], ISNULL([code], N''))))) AS code,
                 LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([khaa02], ISNULL([name], N''))))) AS name
          FROM ${CUSTOMER_FROM}
          WHERE (ISNULL([del], N'') = N'' OR [del] = N'0')
          ${keyword ? `AND (LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([khaa01], ISNULL([code], N''))))) LIKE @kw OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([khaa02], ISNULL([name], N''))))) LIKE @kw)` : ''}
          ORDER BY [code] ASC
        `
      }
      const r = await dbReq.query(sqlText)
      res.json({ code: 200, msg: 'success', data: { list: r.recordset ?? [] } })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取关联方失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  app.get('/api/stock-out/material-options', async (req, res) => {
    try {
      const pool = await getPool()
      const dbReq = pool.request()
      const keyword = text(req.query?.keyword)
      const warehouseCode = text(req.query?.warehouseCode)
      if (keyword) dbReq.input('kw', sql.NVarChar(400), `%${keyword}%`)
      if (warehouseCode) dbReq.input('warehouseCode', sql.NVarChar(200), warehouseCode)
      const availabilitySql = buildStockOutAvailabilitySql({ excludeOutboundNo: text(req.query?.excludeOutboundNo) })
      const r = await dbReq.query(`
        SELECT TOP 100 *
        FROM (${availabilitySql}) AS s
        WHERE s.[availableQty] > 0
          ${warehouseCode ? `AND s.[warehouseCode] = @warehouseCode` : ''}
          ${keyword ? `AND (s.[materialCode] LIKE @kw)` : ''}
        ORDER BY s.[materialCode] ASC
      `)
      res.json({ code: 200, msg: 'success', data: { list: r.recordset ?? [] } })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取可出库存失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  app.get('/api/stock-out/inventory-summary', async (req, res) => {
    try {
      const pool = await getPool()
      const dbReq = pool.request()
      const warehouseCode = text(req.query?.warehouseCode)
      if (warehouseCode) dbReq.input('warehouseCode', sql.NVarChar(200), warehouseCode)
      const r = await dbReq.query(`
        SELECT *
        FROM (${buildStockOutAvailabilitySql({ excludeOutboundNo: text(req.query?.excludeOutboundNo) })}) AS s
        WHERE 1=1 ${warehouseCode ? `AND s.[warehouseCode] = @warehouseCode` : ''}
        ORDER BY s.[materialCode] ASC
      `)
      res.json({ code: 200, msg: 'success', data: { list: r.recordset ?? [] } })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取出库库存统计失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  app.get('/api/stock-out/source-lines', async (req, res) => {
    try {
      const pool = await getPool()
      const list = await queryStockOutSourceLines(pool, {
        outboundType: req.query?.outboundType,
        sourceOrderNo: req.query?.sourceOrderNo,
        keyword: req.query?.keyword,
      })
      res.json({ code: 200, msg: 'success', data: { list } })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取出库来源明细失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  app.get('/api/stock-out/print-data', async (req, res) => {
    req.params = { id: req.query?.id }
    return detail(req, res, true)
  })

  async function detail(req, res, forPrint = false) {
    try {
      const id = normalizeId(req.params?.id)
      if (!id) return res.status(400).json({ code: 400, msg: '出库单参数无效', data: null })
      const pool = await getPool()
      const headerR = await pool.request().input('id', sql.Int, id).query(`SELECT TOP 1 * FROM ${HEADER_FROM} WHERE [id] = @id`)
      const header = headerR.recordset?.[0]
      if (!header) return res.status(404).json({ code: 404, msg: '出库单不存在', data: null })
      const outboundNo = text(header.kcap01)
      const lineR = await pool.request().input('outboundNo', sql.NVarChar(200), outboundNo).query(`
        SELECT *
        FROM ${LINE_FROM}
        WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([kcaq01], N'')))) = @outboundNo
        ORDER BY ISNULL([seq], [id]), [id]
      `)
      res.json({ code: 200, msg: 'success', data: { header: serializeRow(header), lines: lineR.recordset ?? [], forPrint } })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取出库单详情失败：${String(err?.message ?? err)}`, data: null })
    }
  }

  app.get('/api/stock-out/:id', detail)

  app.post('/api/stock-out', async (req, res) => {
    try {
      const pool = await getPool()
      const actor = await getActor(pool, req)
      sendSave(res, await createStockOut({ pool, body: req.body, req, actor }), '保存成功')
    } catch (err) {
      res.status(500).json({ code: 500, msg: `保存出库单失败：${String(err?.message ?? err?.originalError?.message ?? err)}`, data: null })
    }
  })

  app.put('/api/stock-out/:id', async (req, res) => {
    try {
      const id = normalizeId(req.params?.id)
      if (!id) return res.status(400).json({ code: 400, msg: '出库单参数无效', data: null })
      const pool = await getPool()
      const actor = await getActor(pool, req)
      sendSave(res, await updateStockOut({ pool, id, body: req.body, req, actor }), '保存成功')
    } catch (err) {
      res.status(500).json({ code: 500, msg: `保存出库单失败：${String(err?.message ?? err?.originalError?.message ?? err)}`, data: null })
    }
  })

  async function lifecycle(req, res, action) {
    try {
      const id = normalizeId(req.params?.id)
      if (!id) return res.status(400).json({ code: 400, msg: '出库单参数无效', data: null })
      const pool = await getPool()
      const actor = await getActor(pool, req)
      const result = await applyStockOutLifecycleAction({ pool, id, action, actor })
      if (!result.ok) return res.status(result.status ?? 400).json({ code: result.status ?? 400, msg: result.msg, data: null })
      res.json({ code: 200, msg: result.msg, data: result })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `出库单操作失败：${String(err?.message ?? err)}`, data: null })
    }
  }

  app.post('/api/stock-out/:id/audit', (req, res) => lifecycle(req, res, 'audit'))
  app.post('/api/stock-out/:id/unaudit', (req, res) => lifecycle(req, res, 'unaudit'))
  app.post('/api/stock-out/:id/restore', (req, res) => lifecycle(req, res, 'restore'))
  app.delete('/api/stock-out/:id', (req, res) => lifecycle(req, res, 'delete'))
  app.delete('/api/stock-out/:id/hard', (req, res) => lifecycle(req, res, 'hard-delete'))
}
