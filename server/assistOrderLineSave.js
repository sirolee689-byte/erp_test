import { sql } from './db.js'
import {
  ASSIST_LINE_KCAA_SNAPSHOT_FIELDS,
  fetchAssistLineBom000Keys,
  fetchAssistOrderLineBomSnapshot,
  mergeBomSnapshotIntoAssistLine,
} from './assistOrderLineBomSnapshot.js'
import { formatSalesOrderAuditTime } from './salesOrderPiBom.js'

const LINE_FROM = 'dbo.[UB_ERP_assist_order_list]'

const DECIMAL_KCAA = new Set(['kcaa07', 'kcaa08', 'kcaa19', 'kcaa22', 'kcaa23', 'kcaa24', 'kcaa26', 'kcaa30', 'kcaa32', 'kcaa33'])
const INT_KCAA = new Set(['kcaa12', 'kcaa13', 'kcaa14'])

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

function readKcaaField(line, col) {
  if (INT_KCAA.has(col)) return nullableNumber(line?.[col])
  if (DECIMAL_KCAA.has(col)) return nullableNumber(line?.[col])
  return text(line?.[col])
}

export function normalizeAssistOrderLine(line, index = 0) {
  /** @type {Record<string, unknown>} */
  const normalized = {
    seq: Number.isFinite(Number(line?.seq)) ? Number(line.seq) : index + 1,
    piNo: text(line?.piNo ?? line?.pi),
    product: text(line?.product ?? line?.Product),
    kcaa02En: text(line?.kcaa02En ?? line?.kcaa02_en),
    invoiceName: text(line?.invoiceName ?? line?.kpname),
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
    type: nullableNumber(line?.type),
    location: text(line?.location),
    salePrice: nullableNumber(line?.salePrice ?? line?.sale_price),
    costPrice: nullableNumber(line?.costPrice ?? line?.cost_price),
  }
  for (const col of ASSIST_LINE_KCAA_SNAPSHOT_FIELDS) {
    normalized[col] = readKcaaField(line, col)
  }
  return normalized
}

export function normalizeAssistOrderLines(lines) {
  return (Array.isArray(lines) ? lines : [])
    .map((line, index) => normalizeAssistOrderLine(line, index))
    .filter((line) => line.kcaa01 || line.kcaa02)
}

function bindKcaaInputs(req, line) {
  for (const col of ASSIST_LINE_KCAA_SNAPSHOT_FIELDS) {
    const val = line[col]
    if (INT_KCAA.has(col)) {
      req.input(col, sql.Int, nullableNumber(val))
    } else if (DECIMAL_KCAA.has(col)) {
      req.input(col, sql.Decimal(18, 6), nullableNumber(val))
    } else {
      const maxLen = col === 'kcaa01' ? 200 : col === 'kcaa04' || col === 'kcaa05' ? 100 : 500
      req.input(col, sql.NVarChar(maxLen), nullableText(val))
    }
  }
}

