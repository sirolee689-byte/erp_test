import { sql } from './db.js'
import { INV_BOM_MASTER_FROM } from './bomTables.js'
import { calculateBuyOrderAmount } from './buyOrderSaveLogic.js'
import { formatSalesOrderAuditTime } from './salesOrderPiBom.js'

const LINE_FROM = 'dbo.[UB_ERP_Buy_order_list]'

export const BUY_LINE_KCAA_FIELDS = Array.from({ length: 35 }, (_, i) => `kcaa${String(i + 1).padStart(2, '0')}`)

const DECIMAL_KCAA = new Set(['kcaa07', 'kcaa08', 'kcaa19', 'kcaa22', 'kcaa23', 'kcaa24', 'kcaa26', 'kcaa30', 'kcaa32', 'kcaa33'])
const INT_KCAA = new Set(['kcaa12', 'kcaa13', 'kcaa14'])

function text(v) {
  return String(v ?? '').trim()
}

function nullableText(v) {
  const s = text(v)
  return s || null
}

function nullableNumber(v) {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function nullableDate(v) {
  const s = text(v)
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

function readKcaa(row, col) {
  if (INT_KCAA.has(col)) return nullableNumber(row?.[col])
  if (DECIMAL_KCAA.has(col)) return nullableNumber(row?.[col])
  return text(row?.[col])
}

export function normalizeBuyOrderLine(line, index = 0, header = {}) {
  const qty = nullableNumber(line?.quantity ?? line?.kcak03)
  const taxIncludedPrice = nullableNumber(line?.taxIncludedPrice ?? line?.kcak041)
  const tax = nullableNumber(line?.tax)
  const calc = calculateBuyOrderAmount({
    quantity: qty,
    taxIncludedPrice,
    tax,
    decimalPlaces: header.decimalPlaces ?? 4,
    taxIncludedMode: header.taxIncluded ?? '1',
  })
  const normalized = {
    seq: Number.isFinite(Number(line?.seq)) ? Number(line.seq) : index + 1,
    bomSystemCode: text(line?.bomSystemCode ?? line?.kcak02 ?? line?.systemcode),
    systemCode: text(line?.systemCode ?? line?.kcak02 ?? line?.systemcode),
    quantity: qty,
    taxExcludedPrice: nullableNumber(line?.taxExcludedPrice ?? line?.kcak04) ?? calc.taxExcludedPrice,
    taxIncludedPrice: taxIncludedPrice ?? calc.taxIncludedPrice,
    taxExcludedAmount: nullableNumber(line?.taxExcludedAmount ?? line?.kcak05) ?? calc.taxExcludedAmount,
    taxIncludedAmount: nullableNumber(line?.taxIncludedAmount ?? line?.kcak051) ?? calc.taxIncludedAmount,
    tax: header.taxIncluded === '2' ? 0 : (tax ?? calc.tax),
    deliveryDate: nullableDate(line?.deliveryDate ?? line?.delivery_date),
    referenceNo: text(line?.referenceNo ?? line?.Reference),
    describe: text(line?.describe ?? line?.Describe),
    orderNo: text(line?.orderNo ?? line?.OrderNo),
    info: text(line?.info),
    gkcaa02: text(line?.gkcaa02),
    kcak06: text(line?.kcak06),
    kcak07: text(line?.kcak07),
    version: nullableNumber(line?.version) ?? 100,
    location: text(line?.location),
    salePrice: nullableNumber(line?.salePrice ?? line?.sale_price),
    costPrice: nullableNumber(line?.costPrice ?? line?.cost_price),
    kcaa02En: text(line?.kcaa02En ?? line?.kcaa02_en),
    kpname: text(line?.kpname),
    customerName: text(line?.Customer_Name ?? line?.customerName),
    remark: text(line?.remark),
    content: text(line?.content),
  }
  for (const col of BUY_LINE_KCAA_FIELDS) normalized[col] = readKcaa(line, col)
  return normalized
}

export function normalizeBuyOrderLines(lines, header = {}) {
  return (Array.isArray(lines) ? lines : [])
    .map((line, index) => normalizeBuyOrderLine(line, index, header))
    .filter((line) => line.bomSystemCode || line.kcaa01 || line.kcaa02)
}

async function fetchBomSnapshot(db, line) {
  const req = new sql.Request(db)
  const code = text(line.bomSystemCode)
  const materialCode = text(line.kcaa01)
  if (code) req.input('systemcode', sql.NVarChar(500), code)
  if (materialCode) req.input('kcaa01', sql.NVarChar(300), materialCode)
  const where = code
    ? `LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.[systemcode], ISNULL(b.[GUID], N''))))) = @systemcode`
    : `LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.[kcaa01], N'')))) = @kcaa01`
  const r = await req.query(`
    SELECT TOP 1 *
    FROM ${INV_BOM_MASTER_FROM} AS b
    WHERE ${where}
      AND (ISNULL(b.[del], N'') = N'' OR b.[del] = N'0')
    ORDER BY b.[id] DESC
  `)
  return r.recordset?.[0] ?? null
}

function mergeSnapshot(line, bom) {
  if (!bom) return line
  const out = { ...line }
  for (const col of BUY_LINE_KCAA_FIELDS) {
    if (bom[col] !== undefined && bom[col] !== null && text(bom[col]) !== '') out[col] = bom[col]
  }
  out.bomSystemCode = text(bom.systemcode ?? bom.GUID ?? line.bomSystemCode)
  out.systemCode = out.bomSystemCode
  out.kcaa02En = text(bom.kcaa02_en ?? out.kcaa02En)
  out.kpname = text(bom.kpname ?? out.kpname)
  out.location = text(bom.location ?? out.location)
  out.salePrice = nullableNumber(bom.sale_price ?? out.salePrice)
  out.costPrice = nullableNumber(bom.cost_price ?? out.costPrice)
  out.customerName = text(bom.Customer_Name ?? out.customerName)
  out.remark = text(bom.remark ?? out.remark)
  out.content = text(bom.content ?? out.content)
  return out
}

function bindKcaa(req, line) {
  for (const col of BUY_LINE_KCAA_FIELDS) {
    if (INT_KCAA.has(col)) req.input(col, sql.Int, nullableNumber(line[col]))
    else if (DECIMAL_KCAA.has(col)) req.input(col, sql.Decimal(18, 6), nullableNumber(line[col]))
    else req.input(col, sql.NVarChar(col === 'kcaa01' ? 300 : 500), nullableText(line[col]))
  }
}

export async function rewriteBuyOrderLines({ buyOrderNo, systemcodeId, lines, header, tx, hasPricePermission = true, actor = null }) {
  const orderNo = text(buyOrderNo)
  const normalized = normalizeBuyOrderLines(lines, header)
  const auditActor = actor ?? { uidInt: null, uname: null, utruename: null }
  const addtime = formatSalesOrderAuditTime()
  await new sql.Request(tx).input('kcak01', sql.NVarChar(200), orderNo).query(`
    DELETE FROM ${LINE_FROM}
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([kcak01], N'')))) = @kcak01
  `)
  if (!normalized.length) throw new Error('采购明细不能为空')

  for (const rawLine of normalized) {
    if (!(Number(rawLine.quantity) > 0)) throw new Error('采购明细数量必须大于0')
    const snapshot = await fetchBomSnapshot(tx, rawLine)
    const line = mergeSnapshot(rawLine, snapshot)
    if (!line.bomSystemCode) throw new Error(`物料 ${line.kcaa01 || line.kcaa02 || ''} 缺少BOM系统码`)
    const req = new sql.Request(tx)
    req.input('kcak01', sql.NVarChar(200), orderNo)
    req.input('kcak02', sql.NVarChar(500), line.bomSystemCode)
    req.input('systemcode', sql.NVarChar(500), line.bomSystemCode)
    req.input('systemcode_id', sql.NVarChar(500), systemcodeId)
    req.input('kcak03', sql.Decimal(18, 6), line.quantity)
    req.input('kcak04', sql.Decimal(18, 6), hasPricePermission ? line.taxExcludedPrice : null)
    req.input('kcak041', sql.Decimal(18, 6), hasPricePermission ? line.taxIncludedPrice : null)
    req.input('kcak05', sql.Decimal(18, 2), hasPricePermission ? line.taxExcludedAmount : null)
    req.input('kcak051', sql.Decimal(18, 2), hasPricePermission ? line.taxIncludedAmount : null)
    req.input('tax', sql.Decimal(18, 6), hasPricePermission ? line.tax : null)
    req.input('delivery_date', sql.DateTime, line.deliveryDate)
    req.input('Reference', sql.NVarChar(200), nullableText(line.referenceNo))
    req.input('Describe', sql.NVarChar(1000), nullableText(line.describe))
    req.input('OrderNo', sql.NVarChar(200), nullableText(line.orderNo))
    req.input('info', sql.NVarChar(1000), nullableText(line.info))
    req.input('gkcaa02', sql.NVarChar(500), nullableText(line.gkcaa02))
    req.input('seq', sql.Int, line.seq)
    req.input('kcak06', sql.NVarChar(500), nullableText(line.kcak06))
    req.input('kcak07', sql.NVarChar(500), nullableText(line.kcak07))
    req.input('version', sql.Int, line.version)
    req.input('location', sql.NVarChar(500), nullableText(line.location))
    req.input('sale_price', sql.Decimal(18, 6), line.salePrice)
    req.input('cost_price', sql.Decimal(18, 6), line.costPrice)
    req.input('kcaa02_en', sql.NVarChar(500), nullableText(line.kcaa02En))
    req.input('kpname', sql.NVarChar(500), nullableText(line.kpname))
    req.input('Customer_Name', sql.NVarChar(500), nullableText(line.customerName))
    req.input('remark', sql.NVarChar(sql.MAX), nullableText(line.remark))
    req.input('content', sql.NVarChar(sql.MAX), nullableText(line.content))
    req.input('uid', sql.NVarChar(50), auditActor.uidInt != null ? String(auditActor.uidInt) : '')
    req.input('uname', sql.NVarChar(200), text(auditActor.uname))
    req.input('utruename', sql.NVarChar(200), text(auditActor.utruename))
    req.input('addtime', sql.NVarChar(50), addtime)
    bindKcaa(req, line)
    await req.query(`
      INSERT INTO ${LINE_FROM} (
        [kcak01], [kcak02], [systemcode], [systemcode_id],
        [kcak03], [kcak04], [kcak041], [kcak05], [kcak051], [tax],
        [delivery_date], [Reference], [Describe], [OrderNo], [info], [gkcaa02],
        [kcaa01], [kcaa02], [kcaa02_en], [kpname], [kcaa03], [kcaa04], [kcaa05], [kcaa06], [kcaa07], [kcaa08], [kcaa09], [kcaa10], [kcaa11],
        [kcaa12], [kcaa13], [kcaa14], [kcaa15], [kcaa16], [kcaa17], [kcaa18], [kcaa19], [kcaa20],
        [kcaa21], [kcaa22], [kcaa23], [kcaa24], [kcaa25], [kcaa26], [kcaa27], [kcaa28], [kcaa29], [kcaa30],
        [kcaa31], [kcaa32], [kcaa33], [kcaa34], [kcaa35],
        [seq], [kcak06], [kcak07], [pass], [del], [type], [version], [location], [sale_price], [cost_price],
        [Customer_Name], [uid], [uname], [utruename], [addtime], [remark], [content]
      )
      VALUES (
        @kcak01, @kcak02, @systemcode, @systemcode_id,
        @kcak03, @kcak04, @kcak041, @kcak05, @kcak051, @tax,
        @delivery_date, @Reference, @Describe, @OrderNo, @info, @gkcaa02,
        @kcaa01, @kcaa02, @kcaa02_en, @kpname, @kcaa03, @kcaa04, @kcaa05, @kcaa06, @kcaa07, @kcaa08, @kcaa09, @kcaa10, @kcaa11,
        @kcaa12, @kcaa13, @kcaa14, @kcaa15, @kcaa16, @kcaa17, @kcaa18, @kcaa19, @kcaa20,
        @kcaa21, @kcaa22, @kcaa23, @kcaa24, @kcaa25, @kcaa26, @kcaa27, @kcaa28, @kcaa29, @kcaa30,
        @kcaa31, @kcaa32, @kcaa33, @kcaa34, @kcaa35,
        @seq, @kcak06, @kcak07, N'1', N'0', N'1', @version, @location, @sale_price, @cost_price,
        @Customer_Name, @uid, @uname, @utruename, @addtime, @remark, @content
      )
    `)
  }
  return { count: normalized.length }
}
