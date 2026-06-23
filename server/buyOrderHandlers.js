import { sql } from './db.js'
import { resolveActorAuditTripletFromReq } from './businessAuditFields.js'
import { applyBuyOrderLifecycleAction } from './buyOrderLifecycle.js'
import { enrichBuyOrderBatchAddPrices, fetchBuyOrderBatchAddLines } from './buyOrderBatchAdd.js'
import { fetchBuyOrderExpandDetail } from './buyOrderExpandDetail.js'
import { fetchBuyOrderMaterialTrace, fetchBuyOrderTraceBomCodes } from './buyOrderMaterialTrace.js'
import { buildBuyOrderListPagedSql, buildBuyOrderListWhereSql, parseBuyOrderListQuery } from './buyOrderListQuery.js'
import { checkBuyOrderNoAvailable, createBuyOrder, suggestBuyOrderNo, updateBuyOrder } from './buyOrderSaveService.js'

const HEADER_FROM = 'dbo.[UB_ERP_Buy_order]'
const LINE_FROM = 'dbo.[UB_ERP_Buy_order_list]'
const FEE_FROM = 'dbo.[UB_ERP_Buy_order_money]'
const SUPPLIER_FROM = 'dbo.[UB_ERP_System_supplier]'
const CURRENCY_FROM = 'dbo.[UB_ERP_Finance_currency]'
const BOM_FROM = 'dbo.[UB_ERP_Bom_000]'
const SALES_FROM = 'dbo.[UB_ERP_Sales_order]'

function text(v) {
  return String(v ?? '').trim()
}

function serialize(row) {
  const out = {}
  for (const [k, v] of Object.entries(row ?? {})) out[k] = v instanceof Date ? v.toISOString() : v
  if (out.id != null) out.id = Number(out.id)
  return out
}

function bindParams(req, params = {}) {
  for (const [key, value] of Object.entries(params)) {
    if (key === 'dateStart' || key === 'dateEnd') req.input(key, sql.DateTime, new Date(value))
    else req.input(key, sql.NVarChar(500), value)
  }
}

async function actor(pool, req) {
  const audit = await resolveActorAuditTripletFromReq(pool, req)
  return { ...(req.user ?? req.session?.user ?? {}), ...audit }
}

function sendSave(res, result, defaultMsg = '保存成功') {
  if (!result?.ok) {
    res.status(result?.status ?? 400).json({ code: result?.status ?? 400, msg: result?.msg || '保存失败', data: null })
    return
  }
  res.json({ code: 200, msg: result.changedOrderNo ? '保存成功，采购单号已自动顺延' : defaultMsg, data: result })
}

function normalizeIds(raw) {
  return String(raw ?? '').split(',').map((id) => Number(id.trim())).filter((id) => Number.isInteger(id) && id > 0)
}

function parsePiOptionQuery(query = {}) {
  const pageRaw = Number(query.page ?? 1) || 1
  const pageSizeRaw = Number(query.pageSize ?? 10) || 10
  const page = Math.max(1, Math.floor(pageRaw))
  const pageSize = Math.min(100, Math.max(1, Math.floor(pageSizeRaw)))
  return { page, pageSize, startRow: (page - 1) * pageSize + 1, endRow: page * pageSize }
}

function hasPricePermission(req) {
  const actions = req?.user?.actions ?? req?.user?.Permissions ?? req?.session?.user?.actions
  if (Array.isArray(actions)) return actions.includes('price') || actions.includes('*')
  return true
}

