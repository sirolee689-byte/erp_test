import { sql } from './db.js'
import { INV_BOM_MASTER_FROM } from './bomTables.js'

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

export function isMeaningfulAssistOrderFee(fee) {
  return Boolean(text(fee?.feeCode))
}

export function normalizeAssistOrderFees(fees) {
  return (Array.isArray(fees) ? fees : [])
    .map((fee, index) => normalizeAssistOrderFee(fee, index))
    .filter(isMeaningfulAssistOrderFee)
}

async function resolveFeeNameFromBom000(db, feeCode) {
  const code = text(feeCode)
  if (!code || !db) return ''
  const r = await new sql.Request(db)
    .input('code', sql.NVarChar(200), code)
    .query(`
      SELECT TOP 1
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.[kcaa02], N'')))) AS feeName
      FROM ${INV_BOM_MASTER_FROM} AS b
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(b.[kcaa01], N'')))) = @code
        AND LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.[kcaa05], N'')))) = N'FEE'
        AND LTRIM(RTRIM(ISNULL(b.[pass], N''))) = N'1'
        AND (ISNULL(b.[del], N'') = N'' OR b.[del] = N'0')
      ORDER BY b.[id] DESC
    `)
  return text(r.recordset?.[0]?.feeName)
}

export async function rewriteAssistOrderFees({ assistOrderNo, fees, tx = null, requestFactory }) {
  const orderNo = text(assistOrderNo)
  const normalized = normalizeAssistOrderFees(fees)
  const makeRequest = requestFactory ?? (() => new sql.Request(tx))
  const db = tx ?? null

  const deleteReq = makeRequest()
  deleteReq.input('assist_code', sql.NVarChar(200), orderNo)
  await deleteReq.query(`
    DELETE FROM ${FEE_FROM}
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([assist_code], N'')))) = @assist_code
  `)

  for (const fee of normalized) {
    let feeName = fee.feeName
    if (db && fee.feeCode) {
      const resolved = await resolveFeeNameFromBom000(db, fee.feeCode)
      if (resolved) feeName = resolved
    }
    const req = makeRequest()
    req.input('assist_code', sql.NVarChar(200), orderNo)
    req.input('assist_link', sql.NVarChar(200), orderNo)
    req.input('assist_pi', sql.NVarChar(200), orderNo)
    req.input('kcaa01', sql.NVarChar(200), nullableText(fee.feeCode))
    req.input('kcaa02', sql.NVarChar(500), nullableText(feeName))
    req.input('mtitle', sql.NVarChar(500), nullableText(feeName))
    req.input('money', sql.Decimal(18, 2), fee.money)
    req.input('tax', sql.Decimal(18, 6), fee.tax)
    req.input('remark', sql.NVarChar(1000), nullableText(fee.remark))
    await req.query(`
      INSERT INTO ${FEE_FROM} (
        [assist_code], [assist_link], [assist_pi],
        [kcaa01], [kcaa02], [mtitle], [money], [tax], [remark], [del], [pass], [closed]
      )
      VALUES (
        @assist_code, @assist_link, @assist_pi,
        @kcaa01, @kcaa02, @mtitle, @money, @tax, @remark, N'0', N'0', N'0'
      )
    `)
  }

  return { count: normalized.length }
}
