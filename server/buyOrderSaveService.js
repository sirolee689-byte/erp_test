import { sql } from './db.js'
import {
  buildBuyOrderGuid,
  buildNextBuyOrderNo,
  normalizeBuyOrderHeader,
  normalizeBuyOrderNumberType,
  validateBuyOrderHeader,
} from './buyOrderSaveLogic.js'
import { formatSalesOrderAuditTime } from './salesOrderPiBom.js'
import { getRequestIp } from './operationAuditMiddleware.js'
import { rewriteBuyOrderLines } from './buyOrderLineSave.js'
import { rewriteBuyOrderFees } from './buyOrderFeeSave.js'
import { rewriteBuyOrderBomSnapshots } from './buyOrderBomSnapshot.js'
import { buildBuyOrderLogInfo, writeBuyOrderOperationLog } from './buyOrderOperationLog.js'

const HEADER_FROM = 'dbo.[UB_ERP_Buy_order]'
const SUPPLIER_FROM = 'dbo.[UB_ERP_System_supplier]'
const CURRENCY_FROM = 'dbo.[UB_ERP_Finance_currency]'

function text(v) {
  return String(v ?? '').trim()
}

function numberOrNull(v) {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

async function fetchOrderNos(pool, numberType, saveDate) {
  const normalized = normalizeBuyOrderNumberType(numberType, saveDate)
  const prefix = normalized === 'ZY' || normalized === 'PO' ? `${normalized}-%` : `${normalized}%`
  const r = await pool.request().input('prefix', sql.NVarChar(50), prefix).query(`
    SELECT TOP 1 LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([kcaj01], N'')))) AS buyOrderNo
    FROM ${HEADER_FROM}
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([kcaj01], N'')))) LIKE @prefix
      AND LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL([del], N'0')))) = N'0'
    ORDER BY LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([kcaj01], N'')))) DESC
  `)
  return (r.recordset ?? []).map((row) => row.buyOrderNo)
}

async function orderNoExists(pool, buyOrderNo, excludeId = null) {
  const req = pool.request().input('buyOrderNo', sql.NVarChar(200), buyOrderNo)
  if (excludeId != null) req.input('excludeId', sql.Int, Number(excludeId))
  const r = await req.query(`
    SELECT TOP 1 [id]
    FROM ${HEADER_FROM}
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([kcaj01], N'')))) = @buyOrderNo
      ${excludeId != null ? 'AND [id] <> @excludeId' : ''}
  `)
  return Boolean(r.recordset?.[0])
}

export async function suggestBuyOrderNo(pool, opts = {}) {
  const saveDate = opts.saveDate ?? new Date()
  const numberType = opts.numberType ?? 'ZY'
  return buildNextBuyOrderNo({ numberType, saveDate, existingOrderNos: await fetchOrderNos(pool, numberType, saveDate) })
}

export async function checkBuyOrderNoAvailable(pool, buyOrderNo, excludeId = null) {
  const code = text(buyOrderNo)
  if (!code) return { available: false, message: '采购单号不能为空' }
  const exists = await orderNoExists(pool, code, excludeId)
  return { available: !exists, message: exists ? '该采购单号已存在' : '' }
}

async function resolveFinalNo(pool, header, excludeId = null) {
  const requested = text(header.buyOrderNo)
  if (requested && !(await orderNoExists(pool, requested, excludeId))) return { buyOrderNo: requested, changedOrderNo: false }
  const buyOrderNo = await suggestBuyOrderNo(pool, { numberType: header.numberType || requested.slice(0, 2), saveDate: header.buyDate })
  return { buyOrderNo, changedOrderNo: Boolean(requested && requested !== buyOrderNo) }
}

async function resolveSupplier(pool, supplierCode) {
  const r = await pool.request().input('code', sql.NVarChar(200), supplierCode).query(`
    SELECT TOP 1
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([s_code], N'')))) AS code,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(NULLIF([s_name], N''), [name])))) AS name
    FROM ${SUPPLIER_FROM}
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([s_code], N'')))) = @code
      AND LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL([s_lb], N'')))) IN (N'采购', N'共用')
      AND LTRIM(RTRIM(ISNULL([pass], N''))) = N'1'
      AND (ISNULL([del], N'') = N'' OR [del] = N'0')
    ORDER BY [id] ASC
  `)
  const row = r.recordset?.[0]
  if (!row?.code) return { ok: false, msg: '供应商不存在、未审核或不可用' }
  return { ok: true, code: row.code, name: row.name ?? '' }
}

async function resolveCurrency(pool, currencyCode) {
  const r = await pool.request().input('code', sql.NVarChar(100), currencyCode).query(`
    SELECT TOP 1
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL([code], N'')))) AS code,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([name], N'')))) AS name,
      LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL([rate], N'1')))) AS rate
    FROM ${CURRENCY_FROM}
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL([code], N'')))) = @code
      AND LTRIM(RTRIM(ISNULL([pass], N''))) = N'1'
      AND (ISNULL([del], N'') = N'' OR [del] = N'0')
    ORDER BY [id] ASC
  `)
  const row = r.recordset?.[0]
  if (!row?.code) return { ok: false, msg: '币别不存在、未审核或不可用' }
  return { ok: true, code: row.code, name: row.name ?? '', rate: row.rate || '1' }
}

function hasPricePermission(req) {
  const actions = req?.user?.actions ?? req?.user?.Permissions ?? req?.session?.user?.actions
  if (Array.isArray(actions)) return actions.includes('price') || actions.includes('*')
  return true
}

function bindHeader(req, { header, finalNo, supplier, currency, systemCode, actor, insert }) {
  const now = formatSalesOrderAuditTime()
  req.input('kcaj01', sql.NVarChar(200), finalNo.buyOrderNo)
  req.input('kcaj02', sql.DateTime, new Date(header.buyDate))
  req.input('kcaj03', sql.NVarChar(20), header.buyType)
  req.input('kcaj04', sql.NVarChar(500), header.referenceNo)
  req.input('kcaj05', sql.NVarChar(200), supplier.code)
  req.input('kcaj06', sql.NVarChar(20), header.taxIncluded)
  req.input('kcaj07', sql.NVarChar(100), currency.code)
  req.input('kcaj08', sql.NVarChar(500), header.loadingPort)
  req.input('kcaj09', sql.NVarChar(500), header.dischargePort)
  req.input('kcaj10', sql.NVarChar(500), header.paymentTerms)
  req.input('yf', sql.Decimal(18, 2), numberOrNull(header.freight))
  req.input('kehu', sql.NVarChar(500), supplier.name)
  req.input('rmb', sql.NVarChar(200), currency.name)
  req.input('rmb_hl', sql.NVarChar(50), String(currency.rate ?? '1'))
  req.input('remark', sql.NVarChar(sql.MAX), header.remark)
  req.input('decimal', sql.Int, header.decimalPlaces)
  if (insert) {
    req.input('systemcode', sql.NVarChar(500), systemCode)
    req.input('GUID', sql.NVarChar(500), systemCode)
    req.input('uid', sql.NVarChar(50), actor?.uidInt != null ? String(actor.uidInt) : '')
    req.input('uname', sql.NVarChar(200), text(actor?.uname))
    req.input('utruename', sql.NVarChar(200), text(actor?.utruename))
    req.input('addtime', sql.NVarChar(50), now)
  } else {
    req.input('edittime', sql.NVarChar(50), now)
  }
}

async function saveChildren({ tx, orderNo, systemCode, body, header, pricePermission, actor }) {
  await rewriteBuyOrderLines({ buyOrderNo: orderNo, systemcodeId: systemCode, lines: body.lines ?? [], header, tx, hasPricePermission: pricePermission, actor })
  await rewriteBuyOrderFees({
    buyOrderNo: orderNo,
    systemCode,
    fees: body.fees ?? [],
    tx,
    hasPricePermission: pricePermission,
    actor,
  })
  await rewriteBuyOrderBomSnapshots({ buyOrderNo: orderNo, lines: body.lines ?? [], header, tx, actor })
}

export async function createBuyOrder({ pool, body = {}, req: httpReq, actor }) {
  const header = normalizeBuyOrderHeader(body.header ?? {})
  const err = validateBuyOrderHeader(header)
  if (err) return { ok: false, status: 400, msg: err }
  const supplier = await resolveSupplier(pool, header.supplierCode)
  if (!supplier.ok) return { ok: false, status: 400, msg: supplier.msg }
  const currency = await resolveCurrency(pool, header.currencyCode)
  if (!currency.ok) return { ok: false, status: 400, msg: currency.msg }
  const finalNo = await resolveFinalNo(pool, header)
  const systemCode = buildBuyOrderGuid(header.buyDate)
  const tx = new sql.Transaction(pool)
  await tx.begin()
  try {
    const auditActor = actor ?? {}
    const insertReq = new sql.Request(tx)
    bindHeader(insertReq, { header, finalNo, supplier, currency, systemCode, actor: auditActor, insert: true })
    const out = await insertReq.query(`
      INSERT INTO ${HEADER_FROM} (
        [kcaj01], [kcaj02], [kcaj03], [kcaj04], [kcaj05], [kcaj06], [kcaj07], [kcaj08], [kcaj09], [kcaj10],
        [yf], [kehu], [rmb], [rmb_hl], [remark], [decimal], [GUID], [systemcode],
        [type], [uid], [uname], [utruename], [addtime], [pass], [closed], [del]
      )
      OUTPUT INSERTED.[id] AS id
      VALUES (
        @kcaj01, @kcaj02, @kcaj03, @kcaj04, @kcaj05, @kcaj06, @kcaj07, @kcaj08, @kcaj09, @kcaj10,
        @yf, @kehu, @rmb, @rmb_hl, @remark, @decimal, @GUID, @systemcode,
        1, @uid, @uname, @utruename, @addtime, N'0', N'0', N'0'
      )
    `)
    await saveChildren({ tx, orderNo: finalNo.buyOrderNo, systemCode, body, header, pricePermission: hasPricePermission(httpReq), actor: auditActor })
    await writeBuyOrderOperationLog(tx, {
      actName: '采购单录入',
      info: buildBuyOrderLogInfo({ orderNo: finalNo.buyOrderNo, referenceNo: header.referenceNo, actor: auditActor }),
      actor: auditActor,
      orderNo: finalNo.buyOrderNo,
      systemCode,
      ip: httpReq ? getRequestIp(httpReq) : '',
    })
    await tx.commit()
    return { ok: true, id: Number(out.recordset?.[0]?.id), buyOrderNo: finalNo.buyOrderNo, changedOrderNo: finalNo.changedOrderNo }
  } catch (e) {
    try { await tx.rollback() } catch {}
    throw e
  }
}

export async function updateBuyOrder({ pool, id, body = {}, req: httpReq, actor }) {
  const current = await pool.request().input('id', sql.Int, id).query(`
    SELECT TOP 1 [id],
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([kcaj01], N'')))) AS buyOrderNo,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([systemcode], N'')))) AS systemCode,
      LTRIM(RTRIM(ISNULL([pass], N''))) AS pass,
      LTRIM(RTRIM(ISNULL([closed], N''))) AS closed,
      LTRIM(RTRIM(ISNULL([del], N''))) AS del
    FROM ${HEADER_FROM}
    WHERE [id]=@id
  `)
  const row = current.recordset?.[0]
  if (!row) return { ok: false, status: 404, msg: '采购单不存在' }
  if (text(row.del) === '1') return { ok: false, status: 400, msg: '回收站采购单不能保存修改' }
  if (text(row.pass) === '1' || text(row.closed) === '1') return { ok: false, status: 400, msg: '已审核或已结案采购单不能保存修改' }
  const header = normalizeBuyOrderHeader({ ...body.header, buyOrderNo: row.buyOrderNo })
  const err = validateBuyOrderHeader(header)
  if (err) return { ok: false, status: 400, msg: err }
  const supplier = await resolveSupplier(pool, header.supplierCode)
  if (!supplier.ok) return { ok: false, status: 400, msg: supplier.msg }
  const currency = await resolveCurrency(pool, header.currencyCode)
  if (!currency.ok) return { ok: false, status: 400, msg: currency.msg }
  const finalNo = { buyOrderNo: row.buyOrderNo, changedOrderNo: false }
  const tx = new sql.Transaction(pool)
  await tx.begin()
  try {
    const auditActor = actor ?? {}
    const updateReq = new sql.Request(tx)
    updateReq.input('id', sql.Int, id)
    bindHeader(updateReq, { header, finalNo, supplier, currency, systemCode: row.systemCode, actor: auditActor, insert: false })
    await updateReq.query(`
      UPDATE ${HEADER_FROM}
      SET [kcaj02]=@kcaj02, [kcaj03]=@kcaj03, [kcaj04]=@kcaj04, [kcaj05]=@kcaj05, [kcaj06]=@kcaj06,
          [kcaj07]=@kcaj07, [kcaj08]=@kcaj08, [kcaj09]=@kcaj09, [kcaj10]=@kcaj10, [yf]=@yf,
          [kehu]=@kehu, [rmb]=@rmb, [rmb_hl]=@rmb_hl, [remark]=@remark, [decimal]=@decimal, [edittime]=@edittime
      WHERE [id]=@id
    `)
    await saveChildren({ tx, orderNo: row.buyOrderNo, systemCode: row.systemCode, body, header, pricePermission: hasPricePermission(httpReq), actor: auditActor })
    await writeBuyOrderOperationLog(tx, {
      actName: '采购单修改',
      info: buildBuyOrderLogInfo({ orderNo: row.buyOrderNo, referenceNo: header.referenceNo, actor: auditActor }),
      actor: auditActor,
      orderNo: row.buyOrderNo,
      systemCode: row.systemCode,
      ip: httpReq ? getRequestIp(httpReq) : '',
    })
    await tx.commit()
    return { ok: true, id, buyOrderNo: row.buyOrderNo, changedOrderNo: false }
  } catch (e) {
    try { await tx.rollback() } catch {}
    throw e
  }
}
