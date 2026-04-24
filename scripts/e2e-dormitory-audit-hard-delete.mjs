/**
 * E2E：审核入住申请 — 未审核行【删除】物理删除（规则 14）
 * 1) 库内选定一条可删的未审核行（优先已有 pass=0；否则取已退宿行临时置 pass=0）
 * 2) 打开 Tab，点【删除】→ 截图二次确认弹窗
 * 3) 确定删除后 SQL 校验该 id 在 Hr_room_in 中已不存在
 *
 * 前置：.env E2E_USERCODE/E2E_PASSWORD、DB_*；Vite 5173 + API 3001；后端日志含 Dorm-Audit-HardDelete-Logic-v1.1.4-Active
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
const pngConfirm = join(outDir, 'dorm-audit-hard-delete-confirm.png')

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

/** 优先已有未审核行；否则取已退宿行并置 pass=0（降低误删在住风险） */
async function pickRowIdForDeleteTest(pool) {
  const r1 = await pool.request().query(`
    SELECT TOP 1 i.id
    FROM dbo.[Hr_room_in] AS i
    WHERE LTRIM(RTRIM(ISNULL(i.del, N'0'))) = N'0'
      AND LTRIM(RTRIM(ISNULL(i.pass, N'0'))) = N'0'
    ORDER BY i.id DESC
  `)
  let id = Number(r1.recordset?.[0]?.id)
  if (Number.isFinite(id) && id > 0) return id

  const r2 = await pool.request().query(`
    SELECT TOP 1 i.id
    FROM dbo.[Hr_room_in] AS i
    WHERE LTRIM(RTRIM(ISNULL(i.del, N'0'))) = N'0'
      AND LTRIM(RTRIM(ISNULL(i.out_room, N'0'))) = N'1'
    ORDER BY i.id DESC
  `)
  id = Number(r2.recordset?.[0]?.id)
  if (!Number.isFinite(id) || id <= 0) return null
  const u = pool.request()
  u.input('id', sql.Int, id)
  await u.query(`UPDATE dbo.[Hr_room_in] SET pass = N'0' WHERE id = @id`)
  return id
}

async function getListSearchKeywordById(pool, id) {
  const r = pool.request()
  r.input('id', sql.Int, id)
  const rs = await r.query(`
    SELECT
      LTRIM(RTRIM(ISNULL(room_code, N''))) AS rc,
      LTRIM(RTRIM(ISNULL(staff_code, N''))) AS sc
    FROM dbo.[Hr_room_in]
    WHERE id = @id
  `)
  const rc = String(rs.recordset?.[0]?.rc ?? '').trim()
  const sc = String(rs.recordset?.[0]?.sc ?? '').trim()
  return rc || sc
}

async function countRowById(pool, id) {
  const r = pool.request()
  r.input('id', sql.Int, id)
  const rs = await r.query(`SELECT COUNT(1) AS c FROM dbo.[Hr_room_in] WHERE id = @id`)
  return Number(rs.recordset?.[0]?.c ?? 0)
}

async function main() {
  assert(userCode && password, '请在 .env 配置 E2E_USERCODE 与 E2E_PASSWORD')
  mkdirSync(outDir, { recursive: true })

  const pool = await getPoolFromEnv()
  const rowId = await pickRowIdForDeleteTest(pool)
  assert(rowId, '库中无可用测试行（需至少一条 del=0 且 pass=0，或一条已退宿可临时改为未审）')

  const listKw = await getListSearchKeywordById(pool, rowId)
  assert(listKw, '未能读取测试行的 room_code/staff_code 作为查询关键字')

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  try {
    await login(page)
    await page.goto(`${baseUrl}/hr/dormitory/lodging-records`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('tab', { name: '审核入住申请' }).click()
    await sleep(600)

    const showAudited = page.getByTestId('switch-show-audited')
    const needPass0 = await showAudited.evaluate((el) => {
      const input = el.querySelector('input')
      return input ? input.checked : false
    })
    if (needPass0) {
      const w = page.waitForResponse(
        (r) => r.url().includes('audit-center-list') && r.url().includes('pass=0') && r.status() === 200,
        { timeout: 30000 },
      )
      await showAudited.click()
      await w
    }

    const table = page.getByTestId('audit-apply-table')
    await table.waitFor({ state: 'visible', timeout: 30000 })

    await page.getByTestId('audit-keyword-input').fill(listKw)
    const listResp = page.waitForResponse(
      (r) => r.url().includes('audit-center-list') && r.url().includes('pass=0') && r.status() === 200,
      { timeout: 30000 },
    )
    await page.getByRole('button', { name: '查询' }).click()
    await listResp

    const row = table.locator(`tbody tr.audit-row-id-${rowId}`)
    await row.waitFor({ state: 'visible', timeout: 15000 })

    await row.getByTestId('btn-delete-checkin').click()
    await page.getByText('此操作将永久删除该入住申请，不可恢复，是否确定？').waitFor({ state: 'visible', timeout: 10000 })
    await page.screenshot({ path: pngConfirm, fullPage: true })

    const delWait = page.waitForResponse(
      (r) =>
        r.url().includes('/api/dorm/delete-checkin') &&
        r.request().method() === 'DELETE' &&
        r.status() === 200,
      { timeout: 30000 },
    )
    await page.getByRole('button', { name: '确定删除' }).click()
    const delResp = await delWait
    const delJson = await delResp.json().catch(() => ({}))
    assert(delJson?.code === 200, `删除接口应返回 code=200，实际 ${JSON.stringify(delJson)}`)

    await sleep(600)
    const cnt = await countRowById(pool, rowId)
    assert(cnt === 0, `物理删除后 Hr_room_in 中 id=${rowId} 应不存在，实际 COUNT=${cnt}`)

    console.log('【彻底删除 RPA】完成')
    console.log(pngConfirm)
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
