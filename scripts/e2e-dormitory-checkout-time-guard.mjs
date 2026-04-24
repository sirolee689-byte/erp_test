/**
 * E2E：退宿时间校验（退宿时间不得小于入住时间）
 * 流程：
 * 1) 登录
 * 2) 打开“房间列表”，找入住人数>0的房间进入“入住管理”
 * 3) 对第一条在住人员点“退宿”，把退宿日期设置为比入住日期早一天
 * 4) 点击确认，断言提示为「退宿时间不得小于入住时间」，并截图
 *
 * 前置：.env 中 E2E_USERCODE、E2E_PASSWORD；本地 Vite(5173) + API(3001)
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
const outPng = join(outDir, 'dormitory-checkout-time-guard.png')

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

function ymdMinus1(ymd) {
  const m = String(ymd || '').trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (!m) return ''
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  d.setDate(d.getDate() - 1)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
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

    const rows = page.locator('.el-table__body-wrapper tbody tr')
    const n = await rows.count()
    assert(n > 0, '房间列表无数据')
    let target = null
    for (let i = 0; i < n; i++) {
      const row = rows.nth(i)
      const liveText = String((await row.locator('td').nth(5).textContent()) ?? '').trim()
      const live = Number(liveText)
      if (Number.isFinite(live) && live > 0) {
        target = row
        break
      }
    }
    assert(target, '未找到入住人数>0的房间')

    await target.getByRole('button', { name: '入住管理' }).click()
    const dlg = page.getByRole('dialog', { name: '入住管理' })
    await dlg.waitFor({ state: 'visible', timeout: 15000 })

    const occRow = dlg.locator('.el-table__body tr').first()
    await occRow.waitFor({ state: 'visible', timeout: 15000 })
    const inTime = String((await occRow.locator('td').nth(0).textContent()) ?? '').trim()
    const inDate = String(inTime.split(' ')[0] ?? '').trim()
    assert(inDate, `未读取到入住日期：${inTime}`)

    await occRow.getByRole('button', { name: '退宿' }).click()
    const outDlg = page.getByRole('dialog', { name: '办理退宿' })
    await outDlg.waitFor({ state: 'visible', timeout: 10000 })

    const badDate = ymdMinus1(inDate)
    assert(badDate, `无法计算前一天日期：${inDate}`)
    await outDlg.locator('.el-form-item').filter({ hasText: '退宿日期' }).locator('input').first().fill(badDate)

    await outDlg.getByRole('button', { name: '确认退宿' }).click()

    const msg = page.locator('.el-message').first()
    await msg.waitFor({ state: 'visible', timeout: 10000 })
    const txt = String((await msg.textContent()) ?? '')
    assert(txt.includes('退宿时间不得小于入住时间'), `未命中拦截提示：${txt}`)

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

