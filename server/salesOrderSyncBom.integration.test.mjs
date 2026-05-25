/**
 * 销售订单按行同步 BOM 集成测试（issue 04）
 */
import assert from 'node:assert/strict'
import dotenv from 'dotenv'
import { spawn } from 'node:child_process'
import { createConnection } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, describe, test } from 'node:test'
import { fetchMasterBomHeadByKcaa01 } from './salesOrderPiBom.js'
import { normalizeUsageTreeParentKey } from './bomUsageTreeBuild.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

dotenv.config({ path: join(root, '.env') })

const hasE2e =
  Boolean(process.env.DB_SERVER && process.env.E2E_USERCODE && process.env.E2E_PASSWORD)

const e2ePort = Number(process.env.SALES_ORDER_SYNC_E2E_PORT ?? 3015)
const e2eAccount = String(process.env.E2E_USERCODE ?? '001').trim()
const e2ePassword = String(process.env.E2E_PASSWORD ?? '')

const TEST_CUSTOMER_CODE = 'CNS-0001'
const TEST_CURRENCY_ID = '1'
const PRODUCT_A = 'BAG-PQ3672A1/G-TEST'
const PRODUCT_B = 'BAG-PQTEST/BLU2'
const BOM_PARTS_TABLE = (() => {
  const raw = String(process.env.INV_BOM_PARTS_TABLE ?? 'Bom_parts').trim()
  return /^[A-Za-z0-9_]+$/.test(raw) ? raw : 'Bom_parts'
})()

/** @type {import('node:child_process').ChildProcess | null} */
let serverChild = null
let apiBase = ''
let authToken = ''
/** @type {string[]} */
const cleanupPiNos = []

function waitPort(host, port, timeoutMs) {
  const t0 = Date.now()
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const s = createConnection({ host, port }, () => {
        s.end()
        resolve()
      })
      s.on('error', () => {
        if (Date.now() - t0 > timeoutMs) reject(new Error(`端口 ${port} 在 ${timeoutMs}ms 内未就绪`))
        else setTimeout(tryOnce, 200)
      })
    }
    tryOnce()
  })
}

