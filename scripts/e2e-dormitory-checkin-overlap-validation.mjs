/**
 * E2E：办理入住 — 历史区间重叠拦截（规则 14）
 * 1) 库内找一条已退宿且入住/退宿均在 2026-04 的记录，取其 staff_code
 * 2) 打开「办理入住」，选该员工 + 可用房间，入住日填 2026-04-15 → 断言错误提示并截图
 * 3) 入住日改为 2026-05-01 → 断言成功；库内 SQL 将新行退宿以便环境可重复跑
 *
 * 前置：.env E2E_USERCODE/E2E_PASSWORD、DB_*；Vite 5173 + API 3001；后端日志含 Dorm-CheckIn-Overlap-Validation-Active
 */
import dotenv from 'dotenv'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import sql from 'mssql'

dotenv.config()

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const outDir = join(root, 'e2e-output')
const pngOverlap = join(outDir, 'dorm-checkin-overlap-blocked.png')

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

function parseYmd(s) {
  const t = String(s ?? '').trim()
  const m = t.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const dt = new Date(y, mo - 1, d)
  return Number.isNaN(dt.getTime()) ? null : dt
}

/** 用于重叠断言的「区间内」参考日：2026-04-15 */
const OVERLAP_PROBE = new Date(2026, 3, 15, 12, 0, 0, 0)

function dateInClosedInterval(d, lo, hi) {
  if (!d || !lo || !hi) return false
  const t = d.getTime()
  return t >= lo.getTime() && t <= hi.getTime()
}

async function login(page) {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' })
  await page.getByPlaceholder('请输入用户名或编码').fill(userCode)
  await page.getByPlaceholder('请输入密码').fill(password)
  await page.getByRole('button', { name: '登录' }).click()
  await page.waitForLoadState('networkidle', { timeout: 30000 })
}

async function getPoolFromEnv() {
  const config = {
    server: process.env.DB_SERVER,
    database: process.env.DB_DATABASE,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 1433,
    options: {
      encrypt: String(process.env.DB_ENCRYPT ?? 'false').toLowerCase() === 'true',
      trustServerCertificate: String(process.env.DB_TRUST_SERVER_CERTIFICATE).toLowerCase() === 'true',
    },
  }
  if (!config.server || !config.database) throw new Error('缺少 DB_SERVER / DB_DATABASE')
  return sql.connect(config)
}

/**
 * 找一条已退宿记录，使 2026-04-15 落在其 [in_time, out_time] 闭区间内（对应用户「4 月中重叠」场景）
 */
async function findStaffCodeWithApril152026InClosedHistory(pool) {
  const r = await pool.request().query(`
    SELECT TOP 300
      i.id,
      LTRIM(RTRIM(ISNULL(i.staff_code, N''))) AS sc,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(i.in_time, N'')))) AS it_in,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(i.out_time, ISNULL(i.out_time2, N''))))) AS it_out
    FROM dbo.[UB_ERP_Hr_room_in] AS i
    WHERE LTRIM(RTRIM(ISNULL(i.del, N'0'))) = N'0'
      AND LTRIM(RTRIM(ISNULL(i.out_room, N'0'))) = N'1'
      AND LTRIM(RTRIM(ISNULL(i.staff_code, N''))) <> N''
    ORDER BY i.id DESC
  `)
  for (const row of r.recordset ?? []) {
    const din = parseYmd(row.it_in)
    const dout = parseYmd(row.it_out)
    if (dateInClosedInterval(OVERLAP_PROBE, din, dout)) {
      return String(row.sc ?? '').trim()
    }
  }
  return ''
}

async function pickUsableRoomCode(pool) {
  const r = await pool.request().query(`
    SELECT TOP 1 LTRIM(RTRIM(ISNULL(r.s_code, N''))) AS rc
    FROM dbo.[UB_ERP_Hr_room] AS r
    WHERE LTRIM(RTRIM(ISNULL(r.del, N'0'))) = N'0'
      AND LTRIM(RTRIM(ISNULL(r.pass, N'0'))) = N'1'
      AND LTRIM(RTRIM(ISNULL(r.s_code1, N''))) = N'使用'
      AND LTRIM(RTRIM(ISNULL(r.s_code, N''))) <> N''
    ORDER BY r.id DESC
  `)
  return String(r.recordset?.[0]?.rc ?? '').trim()
}

