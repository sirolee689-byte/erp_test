/**
 * E2E：宿舍办理入住 - 满员硬核拦截（v1.1.3+）
 * 目标：对“剩余床位=0”的房间点击“增加入住”，选择一个可选员工后提交，
 *      断言提示为「该房间已满员，无法办理入住」，并截图留证。
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
const outPng = join(outDir, 'dormitory-checkin-fullroom.png')

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

async function openFirstFullRoomAndTryCheckIn(page) {
  await page.goto(`${baseUrl}/hr/dormitory/lodging-records`, { waitUntil: 'domcontentloaded' })
  await page.locator('.el-table').first().waitFor({ state: 'visible', timeout: 30000 })
  await sleep(800)

  // 优先找“剩余床位=0”的房间；若不存在则找“剩余床位=1”的房间并先成功入住 1 人，再验证第二次拦截
  let targetRow = null
  let plan = 'full' // full | fillThenBlock
  for (let p = 0; p < 10; p++) {
    const rows = page.locator('.el-table__body-wrapper tbody tr')
    const n = await rows.count()
    assert(n > 0, '房间列表无数据，无法进行满员拦截验证')

    // 先找 0
    for (let i = 0; i < n; i++) {
      const row = rows.nth(i)
      const remainingCell = row.locator('td').nth(6)
      const remainingText = String((await remainingCell.textContent()) ?? '').trim()
      if (remainingText === '0') {
        targetRow = row
        plan = 'full'
        break
      }
    }

    if (targetRow) break

    // 再找 1
    for (let i = 0; i < n; i++) {
      const row = rows.nth(i)
      const remainingCell = row.locator('td').nth(6)
      const remainingText = String((await remainingCell.textContent()) ?? '').trim()
      if (remainingText === '1') {
        targetRow = row
        plan = 'fillThenBlock'
        break
      }
    }

    if (targetRow) break

    // 下一页
    const nextBtn = page.locator('.pagination-row .el-pagination button.btn-next').first()
    if (await nextBtn.isDisabled()) break
    await nextBtn.click()
    await sleep(800)
  }

  assert(targetRow, '未找到“剩余床位=0/1”的房间行，无法进行满员拦截验证')

  await targetRow.getByRole('button', { name: '增加入住' }).click()
  await sleep(300)

  // 打开办理入住面板（若被收起）
  const panel = page.locator('.checkin-panel')
  const panelVisible = await panel.isVisible().catch(() => false)
  if (!panelVisible) {
    await page.getByRole('button', { name: /管理入住|收起办理入住/ }).click()
    await panel.waitFor({ state: 'visible', timeout: 10000 })
  }

  // 选择一个可选员工：输入一个关键字触发远程搜索，选第一项
  async function pickFirstStaff() {
    const staffSelect = panel.locator('.el-select').first()
    await staffSelect.click()
    const innerInput = staffSelect.locator('input').first()
    const keywords = ['1', '2', 'a', 'A']
    for (const kw of keywords) {
      await innerInput.fill(kw)
      await sleep(700)
      const firstOpt = page.locator('.el-select-dropdown__item').first()
      const visible = await firstOpt.isVisible().catch(() => false)
      if (visible) {
        await firstOpt.click()
        return true
      }
    }
    return false
  }

  const okPick1 = await pickFirstStaff()
  assert(okPick1, '未能加载到可选员工（请确认存在在职、非黑名单、且未在住的员工）')

  if (plan === 'fillThenBlock') {
    // 第一次应成功写入（让房间变满）
    const post1ReqWait = page.waitForRequest(
      (r) => r.url().includes('/api/hr/dormitory/check-in') && r.method() === 'POST',
      { timeout: 30000 },
    )
    await panel.getByRole('button', { name: '办理入住' }).click()
    const post1Req = await post1ReqWait
    const post1 = await post1Req.response()
    assert(post1, '未捕获到首次办理入住的响应')
    const body1 = await post1.json().catch(() => ({}))
    assert(post1.ok() && body1?.code === 200, `首次办理入住未成功：${JSON.stringify(body1)}`)
    await sleep(600)

    // 第二次：选择另一个员工，预期满员拦截
    const clearIcon = panel.locator('.el-select .el-icon').first()
    await clearIcon.click().catch(() => {})
    const okPick2 = await pickFirstStaff()
    assert(okPick2, '第二次未能加载到可选员工（需要至少两名可选员工用于填满+拦截验证）')

    const post2ReqWait = page.waitForRequest(
      (r) => r.url().includes('/api/hr/dormitory/check-in') && r.method() === 'POST',
      { timeout: 30000 },
    )
    await panel.getByRole('button', { name: '办理入住' }).click()
    const post2Req = await post2ReqWait
    const post2 = await post2Req.response()
    assert(post2, '未捕获到第二次办理入住的响应')
    const body2 = await post2.json().catch(() => ({}))
    assert(body2?.code === 400, `预期满员拦截 code=400，实际：${JSON.stringify(body2)}`)
    assert(body2?.msg === '该房间已满员，无法办理入住', `满员拦截文案不匹配：${JSON.stringify(body2)}`)
  } else {
    const postReqWait = page.waitForRequest(
      (r) => r.url().includes('/api/hr/dormitory/check-in') && r.method() === 'POST',
      { timeout: 30000 },
    )
    await panel.getByRole('button', { name: '办理入住' }).click()
    const postReq = await postReqWait
    const postResp = await postReq.response()
    assert(postResp, '未捕获到办理入住的响应')
    const body = await postResp.json().catch(() => ({}))
    assert(body?.code === 400, `预期满员拦截 code=400，实际：${JSON.stringify(body)}`)
    assert(body?.msg === '该房间已满员，无法办理入住', `满员拦截文案不匹配：${JSON.stringify(body)}`)
  }

  // 等待 message 出现后截图
  await page.locator('.el-message').first().waitFor({ state: 'visible', timeout: 10000 })
  await page.screenshot({ path: outPng, fullPage: true })
}

async function main() {
  assert(userCode && password, '请在 .env 配置 E2E_USERCODE 与 E2E_PASSWORD')
  mkdirSync(outDir, { recursive: true })

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  try {
    await login(page)
    await openFirstFullRoomAndTryCheckIn(page)
    console.log('E2E 完成：', outPng)
  } finally {
    await browser.close()
  }
}

main().catch((e) => {
  console.error('E2E 失败：', e)
  process.exit(1)
})

