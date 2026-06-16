/**
 * E2E / RPA：入住审批 v1.1.4 自检
 * 1) 办理入住后直连库断言 UB_ERP_Hr_room_in.pass = '1'
 * 2) 将同一行临时改为 pass='0'，打开「入住审批管理中心」点【审核】后再断言 pass='1'
 * 3) 输出截图到 e2e-output/
 *
 * 前置：.env 中 E2E_USERCODE、E2E_PASSWORD、数据库连接；本地 Vite(5173) + API(3001)；后端启动日志含 Dorm-Audit-ReverseLogic-v1.1.4-Active
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
const pngCheckinPass = join(outDir, 'dormitory-v114-checkin-pass1-db.png')
const pngAuditClick = join(outDir, 'dormitory-v114-audit-center-click.png')
const pngAfterAudit = join(outDir, 'dormitory-v114-after-audit-db.png')
const pngHistoryNoAudit = join(outDir, 'dormitory-v114-history-tab-no-audit-actions.png')
const pngHistoryAfterCheckin = join(outDir, 'dormitory-v114-history-after-checkin.png')

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

function todayYmd() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function stamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `E2E审${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

async function login(page) {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' })
  await page.getByPlaceholder('请输入用户名或编码').fill(userCode)
  await page.getByPlaceholder('请输入密码').fill(password)
  await page.getByRole('button', { name: '登录' }).click()
  await page.waitForLoadState('networkidle', { timeout: 30000 })
}

async function pickFirstStaffInDialog(page, dialog) {
  const select = dialog.locator('.el-select').first()
  await select.click()
  const input = select.locator('input').first()
  const keywords = ['2026042001', '202604', '1', '2', 'a', 'A']
  for (const kw of keywords) {
    await input.fill(kw)
    await sleep(700)
    const opt = page.locator('.el-select-dropdown:visible .el-select-dropdown__item').first()
    if (await opt.isVisible().catch(() => false)) {
      const label = String((await opt.textContent()) ?? '').trim()
      await opt.click()
      const code = label.split('-')[0]?.trim() || ''
      return { code, label }
    }
  }
  return { code: '', label: '' }
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
  if (!config.server || !config.database) {
    throw new Error('缺少 DB_SERVER / DB_DATABASE')
  }
  return sql.connect(config)
}

async function queryPassByStaffRoom(pool, staffCode, roomCode) {
  const r = pool.request()
  r.input('sc', sql.NVarChar(50), staffCode)
  r.input('rc', sql.NVarChar(50), roomCode)
  const rs = await r.query(`
    SELECT TOP 1 id, LTRIM(RTRIM(ISNULL(pass, N'0'))) AS pass
    FROM dbo.[UB_ERP_Hr_room_in]
    WHERE LTRIM(RTRIM(ISNULL(del, N'0'))) = N'0'
      AND LTRIM(RTRIM(ISNULL(out_room, N'0'))) = N'0'
      AND LTRIM(RTRIM(ISNULL(staff_code, N''))) = @sc
      AND LTRIM(RTRIM(ISNULL(room_code, N''))) = @rc
    ORDER BY id DESC
  `)
  return rs.recordset?.[0] ?? null
}

async function setPass(pool, id, passVal) {
  const r = pool.request()
  r.input('id', sql.Int, id)
  r.input('p', sql.NVarChar(10), passVal)
  await r.query(`UPDATE dbo.[UB_ERP_Hr_room_in] SET pass = @p WHERE id = @id`)
}

async function main() {
  assert(userCode && password, '请在 .env 配置 E2E_USERCODE 与 E2E_PASSWORD')
  mkdirSync(outDir, { recursive: true })

  let pool
  /** @type {{ id: number, pass: string } | null} */
  let rowDb = null
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  try {
    pool = await getPoolFromEnv()
  } catch (e) {
    console.error('数据库连接失败（将跳过库内断言）：', e?.message ?? e)
  }

  try {
    await login(page)
    await page.goto(`${baseUrl}/hr/dormitory/lodging-records`, { waitUntil: 'domcontentloaded' })
    await page.locator('.el-table').first().waitFor({ state: 'visible', timeout: 30000 })
    await sleep(800)

    const rows = page.locator('.lodging-page .el-table__body-wrapper tbody tr')
    const n = await rows.count()
    assert(n > 0, '房间列表无数据')

    let targetRow = null
    for (let i = 0; i < n; i++) {
      const row = rows.nth(i)
      const remainingText = String((await row.locator('td').nth(6).textContent()) ?? '').trim()
      const remaining = Number(remainingText)
      if (Number.isFinite(remaining) && remaining > 0) {
        targetRow = row
        break
      }
    }
    assert(targetRow, '未找到剩余床位>0的房间')

    const roomCode = String((await targetRow.locator('td').nth(1).textContent()) ?? '').trim()
    assert(roomCode, '未能读取房号')

    await targetRow.getByRole('button', { name: '增加入住' }).click()
    const dialog = page.getByRole('dialog', { name: '办理入住' })
    await dialog.waitFor({ state: 'visible', timeout: 15000 })

    const { code: staffCode } = await pickFirstStaffInDialog(page, dialog)
    assert(staffCode, '未能选择员工')

    const info = stamp()
    await dialog.getByLabel('入住日期').fill(todayYmd())
    await dialog.getByLabel('优惠电量').fill('3')
    await dialog.getByLabel('备注').fill(info)

    await dialog.getByRole('button', { name: '确认办理' }).click()
    await sleep(2000)

    if (pool) {
      rowDb = await queryPassByStaffRoom(pool, staffCode, roomCode)
      assert(rowDb, '库中未找到刚办理的入住行')
      assert(String(rowDb.pass) === '1', `办理入住后期望 pass='1'，实际为 ${rowDb.pass}`)
      await page.setViewportSize({ width: 960, height: 420 })
      await page.goto('about:blank')
      await page.evaluate(
        ([id, p]) => {
          document.body.innerHTML = `<pre style="font-size:16px;padding:16px">UB_ERP_Hr_room_in 核验（办理入住后）\nid=${id}\npass=${p}</pre>`
        },
        [rowDb.id, rowDb.pass],
      )
      await page.screenshot({ path: pngCheckinPass, fullPage: true })
    }

    // 第三页「住宿历史」：界面无审核操作列；库内 pass=1 已由上一步断言
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto(`${baseUrl}/hr/dormitory/lodging-records`, { waitUntil: 'domcontentloaded' })
    await page.locator('.lodging-page .el-table').first().waitFor({ state: 'visible', timeout: 30000 })
    await page.getByRole('tab', { name: '住宿历史列表' }).click()
    await sleep(600)
    await page.getByTestId('lodging-history-table').waitFor({ state: 'visible', timeout: 20000 })
    await page.screenshot({ path: pngHistoryAfterCheckin, fullPage: true })

    if (!pool || !rowDb) {
      console.warn('跳过库内反写与第二页审批流截图（无数据库或未定位到入住行）')
    } else {
      await setPass(pool, rowDb.id, '0')
      assert(String((await queryPassByStaffRoom(pool, staffCode, roomCode))?.pass) === '0', '反写 pass=0 失败')

      await page.goto(`${baseUrl}/hr/dormitory/lodging-records`, { waitUntil: 'domcontentloaded' })
      await page.locator('.lodging-page .el-table').first().waitFor({ state: 'visible', timeout: 30000 })
      await page.getByRole('tab', { name: '审核入住申请' }).click()
      await sleep(500)
      await page.getByTestId('audit-apply-table').waitFor({ state: 'visible', timeout: 30000 })
      await sleep(600)
      const auditBtn = page.getByTestId('btn-pass-audit').first()
      await auditBtn.waitFor({ state: 'visible', timeout: 15000 })
      await auditBtn.click()
      await page.getByRole('button', { name: '确定' }).click()
      await sleep(1200)

      await page.screenshot({ path: pngAuditClick, fullPage: true })

      const after = await queryPassByStaffRoom(pool, staffCode, roomCode)
      assert(String(after?.pass) === '1', `点击审核后期望 pass='1'，实际为 ${after?.pass}`)
      await page.goto('about:blank')
      await page.evaluate(
        ([id, p]) => {
          document.body.innerHTML = `<pre style="font-size:16px;padding:16px">UB_ERP_Hr_room_in 核验（点击审核后）\nid=${id}\npass=${p}</pre>`
        },
        [after.id, after.pass],
      )
      await page.screenshot({ path: pngAfterAudit, fullPage: true })
    }

    // 住宿历史：不得再出现「审核」操作按钮
    await page.goto(`${baseUrl}/hr/dormitory/lodging-records`, { waitUntil: 'domcontentloaded' })
    await page.locator('.lodging-page .el-table').first().waitFor({ state: 'visible', timeout: 30000 })
    await page.getByRole('tab', { name: '住宿历史列表' }).click()
    await sleep(600)
    const histTable = page.getByTestId('lodging-history-table')
    await histTable.waitFor({ state: 'visible', timeout: 20000 })
    const auditBtns = histTable.getByRole('button', { name: '审核' })
    assert((await auditBtns.count()) === 0, '住宿历史表格中不应存在「审核」按钮')
    await page.screenshot({ path: pngHistoryNoAudit, fullPage: true })

    console.log('【v1.1.4 RPA】完成。截图：')
    console.log(pngCheckinPass)
    console.log(pngHistoryAfterCheckin)
    console.log(pngAuditClick)
    console.log(pngAfterAudit)
    console.log(pngHistoryNoAudit)
  } finally {
    await browser.close()
    if (pool) {
      try {
        await pool.close()
      } catch {
        // ignore
      }
    }
    await sql.close()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