export async function rewriteAssistOrderLines({
  assistOrderNo,
  lines,
  assistType = '0',
  referenceNo = '',
  actor = null,
  clientIp = '',
  tx = null,
  requestFactory,
  resolveLineSnapshot,
  resolveBom000Keys,
}) {
  const orderNo = text(assistOrderNo)
  const normalized = normalizeAssistOrderLines(lines)
  const makeRequest = requestFactory ?? (() => new sql.Request(tx))
  const auditActor = actor ?? { uidInt: null, uname: null, utruename: null }
  const uidStr = auditActor.uidInt != null ? String(auditActor.uidInt) : ''
  const addtime = formatSalesOrderAuditTime()
  const snapshotResolver =
    resolveLineSnapshot ??
    (tx
      ? (line) =>
          fetchAssistOrderLineBomSnapshot(tx, {
            assistType,
            referenceNo,
            product: line.product,
            kcaa01: line.kcaa01,
          })
      : async () => null)
  const bom000KeysResolver =
    resolveBom000Keys ??
    (tx ? (kcaa01) => fetchAssistLineBom000Keys(tx, kcaa01) : async () => null)

  const deleteReq = makeRequest()
  deleteReq.input('wxak01', sql.NVarChar(200), orderNo)
  await deleteReq.query(`
    DELETE FROM ${LINE_FROM}
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([wxak01], N'')))) = @wxak01
  `)

  for (const line of normalized) {
    const snapshot = await snapshotResolver(line)
    const enriched = mergeBomSnapshotIntoAssistLine(line, snapshot)
    const bomKeys = await bom000KeysResolver(enriched.kcaa01)
    const bomGuid = text(bomKeys?.bomGuid)
    if (!bomGuid) {
      throw new Error(
        `货品 ${enriched.kcaa01} 在 bom_000 中缺少 GUID，无法写入明细 wxak02/GUID/systemcode`,
      )
    }
    const customerName = text(enriched.customerName) || text(bomKeys?.customerName) || null
    const req = makeRequest()
    req.input('wxak01', sql.NVarChar(200), orderNo)
    req.input('wxak02', sql.NVarChar(500), bomGuid)
    req.input('guid', sql.NVarChar(500), bomGuid)
    req.input('systemcode', sql.NVarChar(500), bomGuid)
    req.input('uid', sql.NVarChar(50), uidStr)
    req.input('uname', sql.NVarChar(50), String(auditActor.uname ?? ''))
    req.input('utruename', sql.NVarChar(50), String(auditActor.utruename ?? ''))
    req.input('addtime', sql.NVarChar(50), addtime)
    req.input('Customer_Name', sql.NVarChar(500), customerName)
    req.input('seq', sql.Int, enriched.seq)
    req.input('pi', sql.NVarChar(200), nullableText(enriched.piNo))
    req.input('Product', sql.NVarChar(200), nullableText(enriched.product))
    req.input('pq', sql.NVarChar(200), nullableText(enriched.product))
    req.input('kcaa02_en', sql.NVarChar(500), nullableText(enriched.kcaa02En))
    req.input('kpname', sql.NVarChar(500), nullableText(enriched.invoiceName))
    bindKcaaInputs(req, enriched)
    req.input('wxak03', sql.Decimal(18, 2), enriched.wxak03)
    req.input('wxak04', sql.Decimal(18, 6), enriched.wxak04)
    req.input('wxak041', sql.Decimal(18, 6), enriched.wxak041)
    req.input('wxak05', sql.Decimal(18, 2), enriched.wxak05)
    req.input('wxak051', sql.Decimal(18, 2), enriched.wxak051)
    req.input('tax', sql.Decimal(18, 6), enriched.tax)
    req.input('delivery_date', sql.DateTime, enriched.deliveryDate)
    req.input('reference', sql.NVarChar(200), nullableText(enriched.referenceNo))
    req.input('wxak06', sql.NVarChar(1000), nullableText(enriched.remark))
    req.input('version', sql.Int, enriched.version)
    req.input('Customer_supply', sql.Int, enriched.customerSupply)
    req.input('type', sql.Int, enriched.type ?? 1)
    req.input('snapshotRemark', sql.NVarChar(sql.MAX), nullableText(enriched.snapshotRemark))
    req.input('ip', sql.NVarChar(50), nullableText(clientIp))
    req.input('location', sql.NVarChar(500), nullableText(enriched.location))
    req.input('sale_price', sql.Decimal(18, 6), enriched.salePrice)
    req.input('cost_price', sql.Decimal(18, 6), enriched.costPrice)
    await req.query(`
      INSERT INTO ${LINE_FROM} (
        [wxak01], [seq], [pi], [Product], [pq],
        [kcaa01], [kcaa02], [kcaa02_en], [kpname],
        [kcaa03], [kcaa04], [kcaa05], [kcaa06], [kcaa07], [kcaa08], [kcaa09], [kcaa10], [kcaa11],
        [kcaa12], [kcaa13], [kcaa14], [kcaa15], [kcaa16], [kcaa17], [kcaa18], [kcaa19], [kcaa20],
        [kcaa21], [kcaa22], [kcaa23], [kcaa24], [kcaa25], [kcaa26], [kcaa27], [kcaa28], [kcaa29], [kcaa30],
        [kcaa31], [kcaa32], [kcaa33], [kcaa34], [kcaa35],
        [wxak02], [GUID], [systemcode],
        [wxak03], [wxak04], [wxak041], [wxak05], [wxak051], [tax],
        [delivery_date], [reference], [wxak06], [version], [Customer_supply], [type], [location], [sale_price], [cost_price],
        [Customer_Name], [uid], [uname], [utruename], [addtime], [remark], [pass], [ip], [del]
      )
      VALUES (
        @wxak01, @seq, @pi, @Product, @pq,
        @kcaa01, @kcaa02, @kcaa02_en, @kpname,
        @kcaa03, @kcaa04, @kcaa05, @kcaa06, @kcaa07, @kcaa08, @kcaa09, @kcaa10, @kcaa11,
        @kcaa12, @kcaa13, @kcaa14, @kcaa15, @kcaa16, @kcaa17, @kcaa18, @kcaa19, @kcaa20,
        @kcaa21, @kcaa22, @kcaa23, @kcaa24, @kcaa25, @kcaa26, @kcaa27, @kcaa28, @kcaa29, @kcaa30,
        @kcaa31, @kcaa32, @kcaa33, @kcaa34, @kcaa35,
        @wxak02, @guid, @systemcode,
        @wxak03, @wxak04, @wxak041, @wxak05, @wxak051, @tax,
        @delivery_date, @reference, @wxak06, @version, @Customer_supply, @type, @location, @sale_price, @cost_price,
        @Customer_Name, @uid, @uname, @utruename, @addtime, @snapshotRemark, N'1', @ip, N'0'
      )
    `)
  }

  return { count: normalized.length }
}
