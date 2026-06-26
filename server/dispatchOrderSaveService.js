import { sql } from './db.js'
import { formatSalesOrderAuditTime } from './salesOrderPiBom.js'
import { getRequestIp } from './operationAuditMiddleware.js'
import {
  buildDispatchSystemCode,
  buildNextDispatchOrderNo,
  normalizeDispatchOrderHeader,
  normalizeDispatchOrderLine,
  validateDispatchOrderPayload,
  validateDispatchOrderQuantities,
} from './dispatchOrderSaveLogic.js'
import { DISPATCH_ORDER_HEADER_TABLE, DISPATCH_ORDER_LINE_TABLE } from './dispatchOrderListQuery.js'
import { buildDispatchOrderLogInfo, writeDispatchOrderOperationLog } from './dispatchOrderOperationLog.js'

const HEADER_FROM = `dbo.[${DISPATCH_ORDER_HEADER_TABLE}]`
const LINE_FROM = `dbo.[${DISPATCH_ORDER_LINE_TABLE}]`
const WORKSHOP_FROM = 'dbo.[UB_ERP_Stocks_workshop]'
const SALES_HEADER_FROM = 'dbo.[UB_ERP_Sales_order]'
const SALES_LINE_FROM = 'dbo.[UB_ERP_Sales_order_list]'

function text(v) {
  return String(v ?? '').trim()
}

function actorUid(actor) {
  const n = Number(actor?.uidInt ?? actor?.uid ?? actor?.userId ?? actor?.UserID)
  return Number.isFinite(n) && n > 0 ? String(Math.trunc(n)) : ''
}

function activeWhere(alias) {
  return `(ISNULL(${alias}.[del], N'') = N'' OR ${alias}.[del] = N'0')`
}

function auditedWhere(alias) {
  return `LTRIM(RTRIM(ISNULL(${alias}.[pass], N''))) = N'1'`
}

function datePrefix(dispatchDate) {
  return buildNextDispatchOrderNo({ dispatchDate, existingOrderNos: [] }).slice(0, -2)
}

async function fetchOrderNosForDate(pool, dispatchDate) {
  const prefix = datePrefix(dispatchDate)
  const r = await pool.request().input('prefix', sql.NVarChar(50), `${prefix}%`).query(`
    SELECT LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([scaj01], N'')))) AS dispatchOrderNo
    FROM ${HEADER_FROM}
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([scaj01], N'')))) LIKE @prefix
  `)
  return (r.recordset ?? []).map((row) => row.dispatchOrderNo)
}

async function orderNoExists(pool, dispatchOrderNo, excludeId = null) {
  const req = pool.request().input('dispatchOrderNo', sql.NVarChar(200), dispatchOrderNo)
  if (excludeId != null) req.input('excludeId', sql.Int, Number(excludeId))
  const r = await req.query(`
    SELECT TOP 1 [id]
    FROM ${HEADER_FROM}
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([scaj01], N'')))) = @dispatchOrderNo
      ${excludeId != null ? 'AND [id] <> @excludeId' : ''}
  `)
  return Boolean(r.recordset?.[0])
}

export async function suggestDispatchOrderNo(pool, dispatchDate = new Date()) {
  const existingOrderNos = await fetchOrderNosForDate(pool, dispatchDate)
  return buildNextDispatchOrderNo({ dispatchDate, existingOrderNos })
}

export async function checkDispatchOrderNoAvailable(pool, dispatchOrderNo, excludeId = null) {
  const code = text(dispatchOrderNo)
  if (!code) return { available: false, message: '派工单号不能为空' }
  const exists = await orderNoExists(pool, code, excludeId)
  return { available: !exists, message: exists ? '派工单号已存在' : '' }
}

