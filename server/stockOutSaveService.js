import { sql } from './db.js'
import { formatSalesOrderAuditTime } from './salesOrderPiBom.js'
import { getRequestIp } from './operationAuditMiddleware.js'
import {
  buildNextStockOutNo,
  buildStockOutSystemCode,
  normalizeStockOutHeader,
  normalizeStockOutLine,
  validateStockOutPayload,
  isLinkedOutboundType,
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
const SALES_CUSTOMER_FROM = 'dbo.[UB_ERP_System_sales_customer]'
const ASSIST_HEADER_FROM = 'dbo.[UB_ERP_assist_order]'
const BUY_HEADER_FROM = 'dbo.[UB_ERP_Buy_order]'

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

/** 出库主表/明细数值列：须显式绑定类型，避免字符串写入 numeric/int 列报错 */
const STOCK_OUT_INT_COLUMNS = new Set([
  'kcap03', 'in_tax', 'closed', 'sign', 'sign1', 'seq', 'type', 'version',
  'kcaa12', 'kcaa13', 'kcaa14', 'customer_supply', 'auto',
])

const STOCK_OUT_DECIMAL_COLUMNS = new Set([
  'kcaq03', 'kcaq04', 'kcaq041', 'kcaq05', 'kcaq051', 'kcaq08',
  'tax', 'kcaa07', 'kcaa08', 'kcaa19', 'kcaa22', 'kcaa23', 'kcaa24',
  'kcaa26', 'kcaa30', 'kcaa32', 'kcaa33', 'sale_price', 'cost_price',
  'exchange_rate', 'akcaq04', 'akcaq041', 'akcaq05', 'akcaq051', 'atax',
])

const STOCK_OUT_NULLABLE_DECIMAL_COLUMNS = new Set([
  'sale_price', 'cost_price', 'kcaa07', 'kcaa08', 'kcaa19', 'kcaa22', 'kcaa23',
  'kcaa24', 'kcaa26', 'kcaa30', 'kcaa32', 'kcaa33', 'exchange_rate',
  'kcaq08', 'akcaq04', 'akcaq041', 'akcaq05', 'akcaq051', 'atax',
])

function coerceDecimal(value, fallback = 0) {
  if (value === '' || value === null || value === undefined) return fallback
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function coerceInt(value, fallback = 0) {
  if (value === '' || value === null || value === undefined) return fallback
  const n = Number(value)
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}

function decimalScale(colKey) {
  if (colKey === 'kcaq05' || colKey === 'kcaq051' || colKey === 'akcaq05' || colKey === 'akcaq051') return 2
  if (colKey === 'tax' || colKey === 'atax') return 2
  if (colKey === 'kcaq03' || colKey === 'kcaq04' || colKey === 'kcaq041' || colKey === 'kcaq08') return 4
  if (colKey === 'akcaq04' || colKey === 'akcaq041') return 4
  return 6
}

export function resolveStockOutSqlInputType(col, value) {
  if (value instanceof Date) return 'datetime'
  const key = String(col).toLowerCase()
  if (STOCK_OUT_INT_COLUMNS.has(key)) return 'int'
  if (STOCK_OUT_DECIMAL_COLUMNS.has(key)) return 'decimal'
  if (typeof value === 'number') return 'decimal'
  return 'nvarchar'
}

function bindStockOutInput(req, col, value) {
  if (value instanceof Date) {
    req.input(col, sql.DateTime, value)
    return
  }
  const key = String(col).toLowerCase()
  if (STOCK_OUT_INT_COLUMNS.has(key)) {
    req.input(col, sql.Int, coerceInt(value))
    return
  }
  if (STOCK_OUT_DECIMAL_COLUMNS.has(key)) {
    const scale = decimalScale(key)
    if (STOCK_OUT_NULLABLE_DECIMAL_COLUMNS.has(key) && (value === '' || value === null || value === undefined)) {
      req.input(col, sql.Decimal(18, scale), null)
      return
    }
    req.input(col, sql.Decimal(18, scale), coerceDecimal(value))
    return
  }
  if (typeof value === 'number') {
    req.input(col, sql.Decimal(18, 6), Number.isFinite(value) ? value : 0)
    return
  }
  req.input(col, sql.NVarChar(sql.MAX), value === null || value === undefined ? null : String(value))
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

/** 明细表混合大小写列名（columnSet 仅存小写，写入须用真名） */
export const LINE_PHYSICAL_COLUMNS = {
  reference: 'Reference',
  tax: 'Tax',
  describe: 'Describe',
}

export function physicalLineColumn(col, lineCols) {
  const lower = String(col).toLowerCase()
  if (!lineCols.has(lower)) return null
  return LINE_PHYSICAL_COLUMNS[lower] ?? col
}

export function buildWritableLineFields(candidates, lineCols) {
  const seen = new Set()
  const writable = []
  for (const [col, value] of Object.entries(candidates)) {
    if (value === undefined) continue
    const physical = physicalLineColumn(col, lineCols)
    if (!physical) continue
    const dedupeKey = physical.toLowerCase()
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    writable.push([physical, value])
  }
  return writable
}

export function resolveBomLineWriteValues(bom, rowIndex = 1) {
  // 业务口径：保存出库明细时，kcaq02/systemcode 统一写 BOM.systemcode；remark 统一抄 BOM.remark
  const systemCode = text(bom?.systemcode)
  if (!systemCode) throw new Error(`第 ${rowIndex} 行物料缺少 systemcode，无法保存`)
  return {
    systemCode,
    remark: text(bom?.remark),
  }
}

/** 出库明细操作员快照：与入库单明细一致，保存时写入当前登录人 */
export function buildStockOutLineAuditFields(actor, now) {
  return {
    uid: actorUid(actor),
    uname: actorUname(actor),
    utruename: actorTruename(actor),
    addtime: now,
  }
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

export async function resolveRelatedParty(pool, header) {
  if (header.outboundType === '0') {
    const code = text(header.relatedPartyCode)
    const name = text(header.relatedPartyName)
    if (!code && !name) return { ok: true, code: '', name: '' }
    // 手填关联单位：仅写 kehu，kcap05 留空
    if (!code) return { ok: true, code: '', name }
    const r = await pool.request().input('code', sql.NVarChar(200), code).query(`
      SELECT TOP 1
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([s_code], N'')))) AS code,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([s_name], N'')))) AS name
      FROM ${SALES_CUSTOMER_FROM}
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([s_code], N'')))) = @code
        AND (ISNULL([del], N'') = N'' OR [del] = N'0')
        AND LTRIM(RTRIM(ISNULL([pass], N''))) = N'1'
      ORDER BY [id] ASC
    `)
    const row = r.recordset?.[0]
    if (row?.code) return { ok: true, code: row.code, name: row.name ?? '' }
    if (name) return { ok: true, code: '', name }
    return { ok: false, msg: '销售客户不存在或不可用' }
  }
  if (header.outboundType === '9') return { ok: true, code: '', name: '' }
  if (['1', '2', '3'].includes(header.outboundType)) {
    const assistFilter = header.outboundType === '2'
      ? `AND LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(s.[s_lb], N'')))) IN (N'外协', N'共用')`
      : ''
    const r = await pool.request().input('code', sql.NVarChar(200), header.relatedPartyCode).query(`
      SELECT TOP 1
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(s.[s_code], N'')))) AS code,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(NULLIF(s.[s_name], N''), s.[name])))) AS name
      FROM ${SUPPLIER_FROM} AS s
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(s.[s_code], N'')))) = @code
        AND (ISNULL(s.[del], N'') = N'' OR s.[del] = N'0')
        AND LTRIM(RTRIM(ISNULL(s.[pass], N''))) = N'1'
        ${assistFilter}
      ORDER BY s.[id] ASC
    `)
    const row = r.recordset?.[0]
    if (!row?.code) return { ok: false, msg: header.outboundType === '2' ? '外协商不存在或不可用' : '供应商/外协客户不存在或不可用' }
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

async function resolveWorkshop(pool, header) {
  if (header.outboundType !== '2' || !header.postProcessAssist) {
    return { ok: true, code: '', name: '' }
  }
  const r = await pool.request().input('code', sql.NVarChar(200), header.workshopCode).query(`
    SELECT TOP 1
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([code], N'')))) AS code,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([name], N'')))) AS name
    FROM ${WORKSHOP_FROM}
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([code], N'')))) = @code
      AND (ISNULL([del], N'') = N'' OR [del] = N'0')
      AND LTRIM(RTRIM(ISNULL([pass], N''))) = N'1'
    ORDER BY [id] ASC
  `)
  const row = r.recordset?.[0]
  if (!row?.code) return { ok: false, msg: '本厂加工车间不存在或不可用' }
  return { ok: true, code: row.code, name: row.name ?? '' }
}

export function buildValidateStockOutSourceOrderSql(outboundType) {
  const t = text(outboundType)
  if (t === '1') {
    return `
      SELECT TOP 1 [id]
      FROM ${BUY_HEADER_FROM} AS h
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcaj01], N'')))) = @sourceNo
        AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcaj05], N'')))) = @partyCode
        AND (ISNULL(h.[del], N'') = N'' OR h.[del] = N'0')
        AND LTRIM(RTRIM(ISNULL(h.[pass], N''))) = N'1'
        AND LTRIM(RTRIM(ISNULL(h.[closed], N'0'))) = N'0'
    `
  }
  if (t === '2' || t === '3') {
    return `
      SELECT TOP 1 [id]
      FROM ${ASSIST_HEADER_FROM} AS h
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[wxaj01], N'')))) = @sourceNo
        AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[wxaj05], N'')))) = @partyCode
        AND (ISNULL(h.[del], N'') = N'' OR h.[del] = N'0')
        AND LTRIM(RTRIM(ISNULL(h.[pass], N''))) = N'1'
        AND LTRIM(RTRIM(ISNULL(h.[closed], N'0'))) = N'0'
    `
  }
  return ''
}

async function validateSourceOrder(pool, header, related) {
  if (!isLinkedOutboundType(header.outboundType) || !header.sourceOrderNo) return { ok: true }
  if (!['1', '2', '3'].includes(header.outboundType)) return { ok: true }
  const sqlText = buildValidateStockOutSourceOrderSql(header.outboundType)
  if (!sqlText) return { ok: true }
  const r = await pool.request()
    .input('sourceNo', sql.NVarChar(200), header.sourceOrderNo)
    .input('partyCode', sql.NVarChar(200), related.code)
    .query(sqlText)
  if (!r.recordset?.[0]) {
    const label = header.outboundType === '1' ? '采购单' : '外协单'
    return { ok: false, msg: `关联${label}不存在、未审核、已结案或外协商不匹配` }
  }
  return { ok: true }
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

function setHeaderValues({ header, warehouse, related, workshop, actor, now, ip, outboundNo, systemCode, pass }) {
  const isAssistIssue = header.outboundType === '2'
  const values = {
    systemcode: systemCode,
    kcap01: outboundNo,
    kcap02: header.outboundDate ? new Date(header.outboundDate) : new Date(),
    kcap03: header.outboundType,
    kcap04: header.sourceOrderNo,
    kcap05: related.code,
    kcap06: warehouse.code,
    ck: warehouse.name,
    kcap07: header.handlerName || actorTruename(actor),
    kcap08: isAssistIssue ? header.piNo : header.paperNo,
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
  if (isAssistIssue) {
    values.cj = header.postProcessAssist ? workshop.code : ''
    values.cjname = header.postProcessAssist ? workshop.name : ''
  }
  return values
}

async function insertHeader(tx, cols, values) {
  const writable = Object.entries(values).filter(([col]) => has(cols, col))
  const req = new sql.Request(tx)
  for (const [col, value] of writable) bindStockOutInput(req, col, value)
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
  for (const [col, value] of writable) bindStockOutInput(req, col, value)
  await req.query(`UPDATE ${HEADER_FROM} SET ${writable.map(([col]) => `[${col}]=@${col}`).join(', ')} WHERE [id]=@id`)
}

async function insertLines(tx, { pool, lineCols, outboundNo, sourceOrderNo, outboundType, pass, lines, actor, now }) {
  for (let i = 0; i < lines.length; i += 1) {
    const normalized = normalizeStockOutLine({ ...lines[i], kcaq01: outboundNo, kcap04: sourceOrderNo }, i + 1, { outboundNo, sourceOrderNo, outboundType })
    const bom = await fetchMaterialSnapshot(pool, normalized.kcaa01)
    if (!bom) throw new Error(`第 ${i + 1} 行物料不存在或已删除`)
    const { systemCode: bomSystemCode, remark: bomRemark } = resolveBomLineWriteValues(bom, i + 1)
    const sourceLineKey = text(normalized.kcaq02)
    const kcaq02Value = isLinkedOutboundType(outboundType) && sourceLineKey ? sourceLineKey : bomSystemCode
    const line = { ...bom, ...normalized, kcaq01: outboundNo, kcap04: sourceOrderNo, pass, del: '0', seq: i + 1, type: outboundType }
    const candidates = {
      kcaq01: line.kcaq01,
      kcap04: line.kcap04,
      kcaq02: kcaq02Value,
      kcaq03: line.kcaq03,
      kcaq04: line.kcaq04,
      kcaq041: line.kcaq041,
      kcaq05: line.kcaq05,
      kcaq051: line.kcaq051,
      tax: line.tax ?? line.Tax,
      reference: text(line.reference ?? line.Reference),
      Describe: line.Describe,
      remark: bomRemark,
      seq: line.seq,
      del: '0',
      pass,
      type: outboundType,
      systemcode: bomSystemCode,
      GUID: line.GUID ?? bomSystemCode,
      version: line.version,
      location: line.location,
      sale_price: nullableNumber(line.sale_price),
      cost_price: nullableNumber(line.cost_price),
      Customer_Name: line.Customer_Name,
      kpname: line.kpname,
      kcaa02_en: text(line.kcaa02_en),
      content: line.content,
      ...buildStockOutLineAuditFields(actor, now),
    }
    for (let n = 1; n <= 35; n += 1) {
      const col = `kcaa${String(n).padStart(2, '0')}`
      candidates[col] = line[col]
    }
    const writable = buildWritableLineFields(candidates, lineCols)
    const req = new sql.Request(tx)
    for (const [col, value] of writable) bindStockOutInput(req, col, value)
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
  const workshop = await resolveWorkshop(pool, header)
  if (!workshop.ok) return { ok: false, status: 400, msg: workshop.msg }
  const source = await validateSourceOrder(pool, header, related)
  if (!source.ok) return { ok: false, status: 400, msg: source.msg }

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
    const headerValues = setHeaderValues({ header, warehouse, related, workshop, actor, now, ip, outboundNo, systemCode, pass })
    if (id) {
      await updateHeader(tx, headerCols, id, headerValues)
      await new sql.Request(tx).input('outboundNo', sql.NVarChar(200), outboundNo).query(`
        DELETE FROM ${LINE_FROM} WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([kcaq01], N'')))) = @outboundNo
      `)
    } else {
      await insertHeader(tx, headerCols, headerValues)
    }
    await insertLines(tx, {
      pool,
      lineCols,
      outboundNo,
      sourceOrderNo: header.sourceOrderNo,
      outboundType: header.outboundType,
      pass,
      lines,
      actor,
      now,
    })
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
