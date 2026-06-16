/**
 * E2E：操作日志 v1.1.1+ 闭环
 * 1）修改未审核员工备注 → 日志含中文变更说明 → 截图
 * 2）删除该测试员工 → 日志详情为「删除了员工档案：姓名[…]，工号[…]」→ 截图
 *
 * 前置：.env 中 E2E_USERCODE、E2E_PASSWORD、DB_*；本地 Vite(5173) + API(3001)。
 */
import dotenv from 'dotenv'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { getPool, sql } from '../server/db.js'

dotenv.config()

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const outDir = join(root, 'e2e-output')
const outPngRemark = join(outDir, 'operation-logs-staff-remark.png')
const outPngDelete = join(outDir, 'operation-logs-after-delete.png')

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

function buildRemarkStamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `E2E备注${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

async function login(page) {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' })
  await page.getByPlaceholder('请输入工号').fill(userCode)
  await page.getByPlaceholder('请输入密码').fill(password)
  await page.getByRole('button', { name: '登录' }).click()
  await page.waitForLoadState('networkidle', { timeout: 30000 })
}

async function setUnauditedSwitchOn(page) {
  await page.goto(`${baseUrl}/hr/files/employee-files`, { waitUntil: 'domcontentloaded' })
  const auditSwitch = page.locator('.audit-switch .el-switch')
  await auditSwitch.waitFor({ state: 'visible', timeout: 15000 })
  const ariaChecked = String(await auditSwitch.getAttribute('aria-checked')).trim()
  if (ariaChecked !== 'true') {
    await auditSwitch.click()
  }
  await page.locator('.el-table, .el-skeleton').first().waitFor({ state: 'visible', timeout: 30000 })
  await sleep(600)
}

/**
 * @returns {Promise<{ code: string, remark: string }>}
 */
async function ensureUnauditedStaffAndUpdateRemark(page) {
  await setUnauditedSwitchOn(page)

  const editBtn = page.getByRole('button', { name: '编辑' }).first()
  const hasRow = await editBtn.isVisible().catch(() => false)

  if (!hasRow) {
    await page.getByRole('button', { name: '新增员工' }).click()
    await page.getByRole('dialog').waitFor({ state: 'visible', timeout: 15000 })
    const stamp = buildRemarkStamp()
    await page.getByLabel('姓名').fill(`日志E2E${stamp}`)
    await page.getByLabel('卡号').fill(String(Math.floor(1e9 + Math.random() * 9e9)).slice(0, 10))

    const postWait = page.waitForResponse(
      (resp) => resp.url().includes('/api/hr/staff') && resp.request().method() === 'POST',
      { timeout: 30000 },
    )
    await page.getByRole('button', { name: '确定' }).click()
    const postResp = await postWait
    const postBody = await postResp.json().catch(() => ({}))
    assert(postResp.ok() && postBody?.code === 200, `新增员工失败：${postResp.status()} ${JSON.stringify(postBody)}`)
    await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 20000 })
    await page.getByRole('button', { name: '刷新' }).click()
    await sleep(1000)
  }

  await page.getByRole('button', { name: '编辑' }).first().click()
  await page.getByRole('dialog').waitFor({ state: 'visible', timeout: 15000 })

  const remarkText = buildRemarkStamp()
  await page.getByLabel('备注').fill(remarkText)

  const putWait = page.waitForResponse(
    (resp) => resp.url().includes('/api/hr/staff') && resp.request().method() === 'PUT',
    { timeout: 30000 },
  )
  await page.getByRole('button', { name: '确定' }).click()
  const putResp = await putWait
  const putBody = await putResp.json().catch(() => ({}))
  assert(putResp.ok() && putBody?.code === 200, `修改员工失败：${putResp.status()} ${JSON.stringify(putBody)}`)

  await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 20000 })
  await sleep(500)

  const code = String(putBody?.data?.code ?? '').trim()
  return { code, remark: remarkText }
}

async function verifyRemarkLog(page, expectedRemark) {
  await page.goto(`${baseUrl}/system/logs`, { waitUntil: 'domcontentloaded' })
  await page.locator('.el-table').first().waitFor({ state: 'visible', timeout: 30000 })
  await sleep(800)

  const firstRow = page.locator('.el-table__body tr').first()
  await firstRow.waitFor({ state: 'visible', timeout: 15000 })
  const rowText = String((await firstRow.textContent()) ?? '')
  assert(rowText.includes('修改员工'), `首行未包含「修改员工」：${rowText.slice(0, 200)}`)

  await page.getByRole('button', { name: '查看详情' }).first().click()
  await page.getByRole('dialog', { name: '日志详情' }).waitFor({ state: 'visible', timeout: 10000 })
  const pre = page.locator('.detail-json-pre')
  const detailText = String((await pre.textContent()) ?? '')
  assert(
    detailText.includes(expectedRemark),
    `详情未包含备注内容：remark=${expectedRemark} detail=${detailText.slice(0, 400)}`,
  )

  await page.screenshot({ path: outPngRemark, fullPage: true })
}

/**
 * 按工号删除未审核员工（含 MessageBox 确认）
 * @param {import('playwright').Page} page
 * @param {string} code
 */
async function deleteStaffByCode(page, code) {
  await setUnauditedSwitchOn(page)
  await page.getByPlaceholder('工号（精确）').fill(code)
  await page.getByRole('button', { name: '查询' }).click()
  await sleep(800)

  const delWait = page.waitForResponse(
    (resp) =>
      resp.url().includes('/api/hr/staff') &&
      resp.request().method() === 'DELETE' &&
      resp.ok(),
    { timeout: 30000 },
  )

  await page.getByRole('button', { name: '删除' }).first().click()
  await page.locator('.el-message-box').getByRole('button', { name: '确定' }).click()
  const delResp = await delWait
  const delBody = await delResp.json().catch(() => ({}))
  assert(delBody?.code === 200, `删除员工失败：${JSON.stringify(delBody)}`)
  await sleep(500)
}

/**
 * @param {import('playwright').Page} page
 * @param {string} expectedSnippet 例如「删除了员工档案」
 */
async function verifyDeleteLog(page, expectedSnippet) {
  await page.goto(`${baseUrl}/system/logs`, { waitUntil: 'domcontentloaded' })
  await page.locator('.el-table').first().waitFor({ state: 'visible', timeout: 30000 })
  await sleep(800)

  const firstRow = page.locator('.el-table__body tr').first()
  const rowText = String((await firstRow.textContent()) ?? '')
  assert(rowText.includes('删除员工'), `删除后首行未包含「删除员工」：${rowText.slice(0, 240)}`)

  const preview = page.locator('.details-preview').first()
  const previewText = String((await preview.textContent()) ?? '').trim()
  assert(
    previewText.includes(expectedSnippet),
    `列表「详细内容」摘要未包含预期文案：${previewText.slice(0, 300)}`,
  )

  await page.getByRole('button', { name: '查看详情' }).first().click()
  await page.getByRole('dialog', { name: '日志详情' }).waitFor({ state: 'visible', timeout: 10000 })
  const pre = page.locator('.detail-json-pre')
  const detailText = String((await pre.textContent()) ?? '')
  assert(
    detailText.includes(expectedSnippet),
    `详情弹窗未包含预期文案：${detailText.slice(0, 400)}`,
  )

  await page.screenshot({ path: outPngDelete, fullPage: true })
}

async function verifyDatabaseAuditRow() {
  const pool = await getPool()
  try {
    const userR = await pool
      .request()
      .input('UserCode', sql.NVarChar(50), userCode)
      .query(
        `SELECT TOP (1) CAST(u.UserID AS NVARCHAR(50)) AS UserID, u.UserName, u.UserCode
         FROM dbo.UB_ERP_User AS u
         WHERE u.UserCode = @UserCode`,
      )
    const urow = userR.recordset?.[0]
    assert(urow, `未在 UB_ERP_User 找到工号：${userCode}`)

    const logR = await pool.request().query(`
      SELECT TOP (1)
        CAST(L.UserId AS NVARCHAR(50)) AS UserId,
        L.UserName,
        L.Action,
        L.Content
      FROM dbo.Sys_OperationLogs AS L
      WHERE L.Action LIKE N'%修改员工%'
      ORDER BY L.LogID DESC
    `)
    const lrow = logR.recordset?.[0]
    assert(lrow, 'Sys_OperationLogs 中未找到「修改员工」相关记录')

    const uidMatch = String(lrow.UserId ?? '').trim() === String(urow.UserID ?? '').trim()
    assert(uidMatch, `日志 UserId 与登录用户不一致：log=${lrow.UserId} user=${urow.UserID}`)

    const nameMatch =
      String(lrow.UserName ?? '').trim() === String(urow.UserName ?? '').trim() ||
      String(lrow.UserName ?? '').trim() === String(urow.UserCode ?? '').trim()
    assert(
      nameMatch,
      `日志 UserName 与登录用户展示名不一致：log=${lrow.UserName} userName=${urow.UserName} userCode=${urow.UserCode}`,
    )
    console.log('【数据库核验通过】最近一条「修改员工」日志 UserId/UserName 与当前登录用户一致')
  } finally {
    try {
      await sql.close()
    } catch {
      // 忽略重复关闭
    }
  }
}

async function main() {
  if (!userCode || !String(password).trim()) {
    console.error('【缺少登录配置】请在根目录 .env 中增加 E2E_USERCODE、E2E_PASSWORD。')
    process.exit(2)
  }
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true })
  }

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
  })
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })

  try {
    await login(page)
    const { code, remark } = await ensureUnauditedStaffAndUpdateRemark(page)
    assert(code, '未能取得被修改员工的工号 code')

    await verifyRemarkLog(page, remark)
    await verifyDatabaseAuditRow()

    await deleteStaffByCode(page, code)
    await verifyDeleteLog(page, '删除了员工档案')

    console.log('【E2E 通过】修改备注日志 + 删除员工中文详情 + 数据库用户字段')
    console.log('截图（修改）：', outPngRemark)
    console.log('截图（删除）：', outPngDelete)
  } finally {
    await browser.close()
  }
}

main().catch((err) => {
  console.error('e2e_operation_logs_failed', String(err?.message ?? err))
  process.exit(1)
})
