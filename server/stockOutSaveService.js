import { sql } from './db.js'
import { formatSalesOrderAuditTime } from './salesOrderPiBom.js'
import { getRequestIp } from './operationAuditMiddleware.js'
import {
  buildNextStockOutNo,
  buildStockOutSystemCode,
  normalizeStockOutHeader,
  normalizeStockOutLine,
  validateStockOutPayload,
} from './stockOutSaveLogic.js'
import { STOCK_OUT_HEADER_TABLE, STOCK_OUT_LINE_TABLE } from './stockOutListQuery.js'
import { buildStockOutLogInfo, writeStockOutOperationLog } from './stockOutOperationLog.js'

const HEADER_FROM = `dbo.[${STOCK_OUT_HEADER_TABLE}]`
const LINE_FROM = `dbo.[${STOCK_OUT_LINE_TABLE}]`
const WAREHOUSE_FROM = 'dbo.[UB_ERP_Stocks_Warehouse]'
const BOM_FROM = 'dbo.[UB_ERP_Bom_000]'
const SUPPLIER_FROM = 'dbo.[UB_ERP_System_supplier]'
const WORKSHOP_FROM = 'dbo.[UB_ERP_Stocks_workshop]'
const CUSTOMER_FROM = 'dbo.[UB_ERP_Customer]'

function text(v) {
  return String(v ?? '').trim()
}

function actorUid(actor) {
  const n = Number(actor?.uidInt ?? actor?.uid ?? actor?.userId ?? actor?.UserID)
  return Number.isFinite(n) && n > 0 ? String(Math.trunc(n)) : ''
}

function actorUname(actor) {
  return text(actor?.uname ?? actor?.auditUserName ?? actor?.userName)
}

function actorTruename(actor) {
  return text(actor?.utruename ?? actor?.auditTruename ?? actor?.truename ?? actor?.userName)
}