/** 将 E2E 新建在住行直接退宿，便于重复跑脚本 */
async function checkoutLatestByStaffAndDate(pool, staffCode, datePrefix) {
  const req = pool.request()
  req.input('sc', sql.NVarChar(50), staffCode)
  req.input('pfx', sql.NVarChar(20), `${datePrefix}%`)
  await req.query(`
    UPDATE i
    SET i.out_room = N'1',
        i.out_time = N'2026-05-03 12:00:00'
    FROM dbo.[UB_ERP_Hr_room_in] AS i
    WHERE i.id = (
      SELECT TOP 1 i2.id
      FROM dbo.[UB_ERP_Hr_room_in] AS i2
      WHERE LTRIM(RTRIM(ISNULL(i2.del, N'0'))) = N'0'
        AND LTRIM(RTRIM(ISNULL(i2.out_room, N'0'))) = N'0'
        AND LTRIM(RTRIM(ISNULL(i2.staff_code, N''))) = LTRIM(RTRIM(@sc))
        AND LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(i2.in_time, N'')))) LIKE @pfx
      ORDER BY i2.id DESC
    )
  `)
}

async function main() {
  assert(userCode && password, '请在 .env 配置 E2E_USERCODE 与 E2E_PASSWORD')
  mkdirSync(outDir, { recursive: true })

  const pool = await getPoolFromEnv()
  const staffForOverlap = await findStaffCodeWithApril152026InClosedHistory(pool)
  assert(
    staffForOverlap,
    '库中未找到「已退宿且历史区间覆盖 2026-04-15」的员工，无法验证重叠拦截（请准备一条 out_room=1 且 in/out 含该日的记录）',
  )

  const roomCode = await pickUsableRoomCode(pool)
  assert(roomCode, '未找到可用「使用」且已审房间，无法办理入住')

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  try {
    await login(page)
    await page.goto(`${baseUrl}/hr/dormitory/lodging-records`, { waitUntil: 'domcontentloaded' })
    await page.getByTestId('room-list-table').waitFor({ state: 'visible', timeout: 30000 })
    await sleep(600)

    await page.getByRole('button', { name: '办理入住' }).click()
    const dialog = page.getByRole('dialog', { name: '办理入住' })
    await dialog.waitFor({ state: 'visible', timeout: 15000 })

    const staffSelect = dialog.locator('.el-select').first()
    await staffSelect.click()
    await staffSelect.locator('input').first().fill(staffForOverlap)
    await sleep(900)
    const opt = page.locator('.el-select-dropdown:visible .el-select-dropdown__item').first()
    await opt.waitFor({ state: 'visible', timeout: 15000 })
    await opt.click()

    await dialog.getByLabel('房间编码').fill(roomCode)
    await dialog.getByLabel('入住日期').fill('2026-04-15')

    const badWait = page.waitForResponse(
      (r) => r.url().includes('/api/hr/dormitory/check-in') && r.request().method() === 'POST',
      { timeout: 30000 },
    )
    await dialog.getByRole('button', { name: '确认办理' }).click()
    const badResp = await badWait
    assert(badResp.status() === 400, `重叠场景期望 HTTP 400，实际 ${badResp.status()}`)
    const badJson = await badResp.json().catch(() => ({}))
    assert(
      String(badJson?.msg ?? '').includes('时间冲突'),
      `期望文案含「时间冲突」，实际 msg=${String(badJson?.msg ?? '')}`,
    )

    await page.locator('.el-message--error').first().waitFor({ state: 'visible', timeout: 10000 })
    await page.screenshot({ path: pngOverlap, fullPage: true })

    await dialog.getByLabel('入住日期').fill('2026-05-01')
    const okWait = page.waitForResponse(
      (r) => r.url().includes('/api/hr/dormitory/check-in') && r.request().method() === 'POST',
      { timeout: 30000 },
    )
    await dialog.getByRole('button', { name: '确认办理' }).click()
    const okResp = await okWait
    const okJson = await okResp.json().catch(() => ({}))
    assert(okResp.status() === 200 && okJson?.code === 200, `5 月入住应成功，HTTP=${okResp.status()} body=${JSON.stringify(okJson).slice(0, 300)}`)

    await checkoutLatestByStaffAndDate(pool, staffForOverlap, '2026-05-01')

    console.log('【入住重叠校验 RPA】完成')
    console.log(pngOverlap)
  } finally {
    await browser.close()
    try {
      await pool.close()
    } catch {
      // ignore
    }
    await sql.close()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
