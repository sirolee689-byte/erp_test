/**
 * 销售订单一键运算 + 物料单查询集成测试（issue 05）
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

const e2ePort = Number(process.env.SALES_ORDER_CALC_E2E_PORT ?? 3016)
const e2eAccount = String(process.env.E2E_USERCODE ?? '001').trim()
const e2ePassword = String(process.env.E2E_PASSWORD ?? '')

const TEST_CUSTOMER_CODE = 'CNS-0001'
const TEST_CURRENCY_ID = '1'
const PRODUCT_A = 'BAG-PQ3672A1/G-TEST'
const PRODUCT_B = 'BAG-PQTEST/BLU2'

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
  const pi = `PI-CALC-${Date.now()}`
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

async function apiCalculate(id, body = {}) {
  const res = await fetch(`${apiBase}/api/sales-order/${id}/calculate`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  })
  return { res, json: await res.json().catch(() => ({})) }
}

async function apiMaterialBill(id) {
  const res = await fetch(`${apiBase}/api/sales-order/${id}/material-bill`, {
    headers: authHeaders(),
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
    DELETE FROM dbo.[UB_ERP_Bom_pi_consumption] WHERE LTRIM(RTRIM(ISNULL([sid], N''))) = @pi;
    DELETE FROM dbo.[UB_ERP_Bom_pi_cost] WHERE LTRIM(RTRIM(ISNULL([sid], N''))) = @pi;
    DELETE FROM dbo.[UB_ERP_Bom_Sales_list] WHERE LTRIM(RTRIM(ISNULL([sid], N''))) = @pi;
    DELETE FROM dbo.[UB_ERP_Bom_Sales] WHERE LTRIM(RTRIM(ISNULL([sid], N''))) = @pi;
    DELETE FROM dbo.[UB_ERP_Sales_order_list] WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([xsak01], N'')))) = @pi;
    DELETE FROM dbo.[UB_ERP_Sales_order] WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL([xsaj01], N'')))) = @pi;
  `)
}

async function countPiCost(piNo, pq) {
  const { getPool, sql } = await import('./db.js')
  const pool = await getPool()
  const r = await pool
    .request()
    .input('pi', sql.NVarChar(200), piNo)
    .input('pq', sql.NVarChar(300), pq)
    .query(`
    SELECT COUNT(1) AS c FROM dbo.[UB_ERP_Bom_pi_cost]
    WHERE LTRIM(RTRIM(ISNULL([sid], N''))) = @pi
      AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL([pq], N'')))) = @pq
  `)
  return Number(r.recordset?.[0]?.c ?? 0)
}

async function countPiCostTotal(piNo) {
  const { getPool, sql } = await import('./db.js')
  const pool = await getPool()
  const r = await pool.request().input('pi', sql.NVarChar(200), piNo).query(`
    SELECT COUNT(1) AS c FROM dbo.[UB_ERP_Bom_pi_cost]
    WHERE LTRIM(RTRIM(ISNULL([sid], N''))) = @pi
  `)
  return Number(r.recordset?.[0]?.c ?? 0)
}

/** PI BOM list 行数快照 */
async function snapshotPiBomListCount(piNo) {
  const { getPool, sql } = await import('./db.js')
  const pool = await getPool()
  const r = await pool.request().input('pi', sql.NVarChar(200), piNo).query(`
    SELECT COUNT(1) AS c FROM dbo.[UB_ERP_Bom_Sales_list]
    WHERE LTRIM(RTRIM(ISNULL([sid], N''))) = @pi
  `)
  return Number(r.recordset?.[0]?.c ?? 0)
}

describe('salesOrderCalculate.integration', { skip: !hasE2e }, () => {
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

  test('未运算：双款保存后整单运算 → pi_* 且已运算', async () => {
    const pi = newTestPi()
    const created = await apiPostOrder({
      header: baseHeader(pi),
      lines: [
        { kcaa01: PRODUCT_A, orderQty: 2 },
        { kcaa01: PRODUCT_B, orderQty: 3 },
      ],
    })
    assert.equal(created.res.status, 200)
    const id = Number(created.json.data?.id)
    assert.ok(id > 0)

    const beforeBill = await apiMaterialBill(id)
    assert.equal(beforeBill.res.status, 409)

    const bomBefore = await snapshotPiBomListCount(pi)
    const calc = await apiCalculate(id)
    assert.equal(calc.res.status, 200, calc.json?.msg)
    assert.equal(calc.json.data?.calcStatus, '已运算')

    const totalCost = await countPiCostTotal(pi)
    assert.ok(totalCost > 0, '整单运算应写入 pi_cost')

    const bomAfter = await snapshotPiBomListCount(pi)
    assert.equal(bomAfter, bomBefore, '运算不得改 PI BOM list')

    const bill = await apiMaterialBill(id)
    assert.equal(bill.res.status, 200)
    assert.ok((bill.json.data?.costLines?.length ?? 0) > 0)
    assert.ok((bill.json.data?.consumptionLines?.length ?? 0) > 0)
  })

  test('改订货数量保存后未运算 → 再运算覆盖 pi_*', async () => {
    const pi = newTestPi()
    const created = await apiPostOrder({
      header: baseHeader(pi),
      lines: [{ kcaa01: PRODUCT_A, orderQty: 1 }],
    })
    const id = Number(created.json.data?.id)
    await apiCalculate(id)

    const saved = await apiPutOrder(id, {
      header: baseHeader(pi),
      lines: [{ kcaa01: PRODUCT_A, orderQty: 5 }],
    })
    assert.equal(saved.res.status, 200)
    const detail = await apiGetOrder(id)
    assert.equal(detail.json.data?.header?.calcStatus, '未运算')

    const calc2 = await apiCalculate(id)
    assert.equal(calc2.res.status, 200)
    const bill = await apiMaterialBill(id)
    const line = (bill.json.data?.costLines ?? []).find((r) => r.pq === PRODUCT_A)
    assert.ok(line)
    assert.equal(Number(line.orderQty), 5)
    assert.equal(Number(line.prepQty), Number(line.kcac04) * 5)
  })

  test('已运算 + 仅同步 B 后部分重算 → 仅 B 的 pi_cost 变化', async () => {
    const pi = newTestPi()
    const created = await apiPostOrder({
      header: baseHeader(pi),
      lines: [
        { kcaa01: PRODUCT_A, orderQty: 1 },
        { kcaa01: PRODUCT_B, orderQty: 1 },
      ],
    })
    const id = Number(created.json.data?.id)
    const calc1 = await apiCalculate(id)
    assert.equal(calc1.res.status, 200, calc1.json?.msg)

    const countBeforeA = await countPiCost(pi, PRODUCT_A)
    assert.ok(countBeforeA > 0, 'TEST1 款应有物料单明细')
    const countBeforeB = await countPiCost(pi, PRODUCT_B)

    await apiSyncBom(id, PRODUCT_B)
    const partial = await apiCalculate(id, { syncedKcaa01: [PRODUCT_B] })
    assert.equal(partial.res.status, 200)
    assert.equal(partial.json.data?.mode, 'partial')

    const countAfterA = await countPiCost(pi, PRODUCT_A)
    assert.equal(countAfterA, countBeforeA, '部分重算不得改动 TEST1 物料单')
  })
})
