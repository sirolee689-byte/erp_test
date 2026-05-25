/**
 * 销售订单生命周期集成测试（issue 03）
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

const e2ePort = Number(process.env.SALES_ORDER_LC_E2E_PORT ?? 3014)
const e2eAccount = String(process.env.E2E_USERCODE ?? '001').trim()
const e2ePassword = String(process.env.E2E_PASSWORD ?? '')

const TEST_CUSTOMER_CODE = 'CNS-0001'
const TEST_CURRENCY_ID = '1'
const PRODUCT_A = 'BAG-PQ3672A1/G-TEST'

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
  authToken = String(json?.data?.token ?? '').trim()
  assert.ok(authToken)
}

function newTestPi() {
  const pi = `PI-LC-${Date.now()}`
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

async function apiLifecycle(id, action) {
  const res = await fetch(`${apiBase}/api/sales-order/${id}/${action}`, {
    method: 'POST',
    headers: authHeaders(),
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

async function createMinimalOrder(piNo) {
  const created = await apiPostOrder({
    header: baseHeader(piNo),
    lines: [{ kcaa01: PRODUCT_A, orderQty: 1 }],
  })
  assert.equal(created.json.code, 200, created.json.msg)
  return created.json.data.id
}

describe('sales order lifecycle integration', { skip: !hasE2e }, () => {
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

  test('软删后同 PI 不可新建；彻底删后可新建', async () => {
    const piNo = newTestPi()
    const id = await createMinimalOrder(piNo)

    const soft = await apiLifecycle(id, 'soft-delete')
    assert.equal(soft.json.code, 200, soft.json.msg)

    const dup = await apiPostOrder({
      header: baseHeader(piNo),
      lines: [{ kcaa01: PRODUCT_A, orderQty: 1 }],
    })
    assert.equal(dup.res.status, 400)
    assert.match(String(dup.json.msg ?? ''), /已存在/)

    const hard = await apiLifecycle(id, 'hard-delete')
    assert.equal(hard.json.code, 200, hard.json.msg)

    const again = await apiPostOrder({
      header: baseHeader(piNo),
      lines: [{ kcaa01: PRODUCT_A, orderQty: 1 }],
    })
    assert.equal(again.json.code, 200, again.json.msg)
    cleanupPiNos.push(piNo)
  })

  test('软删前审核再软删返回 400', async () => {
    const piNo = newTestPi()
    const id = await createMinimalOrder(piNo)
    const appr = await apiLifecycle(id, 'approve')
    assert.equal(appr.json.code, 200)

    const soft = await apiLifecycle(id, 'soft-delete')
    assert.equal(soft.res.status, 400)
    assert.match(String(soft.json.msg ?? ''), /反审/)
  })

  test('恢复后 pass 与软删前一致', async () => {
    const piNo = newTestPi()
    const id = await createMinimalOrder(piNo)
    await apiLifecycle(id, 'approve')
    const soft = await apiLifecycle(id, 'soft-delete')
    assert.equal(soft.res.status, 400)

    const unap = await apiLifecycle(id, 'unapprove')
    assert.equal(unap.json.code, 200)

    const soft2 = await apiLifecycle(id, 'soft-delete')
    assert.equal(soft2.json.code, 200)

    const restore = await apiLifecycle(id, 'restore')
    assert.equal(restore.json.code, 200)

    const detail = await apiGetOrder(id)
    assert.equal(detail.json.data?.header?.pass, '0')
    assert.equal(detail.json.data?.header?.del, '0')
  })
})
