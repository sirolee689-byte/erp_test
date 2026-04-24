/**
 * E2E：电费分摊 - 住宿天数权重（v1.1.9）
 * 目标：
 * 1) 打开 1 月电费弹窗
 * 2) 找到 in_time 为 1 月 15 日入住的员工，断言住宿天数=17
 * 3) 截图证明：住宿天数列存在且分摊金额已按天数权重计算
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
const outPng = join(outDir, 'dorm-electric-days-weight-v1.1.9.png')

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

  const { getPool } = await import('../server/db.js')
  const pool = await getPool()

  // 直接在数据库里挑一个“入住日期=2026-01-15”的在住记录（并要求可解析为日期）
  const pick = await pool.request().query(`
    SELECT TOP (1)
      LTRIM(RTRIM(ISNULL(i.room_code, N''))) AS room_code,
      LTRIM(RTRIM(ISNULL(i.staff_code, N''))) AS staff_code
    FROM dbo.Hr_room_in AS i
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
  const roomCode = String(pick.recordset?.[0]?.room_code ?? '').trim()
  const staffCode = String(pick.recordset?.[0]?.staff_code ?? '').trim()
  assert(roomCode && staffCode, '未找到“2026-01 月住宿天数=17”的在住记录，无法验证住宿天数列')

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  try {
    await login(page)
    await page.goto(`${baseUrl}/hr/dormitory/lodging-records`, { waitUntil: 'domcontentloaded' })
    await page.locator('.el-table').first().waitFor({ state: 'visible', timeout: 30000 })
    await sleep(800)

    // 设定日期：2026-01
    const filter = page.locator('.filter-card').first()
    await filter.locator('input').nth(0).fill('2026')
    await filter.locator('input').nth(1).fill('1')
    await filter.getByRole('button', { name: '立即查询' }).click()
    await sleep(1200)

    // 按房号过滤并打开电费管理
    const kwInput = page.getByPlaceholder('搜索入住宿舍：房号/楼栋/名称/房型')
    await kwInput.fill(roomCode)
    await filter.getByRole('button', { name: '立即查询' }).click()
    await sleep(1200)

    const rows = page.locator('.el-table__body-wrapper tbody tr')
    assert((await rows.count()) > 0, `过滤后无房间数据：${roomCode}`)
    await rows.first().getByRole('button', { name: '电费管理' }).click()

    const dlg = page.getByRole('dialog', { name: new RegExp(`电费管理中心\\s*-\\s*房间\\s*${roomCode}`) })
    await dlg.waitFor({ state: 'visible', timeout: 15000 })

    // 确保统计月份=2026-01，并等待人员表刷新
    const tjInput = dlg.locator('.el-form-item', { hasText: '统计月份' }).locator('input').first()
    await tjInput.fill('2026-01')
    await tjInput.blur()
    await sleep(1500)

    // 找到指定 staff_code 行，断言住宿天数=17（动态定位“住宿天数”列索引，避免列顺序变化导致误判）
    const bodyRows = dlg.locator('.el-table__body-wrapper tbody tr')
    const n = await bodyRows.count()
    assert(n > 0, '弹窗在住人员表为空，无法验证住宿天数')

    const headers = await dlg.locator('.el-table__header-wrapper thead th').allTextContents()
    const stayIdx = headers.findIndex((t) => String(t ?? '').replace(/\s+/g, '').includes('住宿天数'))
    assert(stayIdx >= 0, `未找到“住宿天数”表头，当前表头为：${headers.join('|')}`)

    let ok = false
    let gotDays = ''
    for (let i = 0; i < n; i++) {
      const tr = bodyRows.nth(i)
      const codeText = String((await tr.locator('td').nth(0).textContent()) ?? '').trim()
      if (codeText !== staffCode) continue
      const daysText = String((await tr.locator('td').nth(stayIdx).textContent()) ?? '').trim()
      gotDays = daysText
      if (daysText === '17') {
        ok = true
        break
      }
    }
    assert(ok, `住宿天数断言失败：staff_code=${staffCode} days=${gotDays || '(empty)'}（期望 17）`)

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

