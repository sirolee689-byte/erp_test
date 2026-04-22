/**
 * E2E（规则 14）：宿舍电费统计报表 vs 房间总览电费（v1.1.6）
 * - 登录后分别请求报表接口与 lodging-overview（tj_date 与 year/month 对齐 2026-3）
 * - 逐房比对 c_sum_money（总览为 MAX 聚合，报表为当月最新一条落库）
 *
 * 前置：.env 中 E2E_USERCODE、E2E_PASSWORD；API 默认 http://localhost:3001
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
const outPng = join(outDir, 'dormitory-electric-report-v1.1.6.png')

const baseUrl = String(process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173').replace(/\/$/, '')
const apiBase = String(process.env.PLAYWRIGHT_API_BASE_URL ?? 'http://localhost:3001').replace(/\/$/, '')
const userCode = String(process.env.E2E_USERCODE ?? '').trim()
const password = String(process.env.E2E_PASSWORD ?? '')

function assert(cond, msg) {
  if (!cond) {
    console.error('【断言失败】', msg)
    process.exit(1)
  }
}

async function login(page) {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' })
  await page.getByPlaceholder('请输入账号').fill(userCode)
  await page.getByPlaceholder('请输入密码').fill(password)
  await page.getByRole('button', { name: '登录' }).click()
  await page.waitForLoadState('networkidle', { timeout: 30000 })
}

function normMoney(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  return Math.round(n * 100) / 100
}

async function main() {
  assert(userCode && password, '请在 .env 配置 E2E_USERCODE 与 E2E_PASSWORD')
  mkdirSync(outDir, { recursive: true })

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  try {
    await login(page)

    const token = await page.evaluate(() => localStorage.getItem('erp_token'))
    assert(token && String(token).trim(), '未读取到 erp_token')

    const headers = { Authorization: `Bearer ${String(token).trim()}` }
    const y = 2026
    const m = 3
    const tj = '2026-3'

    const [repRes, ovRes] = await Promise.all([
      fetch(`${apiBase}/api/dorm/electric-report-data?year=${y}&month=${m}`, { headers }),
      fetch(`${apiBase}/api/hr/dormitory/lodging-overview?year=${y}&month=${m}&page=1&pageSize=500&tj_date=${encodeURIComponent(tj)}`, {
        headers,
      }),
    ])

    const repJson = await repRes.json()
    const ovJson = await ovRes.json()
    assert(repJson?.code === 200, `报表接口失败：${repJson?.msg ?? repRes.status}`)
    assert(ovJson?.code === 200, `总览接口失败：${ovJson?.msg ?? ovRes.status}`)

    const repList = repJson?.data?.list ?? []
    const ovList = ovJson?.data?.list ?? []
    assert(repList.length > 0 && ovList.length > 0, '列表为空，无法比对')

    const ovByCode = new Map()
    for (const row of ovList) {
      const code = String(row?.s_code ?? '').trim()
      if (code) ovByCode.set(code, row)
    }

    let compared = 0
    let mismatches = []
    for (const r of repList) {
      const code = String(r?.room_code ?? '').trim()
      if (!code) continue
      const ov = ovByCode.get(code)
      if (!ov) continue
      compared += 1
      const a = normMoney(r?.total_money)
      const b = normMoney(ov?.c_sum_money)
      if (a != null && b != null && a !== b) {
        mismatches.push({ code, report: a, overview: b })
      }
    }

    assert(compared > 0, '未找到可交叉比对的房号（请确认两接口返回房间有交集）')
    assert(mismatches.length === 0, `电费金额不一致样例（最多列 5 条）：${JSON.stringify(mismatches.slice(0, 5))}`)

    await page.goto(`${baseUrl}/hr/dormitory/electric-report`, { waitUntil: 'domcontentloaded' })
    await page.locator('.report-table').waitFor({ state: 'visible', timeout: 30000 })
    await page.waitForTimeout(1200)
    await page.screenshot({ path: outPng, fullPage: true })
    console.log('E2E 完成：', outPng, '比对行数=', compared)
  } finally {
    await browser.close()
  }
}

main().catch((e) => {
  console.error('E2E 失败：', e)
  process.exit(1)
})
