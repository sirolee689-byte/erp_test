/**
 * E2E：员工离职/状态修改
 *
 * 依赖：Chrome（channel: 'chrome'）、.env 中 E2E_USERCODE / E2E_PASSWORD / E2E_LEAVE_STAFF_CODE
 * 命令：node scripts/e2e-staff-leave.mjs
 * 产出：e2e-output/staff-leave-before.png / staff-leave-after.png
 */
import dotenv from 'dotenv'
import { mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import sql from 'mssql'

dotenv.config()

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const outDir = join(root, 'e2e-output')
const outBefore = join(outDir, 'staff-leave-before.png')
const outAfter = join(outDir, 'staff-leave-after.png')
const outSqlProof = join(outDir, 'staff-leave-sql-proof.png')

const baseUrl = String(process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173').replace(/\/$/, '')
const apiBase = String(process.env.PLAYWRIGHT_API_URL ?? 'http://localhost:3001').replace(/\/$/, '')

const userCode = String(process.env.E2E_USERCODE ?? '').trim()
const password = String(process.env.E2E_PASSWORD ?? '')
const leaveStaffCode = String(process.env.E2E_LEAVE_STAFF_CODE ?? '').trim()

function assert(cond, msg) {
  if (!cond) {
    console.error('【断言失败】', msg)
    process.exit(1)
  }
}

async function loginJson() {
  const res = await fetch(`${apiBase}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ Account: userCode, Password: password }),
  })
  const json = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, json }
}

async function main() {
  if (!userCode || !String(password).trim()) {
    console.error('【缺少登录配置】请在根目录 .env 中增加 E2E_USERCODE、E2E_PASSWORD。')
    process.exit(2)
  }
  if (!leaveStaffCode) {
    console.error('【缺少目标员工】请在根目录 .env 中增加 E2E_LEAVE_STAFF_CODE（要办理离职的员工工号）。')
    process.exit(2)
  }

  const { ok, status, json } = await loginJson()
  assert(ok && json?.code === 200 && json?.data?.token, `登录失败：http=${status} body=${JSON.stringify(json)}`)

  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })

  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage()
  try {
    await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' })
    await page.getByPlaceholder('请输入用户名或编码').fill(String(userCode))
    await page.getByPlaceholder('请输入密码').fill(String(password))
    await page.getByRole('button', { name: '登录' }).click()
    await page.waitForLoadState('networkidle', { timeout: 30000 })

    await page.goto(`${baseUrl}/hr/files/employee-files`, { waitUntil: 'domcontentloaded' })
    await page.locator('.el-table, .el-skeleton').first().waitFor({ state: 'visible', timeout: 30000 })

    // 用工号精确搜索，避免误点其它员工
    await page.getByPlaceholder('工号（精确）').fill(leaveStaffCode)
    await page.getByRole('button', { name: '查询' }).click()
    await page.waitForLoadState('networkidle', { timeout: 30000 })

    await page.screenshot({ path: outBefore, fullPage: true })
    console.log('已截图（离职前）：', outBefore)

    // 点击办理离职
    const leaveBtn = page.getByRole('button', { name: '办理离职' }).first()
    await leaveBtn.waitFor({ state: 'visible', timeout: 15000 })
    await leaveBtn.click()

    // 填写离职弹窗
    await page.getByText('办理离职', { exact: true }).first().waitFor({ state: 'visible', timeout: 15000 })
    // 离职日期：默认今天（不强制改）
    await page.getByPlaceholder('请输入离职原因').fill('个人原因')
    await page.getByRole('combobox', { name: '加入黑名单' }).click().catch(() => null)
    // 选择“是”
    const yesOpt = page.getByRole('option', { name: '是' })
    if (await yesOpt.count()) {
      await yesOpt.first().click()
      await page.getByPlaceholder('请输入黑名单原因（必填）').fill('多次违纪')
    }

    // 二次确认
    await page.getByRole('button', { name: '确认办理离职' }).click()
    const confirmBtn = page.getByRole('button', { name: '确定' }).last()
    await confirmBtn.waitFor({ state: 'visible', timeout: 15000 })
    await confirmBtn.click()

    // 等待提示出现并刷新完成
    await page.waitForTimeout(1200)
    await page.getByRole('button', { name: '刷新' }).click()
    await page.waitForTimeout(1200)

    // 默认仅在职：打开「仅显示离职员工」后再断言
    const leavedSwitchHost = page.locator('div.audit-switch').filter({ hasText: '仅显示离职员工' })
    const leavedSw = leavedSwitchHost.locator('.el-switch')
    const checked = await leavedSw.getAttribute('aria-checked')
    if (checked !== 'true') await leavedSw.click()
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => null)

    // 断言：出现“离职”标签
    const leavedTag = page.getByText('离职').first()
    await leavedTag.waitFor({ state: 'visible', timeout: 20000 })

    await page.screenshot({ path: outAfter, fullPage: true })
    console.log('已截图（离职后）：', outAfter)

    // SQL 证明截图：查询 Hr_staff 与 Sys_Users
    const cfg = {
      server: process.env.DB_SERVER,
      database: process.env.DB_DATABASE,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      port: Number(process.env.DB_PORT || 1433),
      options: {
        encrypt: String(process.env.DB_ENCRYPT ?? 'false').toLowerCase() === 'true',
        trustServerCertificate: String(process.env.DB_TRUST_SERVER_CERTIFICATE ?? 'true').toLowerCase() === 'true',
      },
    }
    await sql.connect(cfg)
    try {
      const req = new sql.Request()
      req.input('c', sql.NVarChar(50), leaveStaffCode)
      const staff = await req.query(
        "SELECT TOP(1) id,code,UserCode,name,status,leave_date,leave_reason,is_blacklist,blacklist_reason,pass,del FROM dbo.Hr_staff WHERE code=@c OR UserCode=@c ORDER BY id DESC",
      )
      let user = { recordset: [] }
      try {
        user = await req.query(
          'SELECT TOP (3) * FROM dbo.Sys_Users WHERE UserCode = @c OR UserName = @c ORDER BY UserID DESC',
        )
      } catch {
        user = await req.query(
          'SELECT TOP (3) * FROM dbo.Sys_Users WHERE usercode = @c OR username = @c ORDER BY uid DESC',
        )
      }
      const html = `
        <html><head><meta charset="utf-8" /><style>
          body{font-family:Consolas,monospace;padding:18px;}
          h2{margin:0 0 10px 0;}
          pre{white-space:pre-wrap;word-break:break-word;border:1px solid #ddd;padding:12px;border-radius:8px;}
        </style></head><body>
          <h2>SQL 验证结果（工号=${leaveStaffCode}）</h2>
          <pre>Hr_staff: ${JSON.stringify(staff.recordset?.[0] ?? null, null, 2)}</pre>
          <pre>Sys_Users: ${JSON.stringify(user.recordset?.[0] ?? null, null, 2)}</pre>
        </body></html>
      `
      const proofPage = await browser.newPage()
      await proofPage.setContent(html, { waitUntil: 'domcontentloaded' })
      await proofPage.screenshot({ path: outSqlProof, fullPage: true })
      await proofPage.close()
      console.log('已截图（SQL 证明）：', outSqlProof)
    } finally {
      await sql.close().catch(() => null)
    }
  } finally {
    await browser.close()
  }
}

main().catch((e) => {
  console.error('e2e_staff_leave_failed', String(e?.message ?? e))
  process.exit(1)
})

