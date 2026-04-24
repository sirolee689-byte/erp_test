/**
 * 临时起后端 → Playwright 调 POST /api/login（admin/123）→ 截图保存
 * 用法：node scripts/playwright-login-admin-screenshot.mjs
 */
import dotenv from 'dotenv'
import { spawn } from 'node:child_process'
import { mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createConnection } from 'node:net'
import { chromium } from 'playwright'

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '.env') })

const port = Number(process.env.SMOKE_PORT ?? 3012)
const account = 'admin'
const password = '123'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'e2e-output')
const shotPath = join(outDir, 'login-admin-success.png')

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
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })

  const child = spawn(process.execPath, [join(root, 'server', 'index.js')], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: 'ignore',
  })

  try {
    await waitPort(port, 25000)
    await new Promise((r) => setTimeout(r, 400))

    const res = await fetch(`http://127.0.0.1:${port}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ Account: account, Password: password }),
    })
    const json = await res.json().catch(() => ({}))

    const browser = await chromium.launch({ headless: true })
    const page = await browser.newPage()
    const safeJson = JSON.stringify(json, null, 2)
      .replace(/</g, '\\u003c')
      .replace(/&/g, '\\u0026')
    await page.setContent(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>登录结果</title>
      <style>body{font-family:Segoe UI,Microsoft YaHei,sans-serif;padding:24px;background:#f5f7fa;}
      h1{color:#16a34a;} pre{background:#fff;border:1px solid #e5e7eb;padding:16px;border-radius:8px;}</style></head>
      <body><h1>Playwright 登录冒烟：成功</h1>
      <p>账号：<strong>${account}</strong> · 后端端口：<strong>${port}</strong> · HTTP <strong>${res.status}</strong></p>
      <pre>${safeJson}</pre></body></html>`)
    await page.screenshot({ path: shotPath, fullPage: true })
    await browser.close()

    console.log('截图已保存：', shotPath)
    if (res.status !== 200 || json?.code !== 200) {
      console.error('登录未成功：', res.status, json)
      process.exit(1)
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
