import { sql } from './db.js'
import {
  ASSIST_ORDER_HEADER_TABLE,
  buildAssistOrderListPagedSql,
  buildAssistOrderListWhereSql,
  parseAssistOrderListQuery,
} from './assistOrderListQuery.js'
import {
  checkAssistOrderNoAvailable,
  createAssistOrder,
  suggestAssistOrderNo,
  updateAssistOrder,
} from './assistOrderSaveService.js'
import { applyAssistOrderLifecycleAction } from './assistOrderLifecycle.js'
import { fetchAssistOrderPrintDocuments } from './assistOrderPrintData.js'
import { fetchAssistOrderBatchAddTree } from './assistOrderBatchAdd.js'
import { resolveActorAuditTripletFromReq } from './businessAuditFields.js'

const HEADER_FROM = `dbo.[${ASSIST_ORDER_HEADER_TABLE}]`
const LINE_FROM = 'dbo.[UB_ERP_assist_order_list]'
const MONEY_FROM = 'dbo.[UB_ERP_assist_order_money]'

function materialSelectable(value) {
  const s = String(value ?? '').trim().toLowerCase()
  return s === '1' || s === 'true' || s === 'yes'
}

function serializeMaterialRow(row) {
  const o = serializeAssistOrderRow(row)
  o.isSelectable = materialSelectable(row?.isOutsource)
  return o
}

function bindListParams(req, params) {
  if (params?.pass) req.input('pass', sql.NVarChar(10), params.pass)
  if (params?.closed) req.input('closed', sql.NVarChar(10), params.closed)
  if (params?.assistType) req.input('assistType', sql.NVarChar(20), params.assistType)
  if (params?.supplier) req.input('supplier', sql.NVarChar(400), params.supplier)
  if (params?.keyword) req.input('keyword', sql.NVarChar(400), params.keyword)
}

function serializeAssistOrderRow(row) {
  const o = {}
  for (const [k, v] of Object.entries(row ?? {})) {
    if (k === 'rn') continue
    if (v instanceof Date) o[k] = v.toISOString()
    else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(v)) o[k] = `[binary:${v.length}]`
    else o[k] = v
  }
  if (o.id != null) o.id = Number(o.id)
  return o
}