async function resolveFinalOrderNo(pool, header, excludeId = null) {
  const requested =
    header.dispatchOrderNo ||
    buildNextDispatchOrderNo({
      dispatchDate: header.dispatchDate,
      existingOrderNos: await fetchOrderNosForDate(pool, header.dispatchDate),
    })
  if (!(await orderNoExists(pool, requested, excludeId))) return { dispatchOrderNo: requested, changedOrderNo: false }
  return {
    dispatchOrderNo: buildNextDispatchOrderNo({
      dispatchDate: header.dispatchDate,
      existingOrderNos: await fetchOrderNosForDate(pool, header.dispatchDate),
    }),
    changedOrderNo: true,
  }
}

async function resolveWorkshop(pool, workshopCode) {
  const r = await pool.request().input('code', sql.NVarChar(200), workshopCode).query(`
    SELECT TOP 1
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([code], N'')))) AS code,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([name], N'')))) AS name
    FROM ${WORKSHOP_FROM}
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([code], N'')))) = @code
      AND (ISNULL([del], N'') = N'' OR [del] = N'0')
    ORDER BY [id] ASC
  `)
  const row = r.recordset?.[0]
  if (!row?.code) return { ok: false, msg: '生产车间不存在或不可用' }
  return { ok: true, code: row.code, name: row.name ?? '' }
}

async function fetchExistingOrder(pool, id) {
  const r = await pool.request().input('id', sql.Int, id).query(`
    SELECT TOP 1
      [id],
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([scaj01], N'')))) AS dispatchOrderNo,
      LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL([scaj03], N'')))) AS dispatchType,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([scaj04], N'')))) AS referenceNo,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([scaj05], N'')))) AS workshopCode,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([cj], N'')))) AS workshopName,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([systemcode], N'')))) AS systemCode,
      LTRIM(RTRIM(ISNULL([pass], N''))) AS pass,
      LTRIM(RTRIM(ISNULL([del], N''))) AS del
    FROM ${HEADER_FROM}
    WHERE [id] = @id
  `)
  return r.recordset?.[0] ?? null
}

/**
 * 已派工数量统计范围：本厂/大板按 PI+车间独立池；委外保留旧系统特殊口径。
 */
export function buildDispatchAvailabilityScope({ dispatchType, workshopCode, workshopName }) {
  const type = String(dispatchType ?? '0')
  if (type === '2') {
    if (String(workshopName ?? '').indexOf('生产') >= 0) {
      return {
        dispatchScope: `AND LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(h.[cj], N'')))) LIKE N'%生产%'`,
        bindWorkshopCode: false,
      }
    }
    return {
      dispatchScope: `AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[scaj05], N'')))) = @workshopCode`,
      bindWorkshopCode: true,
    }
  }
  // 本厂(0)/大板(1)：同一 PI+货品在各生产车间互不占用可派工数量
  return {
    dispatchScope: `AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[scaj04], N'')))) = @pi
        AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[scaj05], N'')))) = @workshopCode`,
    bindWorkshopCode: true,
  }
}

export async function fetchDispatchAvailability(pool, { dispatchType, workshopCode, workshopName, pi, kcaa01, excludeOrderNo = '' }) {
  const req = pool.request()
    .input('pi', sql.NVarChar(200), pi)
    .input('kcaa01', sql.NVarChar(200), kcaa01)
    .input('excludeOrderNo', sql.NVarChar(200), excludeOrderNo || '')
  const { dispatchScope, bindWorkshopCode } = buildDispatchAvailabilityScope({ dispatchType, workshopCode, workshopName })
  if (bindWorkshopCode) {
    req.input('workshopCode', sql.NVarChar(200), workshopCode)
  }
  const r = await req.query(`
    SELECT TOP 1
      ISNULL(s.[xsak03], ISNULL(s.[plan_quantity], 0)) AS salesQty,
      ISNULL(used.[usedQty], 0) AS dispatchedQty
    FROM ${SALES_LINE_FROM} AS s
    INNER JOIN ${SALES_HEADER_FROM} AS sh
      ON LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(sh.[xsaj01], N'')))) = LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(s.[xsak01], N''))))
    LEFT JOIN (
      SELECT SUM(ISNULL(l.[scak03], 0)) AS usedQty
      FROM ${LINE_FROM} AS l
      INNER JOIN ${HEADER_FROM} AS h
        ON LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[scaj01], N'')))) = LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[scak01], N''))))
      WHERE ${activeWhere('h')}
        ${dispatchScope}
        AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) = @kcaa01
        AND (@excludeOrderNo = N'' OR LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[scaj01], N'')))) <> @excludeOrderNo)
    ) AS used ON 1 = 1
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(s.[xsak01], N'')))) = @pi
      AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(s.[kcaa01], N'')))) = @kcaa01
      AND ${activeWhere('sh')}
      AND LTRIM(RTRIM(ISNULL(sh.[closed], N'0'))) = N'0'
      AND ${auditedWhere('sh')}
  `)
  const row = r.recordset?.[0] ?? { salesQty: 0, dispatchedQty: 0 }
  const salesQty = Number(row.salesQty ?? 0) || 0
  const dispatchedQty = Number(row.dispatchedQty ?? 0) || 0
  return { salesQty, dispatchedQty, availableQty: salesQty - dispatchedQty }
}

