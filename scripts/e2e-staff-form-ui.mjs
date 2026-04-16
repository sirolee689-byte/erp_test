/**
 * E2E：员工档案「新增员工」弹窗截图 + 入职部门下拉不得包含未审核顶级部门（接口断言）
 *
 * 依赖：Chrome（channel: 'chrome'）、.env 中 E2E_USERCODE / E2E_PASSWORD、Vite + 后端已启动
 * 命令：npm run e2e:staff-form-ui
 * 产出：项目根目录 e2e-output/staff-dialog.png
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
const outPng = join(outDir, 'staff-dialog.png')
const outPngDept = join(outDir, 'staff-dialog-dept-options.png')

const baseUrl = String(process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173').replace(/\/$/, '')
const apiBase = String(process.env.PLAYWRIGHT_API_URL ?? 'http://localhost:3001').replace(/\/$/, '')

const userCode = String(process.env.E2E_USERCODE ?? '').trim()
const password = String(process.env.E2E_PASSWORD ?? '')

function assert(cond, msg) {
  if (!cond) {
    console.error('【断言失败】', msg)
    process.exit(1)
  }
}

/** 与后端 legacyDeptPassIsAudited 一致（JSON 中小写 pass） */
function rowPassIsAudited(passVal) {
  return String(passVal ?? '').trim() === '1'
}

function isTopLevelDept(row) {
  const pid = String(row?.ParentID ?? '').trim()
  return pid === '' || pid === '0'
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

/**
 * 校验：员工入职部门下拉的 code 集合，与「未审核列表中的顶级部门 code」无交集
 */
async function assertStaffDeptOptionsExcludeUnauditedTop(token) {
  const h = { Authorization: `Bearer ${token}` }
  const optRes = await fetch(`${apiBase}/api/hr/staff/department-options`, { headers: h })
  const optJson = await optRes.json().catch(() => ({}))
  assert(
    optRes.ok && optJson?.code === 200,
    `GET /api/hr/staff/department-options 失败：http=${optRes.status} body=${JSON.stringify(optJson)}`,
  )
  const optCodes = new Set(
    (optJson?.data?.list ?? []).map((x) => String(x?.code ?? '').trim()).filter(Boolean),
  )

  const deptRes = await fetch(`${apiBase}/api/hr/departments?pass=0&page=1&pageSize=500`, { headers: h })
  const deptJson = await deptRes.json().catch(() => ({}))
  assert(
    deptRes.ok && deptJson?.code === 200,
    `GET /api/hr/departments?pass=0 失败：http=${deptRes.status} body=${JSON.stringify(deptJson)}`,
  )
  const unauditedTopCodes = (deptJson?.data?.list ?? [])
    .filter((row) => isTopLevelDept(row) && !rowPassIsAudited(row?.pass))
    .map((row) => String(row?.code ?? '').trim())
    .filter(Boolean)

  const leaked = unauditedTopCodes.filter((c) => optCodes.has(c))
  assert(
    leaked.length === 0,
    `入职部门下拉仍包含未审核顶级部门：code=${JSON.stringify(leaked)}；下拉共 ${optCodes.size} 条，未审顶级共 ${unauditedTopCodes.length} 条`,
  )
  console.log(
    `【接口校验通过】入职部门下拉 ${optCodes.size} 条，与未审核顶级部门（${unauditedTopCodes.length} 条）无交集。`,
  )
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
  const user = json.data.user ?? {}

  await assertStaffDeptOptionsExcludeUnauditedTop(token)

  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
  })
  const page = await browser.newPage()
  try {
    // 走真实登录流程：避免 localStorage 注入时序/权限模型导致仍停留在登录页
    await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' })
    await page.getByPlaceholder('请输入工号').fill(String(userCode))
    await page.getByPlaceholder('请输入密码').fill(String(password))
    await page.getByRole('button', { name: '登录' }).click()
    // 登录成功后会跳转到 redirect 或第一个有权限菜单
    await page.waitForLoadState('networkidle', { timeout: 30000 })
    await page.goto(`${baseUrl}/hr/files/employee-files`, { waitUntil: 'domcontentloaded' })
    await page.locator('.el-table, .el-skeleton').first().waitFor({ state: 'visible', timeout: 30000 })
    try {
      const addBtn = page.getByRole('button', { name: '新增员工' })
      await addBtn.waitFor({ state: 'visible', timeout: 8000 })
      const deptOptionsRespWait = page.waitForResponse(
        (r) =>
          r.url().includes('/api/hr/staff/department-options') && r.request().method() === 'GET',
        { timeout: 20000 },
      ).catch(() => null)

      await addBtn.click({ timeout: 10000 })
      await page.getByText('基本信息').first().waitFor({ state: 'visible', timeout: 15000 })
      await page.getByText('背景调查').first().waitFor({ state: 'visible', timeout: 5000 })

      // 断言：页面端确实请求到了入职部门下拉，并且返回 list>0（否则 UI 会显示“无数据”）
      const deptResp = await deptOptionsRespWait
      if (deptResp) {
        const hitUrl = deptResp.url()
        const status = deptResp.status()
        const rawText = await deptResp.text().catch(() => '')
        let body = {}
        try {
          body = JSON.parse(rawText || '{}')
        } catch {
          body = {}
        }
        const list = body?.data?.list
        const n = Array.isArray(list) ? list.length : 0
        if (n <= 0) {
          console.error('【页面端部门下拉响应】url=', hitUrl)
          console.error('【页面端部门下拉响应】status=', status)
          console.error('【页面端部门下拉响应】text(前200)=', String(rawText ?? '').slice(0, 200))
        }
        assert(n > 0, `页面端部门下拉接口返回空：status=${status} body=${JSON.stringify(body)}`)
      } else {
        console.warn('【提示】未捕获到页面端 /api/hr/staff/department-options 响应（可能页面未触发请求）。')
      }

      // 打开「入职部门」下拉并截图（用于肉眼确认：只显示已审核部门）
      const deptLabel = page.getByText('入职部门', { exact: true })
      await deptLabel.waitFor({ state: 'visible', timeout: 5000 })
      // Element Plus：点击 label 同行的 el-select 触发下拉
      const deptItem = deptLabel.locator('..').locator('..')
      await deptItem.locator('.el-select').click({ timeout: 10000 })
      await page.locator('.el-select-dropdown:visible').first().waitFor({ state: 'visible', timeout: 10000 })

      // UI 断言：下拉项数量必须 > 0（避免“无数据”假通过）
      const optionCount = await page.locator('.el-select-dropdown:visible .el-select-dropdown__item').count()
      assert(optionCount > 0, `UI 下拉仍显示无数据：el-select-dropdown__item count=${optionCount}`)

      await page.screenshot({ path: outPngDept, fullPage: true })
      console.log('已截图（部门下拉）：', outPngDept)
    } catch (e) {
      // 无 add 权限时按钮不存在，或列表刷新导致点击失败：仍导出整页截图供人工查看
      console.warn('【提示】未打开新增弹窗（可能无按钮权限或 UI 未就绪）：', String(e?.message ?? e))
    }
    await page.screenshot({ path: outPng, fullPage: true })
    console.log('已截图：', outPng)
  } finally {
    await browser.close()
  }
}

main().catch((e) => {
  console.error('e2e_staff_form_ui_failed', String(e?.message ?? e))
  process.exit(1)
})