export function registerBuyOrderRoutes(app, deps) {
  const { getPool } = deps

  app.get('/api/buy-order/list', async (req, res) => {
    try {
      const pool = await getPool()
      const q = parseBuyOrderListQuery(req.query ?? {})
      const { whereSql, params } = buildBuyOrderListWhereSql(q)
      const countReq = pool.request()
      bindParams(countReq, params)
      const totalRow = await countReq.query(`SELECT COUNT(1) AS total FROM ${HEADER_FROM} AS h WHERE 1=1 ${whereSql}`)
      const total = Number(totalRow.recordset?.[0]?.total ?? 0)
      const listReq = pool.request().input('startRow', sql.Int, (q.page - 1) * q.pageSize + 1).input('endRow', sql.Int, q.page * q.pageSize)
      bindParams(listReq, params)
      const listResult = await listReq.query(buildBuyOrderListPagedSql({ whereSql }).sql)
      res.json({ code: 200, msg: 'success', data: { total, list: (listResult.recordset ?? []).map(serialize) } })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取采购单列表失败：${String(err?.message ?? err?.originalError?.message ?? err)}`, data: null })
    }
  })

  app.get('/api/buy-order/suggest-doc-no', async (req, res) => {
    try {
      const pool = await getPool()
      const suggested = await suggestBuyOrderNo(pool, { numberType: req.query?.numberType, saveDate: req.query?.saveDate || new Date() })
      res.json({ code: 200, msg: 'success', data: { suggested } })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `获取采购单号失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  app.get('/api/buy-order/check-doc-no', async (req, res) => {
    try {
      const pool = await getPool()
      const excludeId = Number(req.query?.excludeId)
      const result = await checkBuyOrderNoAvailable(pool, req.query?.buyOrderNo, Number.isInteger(excludeId) ? excludeId : null)
      res.json({ code: 200, msg: 'success', data: result })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `检测采购单号失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  app.get('/api/buy-order/supplier-options', async (req, res) => {
    try {
      const keyword = text(req.query?.keyword)
      const dbReq = (await getPool()).request()
      if (keyword) dbReq.input('kw', sql.NVarChar(400), `%${keyword}%`)
      const r = await dbReq.query(`
        SELECT TOP 100
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([s_code], N'')))) AS code,
          LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(NULLIF([s_name], N''), [name])))) AS name
        FROM ${SUPPLIER_FROM}
        WHERE LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL([s_lb], N'')))) IN (N'采购', N'共用')
          AND LTRIM(RTRIM(ISNULL([pass], N''))) = N'1'
          AND (ISNULL([del], N'') = N'' OR [del] = N'0')
          ${keyword ? `AND (LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([s_code], N'')))) LIKE @kw OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(NULLIF([s_name], N''), [name])))) LIKE @kw)` : ''}
        ORDER BY [s_code] ASC
      `)
      res.json({ code: 200, msg: 'success', data: { list: r.recordset ?? [] } })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取供应商失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  app.get('/api/buy-order/currency-options', async (_req, res) => {
    try {
      const r = await (await getPool()).request().query(`
        SELECT TOP 100 LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL([code], N'')))) AS code,
               LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([name], N'')))) AS name,
               LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL([rate], N'1')))) AS rate
        FROM ${CURRENCY_FROM}
        WHERE LTRIM(RTRIM(ISNULL([pass], N''))) = N'1'
          AND (ISNULL([del], N'') = N'' OR [del] = N'0')
        ORDER BY [code] ASC
      `)
      res.json({ code: 200, msg: 'success', data: { list: r.recordset ?? [] } })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取币别失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  app.get('/api/buy-order/pi-options', async (req, res) => {
    try {
      const keyword = text(req.query?.keyword)
      const { page, pageSize, startRow, endRow } = parsePiOptionQuery(req.query ?? {})
      const pool = await getPool()
      const countReq = pool.request()
      const listReq = pool.request()
        .input('startRow', sql.Int, startRow)
        .input('endRow', sql.Int, endRow)
      let keywordSql = ''
      if (keyword) {
        countReq.input('kw', sql.NVarChar(400), `%${keyword}%`)
        listReq.input('kw', sql.NVarChar(400), `%${keyword}%`)
        keywordSql = `
          AND (
            LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([xsaj01], N'')))) LIKE @kw
            OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([xsaj06], N'')))) LIKE @kw
            OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([xsaj05], N'')))) LIKE @kw
          )
        `
      }
      const whereSql = `
        WHERE LTRIM(RTRIM(ISNULL([pass], N''))) = N'1'
          AND (ISNULL([del], N'') = N'' OR [del] = N'0')
          ${keywordSql}
      `
      const totalRow = await countReq.query(`SELECT COUNT(1) AS total FROM ${SALES_FROM} ${whereSql}`)
      const total = Number(totalRow.recordset?.[0]?.total ?? 0)
      const r = await listReq.query(`
        SELECT piNo, poNo, customer
        FROM (
          SELECT ROW_NUMBER() OVER (ORDER BY CASE WHEN [addtime] IS NULL THEN 1 ELSE 0 END ASC, [addtime] DESC, [id] DESC) AS rn,
                 LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([xsaj01], N'')))) AS piNo,
                 LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([xsaj06], N'')))) AS poNo,
                 LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([xsaj05], N'')))) AS customer
          FROM ${SALES_FROM}
          ${whereSql}
        ) AS src
        WHERE src.rn BETWEEN @startRow AND @endRow
        ORDER BY src.rn ASC
      `)
      res.json({ code: 200, msg: 'success', data: { page, pageSize, total, list: r.recordset ?? [] } })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取PI失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  app.get('/api/buy-order/batch-add-lines', async (req, res) => {
    try {
      const pool = await getPool()
      const result = await fetchBuyOrderBatchAddLines(pool, {
        buyType: req.query?.buyType,
        piNo: req.query?.piNo,
        supplierCode: req.query?.supplierCode,
        keyword: req.query?.keyword,
        bomCodeId: req.query?.bomCodeId,
        page: req.query?.page,
        pageSize: req.query?.pageSize,
        hasPricePermission: hasPricePermission(req),
      })
      if (!result.ok) return res.status(result.status ?? 400).json({ code: result.status ?? 400, msg: result.msg, data: null })
      res.json({
        code: 200,
        msg: 'success',
        data: {
          buyType: result.buyType,
          piNo: result.piNo,
          multiPi: result.multiPi === true,
          list: result.list,
          total: result.total,
          page: result.page,
          pageSize: result.pageSize,
        },
      })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取采购订单批量添加明细失败：${String(err?.message ?? err?.originalError?.message ?? err)}`, data: null })
    }
  })

  app.post('/api/buy-order/batch-add-prices', async (req, res) => {
    try {
      const pool = await getPool()
      const result = await enrichBuyOrderBatchAddPrices(pool, {
        supplierCode: req.body?.supplierCode,
        lines: req.body?.lines,
        hasPricePermission: hasPricePermission(req),
      })
      if (!result.ok) return res.status(result.status ?? 400).json({ code: result.status ?? 400, msg: result.msg, data: null })
      res.json({ code: 200, msg: 'success', data: { list: result.list } })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取采购订单批量添加报价失败：${String(err?.message ?? err?.originalError?.message ?? err)}`, data: null })
    }
  })

  app.get('/api/buy-order/material-options', async (req, res) => {
    try {
      const keyword = text(req.query?.keyword)
      const dbReq = (await getPool()).request()
      if (keyword) dbReq.input('kw', sql.NVarChar(400), `%${keyword}%`)
      const r = await dbReq.query(`
        SELECT TOP 200 *
        FROM ${BOM_FROM}
        WHERE (ISNULL([del], N'') = N'' OR [del] = N'0')
          ${keyword ? `AND (LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL([kcaa01], N'')))) LIKE @kw OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([kcaa02], N'')))) LIKE @kw OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([kcaa03], N'')))) LIKE @kw)` : ''}
        ORDER BY [id] DESC
      `)
      res.json({ code: 200, msg: 'success', data: { list: r.recordset ?? [] } })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取采购物料失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  app.get('/api/buy-order/fee-options', async (req, res) => {
    try {
      const keyword = text(req.query?.keyword)
      const dbReq = (await getPool()).request()
      if (keyword) dbReq.input('kw', sql.NVarChar(400), `%${keyword}%`)
      const r = await dbReq.query(`
        SELECT TOP 100
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([kcaa01], N'')))) AS feeCode,
          LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([kcaa02], N'')))) AS feeName,
          LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([kcaa03], N'')))) AS spec
        FROM ${BOM_FROM}
        WHERE LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL([kcaa05], N'')))) = N'FEE'
          AND LTRIM(RTRIM(ISNULL([pass], N''))) = N'1'
          AND (ISNULL([del], N'') = N'' OR [del] = N'0')
          ${keyword ? `AND (LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([kcaa01], N'')))) LIKE @kw OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([kcaa02], N'')))) LIKE @kw)` : ''}
        ORDER BY [kcaa01] ASC
      `)
      res.json({ code: 200, msg: 'success', data: { list: r.recordset ?? [] } })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取费用项目失败：${String(err?.message ?? err)}`, data: null })
    }
  })

  app.get('/api/buy-order/material-trace/bom-codes', async (_req, res) => {
    try {
      const list = await fetchBuyOrderTraceBomCodes(await getPool())
      res.json({ code: 200, msg: 'success', data: { list } })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取采购转向物料分类失败：${String(err?.message ?? err?.originalError?.message ?? err)}`, data: null })
    }
  })

  app.get('/api/buy-order/material-trace/list', async (req, res) => {
    try {
      const result = await fetchBuyOrderMaterialTrace(await getPool(), req.query ?? {})
      if (!result.ok) return res.status(result.status ?? 400).json({ code: result.status ?? 400, msg: result.msg, data: null })
      res.json({ code: 200, msg: 'success', data: result })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取采购转向物料失败：${String(err?.message ?? err?.originalError?.message ?? err)}`, data: null })
    }
  })

  app.post('/api/buy-order', async (req, res) => {
    try {
      const pool = await getPool()
      sendSave(res, await createBuyOrder({ pool, body: req.body ?? {}, req, actor: await actor(pool, req) }))
    } catch (err) {
      res.status(500).json({ code: 500, msg: `保存采购单失败：${String(err?.message ?? err?.originalError?.message ?? err)}`, data: null })
    }
  })

  app.put('/api/buy-order/:id', async (req, res) => {
    try {
      const id = Number(req.params?.id)
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ code: 400, msg: '采购单参数无效', data: null })
      const pool = await getPool()
      sendSave(res, await updateBuyOrder({ pool, id, body: req.body ?? {}, req, actor: await actor(pool, req) }))
    } catch (err) {
      res.status(500).json({ code: 500, msg: `保存采购单失败：${String(err?.message ?? err?.originalError?.message ?? err)}`, data: null })
    }
  })

  async function detail(req, res, forPrint = false) {
    try {
      const id = Number(req.params?.id ?? req.query?.id)
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ code: 400, msg: '采购单参数无效', data: null })
      const pool = await getPool()
      const headerR = await pool.request().input('id', sql.Int, id).query(`SELECT TOP 1 * FROM ${HEADER_FROM} WHERE [id]=@id`)
      const header = headerR.recordset?.[0]
      if (!header) return res.status(404).json({ code: 404, msg: '采购单不存在', data: null })
      const orderNo = text(header.kcaj01)
      const linesR = await pool.request().input('orderNo', sql.NVarChar(200), orderNo).query(`
        SELECT * FROM ${LINE_FROM}
        WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([kcak01], N'')))) = @orderNo
          AND (ISNULL([del], N'') = N'' OR [del] = N'0')
        ORDER BY ISNULL([seq], [id]), [id]
      `)
      const feesR = await pool.request().input('orderNo', sql.NVarChar(200), orderNo).query(`
        SELECT * FROM ${FEE_FROM}
        WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([buy_code], N'')))) = @orderNo
        ORDER BY ISNULL([kid], [id]), [id]
      `)
      res.json({ code: 200, msg: 'success', data: { header: serialize(header), lines: (linesR.recordset ?? []).map(serialize), fees: (feesR.recordset ?? []).map(serialize), forPrint } })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取采购单详情失败：${String(err?.message ?? err)}`, data: null })
    }
  }

  app.get('/api/buy-order/print-data', async (req, res) => {
    const ids = normalizeIds(req.query?.ids ?? req.query?.id)
    if (ids.length === 1) {
      req.params = { id: String(ids[0]) }
      return detail(req, res, true)
    }
    return res.status(400).json({ code: 400, msg: '采购单打印参数无效', data: null })
  })

  app.get('/api/buy-order/:id/expand-detail', async (req, res) => {
    try {
      const pool = await getPool()
      const result = await fetchBuyOrderExpandDetail(pool, req.params?.id)
      if (!result.ok) return res.status(result.status ?? 400).json({ code: result.status ?? 400, msg: result.msg, data: null })
      res.json({ code: 200, msg: 'success', data: result.data })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `读取采购单展开明细失败：${String(err?.message ?? err?.originalError?.message ?? err)}`, data: null })
    }
  })
  app.get('/api/buy-order/:id', detail)

  async function lifecycle(req, res, action) {
    try {
      const id = Number(req.params?.id)
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ code: 400, msg: '采购单参数无效', data: null })
      const pool = await getPool()
      const result = await applyBuyOrderLifecycleAction({ pool, id, action, actor: await actor(pool, req), reason: req.body?.reason })
      if (!result.ok) return res.status(result.status ?? 400).json({ code: result.status ?? 400, msg: result.msg, data: null })
      res.json({ code: 200, msg: result.msg, data: result })
    } catch (err) {
      res.status(500).json({ code: 500, msg: `采购单操作失败：${String(err?.message ?? err)}`, data: null })
    }
  }

  app.post('/api/buy-order/:id/audit', (req, res) => lifecycle(req, res, 'audit'))
  app.post('/api/buy-order/:id/unaudit', (req, res) => lifecycle(req, res, 'unaudit'))
  app.post('/api/buy-order/:id/close', (req, res) => lifecycle(req, res, 'close'))
  app.post('/api/buy-order/:id/unclose', (req, res) => lifecycle(req, res, 'unclose'))
  app.post('/api/buy-order/:id/restore', (req, res) => lifecycle(req, res, 'restore'))
  app.delete('/api/buy-order/:id', (req, res) => lifecycle(req, res, 'delete'))
  app.delete('/api/buy-order/:id/hard', (req, res) => lifecycle(req, res, 'hard-delete'))
}