async function buildAvailabilityMap(pool, { header, lines, excludeOrderNo = '' }) {
  const map = new Map()
  for (const line of lines) {
    const key = `${line.pi}\u0000${line.kcaa01}`
    if (map.has(key)) continue
    map.set(
      key,
      await fetchDispatchAvailability(pool, {
        dispatchType: header.dispatchType,
        workshopCode: header.workshopCode,
        workshopName: header.workshopName,
        pi: line.pi,
        kcaa01: line.kcaa01,
        excludeOrderNo,
      }),
    )
  }
  return map
}

async function insertLines(tx, { orderNo, lines, actor, ip }) {
  for (let i = 0; i < lines.length; i += 1) {
    const line = normalizeDispatchOrderLine(lines[i], i + 1)
    const req = new sql.Request(tx)
    req.input('scak01', sql.NVarChar(200), orderNo)
    req.input('scak02', sql.NVarChar(200), text(line.scak02 || line.systemcode || line.GUID))
    req.input('scak03', sql.Decimal(18, 4), line.scak03)
    req.input('scak04', sql.Decimal(18, 4), line.scak04)
    req.input('scak05', sql.Decimal(18, 4), line.scak05)
    req.input('pi', sql.NVarChar(200), line.pi)
    req.input('seq', sql.Int, i + 1)
    req.input('version', sql.NVarChar(100), text(line.version))
    req.input('kcaa01', sql.NVarChar(200), line.kcaa01)
    req.input('kcaa02', sql.NVarChar(500), line.kcaa02)
    req.input('kcaa02_en', sql.NVarChar(500), text(line.kcaa02_en))
    req.input('kcaa03', sql.NVarChar(500), line.kcaa03)
    req.input('kcaa04', sql.NVarChar(100), line.kcaa04)
    req.input('kcaa05', sql.NVarChar(200), text(line.kcaa05))
    req.input('kcaa06', sql.NVarChar(200), text(line.kcaa06))
    req.input('kcaa09', sql.NVarChar(200), text(line.kcaa09))
    req.input('kcaa10', sql.NVarChar(200), text(line.kcaa10))
    req.input('kcaa11', sql.NVarChar(200), text(line.kcaa11))
    req.input('kcaa12', sql.NVarChar(20), text(line.kcaa12))
    req.input('kcaa13', sql.NVarChar(20), text(line.kcaa13))
    req.input('kcaa14', sql.NVarChar(20), text(line.kcaa14))
    req.input('kcaa15', sql.NVarChar(200), text(line.kcaa15))
    req.input('systemcode', sql.NVarChar(200), text(line.systemcode || line.GUID || line.scak02))
    req.input('GUID', sql.NVarChar(200), text(line.GUID || line.systemcode || line.scak02))
    req.input('uid', sql.NVarChar(50), actorUid(actor))
    req.input('uname', sql.NVarChar(200), text(actor?.uname ?? actor?.auditUserName ?? actor?.userName))
    req.input('utruename', sql.NVarChar(200), text(actor?.utruename ?? actor?.auditTruename ?? actor?.truename ?? actor?.userName))
    req.input('ip', sql.NVarChar(50), text(ip))
    await req.query(`
      INSERT INTO ${LINE_FROM} (
        [scak01], [scak02], [scak03], [scak04], [scak05], [pi], [seq], [version],
        [kcaa01], [kcaa02], [kcaa02_en], [kcaa03], [kcaa04], [kcaa05], [kcaa06], [kcaa09],
        [kcaa10], [kcaa11], [kcaa12], [kcaa13], [kcaa14], [kcaa15], [systemcode], [GUID],
        [type], [pass], [del], [uid], [uname], [utruename], [addtime], [ip]
      )
      VALUES (
        @scak01, @scak02, @scak03, @scak04, @scak05, @pi, @seq, @version,
        @kcaa01, @kcaa02, @kcaa02_en, @kcaa03, @kcaa04, @kcaa05, @kcaa06, @kcaa09,
        @kcaa10, @kcaa11, @kcaa12, @kcaa13, @kcaa14, @kcaa15, @systemcode, @GUID,
        1, N'0', N'0', @uid, @uname, @utruename, CONVERT(nvarchar(30), GETDATE(), 120), @ip
      )
    `)
  }
}

