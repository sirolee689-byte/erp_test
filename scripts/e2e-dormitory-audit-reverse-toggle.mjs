/**
 * E2E：审核入住申请 — 通过审核 ↔ 反审核 切换（规则 14）
 * 1) 库内将一条在住记录置为 pass=0
 * 2) 打开「审核入住申请」Tab，点【通过审核】→ 打开「显示已审核」后同 id 行断言「已审核」+【反审核】
 * 3) 点【反审核】→ 关闭「显示已审核」后同 id 行断言「未审核」+【通过审核】
 * 4) 截图
 *
 * 前置：.env E2E_USERCODE/E2E_PASSWORD、DB_*；Vite 5173 + API 3001；日志含 Dorm-Audit-ReverseLogic-v1.1.4-Active
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
const pngAfterPass = join(outDir, 'dorm-audit-reverse-after-pass.png')
const pngAfterUn = join(outDir, 'dorm-audit-reverse-after-unaudit.png')

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

async function pickOneActiveRoomInId(pool) {
  const r = await pool.request().query(`
    SELECT TOP 1 i.id
    FROM dbo.[Hr_room_in] AS i
    WHERE LTRIM(RTRIM(ISNULL(i.del, N'0'))) = N'0'
      AND LTRIM(RTRIM(ISNULL(i.out_room, N'0'))) = N'0'
    ORDER BY
      CASE WHEN LTRIM(RTRIM(ISNULL(i.room_code, N''))) <> N'' THEN 0 ELSE 1 END,
      LEN(LTRIM(RTRIM(ISNULL(i.staff_code, N'')))) DESC,
      i.id DESC
  `)
  const id = Number(r.recordset?.[0]?.id)
  return Number.isFinite(id) && id > 0 ? id : null
}

async function setPass(pool, id, p) {
  const r = pool.request()
  r.input('id', sql.Int, id)
  r.input('p', sql.NVarChar(10), p)
  await r.query(`UPDATE dbo.[Hr_room_in] SET pass = @p WHERE id = @id`)
}

/** 列表 keyword 模糊匹配：优先用房号缩小命中，避免短工号（如 00000）多行歧义 */
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

async function main() {
  assert(userCode && password, '请在 .env 配置 E2E_USERCODE 与 E2E_PASSWORD')
  mkdirSync(outDir, { recursive: true })

  const pool = await getPoolFromEnv()
  const rowId = await pickOneActiveRoomInId(pool)
  assert(rowId, '库中无在住 Hr_room_in 记录，无法测试')

  await setPass(pool, rowId, '0')
  const listKw = await getListSearchKeywordById(pool, rowId)
  assert(listKw, '未能读取测试行的 room_code/staff_code 作为查询关键字')

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  try {
    await login(page)
    await page.goto(`${baseUrl}/hr/dormitory/lodging-records`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('tab', { name: '审核入住申请' }).click()
    await sleep(600)
    const table = page.getByTestId('audit-apply-table')
    await table.waitFor({ state: 'visible', timeout: 30000 })

    await page.getByTestId('audit-keyword-input').fill(listKw)
    const listResp = page.waitForResponse(
      (r) => r.url().includes('audit-center-list') && r.status() === 200,
      { timeout: 30000 },
    )
    await page.getByRole('button', { name: '查询' }).click()
    await listResp

    // 与 AuditList.vue 中 row-class-name 一致，按主键锁定行
    const row = table.locator(`tbody tr.audit-row-id-${rowId}`)
    await row.waitFor({ state: 'visible', timeout: 15000 })

    await row.getByTestId('btn-pass-audit').click()
    const auditPutWait = page.waitForResponse(
      (r) =>
        r.url().includes('/api/hr/dormitory/lodging-in/audit') &&
        r.request().method() === 'PUT' &&
        r.status() === 200,
      { timeout: 30000 },
    )
    await page.getByRole('button', { name: '确定' }).click()
    const auditPut = await auditPutWait
    const auditJson = await auditPut.json().catch(() => ({}))
    assert(auditJson?.code === 200, `通过审核应返回 code=200，实际 ${JSON.stringify(auditJson)}`)

    // 未审核列表仅含 pass=0：通过后该行会从当前列表消失，需打开「显示已审核」再检索同一 id
    const listAfterPass1 = page.waitForResponse(
      (r) =>
        r.url().includes('audit-center-list') &&
        r.url().includes('pass=1') &&
        r.status() === 200,
      { timeout: 30000 },
    )
    await page.getByTestId('switch-show-audited').click()
    await listAfterPass1

    await page.getByTestId('audit-keyword-input').fill(listKw)
    const listResp2 = page.waitForResponse(
      (r) => r.url().includes('audit-center-list') && r.url().includes('pass=1') && r.status() === 200,
      { timeout: 30000 },
    )
    await page.getByRole('button', { name: '查询' }).click()
    await listResp2

    const rowAudited = table.locator(`tbody tr.audit-row-id-${rowId}`)
    await rowAudited.waitFor({ state: 'visible', timeout: 15000 })
    await rowAudited.getByTestId('tag-pass-1').waitFor({ state: 'visible', timeout: 15000 })
    assert((await rowAudited.getByTestId('btn-un-audit').count()) > 0, '通过审核后该行应出现【反审核】按钮')
    await page.screenshot({ path: pngAfterPass, fullPage: true })

    const unPutWait = page.waitForResponse(
      (r) =>
        r.url().includes('/api/dorm/un-audit') &&
        r.request().method() === 'PUT' &&
        r.status() === 200,
      { timeout: 30000 },
    )
    await rowAudited.getByTestId('btn-un-audit').click()
    await page.getByRole('button', { name: '确定反审核' }).click()
    const unPut = await unPutWait
    const unJson = await unPut.json().catch(() => ({}))
    assert(unJson?.code === 200, `反审核应返回 code=200，实际 ${JSON.stringify(unJson)}`)

    const listAfterUn0 = page.waitForResponse(
      (r) =>
        r.url().includes('audit-center-list') &&
        r.url().includes('pass=0') &&
        r.status() === 200,
      { timeout: 30000 },
    )
    await page.getByTestId('switch-show-audited').click()
    await listAfterUn0

    await page.getByTestId('audit-keyword-input').fill(listKw)
    const listResp3 = page.waitForResponse(
      (r) => r.url().includes('audit-center-list') && r.url().includes('pass=0') && r.status() === 200,
      { timeout: 30000 },
    )
    await page.getByRole('button', { name: '查询' }).click()
    await listResp3

    const rowPending = table.locator(`tbody tr.audit-row-id-${rowId}`)
    await rowPending.waitFor({ state: 'visible', timeout: 15000 })
    await rowPending.getByTestId('tag-pass-0').waitFor({ state: 'visible', timeout: 15000 })
    assert((await rowPending.getByTestId('btn-pass-audit').count()) > 0, '反审核后该行应出现【通过审核】按钮')
    await page.screenshot({ path: pngAfterUn, fullPage: true })

    console.log('【反审核切换 RPA】完成')
    console.log(pngAfterPass)
    console.log(pngAfterUn)
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
