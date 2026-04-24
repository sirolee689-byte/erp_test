/**
 * E2E：房间列表跨月在住过滤（v1.1.7）
 * 目标：
 * 1) 进入「住宿管理」→ 房间列表
 * 2) 将设定日期切换到 2026-01
 * 3) 截图证明：in_time 为 2026-02-26 的员工“朱超梅”不出现在 1 月的入住人员列
 *
 * 前置：.env 中 E2E_USERCODE、E2E_PASSWORD；本地 Vite(5173) + API(3001)。
 */
import dotenv from 'dotenv'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

dotenv.config()

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const outDir = join(root, 'e2e-output')
const outPng = join(outDir, 'dormitory-overview-month-filter-v1.1.7.png')

const baseUrl = String(process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173').replace(/\/$/, '')
const userCode = String(process.env.E2E_USERCODE ?? '').trim()
const password = String(process.env.E2E_PASSWORD ?? '')

function assert(cond, msg) {
  if (!cond) {
    console.error('【断言失败】', msg)
    process.exit(1)
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function login(page) {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' })
  await page.getByPlaceholder('请输入用户名或编码').fill(userCode)
  await page.getByPlaceholder('请输入密码').fill(password)
  await page.getByRole('button', { name: '登录' }).click()
  await page.waitForLoadState('networkidle', { timeout: 30000 })
}

async function main() {
  assert(userCode && password, '请在 .env 配置 E2E_USERCODE 与 E2E_PASSWORD')
  mkdirSync(outDir, { recursive: true })

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  try {
    await login(page)
    await page.goto(`${baseUrl}/hr/dormitory/lodging-records`, { waitUntil: 'domcontentloaded' })
    await page.locator('.el-table').first().waitFor({ state: 'visible', timeout: 30000 })
    await sleep(800)

    // 设定日期：2026 年 1 月
    const filter = page.locator('.filter-card').first()
    const yearInput = filter.locator('input').nth(0)
    const monthInput = filter.locator('input').nth(1)
    await yearInput.fill('2026')
    await monthInput.fill('1')
    await filter.getByRole('button', { name: '立即查询' }).click()
    await sleep(1500)

    const tableText = String((await page.locator('[data-testid=\"room-list-table\"]').textContent()) ?? '')
    assert(!tableText.includes('朱超梅'), '1 月列表仍出现“朱超梅”，跨月过滤未生效')

    await page.screenshot({ path: outPng, fullPage: true })
    console.log('E2E 完成：', outPng)
  } finally {
    await browser.close()
  }
}

main().catch((e) => {
  console.error('E2E 失败：', e)
  process.exit(1)
})

