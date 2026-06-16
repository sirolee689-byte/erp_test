/**
 * BOM 用量运算 characterization（阶段 0 行为锁）
 * POST /api/bom/usage-calc → UB_ERP_Bom_cost 写入与响应结构
 *
 * 需 .env：DB_*、E2E_USERCODE、E2E_PASSWORD
 * 可选：E2E_BOM_SYSTEMCODE 或 E2E_BOM_KCAA01（默认 BAG-PQ2803H1/R-TEST）
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import {
  authHeaders,
  hasE2eDb,
  loginToken,
  startE2eServer,
  stopE2eServer,
} from './testHelpers/e2eServer.mjs'

const e2ePort = Number(process.env.BOM_USAGE_CALC_E2E_PORT ?? 3014)
const defaultKcaa01 = String(process.env.E2E_BOM_KCAA01 ?? 'BAG-PQ2803H1/R-TEST').trim()

/** @type {string} */
let apiBase = ''
/** @type {string} */
let authToken = ''
/** @type {string} */
let testSystemcode = ''

/**
 * @param {unknown[]} bomCost
 */
function bomCostFingerprint(bomCost) {
  const rows = (Array.isArray(bomCost) ? bomCost : [])
    .map((r) => ({
      kcaa01: String(r?.kcaa01 ?? '').trim(),
      Describe: String(r?.Describe ?? '').trim(),
      kcac04: Number(r?.kcac04 ?? 0),
      kcac05: Number(r?.kcac05 ?? 0),
      kcac06: Number(r?.kcac06 ?? 0),
      isok: Number(r?.isok ?? 0),
    }))
    .sort((a, b) => {
      const c = a.kcaa01.localeCompare(b.kcaa01, 'zh-CN')
      if (c !== 0) return c
      const d = a.Describe.localeCompare(b.Describe, 'zh-CN')
      if (d !== 0) return d
      return a.kcac04 - b.kcac04
    })
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex')
}

async function resolveTestSystemcode() {
  const fromEnv = String(process.env.E2E_BOM_SYSTEMCODE ?? '').trim()
  if (fromEnv) return fromEnv

  const { getPool, sql } = await import('./db.js')
  const pool = await getPool()
  const masterTable = String(process.env.INV_BOM_MASTER_TABLE ?? 'UB_ERP_Bom_000').trim()
  const r = await pool
    .request()
    .input('kcaa01', sql.NVarChar(300), defaultKcaa01)
    .query(`
      SELECT TOP 1 LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL([systemcode], N'')))) AS systemcode
      FROM dbo.[${masterTable}]
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL([kcaa01], N'')))) = @kcaa01
        AND (LTRIM(RTRIM(ISNULL([del], N''))) = N'' OR LTRIM(RTRIM(ISNULL([del], N''))) = N'0')
      ORDER BY id DESC
    `)
  const sc = String(r.recordset?.[0]?.systemcode ?? '').trim()
  if (!sc) {
    throw new Error(
      `未找到测试 BOM 主档 systemcode（kcaa01=${defaultKcaa01}）。请在 .env 设置 E2E_BOM_SYSTEMCODE 或 E2E_BOM_KCAA01`,
    )
  }
  return sc
}

/**
 * @param {string} systemcode
 * @param {string[]} [hidePrefixes]
 */
async function postUsageCalc(systemcode, hidePrefixes = ['CUT-', 'BAG-']) {
  const res = await fetch(`${apiBase}/api/bom/usage-calc`, {
    method: 'POST',
    headers: authHeaders(authToken),
    body: JSON.stringify({ systemcode, hidePrefixes }),
  })
  const json = await res.json().catch(() => ({}))
  return { res, json }
}

describe('BOM usage-calc API characterization', { skip: !hasE2eDb }, () => {
  before(async () => {
    apiBase = await startE2eServer(e2ePort)
    authToken = await loginToken(apiBase)
    testSystemcode = await resolveTestSystemcode()
  })

  after(async () => {
    await stopE2eServer()
  })

  test('未登录 POST 返回 401', async () => {
    const res = await fetch(`${apiBase}/api/bom/usage-calc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ systemcode: testSystemcode }),
    })
    assert.equal(res.status, 401)
  })

  test('缺少 systemcode 返回 400', async () => {
    const { res, json } = await postUsageCalc('')
    assert.equal(res.status, 400)
    assert.equal(json.success, false)
    assert.match(String(json.msg ?? ''), /systemcode/)
  })

  test('不存在的 systemcode 返回 404', async () => {
    const { res, json } = await postUsageCalc('__E2E_NOT_EXIST_SYSTEMCODE__')
    assert.equal(res.status, 404)
    assert.equal(json.success, false)
  })

  test('成功运算：响应结构与 UB_ERP_Bom_cost 行 isok=1', async () => {
    const { res, json } = await postUsageCalc(testSystemcode)
    assert.equal(res.status, 200, json.msg ?? res.status)
    assert.equal(json.success, true)
    assert.equal(typeof json.total, 'number')
    assert.ok(Array.isArray(json.data), 'data 应为用量树')
    assert.ok(Array.isArray(json.flatCostUsageRaw), 'flatCostUsageRaw 应为平铺数组')
    assert.ok(Array.isArray(json.bomCost), 'bomCost 应为落库结果')
    assert.equal(json.total, json.bomCost.length)
    if (json.bomCost.length > 0) {
      for (const row of json.bomCost) {
        assert.ok('kcaa01' in row)
        assert.equal(Number(row.isok ?? 0), 1, `行 ${row.kcaa01} isok 应为 1`)
      }
    }
  })

  test('连续两次运算：UB_ERP_Bom_cost 指纹一致（幂等覆盖）', async () => {
    const first = await postUsageCalc(testSystemcode)
    assert.equal(first.res.status, 200, first.json.msg ?? first.res.status)
    const fp1 = bomCostFingerprint(first.json.bomCost)

    const second = await postUsageCalc(testSystemcode)
    assert.equal(second.res.status, 200, second.json.msg ?? second.res.status)
    const fp2 = bomCostFingerprint(second.json.bomCost)

    assert.equal(fp1, fp2, '两次运算 UB_ERP_Bom_cost 内容指纹应一致')
    assert.equal(first.json.total, second.json.total)
  })
})
