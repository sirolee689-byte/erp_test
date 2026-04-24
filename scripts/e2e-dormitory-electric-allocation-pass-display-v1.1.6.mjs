/**
 * E2E（规则 14）：宿舍费用分摊 — 未审档案(pass!=1)仍出现在报表，姓名含「(档案未审)」，异常说明或金额警示可用
 * 1) 登录 → 调分摊接口 → 若有未参与摊费行则断言 staff_display_name / fee_share_applied
 * 2) 打开报表页 Tab2 → 全页截图
 *
 * 前置：.env 中 E2E_USERCODE、E2E_PASSWORD；API 3001、Vite 5173；库中需存在当月含未审在住样本时断言更严格
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
const outPng = join(outDir, 'dormitory-electric-allocation-pass-display-v1.1.6.png')

const baseUrl = String(process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173').replace(/\/$/, '')
const apiBase = String(process.env.PLAYWRIGHT_API_BASE_URL ?? 'http://localhost:3001').replace(/\/$/, '')
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

async function main() {
  assert(userCode && password, '请在 .env 配置 E2E_USERCODE 与 E2E_PASSWORD')
  mkdirSync(outDir, { recursive: true })

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  try {
    await login(page)
    const token = await page.evaluate(() => localStorage.getItem('erp_token'))
    assert(token && String(token).trim(), '未读取到 erp_token')
    const headers = { Authorization: `Bearer ${String(token).trim()}` }

    const y = new Date().getFullYear()
    const m = new Date().getMonth() + 1
    const apiRes = await fetch(`${apiBase}/api/dorm/electric-allocation-report?year=${y}&month=${m}`, { headers })
    const apiJson = await apiRes.json()
    assert(apiJson?.code === 200, `分摊接口失败：${apiJson?.msg ?? apiRes.status}`)
    const rows = apiJson?.data?.list ?? []
    const hint = String(apiJson?.data?.allocation_anomaly_hint ?? '').trim()

    const unapplied = rows.filter((r) => r?.fee_share_applied === false)
    const hasUnauditedName = rows.some((r) => String(r?.staff_display_name ?? '').includes('档案未审'))
    if (unapplied.length > 0) {
      assert(hasUnauditedName, '存在 fee_share_applied=false 但姓名未带「档案未审」标注')
      for (const r of unapplied) {
        assert(Number(r?.share_money ?? 1) === 0, `未参与摊费行 share_money 应为 0：${JSON.stringify(r)}`)
        assert(Number(r?.share_electric ?? 1) === 0, `未参与摊费行 share_electric 应为 0：${JSON.stringify(r)}`)
      }
    }
    if (hint) {
      console.log('异常说明片段：', hint.slice(0, 120))
    } else if (rows.length > 0) {
      console.log('提示：当前月份分摊数据无异常说明（可能无 pass!=1 在住样本）')
    }

    await page.goto(`${baseUrl}/hr/dormitory/electric-report`, { waitUntil: 'domcontentloaded' })
    await page.locator('.toolbar-card').getByRole('button', { name: '查询' }).click()
    await sleep(1200)
    await page.getByRole('tab', { name: '宿舍费用分摊情况' }).click()
    await sleep(600)
    await page.locator('[data-testid="electric-allocation-table"]').waitFor({ state: 'visible', timeout: 20000 })
    await page.screenshot({ path: outPng, fullPage: true })
    console.log('E2E 完成：', outPng, '接口行数=', rows.length, '未摊费行数=', unapplied.length)
  } finally {
    await browser.close()
  }
}

main().catch((e) => {
  console.error('E2E 失败：', e)
  process.exit(1)
})
