/**
 * 起临时后端（新进程加载当前代码）并验证 POST /api/login，避免命中未重启的旧 node 进程
 * 用法：node scripts/login-smoke-with-fresh-server.mjs [账号] [密码]
 */
import dotenv from 'dotenv'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createConnection } from 'node:net'

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '.env') })

const account = String(process.argv[2] ?? process.env.E2E_USERCODE ?? '001').trim()
const password = String(process.argv[3] ?? process.env.E2E_PASSWORD ?? '123')
const port = Number(process.env.SMOKE_PORT ?? 3011)

function waitPort(host, p, timeoutMs) {
  const t0 = Date.now()
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const s = createConnection({ host, port: p }, () => {
        s.end()
        resolve()
      })
      s.on('error', () => {
        if (Date.now() - t0 > timeoutMs) reject(new Error(`端口 ${p} 在 ${timeoutMs}ms 内未就绪`))
        else setTimeout(tryOnce, 200)
      })
    }
    tryOnce()
  })
}

async function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const env = { ...process.env, PORT: String(port) }
  const child = spawn(process.execPath, [join(root, 'server', 'index.js')], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let bootLog = ''
  child.stdout?.on('data', (c) => {
    bootLog += c.toString()
  })
  child.stderr?.on('data', (c) => {
    bootLog += c.toString()
  })

  try {
    await waitPort('127.0.0.1', port, 20000)
    await new Promise((r) => setTimeout(r, 400))

    const res = await fetch(`http://127.0.0.1:${port}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ Account: account, Password: password }),
    })
    const json = await res.json().catch(() => ({}))
    console.log('POST /api/login', res.status, JSON.stringify(json))
    if (res.status !== 200 || json?.code !== 200) {
      console.error('--- 子进程最近日志 ---\n', bootLog.slice(-4000))
      process.exitCode = 1
    } else {
      console.log('登录冒烟：成功')
    }
  } finally {
    child.kill('SIGTERM')
    await new Promise((r) => setTimeout(r, 500))
    if (!child.killed) child.kill('SIGKILL')
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