async function validateSave(pool, payload, excludeOrderNo = '') {
  const err = validateDispatchOrderPayload(payload)
  if (err) return { ok: false, status: 400, msg: err }
  const header = normalizeDispatchOrderHeader(payload.header)
  const workshop = await resolveWorkshop(pool, header.workshopCode)
  if (!workshop.ok) return { ok: false, status: 400, msg: workshop.msg }
  header.workshopName = workshop.name
  const lines = (payload.lines ?? []).map((line, idx) => normalizeDispatchOrderLine(line, idx + 1))
  const availabilityByKey = await buildAvailabilityMap(pool, { header, lines, excludeOrderNo })
  const qtyErr = validateDispatchOrderQuantities({ lines, availabilityByKey })
  if (qtyErr) return { ok: false, status: 400, msg: qtyErr }
  return { ok: true, header, lines, workshop }
}

export async function createDispatchOrder({ pool, body, req: httpReq, actor }) {
  const checked = await validateSave(pool, body)
  if (!checked.ok) return checked
  const { header, lines, workshop } = checked
  const finalNo = await resolveFinalOrderNo(pool, header)
  const systemCode = buildDispatchSystemCode(header.dispatchDate)
  const tx = new sql.Transaction(pool)
  await tx.begin()
  try {
    const req = new sql.Request(tx)
    const now = formatSalesOrderAuditTime()
    req.input('scaj01', sql.NVarChar(200), finalNo.dispatchOrderNo)
    req.input('scaj02', sql.DateTime, new Date(header.dispatchDate))
    req.input('scaj03', sql.NVarChar(20), header.dispatchType)
    req.input('scaj04', sql.NVarChar(200), header.referenceNo)
    req.input('scaj05', sql.NVarChar(200), workshop.code)
    req.input('scaj06', sql.NVarChar(50), header.deliveryDate || null)
    req.input('cj', sql.NVarChar(500), workshop.name)
    req.input('kid', sql.NVarChar(200), header.dispatchType === '2' ? header.supplierCode : '')
    req.input('remark', sql.NVarChar(sql.MAX), header.remark)
    req.input('systemcode', sql.NVarChar(200), systemCode)
    req.input('uid', sql.NVarChar(50), actorUid(actor))
    req.input('uname', sql.NVarChar(200), text(actor?.uname ?? actor?.auditUserName ?? actor?.userName))
    req.input('utruename', sql.NVarChar(200), text(actor?.utruename ?? actor?.auditTruename ?? actor?.truename ?? actor?.userName))
    req.input('addtime', sql.NVarChar(50), now)
    const out = await req.query(`
      INSERT INTO ${HEADER_FROM} (
        [scaj01], [scaj02], [scaj03], [scaj04], [scaj05], [scaj06], [cj], [kid], [remark],
        [systemcode], [sign], [closed], [pass], [del], [uid], [uname], [utruename], [addtime]
      )
      OUTPUT INSERTED.[id] AS id
      VALUES (
        @scaj01, @scaj02, @scaj03, @scaj04, @scaj05, @scaj06, @cj, @kid, @remark,
        @systemcode, 101, N'0', N'0', N'0', @uid, @uname, @utruename, @addtime
      )
    `)
    const ip = httpReq ? getRequestIp(httpReq) : ''
    await insertLines(tx, { orderNo: finalNo.dispatchOrderNo, lines, actor, ip })
    await writeDispatchOrderOperationLog(tx, {
      actName: '新增派工单',
      info: buildDispatchOrderLogInfo({ orderNo: finalNo.dispatchOrderNo, referenceNo: header.referenceNo, actor }),
      actor,
      orderNo: finalNo.dispatchOrderNo,
      systemCode,
      ip,
    })
    await tx.commit()
    return { ok: true, id: out.recordset?.[0]?.id, dispatchOrderNo: finalNo.dispatchOrderNo, changedOrderNo: finalNo.changedOrderNo }
  } catch (err) {
    await tx.rollback().catch(() => {})
    throw err
  }
}

