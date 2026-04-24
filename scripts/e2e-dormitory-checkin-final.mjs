/**
 * E2E：宿舍办理入住 - 最终逻辑回归（v1.1.3-final）
 * 目标：
 * 1) 在“房间列表”找一个剩余床位>0的房间，打开“办理入住”弹窗并提交
 * 2) 断言接口返回 success
 * 3) 到“住宿历史列表”中截图验证：in_time、electric、room_info 已写入并能展示
 * 4) 到“系统日志”中截图验证：Sys_OperationLogs 生成了中文审计文案
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
const outPngHistory = join(outDir, 'dormitory-checkin-final-history.png')
const outPngLogs = join(outDir, 'dormitory-checkin-final-logs.png')

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
  return `E2E入住${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
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
      // label 形如：CODE - NAME
      const code = label.split('-')[0]?.trim() || ''
      const name = label.includes('-') ? label.split('-').slice(1).join('-').trim() : ''
      return { code, name, label }
    }
  }
  return { code: '', name: '', label: '' }
}

async function runCheckIn(page) {
  await page.goto(`${baseUrl}/hr/dormitory/lodging-records`, { waitUntil: 'domcontentloaded' })
  await page.locator('.el-table').first().waitFor({ state: 'visible', timeout: 30000 })
  await sleep(800)

  // 找剩余床位>0 的房间
  const rows = page.locator('.el-table__body-wrapper tbody tr')
  const n = await rows.count()
  assert(n > 0, '房间列表无数据，无法办理入住')

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
  assert(targetRow, '未找到剩余床位>0的房间，请先准备可入住房间数据')

  const roomCode = String((await targetRow.locator('td').nth(1).textContent()) ?? '').trim()
  assert(roomCode, '未能读取房间编码（第2列），请检查表格列顺序是否变更')

  await targetRow.getByRole('button', { name: '增加入住' }).click()

  const dialog = page.getByRole('dialog', { name: '办理入住' })
  await dialog.waitFor({ state: 'visible', timeout: 15000 })

  const { code: staffCode, name: staffName } = await pickFirstStaffInDialog(page, dialog)
  assert(staffCode, '未能加载到可选员工（请确认存在在职、非黑名单、且未在宿的员工）')

  // 填写入住日期/优惠电量/备注
  const info = stamp()
  await dialog.getByLabel('入住日期').fill(todayYmd())
  await dialog.getByLabel('优惠电量').fill('5')
  await dialog.getByLabel('备注').fill(info)

  const postReqWait = page.waitForRequest(
    (r) => r.url().includes('/api/hr/dormitory/check-in') && r.method() === 'POST',
    { timeout: 30000 },
  )
  await dialog.getByRole('button', { name: '确认办理' }).click()

  const postReq = await postReqWait
  const postResp = await postReq.response()
  assert(postResp, '未捕获到办理入住响应')
  const body = await postResp.json().catch(() => ({}))
  assert(postResp.ok() && body?.code === 200, `办理入住失败：${JSON.stringify(body)}`)

  return { roomCode, staffCode, staffName, info }
}

async function verifyHistoryScreenshot(page, { staffCode, info }) {
  // 切到“住宿历史列表”
  await page.locator('.el-tabs__item').filter({ hasText: '住宿历史列表' }).click()
  const kwInput = page.getByPlaceholder('员工工号/姓名/宿舍编码')
  await kwInput.waitFor({ state: 'visible', timeout: 30000 })
  await sleep(600)

  // 年/月设为当前（避免默认月份不是本月导致查不到刚插入的数据）
  const d = new Date()
  const y = String(d.getFullYear())
  const m = String(d.getMonth() + 1)
  const ymInputs = page.locator('.history-head .ym-input input')
  await ymInputs.nth(0).fill(y)
  await ymInputs.nth(1).fill(m)

  // 用关键词精确过滤（按员工工号/姓名/宿舍编码模糊）
  await kwInput.fill(staffCode)
  await page.locator('.history-head').getByRole('button', { name: '立即查询' }).click()
  await sleep(1000)

  // Element Plus 表格不同版本 wrapper class 可能略有差异，这里直接等待“目标工号文本”出现
  await page.locator(`text=${staffCode}`).first().waitFor({ state: 'visible', timeout: 15000 })
  const historyTable = page.locator('.lodging-table').nth(1)
  const firstRow = historyTable.locator('.el-table__body tr').first()
  const rowText = String((await firstRow.textContent()) ?? '')
  assert(rowText.includes(staffCode), `历史列表未命中该员工：${rowText.slice(0, 300)}`)
  assert(rowText.includes('5'), `历史列表未展示优惠电量=5：${rowText.slice(0, 300)}`)
  assert(rowText.includes(info), `历史列表未展示备注：${rowText.slice(0, 300)}`)

  await page.screenshot({ path: outPngHistory, fullPage: true })
}

async function verifyOperationLogsScreenshot(page, { roomCode, staffCode, staffName }) {
  await page.goto(`${baseUrl}/system/logs`, { waitUntil: 'domcontentloaded' })
  await page.locator('.el-table').first().waitFor({ state: 'visible', timeout: 30000 })
  await sleep(800)

  const firstRow = page.locator('.el-table__body tr').first()
  await firstRow.waitFor({ state: 'visible', timeout: 15000 })
  const text = String((await firstRow.textContent()) ?? '')
  assert(text.includes('办理入住') || text.includes('宿舍'), `日志列表首行未看到办理入住相关记录：${text.slice(0, 240)}`)

  await page.getByRole('button', { name: '查看详情' }).first().click()
  await page.getByRole('dialog', { name: '日志详情' }).waitFor({ state: 'visible', timeout: 10000 })
  const detail = String((await page.locator('.detail-json-pre').textContent()) ?? '')
  const hasRoom = detail.includes(roomCode)
  const hasStaff = detail.includes(staffName || '') || detail.includes(staffCode)
  assert(hasRoom && hasStaff, `日志详情未包含房间/员工：${detail.slice(0, 500)}`)

  await page.screenshot({ path: outPngLogs, fullPage: true })
}

async function main() {
  assert(userCode && password, '请在 .env 配置 E2E_USERCODE 与 E2E_PASSWORD')
  mkdirSync(outDir, { recursive: true })

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  page.on('response', async (resp) => {
    const url = resp.url()
    if (!url.includes('/api/hr/dormitory/check-in/staff-options')) return
    const status = resp.status()
    let body = null
    try {
      body = await resp.json()
    } catch {
      body = null
    }
    console.log('[staff-options]', status, body ? JSON.stringify(body).slice(0, 400) : '(no json)')
  })
  page.on('response', async (resp) => {
    const url = resp.url()
    if (!url.includes('/api/hr/dormitory/lodging-history')) return
    const status = resp.status()
    let body = null
    try {
      body = await resp.json()
    } catch {
      body = null
    }
    console.log('[lodging-history]', status, body ? JSON.stringify(body).slice(0, 400) : '(no json)')
  })
  try {
    await login(page)
    const ctx = await runCheckIn(page)
    await verifyHistoryScreenshot(page, ctx)
    await verifyOperationLogsScreenshot(page, ctx)
    console.log('E2E 完成：', outPngHistory, outPngLogs)
  } finally {
    await browser.close()
  }
}

main().catch((e) => {
  console.error('E2E 失败：', e)
  process.exit(1)
})

