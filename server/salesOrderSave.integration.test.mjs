/**
 * 销售订单保存 + PI BOM 对齐集成测试（issue 02）
 * 需 .env：DB_*、E2E_USERCODE、E2E_PASSWORD
 */
import assert from 'node:assert/strict'
import dotenv from 'dotenv'
import { spawn } from 'node:child_process'
import { createConnection } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, describe, test } from 'node:test'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

dotenv.config({ path: join(root, '.env') })

const hasE2e =
  Boolean(process.env.DB_SERVER && process.env.E2E_USERCODE && process.env.E2E_PASSWORD)

const e2ePort = Number(process.env.SALES_ORDER_SAVE_E2E_PORT ?? 3013)
const e2eAccount = String(process.env.E2E_USERCODE ?? '001').trim()
const e2ePassword = String(process.env.E2E_PASSWORD ?? '')

const TEST_CUSTOMER_CODE = 'CNS-0001'
const TEST_CURRENCY_ID = '1'
const PRODUCT_A = 'BAG-PQ3672A1/G-TEST'
const PRODUCT_B = 'BAG-PQTEST/BLU2'

/** @type {import('node:child_process').ChildProcess | null} */
let serverChild = null
/** @type {string} */
let apiBase = ''
/** @type {string} */
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
  const env = { ...process.env, PORT: String(e2ePort) }
  serverChild = spawn(process.execPath, [join(root, 'server', 'index.js')], {
    cwd: root,
    env,
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
  assert.equal(json.code, 200)
  authToken = String(json?.data?.token ?? '').trim()
  assert.ok(authToken)
}

function newTestPi() {
  const pi = `PI-TDD-${Date.now()}`
  cleanupPiNos.push(pi)
  return pi
}

async function apiPostOrder(body) {
  const res = await fetch(`${apiBase}/api/sales-order`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  return { res, json }
}

async function apiPutOrder(id, body) {
  const res = await fetch(`${apiBase}/api/sales-order/${id}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  return { res, json }
}

async function apiGetOrder(id) {
  const res = await fetch(`${apiBase}/api/sales-order/${id}`, { headers: authHeaders() })
  const json = await res.json().catch(() => ({}))
  return { res, json }
}

async function countPiBomHeads(piNo) {
  const { getPool, sql } = await import('./db.js')
  const pool = await getPool()
  const r = await pool.request().input('pi', sql.NVarChar(200), piNo).query(`
    SELECT LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL([kcaa01], N'')))) AS kcaa01
    FROM dbo.[UB_ERP_Bom_Sales]
    WHERE LTRIM(RTRIM(ISNULL([sid], N''))) = @pi
  `)
  return (r.recordset ?? []).map((row) => String(row.kcaa01 ?? '').trim()).filter(Boolean)
}

async function samplePiBomListUsage(piNo, productKcaa01) {
  const { getPool, sql } = await import('./db.js')
  const pool = await getPool()
  const r = await pool
    .request()
    .input('pi', sql.NVarChar(200), piNo)
    .input('p', sql.NVarChar(300), productKcaa01)
    .query(`
      SELECT TOP 1 CAST(l.[kcac04] AS decimal(18, 6)) AS kcac04
      FROM dbo.[UB_ERP_Bom_Sales_list] AS l
      INNER JOIN dbo.[UB_ERP_Bom_Sales] AS h
        ON LTRIM(RTRIM(ISNULL(h.[sid], N''))) = @pi
       AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(h.[kcaa01], N'')))) = @p
      WHERE LTRIM(RTRIM(ISNULL(l.[sid], N''))) = @pi
        AND LTRIM(RTRIM(ISNULL(CAST(l.[kcac01] AS nvarchar(500)), N''))) =
            LTRIM(RTRIM(ISNULL(CAST(h.[systemcode] AS nvarchar(500)), N'')))
    `)
  return Number(r.recordset?.[0]?.kcac04 ?? 0)
}

async function hardDeleteTestPi(piNo) {
  const { getPool, sql } = await import('./db.js')
  const pool = await getPool()
  const pi = String(piNo).trim()
  await pool.request().input('pi', sql.NVarChar(200), pi).query(`
    DELETE FROM dbo.[UB_ERP_Bom_Sales_list] WHERE LTRIM(RTRIM(ISNULL([sid], N''))) = @pi;
    DELETE FROM dbo.[UB_ERP_Bom_Sales] WHERE LTRIM(RTRIM(ISNULL([sid], N''))) = @pi;
    DELETE FROM dbo.[UB_ERP_Sales_order_list] WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([xsak01], N'')))) = @pi;
    DELETE FROM dbo.[UB_ERP_Sales_order] WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([xsaj01], N'')))) = @pi;
  `)
}

function baseHeader(piNo) {
  return {
    piNo,
    salesDate: '2026-05-24',
    deliveryDate: '2026-06-01',
    customerCode: TEST_CUSTOMER_CODE,
    currencyCode: TEST_CURRENCY_ID,
    remark: 'TDD issue02',
    decimalPlaces: '2',
  }
}

describe('sales order save integration', { skip: !hasE2e }, () => {
  before(async () => {
    await startE2eServer()
    await loginToken()
  })

  after(async () => {
    for (const pi of cleanupPiNos) {
      try {
        await hardDeleteTestPi(pi)
      } catch {
        // ignore cleanup errors
      }
    }
    await stopE2eServer()
  })

  test('POST 新建：两款自动生成 PI BOM 头', async () => {
    const piNo = newTestPi()
    const { res, json } = await apiPostOrder({
      header: baseHeader(piNo),
      lines: [
        { kcaa01: PRODUCT_A, orderQty: 10 },
        { kcaa01: PRODUCT_B, orderQty: 5 },
      ],
    })
    assert.equal(res.status, 200, json.msg)
    assert.equal(json.code, 200)
    const heads = await countPiBomHeads(piNo)
    assert.deepEqual(heads.sort(), [PRODUCT_A, PRODUCT_B].sort())
  })

  test('PUT 删明细款：PI BOM 仅余在单款', async () => {
    const piNo = newTestPi()
    const created = await apiPostOrder({
      header: baseHeader(piNo),
      lines: [
        { kcaa01: PRODUCT_A, orderQty: 1 },
        { kcaa01: PRODUCT_B, orderQty: 1 },
      ],
    })
    assert.equal(created.json.code, 200)
    const id = created.json.data.id

    const saved = await apiPutOrder(id, {
      header: baseHeader(piNo),
      lines: [{ kcaa01: PRODUCT_B, orderQty: 2 }],
    })
    assert.equal(saved.json.code, 200, saved.json.msg)

    const heads = await countPiBomHeads(piNo)
    assert.deepEqual(heads, [PRODUCT_B])
  })

  test('PUT 仅改订货数量：标未运算', async () => {
    const piNo = newTestPi()
    const created = await apiPostOrder({
      header: baseHeader(piNo),
      lines: [{ kcaa01: PRODUCT_A, orderQty: 1 }],
    })
    const id = created.json.data.id

    const { getPool, sql } = await import('./db.js')
    const pool = await getPool()
    await pool.request().input('id', sql.Int, id).query(`
      UPDATE dbo.[UB_ERP_Sales_order] SET [is_pur] = N'1' WHERE [id] = @id
    `)

    const saved = await apiPutOrder(id, {
      header: baseHeader(piNo),
      lines: [{ kcaa01: PRODUCT_A, orderQty: 99 }],
    })
    assert.equal(saved.json.code, 200)
    assert.equal(saved.json.data?.markUncalc, true)

    const detail = await apiGetOrder(id)
    assert.equal(detail.json.data?.header?.calcStatus, '未运算')
  })

  test('PUT 未同步：PI 内子件用量保存后不变', async () => {
    const piNo = newTestPi()
    const created = await apiPostOrder({
      header: baseHeader(piNo),
      lines: [{ kcaa01: PRODUCT_A, orderQty: 1 }],
    })
    const id = created.json.data.id
    const before = await samplePiBomListUsage(piNo, PRODUCT_A)
    assert.ok(before >= 0)

    const { getPool, sql } = await import('./db.js')
    const pool = await getPool()
    const tweaked = before + 0.12345
    await pool
      .request()
      .input('pi', sql.NVarChar(200), piNo)
      .input('product', sql.NVarChar(300), PRODUCT_A)
      .input('v', sql.Decimal(18, 6), tweaked)
      .query(`
      UPDATE l SET l.[kcac04] = @v
      FROM dbo.[UB_ERP_Bom_Sales_list] AS l
      INNER JOIN dbo.[UB_ERP_Bom_Sales] AS h
        ON LTRIM(RTRIM(ISNULL(h.[sid], N''))) = @pi
       AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(h.[kcaa01], N'')))) = @product
      WHERE LTRIM(RTRIM(ISNULL(l.[sid], N''))) = @pi
        AND LTRIM(RTRIM(ISNULL(CAST(l.[kcac01] AS nvarchar(500)), N''))) =
            LTRIM(RTRIM(ISNULL(CAST(h.[systemcode] AS nvarchar(500)), N'')))
    `)

    const saved = await apiPutOrder(id, {
      header: baseHeader(piNo),
      lines: [{ kcaa01: PRODUCT_A, orderQty: 1 }],
    })
    assert.equal(saved.json.code, 200)
    const after = await samplePiBomListUsage(piNo, PRODUCT_A)
    assert.equal(after, tweaked)
  })

  test('PUT 已审单返回 400', async () => {
    const piNo = newTestPi()
    const created = await apiPostOrder({
      header: baseHeader(piNo),
      lines: [{ kcaa01: PRODUCT_A, orderQty: 1 }],
    })
    const id = created.json.data.id
    const { getPool, sql } = await import('./db.js')
    const pool = await getPool()
    await pool.request().input('id', sql.Int, id).query(`
      UPDATE dbo.[UB_ERP_Sales_order] SET [pass] = N'1' WHERE [id] = @id
    `)
    const saved = await apiPutOrder(id, {
      header: baseHeader(piNo),
      lines: [{ kcaa01: PRODUCT_A, orderQty: 2 }],
    })
    assert.equal(saved.res.status, 400)
    assert.match(String(saved.json.msg ?? ''), /反审/)
  })
})
