/**
 * E2E：宿舍 - 入住管理/退宿/再入住（out_room 口径）
 * 目标：
 * 1) 入住：对剩余床位>0的房间办理入住
 * 2) 退宿：在“入住管理”里对该员工办理退宿（out_room=1 + out_time 写入）
 * 3) 再入住：同一员工再次办理入住（应新增一行，不覆盖旧记录）
 * 4) 截图：历史列表（同月）应出现该员工至少两条记录；系统日志应出现退宿审计
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
const outPngHistory = join(outDir, 'dormitory-checkout-recheckin-history.png')
const outPngLogs = join(outDir, 'dormitory-checkout-recheckin-logs.png')

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
  return `E2E退宿${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

async function login(page) {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' })
  await page.getByPlaceholder('请输入用户名或编码').fill(userCode)
  await page.getByPlaceholder('请输入密码').fill(password)
  await page.getByRole('button', { name: '登录' }).click()
  await page.waitForLoadState('networkidle', { timeout: 30000 })
}

async function pickStaff(page, dialog, keyword) {
  const select = dialog.locator('.el-select').first()
  await select.click()
  const input = select.locator('input').first()
  const kw = String(keyword ?? '').trim() || '1'
  await input.fill(kw)
  await sleep(800)
  const opt = page.locator('.el-select-dropdown:visible .el-select-dropdown__item').first()
  const visible = await opt.isVisible().catch(() => false)
  assert(visible, '未加载到可选员工')

  // Element Plus 下拉偶发 click 不触发 change，这里用键盘选择第一项更稳
  await input.press('ArrowDown')
  await input.press('Enter')
  await sleep(200)

  const selectedText = String((await select.textContent().catch(() => '')) ?? '').trim()
  const code = selectedText.split('-')[0]?.trim() || ''
  const name = selectedText.includes('-') ? selectedText.split('-').slice(1).join('-').trim() : ''
  assert(code, `选择员工失败：selectedText=${selectedText}`)
  return { code, name }
}

async function findRoomWithRemaining(page) {
  const rows = page.locator('.el-table__body-wrapper tbody tr')
  const n = await rows.count()
  assert(n > 0, '房间列表无数据')
  for (let i = 0; i < n; i++) {
    const row = rows.nth(i)
    const remainingText = String((await row.locator('td').nth(6).textContent()) ?? '').trim()
    const remaining = Number(remainingText)
    if (Number.isFinite(remaining) && remaining > 0) {
      const roomCode = String((await row.locator('td').nth(1).textContent()) ?? '').trim()
      return { row, roomCode }
    }
  }
  assert(false, '未找到剩余床位>0的房间，请先准备数据')
  return null
}

async function checkInOnce(page, roomRow, opts) {
  const { remark, staffKeyword } = opts
  await roomRow.getByRole('button', { name: '增加入住' }).click()
  const dialog = page.getByRole('dialog', { name: '办理入住' })
  await dialog.waitFor({ state: 'visible', timeout: 15000 })

  const staff = await pickStaff(page, dialog, staffKeyword)
  // 强制写入入住日期（避免某些情况下默认值未落入表单校验）
  await dialog.locator('.el-form-item').filter({ hasText: '入住日期' }).locator('input').first().fill(todayYmd())
  await dialog.locator('textarea').first().fill(remark)

  const postWait = page.waitForResponse(
    (resp) => resp.url().includes('/api/hr/dormitory/check-in') && resp.request().method() === 'POST',
    { timeout: 30000 },
  )
  await dialog.locator('button').filter({ hasText: '确认办理' }).click({ force: true })
  const resp = await Promise.race([
    postWait,
    (async () => {
      await sleep(5000)
      const errTexts = await dialog.locator('.el-form-item__error').allTextContents().catch(() => [])
      console.log('[checkin-validate-errors]', errTexts)
      await page.screenshot({ path: join(outDir, 'debug-checkin-no-request.png'), fullPage: true }).catch(() => {})
      throw new Error(`办理入住未发起请求，疑似前端校验未通过：${errTexts.join('|')}`)
    })(),
  ])
  const body = await resp.json().catch(() => ({}))
  assert(resp.ok() && body?.code === 200, `办理入住失败：${JSON.stringify(body)}`)
  return staff
}

async function checkOutInOccupants(page, roomRow, staffName) {
  await roomRow.getByRole('button', { name: '入住管理' }).click()
  const dlg = page.getByRole('dialog', { name: '入住管理' })
  await dlg.waitFor({ state: 'visible', timeout: 15000 })

  const staffCell = dlg.locator('.el-table__body tr').filter({ hasText: staffName }).first()
  await staffCell.waitFor({ state: 'visible', timeout: 15000 })
  await staffCell.getByRole('button', { name: '退宿' }).click()

  const outDlg = page.getByRole('dialog', { name: '办理退宿' })
  await outDlg.waitFor({ state: 'visible', timeout: 10000 })
  await outDlg.getByLabel('退宿日期').fill(todayYmd())
  // 默认 00:00 不改

  const putReqWait = page.waitForRequest(
    (r) => r.url().includes('/api/hr/dormitory/check-out') && r.method() === 'PUT',
    { timeout: 30000 },
  )
  await outDlg.getByRole('button', { name: '确认退宿' }).click()
  const putReq = await putReqWait
  const resp = await putReq.response()
  const body = await resp?.json().catch(() => ({}))
  assert(resp?.ok() && body?.code === 200, `办理退宿失败：${JSON.stringify(body)}`)

  // 关闭弹窗，避免遮挡后续点击
  await outDlg.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {})
  await dlg.locator('button').filter({ hasText: '关闭' }).click({ force: true }).catch(() => {})
  await dlg.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {
    // 兜底：ESC
    return page.keyboard.press('Escape').catch(() => {})
  })
}

async function verifyHistoryHasMultiple(page, staffCode) {
  await page.locator('.el-tabs__item').filter({ hasText: '住宿历史列表' }).click()
  const kwInput = page.getByPlaceholder('员工工号/姓名/宿舍编码')
  await kwInput.waitFor({ state: 'visible', timeout: 30000 })
  const d = new Date()
  const ymInputs = page.locator('.history-head .ym-input input')
  await ymInputs.nth(0).fill(String(d.getFullYear()))
  await ymInputs.nth(1).fill(String(d.getMonth() + 1))

  await kwInput.fill(staffCode)
  await page.locator('.history-head').getByRole('button', { name: '立即查询' }).click()
  await sleep(1000)

  const table = page.locator('.lodging-table').nth(1)
  const rows = table.locator('.el-table__body tr')
  const cnt = await rows.count()
  assert(cnt >= 2, `预期历史列表至少2条记录，实际=${cnt}`)
  await page.screenshot({ path: outPngHistory, fullPage: true })
}

async function verifyLogsHasCheckout(page, staffName) {
  await page.goto(`${baseUrl}/system/logs`, { waitUntil: 'domcontentloaded' })
  await page.locator('.el-table').first().waitFor({ state: 'visible', timeout: 30000 })
  await sleep(800)

  const rows = page.locator('.el-table__body tr')
  const n = Math.min(await rows.count(), 10)
  let hit = false
  for (let i = 0; i < n; i++) {
    await rows.nth(i).getByRole('button', { name: '查看详情' }).click()
    const dlg = page.getByRole('dialog', { name: '日志详情' })
    await dlg.waitFor({ state: 'visible', timeout: 10000 })
    const detail = String((await page.locator('.detail-json-pre').textContent()) ?? '')
    const ok = detail.includes('退宿') && detail.includes(staffName)
    if (ok) {
      hit = true
      await page.screenshot({ path: outPngLogs, fullPage: true })
      break
    }
    await dlg.locator('button').filter({ hasText: '关闭' }).click().catch(() => page.keyboard.press('Escape'))
    await dlg.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {})
    await sleep(200)
  }
  assert(hit, '前10条操作日志中未找到该员工的退宿审计记录')
}

async function main() {
  assert(userCode && password, '请在 .env 配置 E2E_USERCODE 与 E2E_PASSWORD')
  mkdirSync(outDir, { recursive: true })

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  page.on('request', (r) => {
    if (r.url().includes('/api/hr/dormitory/check-in') || r.url().includes('/api/hr/dormitory/check-out')) {
      console.log('[req]', r.method(), r.url())
    }
  })
  try {
    await login(page)
    await page.goto(`${baseUrl}/hr/dormitory/lodging-records`, { waitUntil: 'domcontentloaded' })
    await page.locator('.el-table').first().waitFor({ state: 'visible', timeout: 30000 })
    await sleep(800)

    const { row, roomCode } = await findRoomWithRemaining(page)
    const remark = stamp()
    const staff1 = await checkInOnce(page, row, { remark, staffKeyword: ' ' })
    await sleep(800)

    await checkOutInOccupants(page, row, staff1.name || staff1.code)
    await sleep(800)

    // 再次入住：用刚才的 staffCode 精确搜索
    const staff2 = await checkInOnce(page, row, { remark: `${remark}-2`, staffKeyword: staff1.code })
    assert(staff2.code === staff1.code, '再入住未选择到同一员工（请检查 staff-options 是否按 out_room 排他）')

    await verifyHistoryHasMultiple(page, staff1.code)
    await verifyLogsHasCheckout(page, staff1.name || staff1.code)
    console.log('E2E 完成：room=', roomCode, 'staff=', staff1.code, outPngHistory, outPngLogs)
  } finally {
    await browser.close()
  }
}

main().catch((e) => {
  console.error('E2E 失败：', e)
  process.exit(1)
})

