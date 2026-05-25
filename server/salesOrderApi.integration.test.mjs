/**
 * 销售订单 API 集成测试（循环 4）
 * - 起临时后端，避免命中未重启的 3001 旧进程
 * - 需 .env：DB_*、E2E_USERCODE、E2E_PASSWORD
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

const e2ePort = Number(process.env.SALES_ORDER_E2E_PORT ?? 3012)
const e2eAccount = String(process.env.E2E_USERCODE ?? '001').trim()
const e2ePassword = String(process.env.E2E_PASSWORD ?? '')

/** @type {import('node:child_process').ChildProcess | null} */
let serverChild = null
/** @type {string} */
let apiBase = ''

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
  await new Promise((r) => setTimeout(r, 500))
  apiBase = `http://127.0.0.1:${e2ePort}`
}

async function stopE2eServer() {
  if (!serverChild) return
  serverChild.kill('SIGTERM')
  await new Promise((r) => setTimeout(r, 400))
  if (!serverChild.killed) serverChild.kill('SIGKILL')
  serverChild = null
}

async function loginToken() {
  const res = await fetch(`${apiBase}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ Account: e2eAccount, Password: e2ePassword }),
  })
  const json = await res.json().catch(() => ({}))
  assert.equal(res.status, 200, `登录 HTTP ${res.status}`)
  assert.equal(json.code, 200, `登录失败：${json.msg ?? JSON.stringify(json)}`)
  const token = String(json?.data?.token ?? '').trim()
  assert.ok(token, '登录响应缺少 token')
  return token
}

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
}

describe('sales order API integration', { skip: !hasE2e }, () => {
  before(async () => {
    await startE2eServer()
  })

  after(async () => {
    await stopE2eServer()
  })

  test('未登录访问列表返回 401', async () => {
    const res = await fetch(`${apiBase}/api/sales-order/list`)
    assert.equal(res.status, 401)
  })

  test('GET list 返回 total 与 list 数组', async () => {
    const token = await loginToken()
    const res = await fetch(`${apiBase}/api/sales-order/list?page=1&pageSize=5`, {
      headers: authHeaders(token),
    })
    const json = await res.json()
    assert.equal(res.status, 200, json.msg ?? res.status)
    assert.equal(json.code, 200)
    assert.ok(json.data && typeof json.data.total === 'number')
    assert.ok(Array.isArray(json.data.list))
    if (json.data.list.length > 0) {
      const row = json.data.list[0]
      assert.ok('piNo' in row)
      assert.ok('pass' in row)
      assert.ok('del' in row)
      assert.ok('calcStatus' in row)
      assert.match(String(row.calcStatus), /已运算|未运算/)
    }
  })

  test('GET :id 返回 header 与 lines（含 kcaa01、orderQty）', async () => {
    const token = await loginToken()
    const listRes = await fetch(`${apiBase}/api/sales-order/list?page=1&pageSize=20`, {
      headers: authHeaders(token),
    })
    const listJson = await listRes.json()
    assert.equal(listJson.code, 200)
    const rows = listJson.data?.list ?? []
    assert.ok(rows.length > 0, '库中需至少一条在册销售订单供详情测试')

    const withLines = []
    for (const row of rows) {
      const id = row.id
      const detailRes = await fetch(`${apiBase}/api/sales-order/${id}`, {
        headers: authHeaders(token),
      })
      const detailJson = await detailRes.json()
      assert.equal(detailRes.status, 200, detailJson.msg)
      assert.equal(detailJson.code, 200)
      assert.ok(detailJson.data?.header?.piNo)
      assert.equal(detailJson.data.header.id, id)
      assert.ok(Array.isArray(detailJson.data.lines))
      if (detailJson.data.lines.length > 0) {
        withLines.push(detailJson)
        break
      }
    }

    assert.ok(withLines.length > 0, '前 20 条中应至少有一条含明细行')
    const line = withLines[0].data.lines[0]
    assert.ok(String(line.kcaa01 ?? '').trim(), '明细应有货品编码 kcaa01')
    assert.ok(line.orderQty != null && Number(line.orderQty) > 0, '明细应有订货数量 orderQty > 0')
  })

  test('GET :id 非法参数返回 400', async () => {
    const token = await loginToken()
    const res = await fetch(`${apiBase}/api/sales-order/abc`, {
      headers: authHeaders(token),
    })
    const json = await res.json()
    assert.equal(res.status, 400)
    assert.equal(json.code, 400)
  })
})
