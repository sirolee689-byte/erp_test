import { sql } from './db.js'
import {
  DISPATCH_ORDER_HEADER_TABLE,
  buildDispatchOrderListPagedSql,
  buildDispatchOrderListWhereSql,
  parseDispatchOrderListQuery,
} from './dispatchOrderListQuery.js'
import {
  checkDispatchOrderNoAvailable,
  createDispatchOrder,
  fetchDispatchAvailability,
  suggestDispatchOrderNo,
  updateDispatchOrder,
} from './dispatchOrderSaveService.js'
import { applyDispatchOrderLifecycleAction } from './dispatchOrderLifecycle.js'
import { resolveActorAuditTripletFromReq } from './businessAuditFields.js'

const HEADER_FROM = `dbo.[${DISPATCH_ORDER_HEADER_TABLE}]`
const LINE_FROM = 'dbo.[UB_ERP_Dispatch_order_list]'
const COLOR_FROM = 'dbo.[UB_ERP_Stocks_colorcode]'

function bindListParams(req, params) {
  for (const [key, value] of Object.entries(params ?? {})) {
    req.input(key, sql.NVarChar(500), value)
  }
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

export function registerDispatchOrderRoutes(app, deps) {
  const { getPool } = deps

  app.get('/api/dispatch-order/list', async (req, res) => {
    try {
      const pool = await getPool()
      const q = parseDispatchOrderListQuery(req.query ?? {})
      const { whereSql, params } = buildDispatchOrderListWhereSql(q)
      const countReq = pool.request()
      bindListParams(countReq, params)
      const totalRow = await countReq.query(`SELECT COUNT(1) AS total FROM ${HEADER_FROM} AS h WHERE 1=1 ${whereSql}`)
      const total = Number(totalRow.recordset?.[0]?.total ?? 0)
      const listReq = pool.request().input('startRow', sql.Int, (q.page - 1) * q.pageSize + 1).input('endRow', sql.Int, q.page * q.pageSize)
      bindListParams(listReq, params)
      const listResult = await listReq.query(buildDispatchOrderListPagedSql({ whereSql }).sql)
      res.json({ code: 200, msg: 'success', data: { total, list: (listResult.recordset ?? []).map(serializeRow) } })
    } catch (err) {
      const detail = String(err?.message ?? err?.originalError?.message ?? 'database query failed')
      res.status(500).json({ code: 500, msg: `读取派工单列表失败：${detail}`, data: null })
    }
  })

  app.get('/api/dispatch-order/workshop-options', async (req, res) => {
    try {
      const pool = await getPool()
      const keyword = String(req.query?.keyword ?? '').trim()
      const dbReq = pool.request()
      let kwSql = ''
      if (keyword) {
        dbReq.input('kw', sql.NVarChar(400), `%${keyword}%`)
        kwSql = `AND (LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([code], N'')))) LIKE @kw OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([name], N'')))) LIKE @kw)`
      }
      const r = await dbReq.query(`
        SELECT TOP 100 LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([code], N'')))) AS code,
               LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([name], N'')))) AS name
        FROM dbo.[UB_ERP_Stocks_workshop]
        WHERE (ISNULL([del], N'') = N'' OR [del] = N'0') ${kwSql}
        ORDER BY [code] ASC
      `)
      res.json({ code: 200, msg: 'success', data: { list: r.recordset ?? [] } })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取车间失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  app.get('/api/dispatch-order/suggest-doc-no', async (req, res) => {
    try {
      const pool = await getPool()
      const rawDate = String(req.query?.dispatchDate ?? '').trim()
      const suggested = await suggestDispatchOrderNo(pool, rawDate ? new Date(rawDate) : new Date())
      res.json({ code: 200, msg: 'success', data: { suggested } })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `获取派工单号失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  app.get('/api/dispatch-order/check-doc-no', async (req, res) => {
    try {
      const pool = await getPool()
      const result = await checkDispatchOrderNoAvailable(pool, req.query?.dispatchOrderNo, normalizeId(req.query?.excludeId))
      res.json({ code: 200, msg: 'success', data: result })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `检查派工单号失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  app.get('/api/dispatch-order/goods-options', async (req, res) => {
    try {
      const pool = await getPool()
      const pi = String(req.query?.pi ?? '').trim()
      const dispatchType = String(req.query?.dispatchType ?? '0').trim()
      const workshopCode = String(req.query?.workshopCode ?? '').trim()
      const workshopName = String(req.query?.workshopName ?? '').trim()
      const excludeOrderNo = String(req.query?.excludeOrderNo ?? '').trim()
      const keyword = String(req.query?.keyword ?? '').trim()
      const page = Math.max(1, Number(req.query?.page ?? 1) || 1)
      const pageSize = Math.min(100, Math.max(1, Number(req.query?.pageSize ?? (dispatchType === '2' ? 100 : 10)) || 10))
      if (!pi) {
        res.status(400).json({ code: 400, msg: '请选择关联 PI', data: null })
        return
      }
      const dbReq = pool.request().input('pi', sql.NVarChar(200), pi)
      let kwSql = ''
      if (keyword) {
        dbReq.input('kw', sql.NVarChar(400), `%${keyword}%`)
        kwSql = `AND (LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(s.[kcaa01], N'')))) LIKE @kw OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(s.[kcaa02], N'')))) LIKE @kw)`
      }
      const r = await dbReq.query(`
        SELECT
          s.[id],
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(s.[xsak01], N'')))) AS pi,
          ISNULL(s.[xsak03], ISNULL(s.[plan_quantity], 0)) AS salesQty,
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(s.[systemcode], N'')))) AS systemcode,
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(s.[GUID], N'')))) AS GUID,
          LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(s.[version], N'')))) AS version,
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(s.[kcaa01], N'')))) AS kcaa01,
          LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(s.[kcaa02], N'')))) AS kcaa02,
          LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(s.[kcaa02_en], N'')))) AS kcaa02_en,
          LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(s.[kcaa03], N'')))) AS kcaa03,
          LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(s.[kcaa04], N'')))) AS kcaa04,
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(s.[kcaa05], N'')))) AS kcaa05,
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(s.[kcaa06], N'')))) AS kcaa06,
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(s.[kcaa09], N'')))) AS kcaa09,
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(s.[kcaa10], N'')))) AS kcaa10,
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(s.[kcaa11], N'')))) AS kcaa11,
          LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(s.[kcaa12], N'')))) AS kcaa12,
          LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(s.[kcaa13], N'')))) AS kcaa13,
          LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(s.[kcaa14], N'')))) AS kcaa14,
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(s.[kcaa15], N'')))) AS kcaa15
        FROM dbo.[UB_ERP_Sales_order_list] AS s
        INNER JOIN dbo.[UB_ERP_Sales_order] AS h
          ON LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[xsaj01], N'')))) = LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(s.[xsak01], N''))))
        WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(s.[xsak01], N'')))) = @pi
          AND (ISNULL(h.[del], N'') = N'' OR h.[del] = N'0')
          AND LTRIM(RTRIM(ISNULL(h.[closed], N'0'))) = N'0'
          AND LTRIM(RTRIM(ISNULL(h.[pass], N''))) = N'1'
          ${kwSql}
        ORDER BY s.[id] ASC
      `)
      const all = []
      for (const row of r.recordset ?? []) {
        const availability = await fetchDispatchAvailability(pool, {
          dispatchType,
          workshopCode,
          workshopName,
          pi: row.pi,
          kcaa01: row.kcaa01,
          excludeOrderNo,
        })
        all.push({
          ...serializeRow(row),
          dispatchedQty: availability.dispatchedQty,
          availableQty: availability.availableQty,
          storageQty: 0,
          repairQty: 0,
          selectable: availability.availableQty > 0,
        })
      }
      const start = (page - 1) * pageSize
      res.json({ code: 200, msg: 'success', data: { total: all.length, list: all.slice(start, start + pageSize) } })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取可派工货品失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  app.get('/api/dispatch-order/:id', async (req, res) => {
    try {
      const id = normalizeId(req.params?.id)
      if (!id) {
        res.status(400).json({ code: 400, msg: '派工单参数无效', data: null })
        return
      }
      const pool = await getPool()
      const headerR = await pool.request().input('id', sql.Int, id).query(`
        SELECT TOP 1 * FROM ${HEADER_FROM} WHERE [id] = @id
      `)
      const header = headerR.recordset?.[0]
      if (!header) {
        res.status(404).json({ code: 404, msg: '派工单不存在', data: null })
        return
      }
      const orderNo = String(header.scaj01 ?? '').trim()
      const lineR = await pool.request().input('orderNo', sql.NVarChar(200), orderNo).query(`
        SELECT
          l.*,
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.[name], N'')))) AS colorName,
          CAST(0 AS decimal(18, 4)) AS stockProcessDispatchedQty
        FROM ${LINE_FROM} AS l
        LEFT JOIN ${COLOR_FROM} AS c
          ON LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(c.[code], N'')))) = LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(l.[kcaa11], N''))))
         AND (ISNULL(c.[del], N'') = N'' OR c.[del] = N'0')
        WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[scak01], N'')))) = @orderNo
        ORDER BY ISNULL(l.[seq], l.[id]), l.[id]
      `)
      res.json({ code: 200, msg: 'success', data: { header: serializeRow(header), lines: (lineR.recordset ?? []).map(serializeRow) } })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取派工单详情失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  app.post('/api/dispatch-order', async (req, res) => {
    try {
      const pool = await getPool()
      const actor = await getActor(pool, req)
      sendSave(res, await createDispatchOrder({ pool, body: req.body, req, actor }), '保存成功')
    } catch (err) {
      res.status(500).json({ code: 500, msg: `保存派工单失败：${String(err?.message ?? err?.originalError?.message ?? err)}`, data: null })
    }
  })

  app.put('/api/dispatch-order/:id', async (req, res) => {
    try {
      const id = normalizeId(req.params?.id)
      if (!id) {
        res.status(400).json({ code: 400, msg: '派工单参数无效', data: null })
        return
      }
      const pool = await getPool()
      const actor = await getActor(pool, req)
      sendSave(res, await updateDispatchOrder({ pool, id, body: req.body, req, actor }), '保存成功')
    } catch (err) {
      res.status(500).json({ code: 500, msg: `保存派工单失败：${String(err?.message ?? err?.originalError?.message ?? err)}`, data: null })
    }
  })

  async function lifecycle(req, res, action) {
    try {
      const id = normalizeId(req.params?.id)
      if (!id) {
        res.status(400).json({ code: 400, msg: '派工单参数无效', data: null })
        return
      }
      const pool = await getPool()
      const actor = await getActor(pool, req)
      const result = await applyDispatchOrderLifecycleAction({ pool, id, action, actor })
      if (!result.ok) {
        res.status(result.status ?? 400).json({ code: result.status ?? 400, msg: result.msg, data: null })
        return
      }
      res.json({ code: 200, msg: result.msg, data: result })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `派工单操作失败：${String(err?.message ?? err)}`, data: null })
    }
  }

  app.post('/api/dispatch-order/:id/audit', (req, res) => lifecycle(req, res, 'audit'))
  app.post('/api/dispatch-order/:id/unaudit', (req, res) => lifecycle(req, res, 'unaudit'))
  app.post('/api/dispatch-order/:id/restore', (req, res) => lifecycle(req, res, 'restore'))
  app.delete('/api/dispatch-order/:id', (req, res) => lifecycle(req, res, 'delete'))
  app.delete('/api/dispatch-order/:id/hard', (req, res) => lifecycle(req, res, 'hard-delete'))
}
