import { sql } from './db.js'

const LINE_FROM = 'dbo.[UB_ERP_assist_order_list]'

function text(value) {
  return String(value ?? '').trim()
}

function nullableText(value) {
  const s = text(value)
  return s || null
}

function nullableNumber(value) {
  if (value === '' || value === null || value === undefined) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function nullableDate(value) {
  const s = text(value)
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

export function normalizeAssistOrderLine(line, index = 0) {
  return {
    seq: Number.isFinite(Number(line?.seq)) ? Number(line.seq) : index + 1,
    piNo: text(line?.piNo ?? line?.pi),
    product: text(line?.product ?? line?.Product),
    kcaa01: text(line?.kcaa01),
    kcaa02: text(line?.kcaa02),
    kcaa02En: text(line?.kcaa02En ?? line?.kcaa02_en),
    invoiceName: text(line?.invoiceName ?? line?.kpname),
    kcaa03: text(line?.kcaa03),
    kcaa04: text(line?.kcaa04),
    kcaa05: text(line?.kcaa05),
    kcaa06: text(line?.kcaa06),
    kcaa07: text(line?.kcaa07),
    kcaa08: text(line?.kcaa08),
    kcaa09: text(line?.kcaa09),
    kcaa10: text(line?.kcaa10),
    kcaa11: text(line?.kcaa11),
    wxak03: nullableNumber(line?.wxak03),
    wxak04: nullableNumber(line?.wxak04),
    wxak041: nullableNumber(line?.wxak041),
    wxak05: nullableNumber(line?.wxak05),
    wxak051: nullableNumber(line?.wxak051),
    tax: nullableNumber(line?.tax),
    deliveryDate: nullableDate(line?.deliveryDate ?? line?.delivery_date),
    referenceNo: text(line?.referenceNo ?? line?.reference),
    remark: text(line?.remark ?? line?.wxak06),
    version: nullableNumber(line?.version),
    customerSupply: nullableNumber(line?.customerSupply ?? line?.Customer_supply),
  }
}

export function normalizeAssistOrderLines(lines) {
  return (Array.isArray(lines) ? lines : [])
    .map((line, index) => normalizeAssistOrderLine(line, index))
    .filter((line) => line.kcaa01 || line.kcaa02)
}

export async function rewriteAssistOrderLines({ assistOrderNo, lines, tx = null, requestFactory }) {
  const orderNo = text(assistOrderNo)
  const normalized = normalizeAssistOrderLines(lines)
  const makeRequest = requestFactory ?? (() => new sql.Request(tx))

  const deleteReq = makeRequest()
  deleteReq.input('wxak01', sql.NVarChar(200), orderNo)
  await deleteReq.query(`
    DELETE FROM ${LINE_FROM}
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([wxak01], N'')))) = @wxak01
  `)

  for (const line of normalized) {
    const req = makeRequest()
    req.input('wxak01', sql.NVarChar(200), orderNo)
    req.input('seq', sql.Int, line.seq)
    req.input('pi', sql.NVarChar(200), nullableText(line.piNo))
    req.input('Product', sql.NVarChar(200), nullableText(line.product))
    req.input('kcaa01', sql.NVarChar(200), nullableText(line.kcaa01))
    req.input('kcaa02', sql.NVarChar(500), nullableText(line.kcaa02))
    req.input('kcaa02_en', sql.NVarChar(500), nullableText(line.kcaa02En))
    req.input('kpname', sql.NVarChar(500), nullableText(line.invoiceName))
    req.input('kcaa03', sql.NVarChar(500), nullableText(line.kcaa03))
    req.input('kcaa04', sql.NVarChar(100), nullableText(line.kcaa04))
    req.input('kcaa05', sql.NVarChar(200), nullableText(line.kcaa05))
    req.input('kcaa06', sql.NVarChar(200), nullableText(line.kcaa06))
    req.input('kcaa07', sql.NVarChar(200), nullableText(line.kcaa07))
    req.input('kcaa08', sql.NVarChar(200), nullableText(line.kcaa08))
    req.input('kcaa09', sql.NVarChar(200), nullableText(line.kcaa09))
    req.input('kcaa10', sql.NVarChar(200), nullableText(line.kcaa10))
    req.input('kcaa11', sql.NVarChar(200), nullableText(line.kcaa11))
    req.input('wxak03', sql.Decimal(18, 2), line.wxak03)
    req.input('wxak04', sql.Decimal(18, 6), line.wxak04)
    req.input('wxak041', sql.Decimal(18, 6), line.wxak041)
    req.input('wxak05', sql.Decimal(18, 2), line.wxak05)
    req.input('wxak051', sql.Decimal(18, 2), line.wxak051)
    req.input('tax', sql.Decimal(18, 6), line.tax)
    req.input('delivery_date', sql.DateTime, line.deliveryDate)
    req.input('reference', sql.NVarChar(200), nullableText(line.referenceNo))
    req.input('wxak06', sql.NVarChar(1000), nullableText(line.remark))
    req.input('version', sql.Int, line.version)
    req.input('Customer_supply', sql.Int, line.customerSupply)
    await req.query(`
      INSERT INTO ${LINE_FROM} (
        [wxak01], [seq], [pi], [Product],
        [kcaa01], [kcaa02], [kcaa02_en], [kpname], [kcaa03], [kcaa04], [kcaa05], [kcaa06], [kcaa07], [kcaa08], [kcaa09], [kcaa10], [kcaa11],
        [wxak03], [wxak04], [wxak041], [wxak05], [wxak051], [tax],
        [delivery_date], [reference], [wxak06], [version], [Customer_supply], [del]
      )
      VALUES (
        @wxak01, @seq, @pi, @Product,
        @kcaa01, @kcaa02, @kcaa02_en, @kpname, @kcaa03, @kcaa04, @kcaa05, @kcaa06, @kcaa07, @kcaa08, @kcaa09, @kcaa10, @kcaa11,
        @wxak03, @wxak04, @wxak041, @wxak05, @wxak051, @tax,
        @delivery_date, @reference, @wxak06, @version, @Customer_supply, N'0'
      )
    `)
  }

  return { count: normalized.length }
}
