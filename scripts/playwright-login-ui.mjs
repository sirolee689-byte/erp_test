/**
 * Playwright：打开登录页并提交，断言进入后台（依赖 Vite 代理到后端）
 * 用法：PLAYWRIGHT_BASE_URL=http://localhost:5173 node scripts/playwright-login-ui.mjs
 */
import dotenv from 'dotenv'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '.env') })

const baseUrl = String(process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173').replace(/\/$/, '')
const account = String(process.env.E2E_USERCODE ?? '001').trim()
const password = String(process.env.E2E_PASSWORD ?? '123').trim()

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  try {
    await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.getByPlaceholder('请输入用户名或编码').fill(account)
    await page.getByPlaceholder('请输入密码').fill(password)
    await page.getByRole('button', { name: '登录' }).click()
    await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 30000 })
    const token = await page.evaluate(() => localStorage.getItem('erp_token'))
    if (!token) throw new Error('localStorage 无 erp_token')
    console.log('Playwright 登录 UI：成功', { path: page.url() })
  } finally {
    await browser.close()
  }
}

main().catch((e) => {
  console.error('Playwright 登录失败：', e?.message ?? e)
  process.exit(1)
})