function nullableNumber(value) {
  if (value === '' || value === null || value === undefined) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

async function columnSet(pool, tableName) {
  const r = await pool.request().query(`
    SELECT LOWER([name]) AS name
    FROM sys.columns
    WHERE [object_id] = OBJECT_ID(N'dbo.[${tableName}]')
  `)
  return new Set((r.recordset ?? []).map((row) => String(row.name ?? '').toLowerCase()))
}

function has(cols, col) {
  return cols.has(String(col).toLowerCase())
}

function addInput(req, name, value) {
  if (value instanceof Date) req.input(name, sql.DateTime, value)
  else if (typeof value === 'number') req.input(name, sql.Decimal(18, 6), Number.isFinite(value) ? value : 0)
  else req.input(name, sql.NVarChar(sql.MAX), value === null || value === undefined ? null : String(value))
}

async function fetchOutboundNosForDate(pool, saveDate) {
  const prefix = buildNextStockOutNo({ saveDate, existingOutboundNos: [] }).slice(0, -2)
  const r = await pool.request().input('prefix', sql.NVarChar(50), `${prefix}%`).query(`
    SELECT LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([kcap01], N'')))) AS outboundNo
    FROM ${HEADER_FROM}
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([kcap01], N'')))) LIKE @prefix
  `)
  return (r.recordset ?? []).map((row) => row.outboundNo)
}

export async function suggestStockOutNo(pool, saveDate = new Date()) {
  return buildNextStockOutNo({ saveDate, existingOutboundNos: await fetchOutboundNosForDate(pool, saveDate) })
}

async function resolveWarehouse(pool, warehouseCode) {
  const r = await pool.request().input('code', sql.NVarChar(200), warehouseCode).query(`
    SELECT TOP 1
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([code], N'')))) AS code,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([name], N'')))) AS name
    FROM ${WAREHOUSE_FROM}
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([code], N'')))) = @code
      AND (ISNULL([del], N'') = N'' OR [del] = N'0')
    ORDER BY [id] ASC
  `)
  const row = r.recordset?.[0]
  if (!row?.code) return { ok: false, msg: '仓库不存在或不可用' }
  return { ok: true, code: row.code, name: row.name ?? '' }
}

async function resolveRelatedParty(pool, header) {
  if (header.outboundType === '0') return { ok: true, code: '', name: header.relatedPartyName }
  if (header.outboundType === '9') return { ok: true, code: '', name: '' }
  if (['1', '2', '3'].includes(header.outboundType)) {
    const r = await pool.request().input('code', sql.NVarChar(200), header.relatedPartyCode).query(`
      SELECT TOP 1
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(s.[s_code], N'')))) AS code,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(NULLIF(s.[s_name], N''), s.[name])))) AS name
      FROM ${SUPPLIER_FROM} AS s
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(s.[s_code], N'')))) = @code
        AND (ISNULL(s.[del], N'') = N'' OR s.[del] = N'0')
      ORDER BY s.[id] ASC
    `)
    const row = r.recordset?.[0]
    if (!row?.code) return { ok: false, msg: '供应商/外协客户不存在或不可用' }
    return { ok: true, code: row.code, name: row.name ?? '' }
  }
  if (['4', '5'].includes(header.outboundType)) {
    const r = await pool.request().input('code', sql.NVarChar(200), header.relatedPartyCode).query(`
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
  const r = await pool.request().input('code', sql.NVarChar(200), header.relatedPartyCode).query(`
    SELECT TOP 1
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([khaa01], ISNULL([code], N''))))) AS code,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([khaa02], ISNULL([name], N''))))) AS name
    FROM ${CUSTOMER_FROM}
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([khaa01], ISNULL([code], N''))))) = @code
      AND (ISNULL([del], N'') = N'' OR [del] = N'0')
    ORDER BY [id] ASC
  `)
  const row = r.recordset?.[0]
  if (!row?.code) return { ok: false, msg: '客户不存在或不可用' }
  return { ok: true, code: row.code, name: row.name ?? '' }
}

async function fetchExisting(pool, id) {
  const r = await pool.request().input('id', sql.Int, id).query(`
    SELECT TOP 1
      [id],
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([kcap01], N'')))) AS outboundNo,
      LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL([kcap03], N'')))) AS outboundType,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([systemcode], N'')))) AS systemCode,
      LTRIM(RTRIM(ISNULL([pass], N''))) AS pass,
      LTRIM(RTRIM(ISNULL([del], N''))) AS del,
      LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL([Closed], 0)))) AS closed
    FROM ${HEADER_FROM}
    WHERE [id] = @id
  `)
  return r.recordset?.[0] ?? null
}

async function fetchMaterialSnapshot(pool, materialCode) {
  const r = await pool.request().input('code', sql.NVarChar(200), materialCode).query(`
    SELECT TOP 1 *
    FROM ${BOM_FROM}
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([kcaa01], N'')))) = @code
      AND (ISNULL([del], N'') = N'' OR [del] = N'0')
    ORDER BY [id] DESC
  `)
  return r.recordset?.[0] ?? null
}

function setHeaderValues({ header, warehouse, related, actor, now, ip, outboundNo, systemCode, pass }) {
  return {
    systemcode: systemCode,
    kcap01: outboundNo,
    kcap02: header.outboundDate ? new Date(header.outboundDate) : new Date(),
    kcap03: header.outboundType,
    kcap04: header.sourceOrderNo,
    kcap05: related.code,
    kcap06: warehouse.code,
    ck: warehouse.name,
    kcap07: header.handlerName || actorTruename(actor),
    kcap08: header.paperNo,
    kcap09: header.reserveNo,
    kehu: related.name,
    in_tax: header.inTax,
    remark: header.remark,
    pass,
    del: '0',
    closed: '0',
    uid: actorUid(actor),
    uname: actorUname(actor),
    utruename: actorTruename(actor),
    addtime: now,
    edittime: now,
    ip,
  }
}

async function insertHeader(tx, cols, values) {
  const writable = Object.entries(values).filter(([col]) => has(cols, col))
  const req = new sql.Request(tx)
  for (const [col, value] of writable) addInput(req, col, value)
  await req.query(`
    INSERT INTO ${HEADER_FROM} (${writable.map(([col]) => `[${col}]`).join(', ')})
    VALUES (${writable.map(([col]) => `@${col}`).join(', ')})
  `)
}

async function updateHeader(tx, cols, id, values) {
  const updateValues = { ...values }
  delete updateValues.systemcode
  delete updateValues.kcap01
  delete updateValues.addtime
  delete updateValues.pass
  delete updateValues.del
  delete updateValues.closed
  const writable = Object.entries(updateValues).filter(([col]) => has(cols, col))
  const req = new sql.Request(tx).input('id', sql.Int, id)
  for (const [col, value] of writable) addInput(req, col, value)
  await req.query(`UPDATE ${HEADER_FROM} SET ${writable.map(([col]) => `[${col}]=@${col}`).join(', ')} WHERE [id]=@id`)
}

async function insertLines(tx, { pool, lineCols, outboundNo, sourceOrderNo, outboundType, pass, lines }) {
  for (let i = 0; i < lines.length; i += 1) {
    const normalized = normalizeStockOutLine({ ...lines[i], kcaq01: outboundNo, kcap04: sourceOrderNo }, i + 1, { outboundNo, sourceOrderNo, outboundType })
    const bom = await fetchMaterialSnapshot(pool, normalized.kcaa01)
    if (!bom) throw new Error(`第 ${i + 1} 行物料不存在或已删除`)
    const line = { ...bom, ...normalized, kcaq01: outboundNo, kcap04: sourceOrderNo, pass, del: '0', seq: i + 1, type: outboundType }
    const candidates = {
      kcaq01: line.kcaq01,
      kcap04: line.kcap04,
      kcaq02: line.kcaq02,
      kcaq03: line.kcaq03,
      kcaq04: line.kcaq04,
      kcaq041: line.kcaq041,
      kcaq05: line.kcaq05,
      kcaq051: line.kcaq051,
      tax: line.tax,
      Tax: line.tax,
      reference: line.reference,
      Describe: line.Describe,
      remark: line.remark,
      seq: line.seq,
      del: '0',
      pass,
      type: outboundType,
      systemcode: line.systemcode,
      GUID: line.GUID ?? line.systemcode,
      version: line.version,
      location: line.location,
      sale_price: nullableNumber(line.sale_price),
      cost_price: nullableNumber(line.cost_price),
      Customer_Name: line.Customer_Name,
      kpname: line.kpname,
      content: line.content,
    }
    for (let n = 1; n <= 35; n += 1) {
      const col = `kcaa${String(n).padStart(2, '0')}`
      candidates[col] = line[col]
    }
    const writable = Object.entries(candidates).filter(([col, value]) => value !== undefined && has(lineCols, col))
    const req = new sql.Request(tx)
    for (const [col, value] of writable) addInput(req, col, value)
    await req.query(`
      INSERT INTO ${LINE_FROM} (${writable.map(([col]) => `[${col}]`).join(', ')})
      VALUES (${writable.map(([col]) => `@${col}`).join(', ')})
    `)
  }
}

async function saveStockOut({ pool, body, req: httpReq, actor, id = null }) {
  const header = normalizeStockOutHeader(body?.header ?? {})
  const lines = (body?.lines ?? []).map((line, idx) => normalizeStockOutLine(line, idx + 1, header))
  const valErr = validateStockOutPayload({ header, lines, rawLines: body?.lines ?? [], isEdit: Boolean(id) })
  if (valErr) return { ok: false, status: 400, msg: valErr }

  const existing = id ? await fetchExisting(pool, id) : null
  if (id && !existing) return { ok: false, status: 404, msg: '出库单不存在' }
  if (existing && (existing.pass === '1' || existing.closed === '1')) {
    return { ok: false, status: 400, msg: '此出库单当前状态不允许编辑' }
  }

  const warehouse = await resolveWarehouse(pool, header.warehouseCode)
  if (!warehouse.ok) return { ok: false, status: 400, msg: warehouse.msg }
  const related = await resolveRelatedParty(pool, header)
  if (!related.ok) return { ok: false, status: 400, msg: related.msg }

  const saveDate = new Date()
  const outboundNo = id ? existing.outboundNo : buildNextStockOutNo({ saveDate, existingOutboundNos: await fetchOutboundNosForDate(pool, saveDate) })
  const systemCode = id ? existing.systemCode : buildStockOutSystemCode(actor, saveDate)
  const now = formatSalesOrderAuditTime()
  const ip = getRequestIp(httpReq)
  const pass = '0'
  const [headerCols, lineCols] = await Promise.all([columnSet(pool, STOCK_OUT_HEADER_TABLE), columnSet(pool, STOCK_OUT_LINE_TABLE)])
  const tx = new sql.Transaction(pool)
  await tx.begin()
  try {
    const headerValues = setHeaderValues({ header, warehouse, related, actor, now, ip, outboundNo, systemCode, pass })
    if (id) {
      await updateHeader(tx, headerCols, id, headerValues)
      await new sql.Request(tx).input('outboundNo', sql.NVarChar(200), outboundNo).query(`
        DELETE FROM ${LINE_FROM} WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([kcaq01], N'')))) = @outboundNo
      `)
    } else {
      await insertHeader(tx, headerCols, headerValues)
    }
    await insertLines(tx, { pool, lineCols, outboundNo, sourceOrderNo: header.sourceOrderNo, outboundType: header.outboundType, pass, lines })
    await writeStockOutOperationLog(tx, {
      actName: id ? '修改出库单' : '新增出库单',
      info: buildStockOutLogInfo({ outboundNo, sourceOrderNo: header.sourceOrderNo, actor }),
      actor: { ...actor, ip },
      outboundNo,
      systemCode,
    })
    await tx.commit()
    return { ok: true, id, outboundNo, systemCode, pass }
  } catch (err) {
    try {
      await tx.rollback()
    } catch {}
    throw err
  }
}

export async function createStockOut(opts) {
  return saveStockOut(opts)
}

export async function updateStockOut(opts) {
  return saveStockOut({ ...opts, id: opts.id })
}
