import { sql } from './db.js'
import { formatSalesOrderAuditTime } from './salesOrderPiBom.js'
import { getRequestIp } from './operationAuditMiddleware.js'
import {
  buildNextStockInNo,
  buildStockInSystemCode,
  isLinkedInboundType,
  normalizeStockInHeader,
  normalizeStockInLine,
  validateStockInPayload,
} from './stockInSaveLogic.js'
import { STOCK_IN_HEADER_TABLE, STOCK_IN_LINE_TABLE } from './stockInListQuery.js'
import { buildStockInLogInfo, writeStockInOperationLog } from './stockInOperationLog.js'

const HEADER_FROM = `dbo.[${STOCK_IN_HEADER_TABLE}]`
const LINE_FROM = `dbo.[${STOCK_IN_LINE_TABLE}]`
const WAREHOUSE_FROM = 'dbo.[UB_ERP_Stocks_Warehouse]'
const BOM_FROM = 'dbo.[UB_ERP_Bom_000]'
const SUPPLIER_FROM = 'dbo.[System_supplier]'
const WORKSHOP_FROM = 'dbo.[UB_ERP_Stocks_workshop]'
const CUSTOMER_FROM = 'dbo.[UB_ERP_Customer]'
const PURCHASE_HEADER_FROM = 'dbo.[UB_ERP_Buy_order]'
const PURCHASE_LINE_FROM = 'dbo.[UB_ERP_Buy_order_list]'
const ASSIST_HEADER_FROM = 'dbo.[UB_ERP_assist_order]'
const ASSIST_LINE_FROM = 'dbo.[UB_ERP_assist_order_list]'
const DISPATCH_HEADER_FROM = 'dbo.[UB_ERP_Dispatch_order]'
const DISPATCH_LINE_FROM = 'dbo.[UB_ERP_Dispatch_order_list]'
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

function datePrefix(saveDate) {
  return buildNextStockInNo({ saveDate, existingReceiptNos: [] }).slice(0, -2)
}

async function fetchReceiptNosForDate(pool, saveDate) {
  const prefix = datePrefix(saveDate)
  const r = await pool.request().input('prefix', sql.NVarChar(50), `${prefix}%`).query(`
    SELECT LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([kcan01], N'')))) AS receiptNo
    FROM ${HEADER_FROM}
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([kcan01], N'')))) LIKE @prefix
  `)
  return (r.recordset ?? []).map((row) => row.receiptNo)
}

export async function suggestStockInNo(pool, saveDate = new Date()) {
  const existingReceiptNos = await fetchReceiptNosForDate(pool, saveDate)
  return buildNextStockInNo({ saveDate, existingReceiptNos })
}

