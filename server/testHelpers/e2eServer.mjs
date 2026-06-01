/**
 * 集成测试共用：临时起 Express API，避免依赖未重启的 3001 进程。
 * 需 .env：DB_*、E2E_USERCODE、E2E_PASSWORD
 */
import assert from 'node:assert/strict'
import dotenv from 'dotenv'
import { spawn } from 'node:child_process'
import { createConnection } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const e2eRoot = join(__dirname, '..', '..')

dotenv.config({ path: join(e2eRoot, '.env') })

export const hasE2eDb = Boolean(
  process.env.DB_SERVER && process.env.E2E_USERCODE && process.env.E2E_PASSWORD,
)

export const e2eAccount = String(process.env.E2E_USERCODE ?? '001').trim()
export const e2ePassword = String(process.env.E2E_PASSWORD ?? '')

/** @type {import('node:child_process').ChildProcess | null} */
let serverChild = null

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

/**
 * @param {number} port
 * @returns {Promise<string>} apiBase
 */
export async function startE2eServer(port) {
  const env = { ...process.env, PORT: String(port) }
  serverChild = spawn(process.execPath, [join(e2eRoot, 'server', 'index.js')], {
    cwd: e2eRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  await waitPort('127.0.0.1', port, 25000)
  await new Promise((r) => setTimeout(r, 800))
  return `http://127.0.0.1:${port}`
}

export async function stopE2eServer() {
  if (!serverChild) return
  serverChild.kill('SIGTERM')
  await new Promise((r) => setTimeout(r, 400))
  if (!serverChild.killed) serverChild.kill('SIGKILL')
  serverChild = null
}

/**
 * @param {string} apiBase
 */
export async function loginToken(apiBase) {
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

/** @param {string} token */
export function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
}
