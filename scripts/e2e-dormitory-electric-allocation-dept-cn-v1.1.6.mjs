/**
 * E2E（规则 14）：宿舍费用分摊表 — 部门/职务为中文名称或「未设定」，不得为纯数字编码
 * 1) 登录 → 报表页 → 查询 → 切到「宿舍费用分摊情况」
 * 2) 调接口校验 dept_name、position_name 非纯数字（允许「未设定」）
 * 3) 全页截图
 *
 * 前置：.env 中 E2E_USERCODE、E2E_PASSWORD；API 3001、Vite 5173
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
const outPng = join(outDir, 'dormitory-electric-allocation-dept-cn-v1.1.6.png')

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

/** 纯数字编码（报表中不应作为部门/职务展示） */
function isDigitsOnly(s) {
  return /^\d+$/.test(String(s ?? '').trim())
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
    if (rows.length > 0) {
      for (let i = 0; i < rows.length; i += 1) {
        const r = rows[i]
        const d = String(r?.dept_name ?? '').trim()
        const p = String(r?.position_name ?? '').trim()
        assert(!isDigitsOnly(d), `第 ${i + 1} 行部门仍为纯数字：${d}`)
        assert(!isDigitsOnly(p), `第 ${i + 1} 行职务仍为纯数字：${p}`)
      }
    }

    await page.goto(`${baseUrl}/hr/dormitory/electric-report`, { waitUntil: 'domcontentloaded' })
    await page.locator('.toolbar-card').getByRole('button', { name: '查询' }).click()
    await sleep(1200)
    await page.getByRole('tab', { name: '宿舍费用分摊情况' }).click()
    await sleep(600)
    await page.locator('[data-testid="electric-allocation-table"]').waitFor({ state: 'visible', timeout: 20000 })
    await page.screenshot({ path: outPng, fullPage: true })
    console.log('E2E 完成：', outPng, '接口行数=', rows.length)
  } finally {
    await browser.close()
  }
}

main().catch((e) => {
  console.error('E2E 失败：', e)
  process.exit(1)
})
