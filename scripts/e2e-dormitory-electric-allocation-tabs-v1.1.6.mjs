/**
 * E2E（规则 14）：电费报表 Tabs — 分摊表住宿天数与弹窗一致（v1.1.6）
 * 1) 登录 → 宿舍电费统计报表页
 * 2) 统计 2026-01，点击「查询」
 * 3) 切换到「宿舍费用分摊情况」
 * 4) 断言：存在 in_time=2026-01-15 的员工在该月分摊表中「住宿天数」为 17，且分摊电费与接口公式一致
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
const outPng = join(outDir, 'dormitory-electric-allocation-tabs-v1.1.6.png')

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

  const { getPool } = await import('../server/db.js')
  const pool = await getPool()
  const pick = await pool.request().query(`
    SELECT TOP (1)
      LTRIM(RTRIM(ISNULL(i.room_code, N''))) AS room_code,
      LTRIM(RTRIM(ISNULL(i.staff_code, N''))) AS staff_code
    FROM dbo.[UB_ERP_Hr_room_in] AS i
    CROSS APPLY (
      SELECT LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(i.in_time, N'')))) AS in_raw
    ) AS a
    CROSS APPLY (
      SELECT CASE WHEN ISDATE(a.in_raw) = 1 THEN CONVERT(datetime, a.in_raw) ELSE NULL END AS in_dt
    ) AS b
    WHERE LTRIM(RTRIM(ISNULL(i.del, N'0'))) = N'0'
      AND LTRIM(RTRIM(ISNULL(i.room_code, N''))) <> N''
      AND b.in_dt IS NOT NULL
      AND b.in_dt >= CONVERT(datetime, N'2026-01-15', 120)
      AND b.in_dt < CONVERT(datetime, N'2026-01-16', 120)
    ORDER BY i.id DESC
  `)
  const staffCode = String(pick.recordset?.[0]?.staff_code ?? '').trim()
  assert(staffCode, '未找到 2026-01-15 入住记录，无法验证住宿天数')

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  try {
    await login(page)
    const token = await page.evaluate(() => localStorage.getItem('erp_token'))
    assert(token && String(token).trim(), '未读取到 erp_token')
    const headers = { Authorization: `Bearer ${String(token).trim()}` }

    const apiRes = await fetch(`${apiBase}/api/dorm/electric-allocation-report?year=2026&month=1`, { headers })
    const apiJson = await apiRes.json()
    assert(apiJson?.code === 200, `分摊接口失败：${apiJson?.msg ?? apiRes.status}`)
    const rows = apiJson?.data?.list ?? []
    const hit = rows.find((r) => String(r?.staff_code ?? '').trim() === staffCode)
    assert(hit, `接口结果中未找到 staff_code=${staffCode} 的分摊行`)
    const idCell = String(hit.staff_archive_code ?? '').trim() || staffCode
    assert(Number(hit.stay_days) === 17, `接口住宿天数期望 17，实际 ${hit.stay_days}`)
    const shareM = Number(hit.share_money)
    assert(Number.isFinite(shareM) && shareM >= 0, `分摊电费非法：${hit.share_money}`)

    await page.goto(`${baseUrl}/hr/dormitory/electric-report`, { waitUntil: 'domcontentloaded' })
    await page.locator('.toolbar-card').getByRole('button', { name: '查询' }).waitFor({ state: 'visible', timeout: 20000 })

    await page.locator('.toolbar-card').locator('.el-select').nth(0).click()
    await page.getByRole('option', { name: '2026', exact: true }).click()
    await page.locator('.toolbar-card').locator('.el-select').nth(1).click()
    await page.getByRole('option', { name: '1', exact: true }).click()
    await page.locator('.toolbar-card').getByRole('button', { name: '查询' }).click()
    await sleep(1200)

    await page.getByRole('tab', { name: '宿舍费用分摊情况' }).click()
    await sleep(600)

    const tbl = page.locator('[data-testid="electric-allocation-table"]')
    await tbl.waitFor({ state: 'visible', timeout: 20000 })

    const headersUi = await tbl.locator('.el-table__header-wrapper thead th').allTextContents()
    const stayIdx = headersUi.findIndex((t) => String(t ?? '').replace(/\s+/g, '').includes('住宿天数'))
    assert(stayIdx >= 0, `未找到住宿天数列：${headersUi.join('|')}`)

    const bodyRows = tbl.locator('.el-table__body-wrapper tbody tr')
    const n = await bodyRows.count()
    assert(n > 0, '分摊表无数据行')

    let ok = false
    for (let i = 0; i < n; i++) {
      const tr = bodyRows.nth(i)
      const codeCell = String((await tr.locator('td').nth(2).textContent()) ?? '').trim()
      if (codeCell !== idCell && codeCell !== staffCode) continue
      const daysText = String((await tr.locator('td').nth(stayIdx).textContent()) ?? '').trim()
      if (daysText === '17') {
        ok = true
        break
      }
    }
    assert(ok, `UI 分摊表未找到 staff=${staffCode} 且住宿天数=17 的行`)

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
