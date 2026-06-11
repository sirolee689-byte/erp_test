import { sql } from './db.js'
import {
  buildAssistOrderGuid,
  buildNextAssistOrderNo,
  formatAssistOrderDeliveryDate,
  normalizeAssistOrderHeader,
  resolveAssistOrderPiValue,
  validateAssistOrderHeader,
} from './assistOrderSaveLogic.js'
import { formatSalesOrderAuditTime } from './salesOrderPiBom.js'
import { getRequestIp } from './operationAuditMiddleware.js'
import { rewriteAssistOrderLines } from './assistOrderLineSave.js'
import { rewriteAssistOrderFees } from './assistOrderFeeSave.js'
import {
  buildAssistOrderLogInfo,
  writeAssistOrderOperationLog,
} from './assistOrderOperationLog.js'
import { ASSIST_ORDER_HEADER_TABLE } from './assistOrderListQuery.js'

const HEADER_FROM = `dbo.[${ASSIST_ORDER_HEADER_TABLE}]`
const SUPPLIER_FROM = 'dbo.[System_supplier]'
const CURRENCY_FROM = 'dbo.[UB_ERP_Finance_currency]'

function activeWhere(alias) {
  return `(ISNULL(${alias}.[del], N'') = N'' OR ${alias}.[del] = N'0')`
}

function auditedWhere(alias) {
  return `LTRIM(RTRIM(ISNULL(${alias}.[pass], N''))) = N'1'`
}

function datePrefix(saveDate) {
  return buildNextAssistOrderNo({ saveDate, existingOrderNos: [] }).slice(0, -2)
}

async function fetchOrderNosForDate(pool, saveDate) {
  const prefix = datePrefix(saveDate)
  const r = await pool.request().input('prefix', sql.NVarChar(50), `${prefix}%`).query(`
    SELECT LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([wxaj01], N'')))) AS assistOrderNo
    FROM ${HEADER_FROM}
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([wxaj01], N'')))) LIKE @prefix
  `)
  return (r.recordset ?? []).map((row) => row.assistOrderNo)
}

async function orderNoExists(pool, assistOrderNo, excludeId = null) {
  const req = pool.request().input('assistOrderNo', sql.NVarChar(200), assistOrderNo)
  if (excludeId != null) req.input('excludeId', sql.Int, Number(excludeId))
  const r = await req.query(`
    SELECT TOP 1 [id]
    FROM ${HEADER_FROM}
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([wxaj01], N'')))) = @assistOrderNo
      ${excludeId != null ? 'AND [id] <> @excludeId' : ''}
  `)
  return Boolean(r.recordset?.[0])
}

export async function checkAssistOrderNoAvailable(pool, assistOrderNo, excludeId = null) {
  const code = String(assistOrderNo ?? '').trim()
  if (!code) {
    return { available: false, message: '外协单号不能为空' }
  }
  const exists = await orderNoExists(pool, code, excludeId)
  return {
    available: !exists,
    message: exists ? '该外协单号已在在册记录中存在' : '',
  }
}

async function resolveFinalOrderNo(pool, header, excludeId = null) {
  const saveDate = new Date(header.assistDate)
  const requested = header.assistOrderNo || buildNextAssistOrderNo({
    saveDate,
    existingOrderNos: await fetchOrderNosForDate(pool, saveDate),
  })
  if (!(await orderNoExists(pool, requested, excludeId))) {
    return { assistOrderNo: requested, changedOrderNo: false }
  }
  const existing = await fetchOrderNosForDate(pool, saveDate)
  return {
    assistOrderNo: buildNextAssistOrderNo({ saveDate, existingOrderNos: existing }),
    changedOrderNo: true,
  }
}

async function resolveSupplier(pool, supplierCode) {
  const r = await pool
    .request()
    .input('code', sql.NVarChar(200), supplierCode)
    .query(`
      SELECT TOP 1
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(s.[s_code], N'')))) AS code,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(NULLIF(s.[s_name], N''), s.[name])))) AS name
      FROM ${SUPPLIER_FROM} AS s
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(s.[s_code], N'')))) = @code
        AND LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(s.[s_lb], N'')))) IN (N'外协', N'共用')
        AND ${auditedWhere('s')}
        AND ${activeWhere('s')}
      ORDER BY s.[id] ASC
    `)
  const row = r.recordset?.[0]
  if (!row?.code) return { ok: false, msg: '外协商不存在、未审核或不可用' }
  return { ok: true, code: row.code, name: row.name ?? '' }
}

async function resolveCurrency(pool, currencyCode) {
  const r = await pool
    .request()
    .input('code', sql.NVarChar(100), currencyCode)
    .query(`
      SELECT TOP 1
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(c.[code], N'')))) AS code,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.[name], N'')))) AS name,
        LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(c.[rate], N'')))) AS rate
      FROM ${CURRENCY_FROM} AS c
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(c.[code], N'')))) = @code
        AND ${auditedWhere('c')}
        AND ${activeWhere('c')}
      ORDER BY c.[id] ASC
    `)
  const row = r.recordset?.[0]
  if (!row?.code) return { ok: false, msg: '币别不存在、未审核或不可用' }
  return { ok: true, code: row.code, name: row.name ?? '', rate: row.rate ?? '' }
}

