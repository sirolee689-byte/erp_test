/**
 * 销售订单：明细款是否在 UB_ERP_Bom_pi_cost 中已有 pq 覆盖
 */
import sql from 'mssql'
import { normKcaa01 } from './salesOrderSaveLogic.js'

const PI_COST_FROM = 'dbo.[UB_ERP_Bom_pi_cost]'

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {string} piNo
 * @param {string[]} lineCodes
 */
export async function allOrderLinesHavePiCost(pool, piNo, lineCodes) {
  const codes = [...new Set(lineCodes.map(normKcaa01).filter(Boolean))]
  if (!codes.length) return false
  const pi = normKcaa01(piNo)
  const req = pool.request().input('pi', sql.NVarChar(200), pi)
  const or = []
  for (let i = 0; i < codes.length; i++) {
    const p = `lc${i}`
    req.input(p, sql.NVarChar(300), codes[i])
    or.push(`@${p}`)
  }
  const r = await req.query(`
    SELECT
      LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(c.[pq], N'')))) AS pq
    FROM ${PI_COST_FROM} AS c
    WHERE LTRIM(RTRIM(ISNULL(c.[sid], N''))) = @pi
      AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(c.[pq], N'')))) IN (${or.join(', ')})
    GROUP BY LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(c.[pq], N''))))
  `)
  const covered = new Set((r.recordset ?? []).map((row) => normKcaa01(row.pq)).filter(Boolean))
  return codes.every((code) => covered.has(code))
}
