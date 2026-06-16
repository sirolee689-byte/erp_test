/**
 * E2E：住宿历史列表 — 无年月筛选 + 全量倒序（规则 14）
 * 1) 顶区无「设定日期」、无 el-input-number（年/月）
 * 2) 首屏 API 返回：若库内存在多个月份的 in_time，则首屏列表应出现至少 2 个不同年月键
 * 3) 截图：Tab 页顶区 + 表格（证明无日期控件且有数据）
 *
 * 前置：.env E2E_USERCODE/E2E_PASSWORD、DB_*；Vite 5173 + API 3001；后端日志含 Dorm-History-NoDateFilter-v1.1.4-Active
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
const pngTab = join(outDir, 'dorm-history-no-date-filter-tab.png')

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

/** 从入住时间字符串提取 YYYY-MM（用于判断是否跨自然月） */
function ymKey(s) {
  const t = String(s ?? '').trim()
  const m = t.match(/^(\d{4})-(\d{1,2})\b/)
  return m ? `${m[1]}-${String(m[2]).padStart(2, '0')}` : ''
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

/** 库内未删记录中，按 YYYY-MM 解析得到的不同月份个数（抽样最多 400 条） */
async function countDistinctYmInDb(pool) {
  const r = await pool.request().query(`
    SELECT TOP 400 LTRIM(RTRIM(ISNULL(in_time, N''))) AS it
    FROM dbo.[UB_ERP_Hr_room_in]
    WHERE LTRIM(RTRIM(ISNULL(del, N'0'))) = N'0'
    ORDER BY id DESC
  `)
  const set = new Set()
  for (const row of r.recordset ?? []) {
    const k = ymKey(row.it)
    if (k) set.add(k)
  }
  return set.size
}

async function main() {
  assert(userCode && password, '请在 .env 配置 E2E_USERCODE 与 E2E_PASSWORD')
  mkdirSync(outDir, { recursive: true })

  const pool = await getPoolFromEnv()
  const dbYmDistinct = await countDistinctYmInDb(pool)

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  try {
    await login(page)
    await page.goto(`${baseUrl}/hr/dormitory/lodging-records`, { waitUntil: 'domcontentloaded' })
    await page.locator('.lodging-page .el-table').first().waitFor({ state: 'visible', timeout: 30000 })

    // 须在点击 Tab 之前挂上监听，否则会错过 onTabChange 触发的首屏请求
    const histResp = page.waitForResponse(
      (r) => r.url().includes('/api/hr/dormitory/lodging-history') && r.status() === 200,
      { timeout: 30000 },
    )
    await page.getByRole('tab', { name: '住宿历史列表' }).click()
    const resp = await histResp
    await sleep(400)

    const root = page.getByTestId('lodging-history-root')
    await root.waitFor({ state: 'visible', timeout: 20000 })
    await page.getByTestId('lodging-history-table').waitFor({ state: 'visible', timeout: 20000 })

    assert((await root.getByText('设定日期').count()) === 0, '「住宿历史列表」Tab 内不应再出现「设定日期」（房间列表 Tab 可有独立日期，勿用全页断言）')
    assert((await root.locator('.el-input-number').count()) === 0, '住宿历史 Tab 内不应再有年/月数字输入框')
    const body = await resp.json().catch(() => ({}))
    assert(body?.code === 200, `lodging-history 应返回 200，实际 ${JSON.stringify(body).slice(0, 200)}`)
    const list = Array.isArray(body?.data?.list) ? body.data.list : []
    const total = Number(body?.data?.total ?? 0)
    assert(total >= 0, 'total 应存在')

    const ymsOnPage = new Set(list.map((row) => ymKey(row?.in_time)).filter(Boolean))
    if (dbYmDistinct >= 2) {
      assert(
        ymsOnPage.size >= 2,
        `库内存在至少 2 个不同入住月份时，首屏 API 应能体现跨月（首屏月份键：${[...ymsOnPage].join(', ') || '无'}）`,
      )
    } else {
      console.warn('【提示】当前库抽样未解析出 2 个以上 YYYY-MM 入住月份，跳过「首屏必须跨月」强断言')
    }
    if (total > 0) {
      assert(list.length >= 1, `total=${total} 时首屏 list 不应为空`)
    }

    await page.screenshot({ path: pngTab, fullPage: true })

    console.log('【住宿历史无日期筛选 RPA】完成')
    console.log(pngTab)
    console.log(`total=${total} 首屏行数=${list.length} 首屏不同年月=${ymsOnPage.size} 库抽样不同年月≈${dbYmDistinct}`)
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