function bindAssistOrderHeaderFields(req, opts) {
  const { header, supplier, currency, finalNo, orderGuid, actor, forInsert } = opts
  const now = formatSalesOrderAuditTime()
  const deliveryStr = formatAssistOrderDeliveryDate(header.deliveryDate)
  const piValue = resolveAssistOrderPiValue(header.referenceNo)
  const uidStr = actor?.uidInt != null ? String(actor.uidInt) : ''

  req.input('wxaj01', sql.NVarChar(200), finalNo.assistOrderNo)
  req.input('wxaj02', sql.DateTime, new Date(header.assistDate))
  req.input('wxaj03', sql.NVarChar(20), header.assistType)
  req.input('wxaj04', sql.NVarChar(200), header.referenceNo)
  req.input('wxaj05', sql.NVarChar(200), supplier.code)
  req.input('wxaj06', sql.NVarChar(20), header.taxIncluded)
  req.input('wxaj07', sql.NVarChar(100), currency.code)
  req.input('wxaj08', sql.NVarChar(50), deliveryStr)
  req.input('kehu', sql.NVarChar(500), supplier.name)
  req.input('rmb', sql.NVarChar(200), currency.name)
  req.input('rmb_hl', sql.NVarChar(50), String(currency.rate ?? ''))
  req.input('pi', sql.NVarChar(500), piValue)
  req.input('remark', sql.NVarChar(sql.MAX), header.remark)
  req.input('notes', sql.NVarChar(sql.MAX), header.notes)
  req.input('decimal', sql.Int, header.decimalPlaces)

  if (forInsert) {
    req.input('uid', sql.NVarChar(50), uidStr)
    req.input('uname', sql.NVarChar(50), String(actor?.uname ?? ''))
    req.input('utruename', sql.NVarChar(50), String(actor?.utruename ?? ''))
    req.input('guid', sql.NVarChar(500), orderGuid)
    req.input('systemcode', sql.NVarChar(50), orderGuid)
    req.input('type', sql.Int, 1)
    req.input('addtime', sql.NVarChar(50), now)
  } else {
    req.input('edittime', sql.NVarChar(50), now)
    req.input('upname', sql.NVarChar(50), String(actor?.uname ?? ''))
    req.input('uptruename', sql.NVarChar(50), String(actor?.utruename ?? ''))
  }
}

export async function suggestAssistOrderNo(pool, saveDate = new Date()) {
  const existingOrderNos = await fetchOrderNosForDate(pool, saveDate)
  return buildNextAssistOrderNo({ saveDate, existingOrderNos })
}

export async function createAssistOrder(opts) {
  const { pool, body, req: httpReq, actor } = opts
  const header = normalizeAssistOrderHeader(body?.header ?? {})
  const valErr = validateAssistOrderHeader(header)
  if (valErr) return { ok: false, status: 400, msg: valErr }

  const supplier = await resolveSupplier(pool, header.supplierCode)
  if (!supplier.ok) return { ok: false, status: 400, msg: supplier.msg }
  const currency = await resolveCurrency(pool, header.currencyCode)
  if (!currency.ok) return { ok: false, status: 400, msg: currency.msg }
  const finalNo = await resolveFinalOrderNo(pool, header)
  const orderGuid = buildAssistOrderGuid(header.assistDate)

  const tx = new sql.Transaction(pool)
  await tx.begin()
  try {
    const req = new sql.Request(tx)
    bindAssistOrderHeaderFields(req, {
      header,
      supplier,
      currency,
      finalNo,
      orderGuid,
      actor: actor ?? { uidInt: null, uname: null, utruename: null },
      forInsert: true,
    })
    const out = await req.query(`
      INSERT INTO ${HEADER_FROM} (
        [wxaj01], [wxaj02], [wxaj03], [wxaj04], [wxaj05], [wxaj06], [wxaj07], [wxaj08],
        [kehu], [rmb], [rmb_hl], [pi], [type], [remark], [notes], [decimal], [GUID], [systemcode],
        [uid], [uname], [utruename], [addtime], [pass], [closed], [del]
      )
      OUTPUT INSERTED.[id] AS id
      VALUES (
        @wxaj01, @wxaj02, @wxaj03, @wxaj04, @wxaj05, @wxaj06, @wxaj07, @wxaj08,
        @kehu, @rmb, @rmb_hl, @pi, @type, @remark, @notes, @decimal, @guid, @systemcode,
        @uid, @uname, @utruename, @addtime, N'0', N'0', N'0'
      )
    `)
    const clientIp = httpReq ? getRequestIp(httpReq) : ''
    await rewriteAssistOrderLines({
      assistOrderNo: finalNo.assistOrderNo,
      lines: body?.lines ?? [],
      assistType: header.assistType,
      referenceNo: header.referenceNo,
      actor: actor ?? { uidInt: null, uname: null, utruename: null },
      clientIp,
      tx,
    })
    await rewriteAssistOrderFees({
      assistOrderNo: finalNo.assistOrderNo,
      fees: body?.fees ?? [],
      tx,
    })
    await writeAssistOrderOperationLog(tx, {
      actName: '外协订单录入',
      info: buildAssistOrderLogInfo({
        orderNo: finalNo.assistOrderNo,
        referenceNo: header.referenceNo,
        systemCode: orderGuid,
        actor: httpReq?.user,
      }),
      actor: httpReq?.user,
      orderNo: finalNo.assistOrderNo,
      systemCode: orderGuid,
      ip: httpReq ? getRequestIp(httpReq) : '',
    })
    await tx.commit()
    return {
      ok: true,
      id: Number(out.recordset?.[0]?.id),
      assistOrderNo: finalNo.assistOrderNo,
      changedOrderNo: finalNo.changedOrderNo,
    }
  } catch (err) {
    try {
      await tx.rollback()
    } catch {
      // ignore rollback errors
    }
    throw err
  }
}