export function registerAssistOrderRoutes(app, deps) {
  const { getPool } = deps
  const saveService = deps.saveService ?? {
    createAssistOrder,
    updateAssistOrder,
    suggestAssistOrderNo,
    checkAssistOrderNoAvailable,
  }
  const lifecycleService = deps.lifecycleService ?? { applyAssistOrderLifecycleAction }
  const printService = deps.printService ?? { fetchAssistOrderPrintDocuments }

  function saveJson(res, result, successMsg) {
    if (!result?.ok) {
      res.status(result?.status ?? 400).json({ code: result?.status ?? 400, msg: result?.msg || '保存失败', data: null })
      return
    }
    res.json({
      code: 200,
      msg: successMsg,
      data: {
        id: result.id,
        assistOrderNo: result.assistOrderNo,
        changedOrderNo: Boolean(result.changedOrderNo),
      },
    })
  }

  async function handleLifecycle(req, res, action) {
    try {
      const id = Number(req.params?.id)
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ code: 400, msg: '外协订单参数无效', data: null })
        return
      }
      const pool = await getPool()
      const auditActor = await resolveActorAuditTripletFromReq(pool, req)
      const result = await lifecycleService.applyAssistOrderLifecycleAction({
        pool,
        id,
        action,
        actor: { ...(req.user ?? req.session?.user ?? {}), ...auditActor },
      })
      if (!result?.ok) {
        res.status(result?.status ?? 400).json({ code: result?.status ?? 400, msg: result?.msg || '操作失败', data: null })
        return
      }
      res.json({ code: 200, msg: result.msg || '操作成功', data: result })
    } catch (err) {
      console.error(`assist-order lifecycle ${action} failed:`, err)
      const detail = String(err?.message ?? err?.originalError?.message ?? 'database action failed')
      res.status(500).json({ code: 500, msg: `外协订单操作失败：${detail}`, data: null })
    }
  }

  app.get('/api/assist-order/list', async (req, res) => {
    try {
      const pool = await getPool()
      const q = parseAssistOrderListQuery(req.query ?? {})
      const { whereSql, params } = buildAssistOrderListWhereSql(q)

      const countReq = pool.request()
      bindListParams(countReq, params)

      const totalRow = await countReq.query(`
        SELECT COUNT(1) AS total
        FROM ${HEADER_FROM} AS h
        WHERE 1 = 1
        ${whereSql}
      `)
      const total = Number(totalRow.recordset?.[0]?.total ?? 0)

      const safeOffset = (q.page - 1) * q.pageSize
      const startRow = safeOffset + 1
      const endRow = safeOffset + q.pageSize

      const listReq = pool.request()
      listReq.input('startRow', sql.Int, startRow)
      listReq.input('endRow', sql.Int, endRow)
      bindListParams(listReq, params)

      const { sql: listSql } = buildAssistOrderListPagedSql({ whereSql, sortBy: q.sortBy })
      const listResult = await listReq.query(listSql)
      const list = (listResult.recordset ?? []).map((row) => serializeAssistOrderRow(row))

      res.json({ code: 200, msg: 'success', data: { total, list } })
    } catch (err) {
      console.error('GET /api/assist-order/list failed:', err)
      const detail = String(err?.message ?? err?.originalError?.message ?? 'database query failed')
      res.status(500).json({ code: 500, msg: `读取外协订单列表失败：${detail}`, data: null })
    }
  })

  app.get('/api/assist-order/suggest-doc-no', async (req, res) => {
    try {
      const pool = await getPool()
      const rawDate = String(req.query?.saveDate ?? '').trim()
      const saveDate = rawDate ? new Date(rawDate) : new Date()
      if (Number.isNaN(saveDate.getTime())) {
        res.status(400).json({ code: 400, msg: '保存日期无效', data: null })
        return
      }
      const suggested = await saveService.suggestAssistOrderNo(pool, saveDate)
      res.json({ code: 200, msg: 'success', data: { suggested } })
    } catch (err) {
      console.error('GET /api/assist-order/suggest-doc-no failed:', err)
      const detail = String(err?.message ?? err?.originalError?.message ?? 'database query failed')
      res.status(500).json({ code: 500, msg: `获取外协订单建议单号失败：${detail}`, data: null })
    }
  })

  app.get('/api/assist-order/check-doc-no', async (req, res) => {
    try {
      const pool = await getPool()
      const assistOrderNo = String(req.query?.assistOrderNo ?? '').trim()
      if (!assistOrderNo) {
        res.status(400).json({ code: 400, msg: '参数错误：assistOrderNo', data: null })
        return
      }
      const excludeRaw = String(req.query?.excludeId ?? '').trim()
      const excludeId = excludeRaw ? Number(excludeRaw) : null
      const result = await saveService.checkAssistOrderNoAvailable(
        pool,
        assistOrderNo,
        Number.isInteger(excludeId) && excludeId > 0 ? excludeId : null,
      )
      res.json({
        code: 200,
        msg: 'success',
        data: { available: result.available, message: result.message || '' },
      })
    } catch (err) {
      console.error('GET /api/assist-order/check-doc-no failed:', err)
      const detail = String(err?.message ?? err?.originalError?.message ?? 'database query failed')
      res.status(500).json({ code: 500, msg: `检测外协单号失败：${detail}`, data: null })
    }
  })

  app.get('/api/assist-order/supplier-options', async (req, res) => {
    try {
      const pool = await getPool()
      const keyword = String(req.query?.keyword ?? '').trim()
      const reqDb = pool.request()
      let keywordSql = ''
      if (keyword) {
        reqDb.input('kw', sql.NVarChar(400), `%${keyword}%`)
        keywordSql = `
          AND (
            LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(s.[s_code], N'')))) LIKE @kw
            OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(s.[s_name], N'')))) LIKE @kw
            OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(s.[name], N'')))) LIKE @kw
          )
        `
      }
      const r = await reqDb.query(`
        SELECT TOP 50
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(s.[s_code], N'')))) AS code,
          LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(NULLIF(s.[s_name], N''), s.[name])))) AS name
        FROM dbo.[System_supplier] AS s
        WHERE LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(s.[s_lb], N'')))) IN (N'外协', N'共用')
          AND LTRIM(RTRIM(ISNULL(s.[pass], N''))) = N'1'
          AND (ISNULL(s.[del], N'') = N'' OR s.[del] = N'0')
          ${keywordSql}
        ORDER BY s.[s_code] ASC
      `)
      res.json({ code: 200, msg: 'success', data: { list: r.recordset ?? [] } })
    } catch (err) {
      console.error('GET /api/assist-order/supplier-options failed:', err)
      res.status(500).json({ code: 500, msg: '读取外协商失败', data: null })
    }
  })

  app.get('/api/assist-order/currency-options', async (_req, res) => {
    try {
      const pool = await getPool()
      const r = await pool.request().query(`
        SELECT TOP 100
          LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(c.[code], N'')))) AS code,
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.[name], N'')))) AS name
        FROM dbo.[UB_ERP_Finance_currency] AS c
        WHERE LTRIM(RTRIM(ISNULL(c.[pass], N''))) = N'1'
          AND (ISNULL(c.[del], N'') = N'' OR c.[del] = N'0')
        ORDER BY c.[code] ASC
      `)
      res.json({ code: 200, msg: 'success', data: { list: r.recordset ?? [] } })
    } catch (err) {
      console.error('GET /api/assist-order/currency-options failed:', err)
      res.status(500).json({ code: 500, msg: '读取币别失败', data: null })
    }
  })

  app.get('/api/assist-order/batch-add-tree', async (req, res) => {
    try {
      const pool = await getPool()
      const piNo = String(req.query?.piNo ?? req.query?.referenceNo ?? '').trim()
      const assistType = String(req.query?.assistType ?? '1').trim()
      const supplierCode = String(req.query?.supplierCode ?? '').trim()
      const excludeOrderNo = String(req.query?.excludeOrderNo ?? '').trim()
      const currentLines = req.query?.currentLines
      const lx = String(req.query?.lx ?? '1').trim()
      const keyword = String(req.query?.keyword ?? '').trim()
      const bomCodeId = String(req.query?.bomCodeId ?? req.query?.bom_code_id ?? '').trim()
      const page = String(req.query?.page ?? '').trim()
      const pageSize = String(req.query?.pageSize ?? '').trim()
      const result = await fetchAssistOrderBatchAddTree(pool, {
        piNo,
        assistType,
        supplierCode,
        excludeOrderNo,
        currentLines,
        lx,
        keyword,
        bomCodeId,
        page,
        pageSize,
      })
      if (!result?.ok) {
        res.status(result?.status ?? 400).json({ code: result?.status ?? 400, msg: result?.msg || '读取批量选材失败', data: null })
        return
      }
      res.json({
        code: 200,
        msg: 'success',
        data: {
          piNo: result.piNo,
          assistType: result.assistType || assistType,
          orderId: result.orderId,
          calcStatus: result.calcStatus,
          lx: result.lx || lx,
          page: result.page,
          pageSize: result.pageSize,
          total: result.total,
          styles: result.styles,
        },
      })
    } catch (err) {
      console.error('GET /api/assist-order/batch-add-tree failed:', err)
      const detail = String(err?.message ?? err?.originalError?.message ?? 'database query failed')
      res.status(500).json({ code: 500, msg: `读取外协订单批量选材失败：${detail}`, data: null })
    }
  })

  app.get('/api/assist-order/material-options', async (req, res) => {
    try {
      const pool = await getPool()
      const assistType = String(req.query?.assistType ?? '0').trim()
      const referenceNo = String(req.query?.referenceNo ?? '').trim()
      const keyword = String(req.query?.keyword ?? '').trim()
      const reqDb = pool.request()
      let keywordSql = ''
      if (keyword) {
        reqDb.input('kw', sql.NVarChar(400), `%${keyword}%`)
        keywordSql = `
          AND (
            LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(src.[kcaa01], N'')))) LIKE @kw
            OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(src.[kcaa02], N'')))) LIKE @kw
            OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(src.[kcaa03], N'')))) LIKE @kw
          )
        `
      }

      if (assistType === '1' || assistType === '2') {
        if (!referenceNo) {
          res.status(400).json({ code: 400, msg: '订单外协/订单外发选材必须先填写关联单号', data: null })
          return
        }
        reqDb.input('referenceNo', sql.NVarChar(200), referenceNo)
        const r = await reqDb.query(`
          SELECT TOP 200 *
          FROM (
            SELECT
              N'pi_bom' AS source,
              LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(src.[sid], N'')))) AS piNo,
              LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(src.[pkcaa01], N'')))) AS product,
              CAST(ISNULL(ol.[xsak03], ol.[plan_quantity]) AS decimal(18, 2)) AS orderQty,
              LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(src.[kcaa01], N'')))) AS kcaa01,
              LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(src.[kcaa02], N'')))) AS kcaa02,
              LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(src.[kcaa02_en], N'')))) AS kcaa02En,
              LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(src.[kpname], N'')))) AS invoiceName,
              LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(src.[kcaa03], N'')))) AS kcaa03,
              LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(src.[kcaa04], N'')))) AS kcaa04,
              LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(src.[kcaa05], N'')))) AS kcaa05,
              LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(src.[kcaa09], N'')))) AS origin,
              LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(src.[kcaa10], N'')))) AS kcaa10,
              LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(src.[kcaa11], N'')))) AS kcaa11,
              LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(src.[version], N'')))) AS version,
              LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(src.[Customer_supply], N'')))) AS customerSupply,
              CASE WHEN ISNULL(src.[kcaa13], 0) <> 0 THEN 1 ELSE 0 END AS isOutsource,
              src.[id] AS seq
            FROM dbo.[UB_ERP_Bom_Sales_list] AS src
            INNER JOIN dbo.[UB_ERP_Sales_order] AS so
              ON LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(so.[xsaj01], N'')))) = LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(src.[sid], N''))))
             AND LTRIM(RTRIM(ISNULL(so.[pass], N''))) = N'1'
             AND (ISNULL(so.[del], N'') = N'' OR so.[del] = N'0')
            LEFT JOIN dbo.[UB_ERP_Sales_order_list] AS ol
              ON LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(ol.[xsak01], N'')))) = LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(src.[sid], N''))))
             AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(ol.[kcaa01], N'')))) = LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(src.[pkcaa01], N''))))
            WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(src.[sid], N'')))) = @referenceNo
              AND (ISNULL(src.[del], N'') = N'' OR src.[del] = N'0')
              ${keywordSql}
          ) AS picked
          ORDER BY picked.[seq] ASC
        `)
        res.json({ code: 200, msg: 'success', data: { list: (r.recordset ?? []).map((row) => serializeMaterialRow(row)) } })
        return
      }

      const r = await reqDb.query(`
        SELECT TOP 200 *
        FROM (
          SELECT
            N'UB_ERP_Bom_000' AS source,
            N'' AS piNo,
            N'' AS product,
            CAST(NULL AS decimal(18, 2)) AS orderQty,
            LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(src.[kcaa01], N'')))) AS kcaa01,
            LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(src.[kcaa02], N'')))) AS kcaa02,
            LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(src.[kcaa02_en], N'')))) AS kcaa02En,
            LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(src.[kpname], N'')))) AS invoiceName,
            LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(src.[kcaa03], N'')))) AS kcaa03,
            LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(src.[kcaa04], N'')))) AS kcaa04,
            LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(src.[kcaa05], N'')))) AS kcaa05,
            LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(src.[kcaa09], N'')))) AS origin,
            LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(src.[kcaa10], N'')))) AS kcaa10,
            LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(src.[kcaa11], N'')))) AS kcaa11,
            LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(src.[version], N'')))) AS version,
            LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(src.[Customer_supply], N'')))) AS customerSupply,
            CASE WHEN ISNULL(src.[kcaa13], 0) <> 0 THEN 1 ELSE 0 END AS isOutsource,
            src.[id] AS seq
          FROM dbo.[UB_ERP_Bom_000] AS src
          WHERE LTRIM(RTRIM(ISNULL(src.[pass], N''))) = N'1'
            AND (ISNULL(src.[del], N'') = N'' OR src.[del] = N'0')
            ${keywordSql}
        ) AS picked
        ORDER BY picked.[seq] DESC
      `)
      res.json({ code: 200, msg: 'success', data: { list: (r.recordset ?? []).map((row) => serializeMaterialRow(row)) } })
    } catch (err) {
      console.error('GET /api/assist-order/material-options failed:', err)
      const detail = String(err?.message ?? err?.originalError?.message ?? 'database query failed')
      res.status(500).json({ code: 500, msg: `读取外协订单选材失败：${detail}`, data: null })
    }
  })

  app.get('/api/assist-order/fee-options', async (req, res) => {
    try {
      const pool = await getPool()
      const keyword = String(req.query?.keyword ?? '').trim()
      const reqDb = pool.request()
      let keywordSql = ''
      if (keyword) {
        reqDb.input('kw', sql.NVarChar(400), `%${keyword}%`)
        keywordSql = `
          AND (
            LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(src.[kcaa01], N'')))) LIKE @kw
            OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(src.[kcaa02], N'')))) LIKE @kw
          )
        `
      }
      const r = await reqDb.query(`
        SELECT TOP 100
          LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(src.[kcaa01], N'')))) AS feeCode,
          LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(src.[kcaa02], N'')))) AS feeName,
          LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(src.[kcaa05], N'')))) AS kcaa05
        FROM dbo.[UB_ERP_Bom_000] AS src
        WHERE LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(src.[kcaa05], N'')))) = N'FEE'
          AND LTRIM(RTRIM(ISNULL(src.[pass], N''))) = N'1'
          AND (ISNULL(src.[del], N'') = N'' OR src.[del] = N'0')
          ${keywordSql}
        ORDER BY src.[kcaa01] ASC
      `)
      res.json({ code: 200, msg: 'success', data: { list: r.recordset ?? [] } })
    } catch (err) {
      console.error('GET /api/assist-order/fee-options failed:', err)
      const detail = String(err?.message ?? err?.originalError?.message ?? 'database query failed')
      res.status(500).json({ code: 500, msg: `读取额外费用选项失败：${detail}`, data: null })
    }
  })

  app.post('/api/assist-order', async (req, res) => {
    try {
      const pool = await getPool()
      const actor = await resolveActorAuditTripletFromReq(pool, req)
      const result = await saveService.createAssistOrder({ pool, body: req.body ?? {}, req, actor })
      saveJson(res, result, result?.changedOrderNo ? '保存成功，单号已自动顺延' : '保存成功')
    } catch (err) {
      console.error('POST /api/assist-order failed:', err)
      const detail = String(err?.message ?? err?.originalError?.message ?? 'database save failed')
      res.status(500).json({ code: 500, msg: `保存外协订单失败：${detail}`, data: null })
    }
  })

  app.put('/api/assist-order/:id', async (req, res) => {
    try {
      const id = Number(req.params?.id)
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ code: 400, msg: '外协订单参数无效', data: null })
        return
      }
      const pool = await getPool()
      const actor = await resolveActorAuditTripletFromReq(pool, req)
      const result = await saveService.updateAssistOrder({ pool, id, body: req.body ?? {}, req, actor })
      saveJson(res, result, result?.changedOrderNo ? '保存成功，单号已自动顺延' : '保存成功')
    } catch (err) {
      console.error('PUT /api/assist-order/:id failed:', err)
      const detail = String(err?.message ?? err?.originalError?.message ?? 'database save failed')
      res.status(500).json({ code: 500, msg: `保存外协订单失败：${detail}`, data: null })
    }
  })

  app.post('/api/assist-order/:id/audit', (req, res) => handleLifecycle(req, res, 'audit'))
  app.post('/api/assist-order/:id/unaudit', (req, res) => handleLifecycle(req, res, 'unaudit'))
  app.post('/api/assist-order/:id/close', (req, res) => handleLifecycle(req, res, 'close'))
  app.post('/api/assist-order/:id/unclose', (req, res) => handleLifecycle(req, res, 'unclose'))
  app.post('/api/assist-order/:id/restore', (req, res) => handleLifecycle(req, res, 'restore'))
  if (typeof app.delete === 'function') {
    app.delete('/api/assist-order/:id', (req, res) => handleLifecycle(req, res, 'delete'))
    app.delete('/api/assist-order/:id/hard', (req, res) => handleLifecycle(req, res, 'hard-delete'))
  }

  app.get('/api/assist-order/print-data', async (req, res) => {
    try {
      const ids = String(req.query?.ids ?? '')
        .split(',')
        .map((id) => Number(id.trim()))
        .filter((id) => Number.isInteger(id) && id > 0)
      if (!ids.length) {
        res.status(400).json({ code: 400, msg: '澶栧崗璁㈠崟鎵撳嵃鍙傛暟鏃犳晥', data: null })
        return
      }
      const pool = await getPool()
      const setup = {
        rowsPerPage: req.query?.rowsPerPage,
        priceDecimals: req.query?.priceDecimals,
      }
      const list = await printService.fetchAssistOrderPrintDocuments(
        pool,
        ids,
        req.user ?? req.session?.user ?? {},
        setup,
      )
      res.json({ code: 200, msg: 'success', data: { list } })
    } catch (err) {
      console.error('GET /api/assist-order/print-data failed:', err)
      const detail = String(err?.message ?? err?.originalError?.message ?? 'database query failed')
      res.status(500).json({ code: 500, msg: `璇诲彇澶栧崗璁㈠崟鎵撳嵃鏁版嵁澶辫触锛?{detail}`, data: null })
    }
  })

  app.get('/api/assist-order/:id', async (req, res) => {
    try {
      const id = Number(req.params?.id)
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ code: 400, msg: '外协订单参数无效', data: null })
        return
      }

      const pool = await getPool()
      const headerResult = await pool
        .request()
        .input('id', sql.Int, id)
        .query(`
          SELECT TOP 1
            h.[id],
            LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[wxaj01], N'')))) AS assistOrderNo,
            h.[wxaj02] AS assistDate,
            LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(h.[wxaj03], N'')))) AS assistType,
            LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[wxaj04], N'')))) AS referenceNo,
            LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[wxaj05], N'')))) AS supplierCode,
            LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[kehu], N'')))) AS supplierName,
            LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL(h.[wxaj06], N'')))) AS taxIncluded,
            LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(h.[wxaj07], N'')))) AS currencyCode,
            LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[rmb], N'')))) AS currencyName,
            h.[wxaj08] AS deliveryDate,
            LTRIM(RTRIM(CONVERT(nvarchar(1000), ISNULL(h.[remark], N'')))) AS remark,
            LTRIM(RTRIM(CONVERT(nvarchar(1000), ISNULL(h.[notes], N'')))) AS notes,
            h.[decimal] AS decimalPlaces,
            LTRIM(RTRIM(ISNULL(h.[pass], N''))) AS pass,
            LTRIM(RTRIM(ISNULL(h.[closed], N''))) AS closed,
            LTRIM(RTRIM(ISNULL(h.[del], N''))) AS del,
            LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[systemcode], N'')))) AS systemCode
          FROM ${HEADER_FROM} AS h
          WHERE h.[id] = @id
        `)
      const header = serializeAssistOrderRow(headerResult.recordset?.[0])
      if (!header?.id) {
        res.status(404).json({ code: 404, msg: '外协订单不存在', data: null })
        return
      }

      const orderNo = String(header.assistOrderNo ?? '').trim()
      const linesResult = await pool
        .request()
        .input('orderNo', sql.NVarChar(200), orderNo)
        .query(`
          SELECT
            ROW_NUMBER() OVER (ORDER BY l.[id] ASC) AS seq,
            LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[pi], N'')))) AS piNo,
            LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[Product], N'')))) AS product,
            LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) AS kcaa01,
            LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa02], N'')))) AS kcaa02,
            LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa02_en], N'')))) AS kcaa02En,
            LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kpname], N'')))) AS invoiceName,
            LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa03], N'')))) AS kcaa03,
            LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(l.[kcaa04], N'')))) AS kcaa04,
            LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(l.[kcaa05], N'')))) AS kcaa05,
            LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(l.[kcaa09], N'')))) AS origin,
            LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(l.[kcaa10], N'')))) AS kcaa10,
            LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(l.[kcaa11], N'')))) AS kcaa11,
            l.[version],
            l.[Customer_supply] AS customerSupply,
            l.[wxak03],
            l.[wxak04],
            l.[wxak041],
            l.[wxak05],
            l.[wxak051],
            l.[tax],
            l.[delivery_date] AS deliveryDate,
            LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[reference], N'')))) AS referenceNo,
            LTRIM(RTRIM(CONVERT(nvarchar(1000), ISNULL(l.[wxak06], N'')))) AS remark
          FROM ${LINE_FROM} AS l
          WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[wxak01], N'')))) = @orderNo
            AND (ISNULL(l.[del], N'') = N'' OR l.[del] = N'0')
          ORDER BY l.[id] ASC
        `)

      const feesResult = await pool
        .request()
        .input('orderNo', sql.NVarChar(200), orderNo)
        .query(`
          SELECT
            ROW_NUMBER() OVER (ORDER BY m.[id] ASC) AS seq,
            LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(m.[kcaa01], N'')))) AS feeCode,
            LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(NULLIF(m.[kcaa02], N''), m.[mtitle])))) AS feeName,
            m.[money],
            m.[tax],
            LTRIM(RTRIM(CONVERT(nvarchar(1000), ISNULL(m.[remark], N'')))) AS remark
          FROM ${MONEY_FROM} AS m
          WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(m.[assist_code], N'')))) = @orderNo
            AND ISNULL(m.[del], 0) = 0
          ORDER BY seq ASC
        `)

      res.json({
        code: 200,
        msg: 'success',
        data: {
          header,
          lines: (linesResult.recordset ?? []).map((row) => serializeAssistOrderRow(row)),
          fees: (feesResult.recordset ?? []).map((row) => serializeAssistOrderRow(row)),
        },
      })
    } catch (err) {
      console.error('GET /api/assist-order/:id failed:', err)
      const detail = String(err?.message ?? err?.originalError?.message ?? 'database query failed')
      res.status(500).json({ code: 500, msg: `读取外协订单详情失败：${detail}`, data: null })
    }
  })
}
