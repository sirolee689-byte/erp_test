/**
 * E2E：部门资料页批量审核（仅当前页）
 *
 * 目标：
 * - 打开“显示未审核”后出现【批量审核（仅当前页）】按钮
 * - 点击后只审核当前页数据（本脚本仅验证按钮可用 + 请求成功 + 截图留证）
 *
 * 依赖：Chrome（channel: 'chrome'）、.env 中 E2E_USERCODE / E2E_PASSWORD、Vite + 后端已启动
 * 命令：npm run e2e:dept-batch-audit
 * 产出：e2e-output/dept-batch-audit.png
 */
import dotenv from 'dotenv'
import { mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

dotenv.config()

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const outDir = join(root, 'e2e-output')
const outPng = join(outDir, 'dept-batch-audit.png')

const baseUrl = String(process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173').replace(/\/$/, '')
const apiBase = 'http://localhost:3001'

const userCode = String(process.env.E2E_USERCODE ?? '').trim()
const password = String(process.env.E2E_PASSWORD ?? '')

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
    body: JSON.stringify({ UserCode: userCode, Password: password }),
  })
  const json = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, json }
}

async function seedUnauditedDepts(token) {
  const tag = Date.now()
  for (let i = 0; i < 2; i += 1) {
    const r = await fetch(`${apiBase}/api/hr/departments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: `批审测试_${tag}_${i}` }),
    })
    const b = await r.json().catch(() => ({}))
    assert(r.status === 200 && b?.code === 200, `预置未审核部门失败：http=${r.status} body=${JSON.stringify(b)}`)
  }
}

async function main() {
  if (!userCode || !String(password).trim()) {
    console.error('【缺少登录配置】请在根目录 .env 中增加 E2E_USERCODE、E2E_PASSWORD。')
    process.exit(2)
  }
  const { ok, status, json } = await loginJson()
  if (!ok || json?.code !== 200 || !json?.data?.token) {
    console.error('【登录失败】', status, json?.msg ?? json)
    process.exit(1)
  }
  const token = String(json.data.token)

  await seedUnauditedDepts(token)

  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })

  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage()
  try {
    // 走真实登录流程
    await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' })
    await page.getByPlaceholder('请输入工号').fill(String(userCode))
    await page.getByPlaceholder('请输入密码').fill(String(password))
    await page.getByRole('button', { name: '登录' }).click()
    await page.waitForLoadState('networkidle', { timeout: 30000 })

    await page.goto(`${baseUrl}/hr/files/department`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(900)

    // 打开“显示未审核”
    await page.getByText('显示未审核', { exact: true }).locator('..').locator('.el-switch').click()
    await page.waitForTimeout(900)

    // 批量审核按钮只在显示未审核时出现
    const btn = page.getByRole('button', { name: '批量审核（仅当前页）' })
    await btn.waitFor({ state: 'visible', timeout: 15000 })

    // 点击批量审核并确认
    await btn.click()
    await page.getByRole('button', { name: '确定' }).click({ timeout: 15000 })
    await page.waitForTimeout(1200)

    await page.screenshot({ path: outPng, fullPage: true })
    console.log('已截图：', outPng)
  } finally {
    await browser.close()
  }
}

main().catch((e) => {
  console.error('e2e_dept_batch_audit_failed', String(e?.message ?? e))
  process.exit(1)
})