export async function updateAssistOrder(opts) {
  const { pool, id, body, req: httpReq, actor } = opts
  const current = await pool.request().input('id', sql.Int, id).query(`
    SELECT TOP 1
      [id],
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([wxaj01], N'')))) AS assistOrderNo,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([systemcode], N'')))) AS systemCode,
      LTRIM(RTRIM(ISNULL([pass], N''))) AS pass,
      LTRIM(RTRIM(ISNULL([closed], N''))) AS closed,
      LTRIM(RTRIM(ISNULL([del], N''))) AS del
    FROM ${HEADER_FROM}
    WHERE [id] = @id
  `)
  const row = current.recordset?.[0]
  if (!row) return { ok: false, status: 404, msg: '外协订单不存在' }
  if (String(row.del ?? '').trim() === '1') return { ok: false, status: 400, msg: '回收站单据不能保存修改' }
  if (String(row.pass ?? '').trim() === '1' || String(row.closed ?? '').trim() === '1') {
    return { ok: false, status: 400, msg: '已审核或已结案单据不能保存修改' }
  }

  const header = normalizeAssistOrderHeader({
    ...body?.header,
    assistOrderNo: body?.header?.assistOrderNo || row.assistOrderNo,
  })
  const valErr = validateAssistOrderHeader(header)
  if (valErr) return { ok: false, status: 400, msg: valErr }
  const supplier = await resolveSupplier(pool, header.supplierCode)
  if (!supplier.ok) return { ok: false, status: 400, msg: supplier.msg }
  const currency = await resolveCurrency(pool, header.currencyCode)
  if (!currency.ok) return { ok: false, status: 400, msg: currency.msg }
  const finalNo = await resolveFinalOrderNo(pool, header, id)

  const tx = new sql.Transaction(pool)
  await tx.begin()
  try {
    const req = new sql.Request(tx)
    req.input('id', sql.Int, id)
    bindAssistOrderHeaderFields(req, {
      header,
      supplier,
      currency,
      finalNo,
      actor: actor ?? { uidInt: null, uname: null, utruename: null },
      forInsert: false,
    })
    await req.query(`
      UPDATE ${HEADER_FROM}
      SET [wxaj01]=@wxaj01,
          [wxaj02]=@wxaj02,
          [wxaj03]=@wxaj03,
          [wxaj04]=@wxaj04,
          [wxaj05]=@wxaj05,
          [wxaj06]=@wxaj06,
          [wxaj07]=@wxaj07,
          [wxaj08]=@wxaj08,
          [kehu]=@kehu,
          [rmb]=@rmb,
          [rmb_hl]=@rmb_hl,
          [pi]=@pi,
          [remark]=@remark,
          [notes]=@notes,
          [decimal]=@decimal,
          [upname]=@upname,
          [uptruename]=@uptruename,
          [edittime]=@edittime
      WHERE [id]=@id
    `)
    const clientIp = httpReq ? getRequestIp(httpReq) : ''
    await rewriteAssistOrderLines({
      assistOrderNo: finalNo.assistOrderNo,
      lines: body?.lines ?? [],
      assistType: header.assistType,
      referenceNo: header.referenceNo,
      actor: actor ?? { uidInt: null, uname: null, utruename: null },
      clientIp,
      tx,
    })
    await rewriteAssistOrderFees({
      assistOrderNo: finalNo.assistOrderNo,
      fees: body?.fees ?? [],
      tx,
    })
    await writeAssistOrderOperationLog(tx, {
      actName: '外协订单修改',
      info: buildAssistOrderLogInfo({
        orderNo: finalNo.assistOrderNo,
        referenceNo: header.referenceNo,
        systemCode: row.systemCode || row.assistOrderNo,
        actor: httpReq?.user,
      }),
      actor: httpReq?.user,
      orderNo: finalNo.assistOrderNo,
      systemCode: row.systemCode || row.assistOrderNo,
      ip: httpReq ? getRequestIp(httpReq) : '',
    })
    await tx.commit()
    return { ok: true, id, assistOrderNo: finalNo.assistOrderNo, changedOrderNo: finalNo.changedOrderNo }
  } catch (err) {
    try {
      await tx.rollback()
    } catch {
      // ignore rollback errors
    }
    throw err
  }
}
