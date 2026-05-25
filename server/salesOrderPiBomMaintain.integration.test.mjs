/**
 * 销售订单 PI BOM 维护集成测试（issue 06）
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

const e2ePort = Number(process.env.SALES_ORDER_PIBOM_E2E_PORT ?? 3016)
const e2eAccount = String(process.env.E2E_USERCODE ?? '001').trim()
const e2ePassword = String(process.env.E2E_PASSWORD ?? '')

const TEST_CUSTOMER_CODE = 'CNS-0001'
const TEST_CURRENCY_ID = '1'
const PRODUCT_A = 'BAG-PQ3672A1/G-TEST'

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
  const pi = `PI-PIBOM-${Date.now()}`
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

async function apiPutOrder(id, body) {
  const res = await fetch(`${apiBase}/api/sales-order/${id}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(body),
  })
  return { res, json: await res.json().catch(() => ({})) }
}

async function apiGetPiBom(id, kcaa01) {
  const q = kcaa01 ? `?kcaa01=${encodeURIComponent(kcaa01)}` : ''
  const res = await fetch(`${apiBase}/api/sales-order/${id}/pi-bom${q}`, { headers: authHeaders() })
  return { res, json: await res.json().catch(() => ({})) }
}

async function apiPutPiBom(id, body) {
  const res = await fetch(`${apiBase}/api/sales-order/${id}/pi-bom`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(body),
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

describe('salesOrderPiBomMaintain integration', { skip: !hasE2e }, () => {
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

  test('GET 款列表与树；PUT 改用量后未运算且保存订单不覆盖', async () => {
    const piNo = newTestPi()
    const created = await apiPostOrder({
      header: baseHeader(piNo),
      lines: [{ kcaa01: PRODUCT_A, orderQty: 1 }],
    })
    assert.equal(created.res.status, 200)
    const id = created.json.data.id

    const listRes = await apiGetPiBom(id, '')
    assert.equal(listRes.res.status, 200)
    const products = listRes.json.data?.products ?? []
    assert.ok(products.some((p) => p.kcaa01 === PRODUCT_A && p.hasBom))

    const treeRes = await apiGetPiBom(id, PRODUCT_A)
    assert.equal(treeRes.res.status, 200)
    const flat = treeRes.json.data?.flat ?? []
    assert.ok(flat.length > 0)
    const target = flat[0]
    const newUsage = round6(Number(target.kcac04 ?? 0) + 0.2)

    const saved = await apiPutPiBom(id, {
      kcaa01: PRODUCT_A,
      lines: flat.map((row) =>
        row.id === target.id
          ? { id: row.id, kcac04: newUsage, kcac05: row.kcac05, Describe: row.Describe }
          : { id: row.id, kcac04: row.kcac04, kcac05: row.kcac05, Describe: row.Describe },
      ),
    })
    assert.equal(saved.res.status, 200)
    assert.equal(saved.json.data?.markUncalc, true)

    const detail = await apiGetOrder(id)
    assert.equal(detail.json.data?.header?.calcStatus, '未运算')

    const afterTree = await apiGetPiBom(id, PRODUCT_A)
    const hit = (afterTree.json.data?.flat ?? []).find((r) => r.id === target.id)
    assert.ok(hit)
    assert.equal(round6(hit.kcac04), newUsage)

    const orderSaved = await apiPutOrder(id, {
      header: baseHeader(piNo),
      lines: [{ kcaa01: PRODUCT_A, orderQty: 1 }],
    })
    assert.equal(orderSaved.res.status, 200)

    const afterOrder = await apiGetPiBom(id, PRODUCT_A)
    const hit2 = (afterOrder.json.data?.flat ?? []).find((r) => r.id === target.id)
    assert.equal(round6(hit2?.kcac04), newUsage)
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

    const treeRes = await apiGetPiBom(id, PRODUCT_A)
    const flat = treeRes.json.data?.flat ?? []
    assert.ok(flat.length > 0)

    const saved = await apiPutPiBom(id, {
      kcaa01: PRODUCT_A,
      lines: [{ id: flat[0].id, kcac04: 0.99, kcac05: 0 }],
    })
    assert.equal(saved.res.status, 400)
    assert.match(String(saved.json.msg ?? ''), /反审/)
  })
})

function round6(n) {
  return Math.round(Number(n) * 1e6) / 1e6
}
