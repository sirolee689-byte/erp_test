import { sql } from './db.js'

const FEE_FROM = 'dbo.[UB_ERP_assist_order_money]'

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

export function normalizeAssistOrderFee(fee, index = 0) {
  return {
    seq: Number.isFinite(Number(fee?.seq)) ? Number(fee.seq) : index + 1,
    feeCode: text(fee?.feeCode ?? fee?.kcaa01),
    feeName: text(fee?.feeName ?? fee?.kcaa02 ?? fee?.mtitle),
    money: nullableNumber(fee?.money),
    tax: nullableNumber(fee?.tax),
    remark: text(fee?.remark),
  }
}

export function normalizeAssistOrderFees(fees) {
  return (Array.isArray(fees) ? fees : [])
    .map((fee, index) => normalizeAssistOrderFee(fee, index))
    .filter((fee) => fee.feeCode || fee.feeName || fee.money != null)
}

export async function rewriteAssistOrderFees({ assistOrderNo, fees, tx = null, requestFactory }) {
  const orderNo = text(assistOrderNo)
  const normalized = normalizeAssistOrderFees(fees)
  const makeRequest = requestFactory ?? (() => new sql.Request(tx))

  const deleteReq = makeRequest()
  deleteReq.input('assist_code', sql.NVarChar(200), orderNo)
  await deleteReq.query(`
    DELETE FROM ${FEE_FROM}
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([assist_code], N'')))) = @assist_code
  `)

  for (const fee of normalized) {
    const req = makeRequest()
    req.input('assist_code', sql.NVarChar(200), orderNo)
    req.input('assist_link', sql.NVarChar(200), orderNo)
    req.input('assist_pi', sql.NVarChar(200), orderNo)
    req.input('seq', sql.Int, fee.seq)
    req.input('kcaa01', sql.NVarChar(200), nullableText(fee.feeCode))
    req.input('kcaa02', sql.NVarChar(500), nullableText(fee.feeName))
    req.input('mtitle', sql.NVarChar(500), nullableText(fee.feeName))
    req.input('money', sql.Decimal(18, 2), fee.money)
    req.input('tax', sql.Decimal(18, 6), fee.tax)
    req.input('remark', sql.NVarChar(1000), nullableText(fee.remark))
    await req.query(`
      INSERT INTO ${FEE_FROM} (
        [assist_code], [assist_link], [assist_pi], [kid],
        [kcaa01], [kcaa02], [mtitle], [money], [tax], [remark], [del], [pass], [closed]
      )
      VALUES (
        @assist_code, @assist_link, @assist_pi, @seq,
        @kcaa01, @kcaa02, @mtitle, @money, @tax, @remark, N'0', N'0', N'0'
      )
    `)
  }

  return { count: normalized.length }
}
