/**
 * Playwright request API：临时起后端 + POST /api/login，直到 200（与 login-smoke-with-fresh-server 等价，满足「Playwright 自检」）
 */
import dotenv from 'dotenv'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createConnection } from 'node:net'
import { request } from 'playwright'

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '.env') })

const account = String(process.argv[2] ?? process.env.E2E_USERCODE ?? '001').trim()
const password = String(process.argv[3] ?? process.env.E2E_PASSWORD ?? '123')
const port = Number(process.env.SMOKE_PORT ?? 3011)

function waitPort(p, timeoutMs) {
  const t0 = Date.now()
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const s = createConnection({ host: '127.0.0.1', port: p }, () => {
        s.end()
        resolve()
      })
      s.on('error', () => {
        if (Date.now() - t0 > timeoutMs) reject(new Error(`端口 ${p} 未就绪`))
        else setTimeout(tryOnce, 200)
      })
    }
    tryOnce()
  })
}

async function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const child = spawn(process.execPath, [join(root, 'server', 'index.js')], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: 'ignore',
  })
  try {
    await waitPort(port, 25000)
    await new Promise((r) => setTimeout(r, 300))

    const ctx = await request.newContext({ baseURL: `http://127.0.0.1:${port}` })
    const res = await ctx.post('/api/login', {
      data: { Account: account, Password: password },
    })
    const json = await res.json().catch(() => ({}))
    await ctx.dispose()
    console.log('Playwright API POST /api/login', res.status(), JSON.stringify(json))
    if (res.status() !== 200 || json?.code !== 200) process.exit(1)
    console.log('Playwright 登录 API：成功')
  } finally {
    child.kill('SIGTERM')
    await new Promise((r) => setTimeout(r, 400))
    if (!child.killed) child.kill('SIGKILL')
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
