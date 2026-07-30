/**
 * BOM 树预览接口（preferTree=1）回归：
 * - 已有 UB_ERP_Bom_cost 缓存时，默认 GET /api/bom/tree 走缓存直读（hasCache=true）
 * - 带 preferTree=1 时强制走只读树预览（hasCache=false，返回 data/flatCostUsageRaw）
 *
 * 需 .env：DB_*、E2E_USERCODE、E2E_PASSWORD
 * 可选：E2E_BOM_SYSTEMCODE 或 E2E_BOM_KCAA01（默认 BAG-PQ2803H1/R-TEST）
 */
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import {
  authHeaders,
  hasE2eDb,
  loginToken,
  startE2eServer,
  stopE2eServer,
} from './testHelpers/e2eServer.mjs'

const e2ePort = Number(process.env.BOM_TREE_PREVIEW_E2E_PORT ?? 3015)
const defaultKcaa01 = String(process.env.E2E_BOM_KCAA01 ?? 'BAG-PQ2803H1/R-TEST').trim()

/** @type {string} */
let apiBase = ''
/** @type {string} */
let authToken = ''
/** @type {string} */
let testSystemcode = ''

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
 * 先跑一次 legacy 写库，确保存在缓存用于后续断言。
 * @param {string} systemcode
 */
async function warmBomCostCache(systemcode) {
  const res = await fetch(`${apiBase}/api/bom/usage-calc-legacy`, {
    method: 'POST',
    headers: authHeaders(authToken),
    body: JSON.stringify({ systemcode, hidePrefixes: ['CUT-', 'BAG-'] }),
  })
  const json = await res.json().catch(() => ({}))
  assert.equal(res.status, 200, json.msg ?? res.status)
  assert.equal(json.success, true)
}

/**
 * @param {string} systemcode
 * @param {{ preferTree?: boolean }} [opts]
 */
async function getBomTree(systemcode, opts = {}) {
  const params = new URLSearchParams({ systemcode })
  if (opts.preferTree) params.set('preferTree', '1')
  const res = await fetch(`${apiBase}/api/bom/tree?${params.toString()}`, {
    headers: authHeaders(authToken),
  })
  const json = await res.json().catch(() => ({}))
  return { res, json }
}

describe('BOM tree preferTree preview', { skip: !hasE2eDb }, () => {
  before(async () => {
    apiBase = await startE2eServer(e2ePort)
    authToken = await loginToken(apiBase)
    testSystemcode = await resolveTestSystemcode()
    await warmBomCostCache(testSystemcode)
  })

  after(async () => {
    await stopE2eServer()
  })

  test('默认 GET /api/bom/tree 在有缓存时走缓存直读', async () => {
    const { res, json } = await getBomTree(testSystemcode)
    assert.equal(res.status, 200, json.msg ?? res.status)
    assert.equal(json.success, true)
    assert.equal(json.hasCache, true)
    assert.ok(Array.isArray(json.UB_ERP_Bom_cost), '默认模式应返回 UB_ERP_Bom_cost 缓存')
    assert.equal(Array.isArray(json.data), true)
    assert.equal(json.data.length, 0, '默认缓存模式不返回树 data')
  })

  test('GET /api/bom/tree?preferTree=1 强制只读树预览', async () => {
    const { res, json } = await getBomTree(testSystemcode, { preferTree: true })
    assert.equal(res.status, 200, json.msg ?? res.status)
    assert.equal(json.success, true)
    assert.equal(json.hasCache, false, 'preferTree=1 应跳过缓存直读')
    assert.ok(Array.isArray(json.data), 'preferTree=1 应返回树 data')
    assert.ok(Array.isArray(json.flatCostUsageRaw), 'preferTree=1 应返回平铺预览')
    assert.ok(Array.isArray(json.UB_ERP_Bom_cost), '返回结构保持兼容')
    assert.equal(json.UB_ERP_Bom_cost.length, 0, 'preferTree=1 不返回缓存行')
  })
})