export async function updateDispatchOrder({ pool, id, body, req: httpReq, actor }) {
  const existing = await fetchExistingOrder(pool, id)
  if (!existing) return { ok: false, status: 404, msg: '派工单不存在' }
  if (existing.del === '1') return { ok: false, status: 400, msg: '回收站里的派工单不能编辑' }
  if (existing.pass === '1') return { ok: false, status: 400, msg: '已审核派工单不能编辑，请先反审核' }
  const incoming = normalizeDispatchOrderHeader(body?.header ?? {})
  const header = {
    ...incoming,
    dispatchOrderNo: existing.dispatchOrderNo,
    dispatchType: existing.dispatchType,
    referenceNo: existing.referenceNo,
    workshopCode: existing.workshopCode,
    workshopName: existing.workshopName,
    supplierCode: existing.dispatchType === '2' ? existing.referenceNo : '',
  }
  const checked = await validateSave(pool, { header, lines: body?.lines ?? [] }, existing.dispatchOrderNo)
  if (!checked.ok) return checked
  const tx = new sql.Transaction(pool)
  await tx.begin()
  try {
    const req = new sql.Request(tx)
    req.input('id', sql.Int, id)
    req.input('scaj02', sql.DateTime, new Date(header.dispatchDate))
    req.input('scaj06', sql.NVarChar(50), header.deliveryDate || null)
    req.input('remark', sql.NVarChar(sql.MAX), header.remark)
    await req.query(`UPDATE ${HEADER_FROM} SET [scaj02]=@scaj02, [scaj06]=@scaj06, [remark]=@remark WHERE [id]=@id`)
    const delReq = new sql.Request(tx).input('orderNo', sql.NVarChar(200), existing.dispatchOrderNo)
    await delReq.query(`DELETE FROM ${LINE_FROM} WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([scak01], N'')))) = @orderNo`)
    const ip = httpReq ? getRequestIp(httpReq) : ''
    await insertLines(tx, { orderNo: existing.dispatchOrderNo, lines: checked.lines, actor, ip })
    await writeDispatchOrderOperationLog(tx, {
      actName: '修改派工单',
      info: buildDispatchOrderLogInfo({ orderNo: existing.dispatchOrderNo, referenceNo: existing.referenceNo, actor }),
      actor,
      orderNo: existing.dispatchOrderNo,
      systemCode: existing.systemCode,
      ip,
    })
    await tx.commit()
    return { ok: true, id, dispatchOrderNo: existing.dispatchOrderNo, changedOrderNo: false }
  } catch (err) {
    await tx.rollback().catch(() => {})
    throw err
  }
}