async function startE2eServer() {
  serverChild = spawn(process.execPath, [join(root, 'server', 'index.js')], {
    cwd: root,
    env: { ...process.env, PORT: String(e2ePort) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  await waitPort('127.0.0.1', e2ePort, 25000)
  await new Promise((r) => setTimeout(r, 800))
  apiBase = `http://127.0.0.1:${e2ePort}`
}

async function stopE2eServer() {
  if (!serverChild) return
  serverChild.kill('SIGTERM')
  await new Promise((r) => setTimeout(r, 400))
  if (!serverChild.killed) serverChild.kill('SIGKILL')
  serverChild = null
}

function authHeaders() {
  return {
    Authorization: `Bearer ${authToken}`,
    'Content-Type': 'application/json',
  }
}

async function loginToken() {
  const res = await fetch(`${apiBase}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ Account: e2eAccount, Password: e2ePassword }),
  })
  const json = await res.json().catch(() => ({}))
  assert.equal(res.status, 200)
  authToken = String(json?.data?.token ?? '').trim()
  assert.ok(authToken)
}

function newTestPi() {
  const pi = `PI-SYNC-${Date.now()}`
  cleanupPiNos.push(pi)
  return pi
}

function baseHeader(piNo) {
  return {
    piNo,
    salesDate: '2026-05-24',
    customerCode: TEST_CUSTOMER_CODE,
    currencyCode: TEST_CURRENCY_ID,
    decimalPlaces: '2',
  }
}

async function apiPostOrder(body) {
  const res = await fetch(`${apiBase}/api/sales-order`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  })
  return { res, json: await res.json().catch(() => ({})) }
}

async function apiSyncBom(id, kcaa01) {
  const res = await fetch(`${apiBase}/api/sales-order/${id}/sync-bom`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ kcaa01 }),
  })
  return { res, json: await res.json().catch(() => ({})) }
}

async function apiGetOrder(id) {
  const res = await fetch(`${apiBase}/api/sales-order/${id}`, { headers: authHeaders() })
  return { res, json: await res.json().catch(() => ({})) }
}

async function hardDeleteTestPi(piNo) {
  const { getPool, sql } = await import('./db.js')
  const pool = await getPool()
  const pi = String(piNo).trim()
  await pool.request().input('pi', sql.NVarChar(200), pi).query(`
    DELETE FROM dbo.[UB_ERP_Bom_Sales_list] WHERE LTRIM(RTRIM(ISNULL([sid], N''))) = @pi;
    DELETE FROM dbo.[UB_ERP_Bom_Sales] WHERE LTRIM(RTRIM(ISNULL([sid], N''))) = @pi;
    DELETE FROM dbo.[UB_ERP_Bom_pi_cost] WHERE LTRIM(RTRIM(ISNULL([sid], N''))) = @pi;
    DELETE FROM dbo.[UB_ERP_Sales_order_list] WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([xsak01], N'')))) = @pi;
    DELETE FROM dbo.[UB_ERP_Sales_order] WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([xsaj01], N'')))) = @pi;
  `)
}

/** 主 BOM 成品下第一层子件（按 Seq） */
async function sampleMasterFirstDirectChild(productKcaa01) {
  const { getPool, sql } = await import('./db.js')
  const pool = await getPool()
  const master = await fetchMasterBomHeadByKcaa01(pool, productKcaa01)
  const parentSc = normalizeUsageTreeParentKey(master?.systemcode)
  if (!parentSc) return null
  const r = await pool.request().input('parent', sql.NVarChar(500), parentSc).query(`
    SELECT TOP 1
      LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(p.[kcaa01], N'')))) AS childKcaa01,
      CAST(p.[kcac04] AS decimal(18, 6)) AS kcac04
    FROM dbo.[${BOM_PARTS_TABLE}] AS p
    WHERE LTRIM(RTRIM(ISNULL(CAST(p.[kcac01] AS nvarchar(500)), N''))) = @parent
    ORDER BY ISNULL(p.[Seq], p.[id]) ASC
  `)
  const row = r.recordset?.[0]
  if (!row?.childKcaa01) return null
  return {
    childKcaa01: String(row.childKcaa01).trim(),
    kcac04: Number(row.kcac04 ?? NaN),
  }
}

/** PI BOM 成品下第一层子件（按 seq） */
async function samplePiFirstDirectChild(piNo, productKcaa01) {
  const { getPool, sql } = await import('./db.js')
  const pool = await getPool()
  const r = await pool
    .request()
    .input('pi', sql.NVarChar(200), piNo)
    .input('p', sql.NVarChar(300), productKcaa01)
    .query(`
      SELECT TOP 1
        LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa01], N'')))) AS childKcaa01,
        CAST(l.[kcac04] AS decimal(18, 6)) AS kcac04
      FROM dbo.[UB_ERP_Bom_Sales_list] AS l
      INNER JOIN dbo.[UB_ERP_Bom_Sales] AS h
        ON LTRIM(RTRIM(ISNULL(h.[sid], N''))) = @pi
       AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(h.[kcaa01], N'')))) = @p
      WHERE LTRIM(RTRIM(ISNULL(l.[sid], N''))) = @pi
        AND LTRIM(RTRIM(ISNULL(CAST(l.[kcac01] AS nvarchar(500)), N''))) =
            LTRIM(RTRIM(ISNULL(CAST(h.[systemcode] AS nvarchar(500)), N'')))
      ORDER BY ISNULL(l.[seq], l.[id]) ASC
    `)
  const row = r.recordset?.[0]
  if (!row?.childKcaa01) return null
  return {
    childKcaa01: String(row.childKcaa01).trim(),
    kcac04: Number(row.kcac04 ?? NaN),
  }
}

/** PI BOM 指定成品下指定子件用量 */
async function samplePiChildUsage(piNo, productKcaa01, childKcaa01) {
  const { getPool, sql } = await import('./db.js')
  const pool = await getPool()
  const r = await pool
    .request()
    .input('pi', sql.NVarChar(200), piNo)
    .input('p', sql.NVarChar(300), productKcaa01)
    .input('child', sql.NVarChar(300), childKcaa01)
    .query(`
      SELECT TOP 1 CAST(l.[kcac04] AS decimal(18, 6)) AS kcac04
      FROM dbo.[UB_ERP_Bom_Sales_list] AS l
      INNER JOIN dbo.[UB_ERP_Bom_Sales] AS h
        ON LTRIM(RTRIM(ISNULL(h.[sid], N''))) = @pi
       AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(h.[kcaa01], N'')))) = @p
      WHERE LTRIM(RTRIM(ISNULL(l.[sid], N''))) = @pi
        AND LTRIM(RTRIM(ISNULL(CAST(l.[kcac01] AS nvarchar(500)), N''))) =
            LTRIM(RTRIM(ISNULL(CAST(h.[systemcode] AS nvarchar(500)), N'')))
        AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa01], N'')))) = @child
    `)
  return Number(r.recordset?.[0]?.kcac04 ?? NaN)
}

async function setPiChildUsage(piNo, productKcaa01, childKcaa01, value) {
  const { getPool, sql } = await import('./db.js')
  const pool = await getPool()
  await pool
    .request()
    .input('pi', sql.NVarChar(200), piNo)
    .input('product', sql.NVarChar(300), productKcaa01)
    .input('child', sql.NVarChar(300), childKcaa01)
    .input('v', sql.Decimal(18, 6), value)
    .query(`
      UPDATE l SET l.[kcac04] = @v
      FROM dbo.[UB_ERP_Bom_Sales_list] AS l
      INNER JOIN dbo.[UB_ERP_Bom_Sales] AS h
        ON LTRIM(RTRIM(ISNULL(h.[sid], N''))) = @pi
       AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(h.[kcaa01], N'')))) = @product
      WHERE LTRIM(RTRIM(ISNULL(l.[sid], N''))) = @pi
        AND LTRIM(RTRIM(ISNULL(CAST(l.[kcac01] AS nvarchar(500)), N''))) =
            LTRIM(RTRIM(ISNULL(CAST(h.[systemcode] AS nvarchar(500)), N'')))
        AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(l.[kcaa01], N'')))) = @child
    `)
}

async function countPiBomListRowsForProduct(piNo, productKcaa01) {
  const { getPool, sql } = await import('./db.js')
  const pool = await getPool()
  const r = await pool
    .request()
    .input('pi', sql.NVarChar(200), piNo)
    .input('p', sql.NVarChar(300), productKcaa01)
    .query(`
      SELECT COUNT(1) AS c
      FROM dbo.[UB_ERP_Bom_Sales_list] AS l
      INNER JOIN dbo.[UB_ERP_Bom_Sales] AS h
        ON LTRIM(RTRIM(ISNULL(h.[sid], N''))) = @pi
       AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(h.[kcaa01], N'')))) = @p
      WHERE LTRIM(RTRIM(ISNULL(l.[sid], N''))) = @pi
    `)
  return Number(r.recordset?.[0]?.c ?? 0)
}

async function countPiCostRows(piNo) {
  const { getPool, sql } = await import('./db.js')
  const pool = await getPool()
  const r = await pool.request().input('pi', sql.NVarChar(200), piNo).query(`
    SELECT COUNT(1) AS c FROM dbo.[UB_ERP_Bom_pi_cost] WHERE LTRIM(RTRIM(ISNULL([sid], N''))) = @pi
  `)
  return Number(r.recordset?.[0]?.c ?? 0)
}

describe('sales order sync bom integration', { skip: !hasE2e }, () => {
  before(async () => {
    await startE2eServer()
    await loginToken()
  })

  after(async () => {
    for (const pi of cleanupPiNos) {
      try {
        await hardDeleteTestPi(pi)
      } catch {
        // ignore
      }
    }
    await stopE2eServer()
  })

  test('同步后 PI BOM 与主 BOM 一致且标未运算', async () => {
    const piNo = newTestPi()
    const created = await apiPostOrder({
      header: baseHeader(piNo),
      lines: [{ kcaa01: PRODUCT_A, orderQty: 1 }],
    })
    assert.equal(created.json.code, 200)
    const id = created.json.data.id

    const masterChild = await sampleMasterFirstDirectChild(PRODUCT_A)
    assert.ok(masterChild && Number.isFinite(masterChild.kcac04), '主 BOM 应有直接子件')

    const tweaked = masterChild.kcac04 + 0.25
    await setPiChildUsage(piNo, PRODUCT_A, masterChild.childKcaa01, tweaked)
    assert.equal(await samplePiChildUsage(piNo, PRODUCT_A, masterChild.childKcaa01), tweaked)

    const { getPool, sql } = await import('./db.js')
    const pool = await getPool()
    await pool.request().input('id', sql.Int, id).query(`
      UPDATE dbo.[UB_ERP_Sales_order] SET [is_pur] = N'1' WHERE [id] = @id
    `)

    const synced = await apiSyncBom(id, PRODUCT_A)
    assert.equal(synced.json.code, 200, synced.json.msg)

    const piUsage = await samplePiChildUsage(piNo, PRODUCT_A, masterChild.childKcaa01)
    assert.ok(
      Math.abs(piUsage - masterChild.kcac04) < 0.0001,
      `PI=${piUsage} master=${masterChild.kcac04} child=${masterChild.childKcaa01}`,
    )

    const detail = await apiGetOrder(id)
    assert.equal(detail.json.data?.header?.calcStatus, '未运算')
  })

  test('仅同步指定款，其它款 PI BOM 不变', async () => {
    const piNo = newTestPi()
    const created = await apiPostOrder({
      header: baseHeader(piNo),
      lines: [
        { kcaa01: PRODUCT_A, orderQty: 1 },
        { kcaa01: PRODUCT_B, orderQty: 1 },
      ],
    })
    const id = created.json.data.id

    const listRowsBBefore = await countPiBomListRowsForProduct(piNo, PRODUCT_B)
    const piChildB = await samplePiFirstDirectChild(piNo, PRODUCT_B)
    const beforeBUsage = piChildB ? piChildB.kcac04 : null

    const childA = await sampleMasterFirstDirectChild(PRODUCT_A)
    assert.ok(childA)
    const tweakA = (await samplePiChildUsage(piNo, PRODUCT_A, childA.childKcaa01)) + 0.33
    await setPiChildUsage(piNo, PRODUCT_A, childA.childKcaa01, tweakA)

    const synced = await apiSyncBom(id, PRODUCT_A)
    assert.equal(synced.json.code, 200)

    assert.ok(Math.abs((await samplePiChildUsage(piNo, PRODUCT_A, childA.childKcaa01)) - childA.kcac04) < 0.0001)
    assert.equal(await countPiBomListRowsForProduct(piNo, PRODUCT_B), listRowsBBefore)
    if (piChildB) {
      assert.equal(await samplePiChildUsage(piNo, PRODUCT_B, piChildB.childKcaa01), beforeBUsage)
    }
  })

  test('同步不写 pi_cost；已审/非明细款失败', async () => {
    const piNo = newTestPi()
    const created = await apiPostOrder({
      header: baseHeader(piNo),
      lines: [{ kcaa01: PRODUCT_A, orderQty: 1 }],
    })
    const id = created.json.data.id
    const costBefore = await countPiCostRows(piNo)

    const synced = await apiSyncBom(id, PRODUCT_A)
    assert.equal(synced.json.code, 200)
    assert.equal(await countPiCostRows(piNo), costBefore)

    const badLine = await apiSyncBom(id, 'NOT-ON-ORDER-XXX')
    assert.equal(badLine.res.status, 400)

    const { getPool, sql } = await import('./db.js')
    const pool = await getPool()
    await pool.request().input('id', sql.Int, id).query(`
      UPDATE dbo.[UB_ERP_Sales_order] SET [pass] = N'1' WHERE [id] = @id
    `)
    const audited = await apiSyncBom(id, PRODUCT_A)
    assert.equal(audited.res.status, 400)
    assert.match(String(audited.json.msg ?? ''), /反审/)
  })
})
