/**
 * 验收：采购入库批量添加 → 保存已选数据 → 子窗口应自动关闭且主页面有明细
 * 前置：npm run dev (5173) + npm run dev:server (3001)
 */
import dotenv from 'dotenv'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, request } from 'playwright'

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '.env') })

const FRONT = 'http://localhost:5173'
const API = 'http://localhost:3001'
const account = String(process.env.E2E_USERCODE ?? '001').trim()
const password = String(process.env.E2E_PASSWORD ?? '123')

async function login() {
  const ctx = await request.newContext({ baseURL: API })
  const res = await ctx.post('/api/login', { data: { Account: account, Password: password } })
  const json = await res.json().catch(() => ({}))
  await ctx.dispose()
  if (res.status() !== 200 || json?.code !== 200) {
    throw new Error(`登录失败: ${res.status()} ${JSON.stringify(json)}`)
  }
  return { token: json.data?.token, user: json.data?.user ?? json.data }
}

async function main() {
  const { token, user } = await login()
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await context.addInitScript(
    ({ t, u }) => {
      localStorage.setItem('erp_token', t)
      localStorage.setItem('erp_user', JSON.stringify(u))
    },
    { t: String(token ?? ''), u: user ?? {} },
  )

  const page = await context.newPage()
  const logs = []
  page.on('console', (msg) => logs.push(`[parent] ${msg.type()}: ${msg.text()}`))

  await page.goto(`${FRONT}/inventory/daily/stock-in`, { waitUntil: 'networkidle' })

  await page.getByRole('button', { name: '入库单添加' }).click()
  await page.getByRole('button', { name: '采购入库' }).click()
  await page.locator('.el-radio-button').filter({ hasText: /^含税$/ }).click()

  const warehouseSelect = page.locator('.stock-form--base .el-select').first()
  await warehouseSelect.click()
  await page.locator('.el-select-dropdown:visible .el-select-dropdown__item').first().click({ timeout: 10000 })

  await page.getByRole('button', { name: '选择', exact: true }).first().click()
  await page.locator('.source-order-dialog').waitFor({ state: 'visible', timeout: 15000 })
  const pickSource = page.locator('.source-order-dialog').getByRole('button', { name: '选择' }).first()
  await pickSource.click({ timeout: 15000 })
  await page.locator('.source-order-dialog').waitFor({ state: 'hidden', timeout: 10000 })

  await page.getByRole('tab', { name: '入库单明细' }).click()

  const batchOpen = context.waitForEvent('page')
  await page.getByRole('button', { name: '批量添加' }).click()
  const batchPage = await batchOpen
  batchPage.on('console', (msg) => logs.push(`[batch] ${msg.type()}: ${msg.text()}`))
  batchPage.on('pageerror', (err) => logs.push(`[batch-pageerror] ${err.message}`))
  await batchPage.waitForLoadState('networkidle')

  const pickLine = batchPage.locator('tbody tr').first().getByRole('button', { name: /选择|已选择/ }).first()
  await pickLine.waitFor({ state: 'visible', timeout: 20000 })
  const pickLabel = await pickLine.innerText()
  if (pickLabel.includes('选择') && !pickLabel.includes('已选择')) {
    await pickLine.click()
  }

  const saveBtn = batchPage.getByRole('button', { name: '保存已选数据' })
  await saveBtn.click()

  let closed = false
  try {
    await batchPage.waitForEvent('close', { timeout: 8000 })
    closed = true
  } catch {
    closed = batchPage.isClosed()
  }

  await page.waitForTimeout(500)
  const lineRows = await page.locator('.stock-form-tabs .erp-list-table tbody tr').count()
  const batchStillOpen = !batchPage.isClosed()
  const batchUrl = batchStillOpen ? batchPage.url() : '(closed)'

  console.log('=== E2E 采购入库批量添加关窗 ===')
  console.log('子窗口已关闭:', closed && !batchStillOpen)
  console.log('主页面明细行数:', lineRows)
  console.log('子窗口状态:', batchUrl)
  if (batchStillOpen) {
    const hint = await batchPage.locator('.stock-batch-close-hint, .el-message').allTextContents().catch(() => [])
    console.log('子窗口提示:', hint.join(' | ') || '(无)')
  }
  if (logs.length) {
    console.log('--- console ---')
    logs.slice(-20).forEach((l) => console.log(l))
  }

  await browser.close()

  if (!closed || batchStillOpen) {
    console.error('FAIL: 子窗口未在预期时间内关闭')
    process.exit(1)
  }
  if (lineRows < 1) {
    console.error('FAIL: 主页面未出现入库明细')
    process.exit(1)
  }
  console.log('PASS')
}

main().catch((e) => {
  console.error('e2e_failed', e?.message ?? e)
  process.exit(1)
})