async function resolveFinalReceiptNo(pool, saveDate) {
  return buildNextStockInNo({ saveDate, existingReceiptNos: await fetchReceiptNosForDate(pool, saveDate) })
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
  if (header.inboundType === '0' || header.inboundType === '7') {
    return { ok: true, code: '', name: header.relatedPartyName }
  }
  if (['1', '2', '3'].includes(header.inboundType)) {
    const r = await pool.request().input('code', sql.NVarChar(200), header.relatedPartyCode).query(`
      SELECT TOP 1
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(s.[s_code], N'')))) AS code,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(NULLIF(s.[s_name], N''), s.[name])))) AS name
      FROM ${SUPPLIER_FROM} AS s
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(s.[s_code], N'')))) = @code
        AND ${activeWhere('s')}
      ORDER BY s.[id] ASC
    `)
    const row = r.recordset?.[0]
    if (!row?.code) return { ok: false, msg: '供应商/外协客户不存在或不可用' }
    return { ok: true, code: row.code, name: row.name ?? '' }
  }
  if (['4', '5'].includes(header.inboundType)) {
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

async function fetchExistingReceipt(pool, id) {
  const r = await pool.request().input('id', sql.Int, id).query(`
    SELECT TOP 1
      [id],
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([kcan01], N'')))) AS receiptNo,
      LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL([kcan03], N'')))) AS inboundType,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([systemcode], N'')))) AS systemCode,
      LTRIM(RTRIM(ISNULL([pass], N''))) AS pass,
      LTRIM(RTRIM(ISNULL([del], N''))) AS del,
      LTRIM(RTRIM(ISNULL([sp_flag], N''))) AS spFlag,
      LTRIM(RTRIM(ISNULL([closed], N''))) AS closed
    FROM ${HEADER_FROM}
    WHERE [id] = @id
  `)
  return r.recordset?.[0] ?? null
}

function sourceTable(type) {
  if (type === '1') return { header: PURCHASE_HEADER_FROM, line: PURCHASE_LINE_FROM, noCol: 'cgad01', partyCol: 'cgad05', lineOrderCol: 'cgae01', qtyCol: 'cgae03', priceCol: 'cgae04' }
  if (type === '2' || type === '3') return { header: ASSIST_HEADER_FROM, line: ASSIST_LINE_FROM, noCol: 'wxaj01', partyCol: 'wxaj05', lineOrderCol: 'wxak01', qtyCol: 'wxak03', priceCol: 'wxak04' }
  if (type === '4' || type === '5') return { header: DISPATCH_HEADER_FROM, line: DISPATCH_LINE_FROM, noCol: 'scaj01', partyCol: 'scaj05', lineOrderCol: 'scak01', qtyCol: 'scak03', priceCol: 'cost_price' }
  if (type === '6') return { header: SALES_HEADER_FROM, line: SALES_LINE_FROM, noCol: 'xsaj01', partyCol: 'xsaj04', lineOrderCol: 'xsak01', qtyCol: 'xsak03', priceCol: 'sale_price' }
  return null
}

async function validateSourceOrder(pool, header, related) {
  if (!isLinkedInboundType(header.inboundType, header.sourceOrderNo)) return { ok: true }
  const meta = sourceTable(header.inboundType)
  if (!meta) return { ok: true }
  const r = await pool.request()
    .input('sourceNo', sql.NVarChar(200), header.sourceOrderNo)
    .input('partyCode', sql.NVarChar(200), related.code)
    .query(`
      SELECT TOP 1 [id]
      FROM ${meta.header} AS h
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[${meta.noCol}], N'')))) = @sourceNo
        AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[${meta.partyCol}], N'')))) = @partyCode
        AND ${activeWhere('h')}
        AND ${auditedWhere('h')}
        AND LTRIM(RTRIM(ISNULL(h.[closed], N'0'))) = N'0'
    `)
  if (!r.recordset?.[0]) return { ok: false, msg: '关联单据不存在、未审核、已结案或关联方不匹配' }
  return { ok: true }
}

async function getAutoApprove(pool, actor) {
  const usercode = text(actor?.uname ?? actor?.auditUserName ?? actor?.userCode ?? actor?.userName)
  if (!usercode) return false
  try {
    const r = await pool.request().input('usercode', sql.NVarChar(200), usercode).query(`
      SELECT TOP 1 LTRIM(RTRIM(CONVERT(nvarchar(20), ISNULL([ub_Stocks_Storage_sp], N'')))) AS autoApprove
      FROM dbo.[UB_ERP_User]
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([usercode], ISNULL([username], N''))))) = @usercode
    `)
    return text(r.recordset?.[0]?.autoApprove) === '1'
  } catch {
    return false
  }
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

async function insertLines(tx, { pool, receiptNo, sourceOrderNo, pass, lines, actor, ip }) {
  for (let i = 0; i < lines.length; i += 1) {
    const normalized = normalizeStockInLine({ ...lines[i], kcao01: receiptNo, kcan04: sourceOrderNo }, i + 1, { receiptNo, sourceOrderNo })
    const bom = await fetchMaterialSnapshot(pool, normalized.kcaa01)
    const line = { ...normalized, ...(bom ?? {}), ...normalized }
    const req = new sql.Request(tx)
    req.input('kcao01', sql.NVarChar(200), receiptNo)
    req.input('kcao02', sql.NVarChar(200), line.kcao02)
    req.input('kcan04', sql.NVarChar(200), sourceOrderNo)
    req.input('kcao03', sql.Decimal(18, 4), line.kcao03)
    req.input('kcao031', sql.Decimal(18, 4), line.kcao031)
    req.input('kcao04', sql.Decimal(18, 4), line.kcao04)
    req.input('kcao041', sql.Decimal(18, 4), line.kcao041)
    req.input('kcao05', sql.Decimal(18, 2), line.kcao05)
    req.input('kcao051', sql.Decimal(18, 2), line.kcao051)
    req.input('tax', sql.Decimal(18, 6), line.tax)
    req.input('reference', sql.NVarChar(500), text(line.reference))
    req.input('Describe', sql.NVarChar(sql.MAX), text(line.Describe))
    req.input('kcaa01', sql.NVarChar(200), text(line.kcaa01))
    req.input('kcaa02', sql.NVarChar(500), text(line.kcaa02))
    req.input('kcaa02_en', sql.NVarChar(500), text(line.kcaa02_en))
    req.input('kpname', sql.NVarChar(500), text(line.kpname))
    req.input('kcaa03', sql.NVarChar(500), text(line.kcaa03))
    req.input('kcaa04', sql.NVarChar(100), text(line.kcaa04))
    req.input('kcaa11', sql.NVarChar(200), text(line.kcaa11))
    req.input('kcaa05', sql.NVarChar(200), text(line.kcaa05))
    req.input('kcaa06', sql.NVarChar(200), text(line.kcaa06))
    req.input('kcaa09', sql.NVarChar(200), text(line.kcaa09))
    req.input('kcaa10', sql.NVarChar(200), text(line.kcaa10))
    req.input('kcaa26', sql.NVarChar(200), text(line.kcaa26))
    req.input('kcaa27', sql.NVarChar(200), text(line.kcaa27))
    req.input('location', sql.NVarChar(500), text(line.location))
    req.input('version', sql.NVarChar(200), text(line.version))
    req.input('sale_price', sql.Decimal(18, 4), Number(line.sale_price ?? 0) || 0)
    req.input('cost_price', sql.Decimal(18, 4), Number(line.cost_price ?? 0) || 0)
    req.input('Customer_supply', sql.NVarChar(50), text(line.Customer_supply))
    req.input('Customer_Name', sql.NVarChar(500), text(line.Customer_Name))
    req.input('seq', sql.Int, i + 1)
    req.input('systemcode', sql.NVarChar(200), text(line.systemcode))
    req.input('pass', sql.NVarChar(20), pass)
    await req.query(`
      INSERT INTO ${LINE_FROM} (
        [kcao01], [kcao02], [kcan04], [kcao03], [kcao031], [kcao04], [kcao041], [kcao05], [kcao051], [tax],
        [reference], [Describe], [kcaa01], [kcaa02], [kcaa02_en], [kpname], [kcaa03], [kcaa04], [kcaa05],
        [kcaa06], [kcaa09], [kcaa10], [kcaa11], [kcaa26], [kcaa27], [location], [version], [sale_price],
        [cost_price], [Customer_supply], [Customer_Name], [seq], [systemcode], [type], [pass], [del]
      )
      VALUES (
        @kcao01, @kcao02, @kcan04, @kcao03, @kcao031, @kcao04, @kcao041, @kcao05, @kcao051, @tax,
        @reference, @Describe, @kcaa01, @kcaa02, @kcaa02_en, @kpname, @kcaa03, @kcaa04, @kcaa05,
        @kcaa06, @kcaa09, @kcaa10, @kcaa11, @kcaa26, @kcaa27, @location, @version, @sale_price,
        @cost_price, @Customer_supply, @Customer_Name, @seq, @systemcode, N'1', @pass, N'0'
      )
    `)
  }
}

async function saveStockIn({ pool, body, req: httpReq, actor, id = null }) {
  const header = normalizeStockInHeader(body?.header ?? {})
  const lines = (body?.lines ?? []).map((line, idx) => normalizeStockInLine(line, idx + 1, header))
  const valErr = validateStockInPayload({ header, lines })
  if (valErr) return { ok: false, status: 400, msg: valErr }

  const existing = id ? await fetchExistingReceipt(pool, id) : null
  if (id && !existing) return { ok: false, status: 404, msg: '入库单不存在' }
  if (existing && (existing.pass === '1' || existing.spFlag === '1' || existing.closed === '1' || existing.inboundType === '8')) {
    return { ok: false, status: 400, msg: '此入库单当前状态不允许编辑' }
  }

  const warehouse = await resolveWarehouse(pool, header.warehouseCode)
  if (!warehouse.ok) return { ok: false, status: 400, msg: warehouse.msg }
  const related = await resolveRelatedParty(pool, header)
  if (!related.ok) return { ok: false, status: 400, msg: related.msg }
  const source = await validateSourceOrder(pool, header, related)
  if (!source.ok) return { ok: false, status: 400, msg: source.msg }

  const autoApprove = !id && (await getAutoApprove(pool, actor))
  const pass = autoApprove ? '1' : '0'
  const saveDate = new Date()
  const receiptNo = id ? existing.receiptNo : await resolveFinalReceiptNo(pool, saveDate)
  const systemCode = id ? existing.systemCode : buildStockInSystemCode(actor, saveDate)
  const now = formatSalesOrderAuditTime()
  const ip = getRequestIp(httpReq)
  const tx = new sql.Transaction(pool)
  await tx.begin()
  try {
    const hreq = new sql.Request(tx)
    hreq.input('id', sql.Int, id ?? 0)
    hreq.input('systemcode', sql.NVarChar(500), systemCode)
    hreq.input('kcan01', sql.NVarChar(200), receiptNo)
    hreq.input('kcan02', sql.DateTime, header.inboundDate ? new Date(header.inboundDate) : new Date())
    hreq.input('kcan03', sql.NVarChar(20), header.inboundType)
    hreq.input('kcan04', sql.NVarChar(200), header.sourceOrderNo)
    hreq.input('kcan05', sql.NVarChar(200), related.code)
    hreq.input('kcan06', sql.NVarChar(200), warehouse.code)
    hreq.input('ck', sql.NVarChar(500), warehouse.name)
    hreq.input('kcan07', sql.NVarChar(200), text(actor?.utruename ?? actor?.auditTruename ?? actor?.truename ?? actor?.userName))
    hreq.input('kcan08', sql.NVarChar(200), header.paperNo)
    hreq.input('kehu', sql.NVarChar(500), related.name)
    hreq.input('in_tax', sql.NVarChar(20), header.inTax)
    hreq.input('remark', sql.NVarChar(sql.MAX), header.remark)
    hreq.input('pass', sql.NVarChar(20), pass)
    hreq.input('uid', sql.NVarChar(50), actorUid(actor))
    hreq.input('uname', sql.NVarChar(200), text(actor?.uname ?? actor?.auditUserName ?? actor?.userName))
    hreq.input('utruename', sql.NVarChar(200), text(actor?.utruename ?? actor?.auditTruename ?? actor?.truename ?? actor?.userName))
    hreq.input('now', sql.NVarChar(30), now)
    hreq.input('ip', sql.NVarChar(50), ip)
    if (id) {
      await hreq.query(`
        UPDATE ${HEADER_FROM}
        SET [kcan02]=@kcan02, [kcan03]=@kcan03, [kcan04]=@kcan04, [kcan05]=@kcan05, [kcan06]=@kcan06,
            [ck]=@ck, [kcan07]=@kcan07, [kcan08]=@kcan08, [kehu]=@kehu, [in_tax]=@in_tax, [remark]=@remark,
            [uid]=@uid, [uname]=@uname, [utruename]=@utruename, [edittime]=@now, [ip]=@ip
        WHERE [id]=@id
      `)
      await new sql.Request(tx).input('receiptNo', sql.NVarChar(200), receiptNo).query(`
        DELETE FROM ${LINE_FROM} WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([kcao01], N'')))) = @receiptNo
      `)
    } else {
      await hreq.query(`
        INSERT INTO ${HEADER_FROM} (
          [systemcode], [kcan01], [kcan02], [kcan03], [kcan04], [kcan05], [kcan06], [ck], [kcan07],
          [kcan08], [kehu], [in_tax], [remark], [pass], [sp_flag], [del], [closed],
          [uid], [uname], [utruename], [addtime], [ip], [passuid], [passuname], [shtime]
        )
        VALUES (
          @systemcode, @kcan01, @kcan02, @kcan03, @kcan04, @kcan05, @kcan06, @ck, @kcan07,
          @kcan08, @kehu, @in_tax, @remark, @pass, N'0', N'0', N'0',
          @uid, @uname, @utruename, @now, @ip,
          CASE WHEN @pass=N'1' THEN @uid ELSE NULL END,
          CASE WHEN @pass=N'1' THEN @uname ELSE NULL END,
          CASE WHEN @pass=N'1' THEN @now ELSE NULL END
        )
      `)
    }
    await insertLines(tx, { pool, receiptNo, sourceOrderNo: header.sourceOrderNo, pass, lines, actor, ip })
    await writeStockInOperationLog(tx, {
      actName: id ? '修改入库单' : autoApprove ? '新增入库单并自动审核' : '新增入库单',
      info: buildStockInLogInfo({ receiptNo, sourceOrderNo: header.sourceOrderNo, actor }),
      actor: { ...actor, ip },
      receiptNo,
      systemCode,
    })
    await tx.commit()
    return { ok: true, id, receiptNo, systemCode, autoApproved: autoApprove, pass }
  } catch (err) {
    try {
      await tx.rollback()
    } catch {}
    throw err
  }
}

export async function createStockIn(opts) {
  return saveStockIn(opts)
}

export async function updateStockIn(opts) {
  return saveStockIn({ ...opts, id: opts.id })
}

export async function fetchStockInInventorySummary(pool, query = {}) {
  const materialCode = text(query.materialCode)
  const warehouseCode = text(query.warehouseCode)
  const req = pool.request()
  let where = `WHERE LTRIM(RTRIM(ISNULL(h.[pass], N''))) = N'1' AND (ISNULL(h.[del], N'') = N'' OR h.[del] = N'0')`
  if (materialCode) {
    req.input('materialCode', sql.NVarChar(200), materialCode)
    where += ` AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) = @materialCode`
  }
  if (warehouseCode) {
    req.input('warehouseCode', sql.NVarChar(200), warehouseCode)
    where += ` AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan06], N'')))) = @warehouseCode`
  }
  const r = await req.query(`
    SELECT
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) AS materialCode,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan06], N'')))) AS warehouseCode,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa11], N'')))) AS color,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[version], N'')))) AS version,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[location], N'')))) AS location,
      SUM(ISNULL(l.[kcao03], 0)) AS inboundQty
    FROM ${LINE_FROM} AS l
    INNER JOIN ${HEADER_FROM} AS h
      ON LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan01], N'')))) = LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcao01], N''))))
    ${where}
    GROUP BY
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))),
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcan06], N'')))),
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa11], N'')))),
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[version], N'')))),
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[location], N''))))
    ORDER BY materialCode, warehouseCode
  `)
  return r.recordset ?? []
}

