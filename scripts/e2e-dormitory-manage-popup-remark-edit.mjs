/**
 * E2E：入住管理弹窗优化 - 部门中文 + 备注失焦保存
 * 目标：
 * 1) 打开房间列表→任意房间点“入住管理”
 * 2) 断言部门列显示中文（来自 HR_Departments.name）
 * 3) 修改第一行备注并失焦触发保存
 * 4) 点击“刷新”，确认备注仍然存在（持久化）
 * 5) 进入系统日志，确认存在“修改入住备注”的审计内容
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
const outPngPopup = join(outDir, 'dormitory-manage-popup-remark-edit.png')
const outPngLogs = join(outDir, 'dormitory-manage-popup-remark-log.png')

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

function stamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `E2E备注${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

async function login(page) {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' })
  await page.getByPlaceholder('请输入账号').fill(userCode)
  await page.getByPlaceholder('请输入密码').fill(password)
  await page.getByRole('button', { name: '登录' }).click()
  await page.waitForLoadState('networkidle', { timeout: 30000 })
}

async function openManagePopup(page) {
  await page.goto(`${baseUrl}/hr/dormitory/lodging-records`, { waitUntil: 'domcontentloaded' })
  await page.locator('.el-table').first().waitFor({ state: 'visible', timeout: 30000 })
  await sleep(800)

  // 找到“入住人数>0”的第一行再点“入住管理”（避免弹窗无在住人员）
  const rows = page.locator('.el-table__body-wrapper tbody tr')
  const n = await rows.count()
  assert(n > 0, '房间列表无数据')
  let target = null
  for (let i = 0; i < n; i++) {
    const row = rows.nth(i)
    const liveText = String((await row.locator('td').nth(5).textContent()) ?? '').trim()
    const live = Number(liveText)
    if (Number.isFinite(live) && live > 0) {
      target = row
      break
    }
  }
  assert(target, '未找到入住人数>0的房间，请先准备在住房间数据')
  await target.getByRole('button', { name: '入住管理' }).click()

  const dlg = page.getByRole('dialog', { name: '入住管理' })
  await dlg.waitFor({ state: 'visible', timeout: 15000 })
  return dlg
}

async function editRemarkAndVerifyPersist(page, dlg) {
  const rows = dlg.locator('.el-table__body tr')
  const n = await rows.count()
  assert(n > 0, '入住管理弹窗没有在住人员数据，无法验证备注编辑')

  const firstRow = rows.first()
  const deptText = String((await firstRow.locator('td').nth(2).textContent()) ?? '').trim()
  assert(deptText && deptText !== '空' && deptText !== '—', `部门列未显示中文：${deptText}`)

  const remarkVal = stamp()
  const remarkInput = firstRow.locator('input').first()
  await remarkInput.fill(remarkVal)
  await remarkInput.blur()

  // 等待提示出现（备注已保存）
  await page.locator('.el-message').first().waitFor({ state: 'visible', timeout: 10000 })
  await sleep(300)

  // 刷新并验证仍存在
  await dlg.getByRole('button', { name: '刷新' }).click()
  await sleep(800)

  const remarkAfter = await dlg.locator('.el-table__body tr').first().locator('input').first().inputValue()
  assert(String(remarkAfter ?? '').includes(remarkVal), `刷新后备注未持久化：${String(remarkAfter ?? '')}`)

  await page.screenshot({ path: outPngPopup, fullPage: true })
  return { deptText, remarkVal }
}

async function verifyLog(page, remarkVal) {
  await page.goto(`${baseUrl}/system/logs`, { waitUntil: 'domcontentloaded' })
  await page.locator('.el-table').first().waitFor({ state: 'visible', timeout: 30000 })
  await sleep(800)

  // 直接查数据库里的最新一条“修改入住备注”（UI 列表可能有过滤/分页/权限差异）
  const { getPool } = await import('../server/db.js')
  const pool = await getPool()
  const r = await pool.request().query(`
    SELECT TOP (1) Content
    FROM dbo.Sys_OperationLogs
    WHERE TargetTable = N'Hr_room_in'
      AND Action = N'修改入住备注'
    ORDER BY LogID DESC
  `)
  const content = String(r.recordset?.[0]?.Content ?? '')
  assert(content.includes(remarkVal), `数据库日志未包含备注关键字：${content}`)
  await page.screenshot({ path: outPngLogs, fullPage: true })
}

async function main() {
  assert(userCode && password, '请在 .env 配置 E2E_USERCODE 与 E2E_PASSWORD')
  mkdirSync(outDir, { recursive: true })

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  page.on('response', async (resp) => {
    const url = resp.url()
    if (!url.includes('/api/hr/dormitory/room-in/room-info')) return
    const status = resp.status()
    let body = null
    try {
      body = await resp.json()
    } catch {
      body = null
    }
    console.log('[room-info-save]', status, body ? JSON.stringify(body) : '(no json)')
  })
  try {
    await login(page)
    const dlg = await openManagePopup(page)
    const { remarkVal } = await editRemarkAndVerifyPersist(page, dlg)
    await verifyLog(page, remarkVal)
    console.log('E2E 完成：', outPngPopup, outPngLogs)
  } finally {
    await browser.close()
  }
}

main().catch((e) => {
  console.error('E2E 失败：', e)
  process.exit(1)
})

