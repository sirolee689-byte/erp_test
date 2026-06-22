import { sql } from './db.js'
import { INV_BOM_MASTER_FROM } from './bomTables.js'
import { formatSalesOrderAuditTime } from './salesOrderPiBom.js'

const FEE_FROM = 'dbo.[UB_ERP_Buy_order_money]'

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

export function normalizeBuyOrderFees(fees) {
  return (Array.isArray(fees) ? fees : [])
    .map((fee, index) => ({
      seq: Number.isFinite(Number(fee?.seq)) ? Number(fee.seq) : index + 1,
      feeCode: text(fee?.feeCode ?? fee?.kcaa01),
      feeName: text(fee?.feeName ?? fee?.kcaa02),
      spec: text(fee?.spec ?? fee?.kcaa03),
      money: nullableNumber(fee?.money),
      tax: nullableNumber(fee?.tax),
      remark: text(fee?.remark),
    }))
    .filter((fee) => fee.feeCode)
}

async function resolveFee(db, code) {
  const r = await new sql.Request(db).input('code', sql.NVarChar(200), code).query(`
    SELECT TOP 1
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([kcaa01], N'')))) AS feeCode,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([kcaa02], N'')))) AS feeName,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([kcaa03], N'')))) AS spec
    FROM ${INV_BOM_MASTER_FROM}
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([kcaa01], N'')))) = @code
      AND LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL([kcaa05], N'')))) = N'FEE'
      AND LTRIM(RTRIM(ISNULL([pass], N''))) = N'1'
      AND (ISNULL([del], N'') = N'' OR [del] = N'0')
    ORDER BY [id] DESC
  `)
  return r.recordset?.[0] ?? null
}

export async function rewriteBuyOrderFees({
  buyOrderNo,
  systemCode,
  fees,
  tx,
  hasPricePermission = true,
  actor = null,
}) {
  const orderNo = text(buyOrderNo)
  const headerSystemCode = text(systemCode)
  const auditActor = actor ?? { uidInt: null, uname: null, utruename: null }
  const addtime = formatSalesOrderAuditTime()
  const normalized = normalizeBuyOrderFees(fees)
  await new sql.Request(tx).input('buy_code', sql.NVarChar(200), orderNo).query(`
    DELETE FROM ${FEE_FROM}
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([buy_code], N'')))) = @buy_code
  `)
  for (const fee of normalized) {
    const bom = await resolveFee(tx, fee.feeCode)
    if (!bom) throw new Error(`费用项目 ${fee.feeCode} 不存在、未审核或不是FEE类别`)
    const req = new sql.Request(tx)
    req.input('buy_code', sql.NVarChar(200), orderNo)
    req.input('kid', sql.Int, fee.seq)
    req.input('kcaa01', sql.NVarChar(200), bom.feeCode)
    req.input('kcaa02', sql.NVarChar(500), bom.feeName)
    req.input('kcaa03', sql.NVarChar(500), nullableText(bom.spec ?? fee.spec))
    req.input('money', sql.Decimal(18, 2), hasPricePermission ? fee.money : null)
    req.input('tax', sql.Decimal(18, 6), hasPricePermission ? fee.tax : null)
    req.input('remark', sql.NVarChar(1000), nullableText(fee.remark))
    req.input('systemcode', sql.NVarChar(500), headerSystemCode)
    req.input('uid', sql.NVarChar(50), auditActor.uidInt != null ? String(auditActor.uidInt) : '')
    req.input('uname', sql.NVarChar(200), text(auditActor.uname))
    req.input('utruename', sql.NVarChar(200), text(auditActor.utruename))
    req.input('addtime', sql.NVarChar(50), addtime)
    await req.query(`
      INSERT INTO ${FEE_FROM} (
        [buy_code], [kid], [kcaa01], [kcaa02], [kcaa03], [money], [tax], [remark],
        [systemcode], [uid], [uname], [utruename], [addtime]
      )
      VALUES (
        @buy_code, @kid, @kcaa01, @kcaa02, @kcaa03, @money, @tax, @remark,
        @systemcode, @uid, @uname, @utruename, @addtime
      )
    `)
  }
  return { count: normalized.length }
}
