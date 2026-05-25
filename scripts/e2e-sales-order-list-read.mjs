/**
 * E2E：销售订单 issue 01 — 列表加载 → 点击查看 → 主表/明细 Tab
 *
 * 前置：.env 中 E2E_USERCODE、E2E_PASSWORD、DB_*；本地 Vite(5173) + API(3001) 已启动。
 * 命令：npm run e2e:sales-order
 * 产出：e2e-output/sales-order-view-dialog.png
 */
import dotenv from 'dotenv'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

dotenv.config()

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const outDir = join(root, 'e2e-output')
const outPng = join(outDir, 'sales-order-view-dialog.png')

const baseUrl = String(process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173').replace(/\/$/, '')
const apiBase = String(process.env.PLAYWRIGHT_API_URL ?? 'http://localhost:3001').replace(/\/$/, '')
const soPagePath = '/supply-chain/daily/sales-order'

const userCode = String(process.env.E2E_USERCODE ?? '').trim()
const password = String(process.env.E2E_PASSWORD ?? '')

function assert(cond, msg) {
  if (!cond) {
    console.error('【断言失败】', msg)
    process.exit(1)
  }
}

async function assertServersReachable() {
  let viteOk = false
  let apiOk = false
  try {
    const r = await fetch(baseUrl, { method: 'GET' })
    viteOk = r.ok || r.status < 500
  } catch {
    viteOk = false
  }
  try {
    const r = await fetch(`${apiBase}/api/login`, { method: 'OPTIONS' }).catch(() => null)
    apiOk = Boolean(r)
  } catch {
    apiOk = false
  }
  if (!viteOk) {
    console.error(`【前置未满足】Vite 未就绪：${baseUrl}，请先 npm run dev`)
    process.exit(2)
  }
  if (!apiOk) {
    console.error(`【前置未满足】API 未就绪：${apiBase}，请先 npm run dev:server`)
    process.exit(2)
  }
}

async function loginApi() {
  const res = await fetch(`${apiBase}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ Account: userCode, Password: password }),
  })
  const json = await res.json().catch(() => ({}))
  return { res, json }
}

/**
 * @param {string} token
 */
async function assertSalesOrderApiListAndDetail(token) {
  const h = { Authorization: `Bearer ${token}` }
  const listRes = await fetch(`${apiBase}/api/sales-order/list?page=1&pageSize=5`, { headers: h })
  const listJson = await listRes.json().catch(() => ({}))
  assert(
    listRes.ok && listJson?.code === 200,
    `GET /api/sales-order/list 失败：http=${listRes.status} body=${JSON.stringify(listJson)}`,
  )
  assert(typeof listJson.data?.total === 'number', '列表缺少 total')
  assert(Array.isArray(listJson.data?.list), '列表缺少 list 数组')
  const rows = listJson.data.list
  assert(rows.length > 0, '库中需至少一条在册销售订单（issue 01 E2E 依赖 seed 数据）')
  const row = rows[0]
  for (const key of ['piNo', 'pass', 'del', 'calcStatus']) {
    assert(key in row, `列表行缺少字段 ${key}`)
  }
  assert(
    /已运算|未运算/.test(String(row.calcStatus)),
    `calcStatus 应为已运算/未运算，实际=${row.calcStatus}`,
  )

  const id = row.id
  const detailRes = await fetch(`${apiBase}/api/sales-order/${id}`, { headers: h })
  const detailJson = await detailRes.json().catch(() => ({}))
  assert(
    detailRes.ok && detailJson?.code === 200,
    `GET /api/sales-order/:id 失败：http=${detailRes.status} body=${JSON.stringify(detailJson)}`,
  )
  assert(Boolean(detailJson.data?.header?.piNo), '详情缺少 header.piNo')
  assert(Array.isArray(detailJson.data?.lines), '详情缺少 lines 数组')
  console.log(
    `【接口校验通过】列表 ${rows.length} 条（total=${listJson.data.total}），详情 id=${id}，明细 ${detailJson.data.lines.length} 行。`,
  )
  return { piNo: String(row.piNo ?? '').trim(), id }
}

async function loginUi(page) {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' })
  await page.getByPlaceholder('请输入用户名或编码').fill(userCode)
  await page.getByPlaceholder('请输入密码').fill(password)
  await page.getByRole('button', { name: '登录' }).click()
  await page.waitForLoadState('networkidle', { timeout: 30000 })
}

async function main() {
  if (!userCode || !String(password).trim()) {
    console.error('【缺少登录配置】请在根目录 .env 中设置 E2E_USERCODE、E2E_PASSWORD。')
    process.exit(2)
  }

  await assertServersReachable()

  const { res: loginRes, json: loginJson } = await loginApi()
  assert(loginRes.ok && loginJson?.code === 200 && loginJson?.data?.token, `登录失败：${loginJson?.msg ?? loginRes.status}`)
  const token = String(loginJson.data.token)
  const { piNo: seedPiNo } = await assertSalesOrderApiListAndDetail(token)

  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })

  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage()
  try {
    await loginUi(page)
    await page.goto(`${baseUrl}${soPagePath}`, { waitUntil: 'domcontentloaded' })

    const listRespWait = page.waitForResponse(
      (r) => r.url().includes('/api/sales-order/list') && r.request().method() === 'GET',
      { timeout: 30000 },
    )
    await page.locator('.so-main-table, .el-skeleton').first().waitFor({ state: 'visible', timeout: 30000 })
    const listResp = await listRespWait
    const listBody = await listResp.json().catch(() => ({}))
    assert(listResp.ok() && listBody?.code === 200, `页面列表接口失败：${listResp.status()}`)

    const viewBtn = page.getByRole('button', { name: '查看' }).first()
    await viewBtn.waitFor({ state: 'visible', timeout: 15000 })

    const detailRespWait = page.waitForResponse(
      (r) => /\/api\/sales-order\/\d+/.test(r.url()) && r.request().method() === 'GET',
      { timeout: 20000 },
    )
    await viewBtn.click()
    await page.locator('.so-view-dialog').waitFor({ state: 'visible', timeout: 15000 })
    const detailResp = await detailRespWait
    const detailBody = await detailResp.json().catch(() => ({}))
    assert(detailResp.ok() && detailBody?.code === 200, `页面详情接口失败：${detailBody?.msg ?? detailResp.status()}`)

    await page.getByRole('tab', { name: '主表' }).click()
    if (seedPiNo) {
      await page.getByText(seedPiNo, { exact: false }).first().waitFor({ state: 'visible', timeout: 10000 })
    }

    await page.getByRole('tab', { name: '明细' }).click()
    const hasLines = (detailBody?.data?.lines ?? []).length > 0
    if (hasLines) {
      await page.locator('.so-lines-table').waitFor({ state: 'visible', timeout: 10000 })
      await page.getByText('货品编码').first().waitFor({ state: 'visible', timeout: 5000 })
    } else {
      await page.getByText('暂无明细').waitFor({ state: 'visible', timeout: 10000 })
    }

    await page.screenshot({ path: outPng, fullPage: true })
    console.log('已截图：', outPng)

    await page.locator('.so-view-dialog .el-dialog__footer').getByRole('button', { name: '关闭' }).click()
    await page.locator('.so-view-dialog').waitFor({ state: 'hidden', timeout: 10000 })

    // 回收站开关应带 recycled=1 重新请求列表
    const recycleSwitch = page.locator('.audit-switch .el-switch')
    await recycleSwitch.waitFor({ state: 'visible', timeout: 10000 })
    const recycleListWait = page.waitForResponse(
      (r) => {
        const u = r.url()
        return u.includes('/api/sales-order/list') && u.includes('recycled=1') && r.request().method() === 'GET'
      },
      { timeout: 20000 },
    )
    await recycleSwitch.click()
    const recycleResp = await recycleListWait
    const recycleBody = await recycleResp.json().catch(() => ({}))
    assert(recycleResp.ok() && recycleBody?.code === 200, '回收站列表请求失败')
    await page.getByText('当前为回收站视图').waitFor({ state: 'visible', timeout: 10000 })
    console.log('【UI 校验通过】列表 → 查看详情（主表/明细）→ 回收站切换。')
  } finally {
    await browser.close()
  }
}

main().catch((e) => {
  console.error('e2e_sales_order_list_read_failed', String(e?.message ?? e))
  process.exit(1)
})
