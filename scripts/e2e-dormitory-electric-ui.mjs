/**
 * E2E：电费管理中心（v1.1.5）- 弹窗零滚动 + 金额联动 + 落库 + 审计
 * 目标：
 * 1) 进入「住宿管理」→ 房间列表
 * 2) 找到“入住人数>0”的房间，点击“电费管理”打开弹窗
 * 3) 输入“本期读数”，断言“合计金额”自动变化（无需点保存）
 * 4) 截图：展示整个弹窗，确保【保存】按钮清晰可见且不需要滚动
 * 5) 点击保存，落库 Hr_room_use，并验证 Sys_OperationLogs 存在“电费核算”审计
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
const outPngDialog = join(outDir, 'dorm-electric-ui-v1.1.5.png')
const outPngAfterSave = join(outDir, 'dorm-electric-ui-v1.1.5-after-save.png')
const outPngMonth03 = join(outDir, 'dorm-electric-ui-v1.1.5-month-2026-03.png')
const outPngMonth02 = join(outDir, 'dorm-electric-ui-v1.1.5-month-2026-02.png')
const outPngMeterChange = join(outDir, 'dorm-electric-meter-change-v1.1.5.png')
const outPngSplitFix = join(outDir, 'dorm-electric-split-fix-v1.1.5.png')

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

async function closeTopDialogIfAny(page) {
  const dialogs = page.locator('.el-overlay .el-dialog')
  const n = await dialogs.count()
  if (n <= 0) return
  // 优先点右上角关闭按钮（避免遮罩拦截页面点击）
  const closeBtn = dialogs.nth(n - 1).locator('.el-dialog__headerbtn').first()
  if (await closeBtn.isVisible().catch(() => false)) {
    await closeBtn.click()
    await sleep(500)
    return
  }
  await page.keyboard.press('Escape')
  await sleep(500)
}

async function login(page) {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' })
  await page.getByPlaceholder('请输入账号').fill(userCode)
  await page.getByPlaceholder('请输入密码').fill(password)
  await page.getByRole('button', { name: '登录' }).click()
  await page.waitForLoadState('networkidle', { timeout: 30000 })
}

async function openElectricDialog(page) {
  await page.goto(`${baseUrl}/hr/dormitory/lodging-records`, { waitUntil: 'domcontentloaded' })
  await page.locator('.el-table').first().waitFor({ state: 'visible', timeout: 30000 })
  await sleep(800)

  // 先从数据库挑选一个同时存在 2026-03 与 2026-02 记录的房间号，确保联动能观察到变化
  const { getPool } = await import('../server/db.js')
  const pool = await getPool()
  const pickRs = await pool.request().query(`
    SELECT TOP (1)
      LTRIM(RTRIM(ISNULL(room_code, N''))) AS room_code
    FROM dbo.Hr_room_use
    WHERE LTRIM(RTRIM(ISNULL(del, N'0'))) = N'0'
      AND LTRIM(RTRIM(ISNULL(room_code, N''))) <> N''
      AND LTRIM(RTRIM(ISNULL(tj_date, N''))) IN (N'2026-03', N'2026-02', N'2026-3', N'2026-2')
    GROUP BY LTRIM(RTRIM(ISNULL(room_code, N'')))
    HAVING COUNT(DISTINCT LTRIM(RTRIM(ISNULL(tj_date, N'')))) = 2
    ORDER BY MAX(id) DESC
  `)
  const pickedRoomCode = String(pickRs.recordset?.[0]?.room_code ?? '').trim()
  assert(pickedRoomCode, '数据库中未找到同时存在 2026-03 与 2026-02 电费记录的房间号')

  // 页面按房号过滤（RoomList 的关键字输入框）
  const kwInput = page.getByPlaceholder('搜索入住宿舍：房号/楼栋/名称/房型')
  await kwInput.fill(pickedRoomCode)
  await page.locator('.filter-card').first().getByRole('button', { name: '立即查询' }).click()
  await sleep(1200)

  const rows = page.locator('.el-table__body-wrapper tbody tr')
  const n = await rows.count()
  assert(n > 0, `按房号过滤后无数据：${pickedRoomCode}`)
  const target = rows.first()

  const roomCode = String((await target.locator('td').nth(1).textContent()) ?? '').trim()
  assert(roomCode && roomCode.includes(pickedRoomCode), `过滤后房号不匹配：picked=${pickedRoomCode} got=${roomCode}`)

  await target.getByRole('button', { name: '电费管理' }).click()
  const dlg = page.getByRole('dialog', { name: new RegExp(`电费管理中心\\s*-\\s*房间\\s*${roomCode}`) })
  await dlg.waitFor({ state: 'visible', timeout: 15000 })
  return { dlg, roomCode }
}

async function verifyAutoCalc(page, dlg) {
  const totalInput = dlg.locator('.el-form-item', { hasText: '合计金额' }).locator('input').first()
  await totalInput.waitFor({ state: 'visible', timeout: 10000 })

  const totalBefore = await totalInput.inputValue()

  const oldInput = dlg.locator('.el-form-item', { hasText: '上期读数' }).locator('input').first()
  await oldInput.waitFor({ state: 'visible', timeout: 10000 })
  const oldText = String((await oldInput.inputValue()) ?? '').trim()
  const oldNum = Number(oldText || '0')
  const oldSafe = Number.isFinite(oldNum) && oldNum >= 0 ? oldNum : 0

  // 本期读数：Element Plus 的 el-input-number 内部有真实 <input>，直接定位并填入
  const curInput = dlg.locator('.el-form-item', { hasText: '本期读数' }).locator('input').first()
  await curInput.waitFor({ state: 'visible', timeout: 10000 })
  await curInput.fill(String(oldSafe + 100))
  await curInput.blur()

  // 等待联动刷新（短轮询，避免 UI 渲染延迟）
  let totalAfter = await totalInput.inputValue()
  for (let i = 0; i < 10; i++) {
    if (String(totalAfter ?? '').trim() !== String(totalBefore ?? '').trim()) break
    await sleep(200)
    totalAfter = await totalInput.inputValue()
  }
  assert(
    String(totalAfter ?? '').trim() !== String(totalBefore ?? '').trim(),
    `合计金额未自动变化：before=${totalBefore} after=${totalAfter}`,
  )

  // 截图：必须能看到保存按钮（不滚动）
  await page.screenshot({ path: outPngDialog, fullPage: true })
}

async function saveAndVerifyDb(page, dlg, roomCode) {
  const saveBtn = dlg.getByRole('button', { name: '保存' })
  await saveBtn.waitFor({ state: 'visible', timeout: 10000 })
  await saveBtn.click()

  // 等待“保存成功”提示
  await page.locator('.el-message').first().waitFor({ state: 'visible', timeout: 15000 })
  await sleep(800)
  await page.screenshot({ path: outPngAfterSave, fullPage: true })

  // 数据库核验：Hr_room_use 写入 + Sys_OperationLogs 审计
  const { getPool } = await import('../server/db.js')
  const pool = await getPool()

  const useRs = await pool.request().input('room_code', roomCode).query(`
    SELECT TOP (1)
      id, room_code, tj_date, c_sum_money, c_old_end, c_this, c_electric, c_money, c_yh_electric
    FROM dbo.Hr_room_use
    WHERE LTRIM(RTRIM(ISNULL(del, N'0'))) = N'0'
      AND LTRIM(RTRIM(ISNULL(room_code, N''))) = @room_code
    ORDER BY id DESC
  `)
  const useRow = useRs.recordset?.[0]
  assert(useRow && String(useRow.room_code ?? '').trim() === roomCode, 'Hr_room_use 未找到最新写入记录')
  assert(String(useRow.c_sum_money ?? '').trim() !== '', `Hr_room_use.c_sum_money 为空：${JSON.stringify(useRow)}`)

  const logRs = await pool.request().query(`
    SELECT TOP (1) Action, TargetTable, Content
    FROM dbo.Sys_OperationLogs
    WHERE TargetTable = N'Hr_room_use'
      AND Action = N'电费核算'
    ORDER BY LogID DESC
  `)
  const logRow = logRs.recordset?.[0]
  assert(logRow, 'Sys_OperationLogs 未找到“电费核算”审计记录')
  const content = String(logRow?.Content ?? '')
  assert(content.includes(roomCode), `审计详情未包含房间号：${content}`)
}

async function verifyMonthLinkage(page, dlg) {
  const tjInput = dlg.locator('.el-form-item', { hasText: '统计月份' }).locator('input').first()
  const oldInput = dlg.locator('.el-form-item', { hasText: '上期读数' }).locator('input').first()
  const curInput = dlg.locator('.el-form-item', { hasText: '本期读数' }).locator('input').first()

  await tjInput.waitFor({ state: 'visible', timeout: 10000 })
  await oldInput.waitFor({ state: 'visible', timeout: 10000 })
  await curInput.waitFor({ state: 'visible', timeout: 10000 })

  // 切到 2026-03
  await tjInput.fill('2026-03')
  await tjInput.blur()
  await sleep(1200)
  const old03 = String((await oldInput.inputValue()) ?? '').trim()
  const cur03 = String((await curInput.inputValue()) ?? '').trim()
  await page.screenshot({ path: outPngMonth03, fullPage: true })

  // 切到 2026-02
  await tjInput.fill('2026-02')
  await tjInput.blur()
  await sleep(1200)
  const old02 = String((await oldInput.inputValue()) ?? '').trim()
  const cur02 = String((await curInput.inputValue()) ?? '').trim()
  await page.screenshot({ path: outPngMonth02, fullPage: true })

  // 要求：月份切换后自动更新（允许其中一个为 0，但应当发生变化）
  assert(old02 !== old03 || cur02 !== cur03, `月份切换后读数未变化：03=[${old03},${cur03}] 02=[${old02},${cur02}]`)
}

async function verifyMeterChangeFormula(page, dlg) {
  const priceInput = dlg.locator('.el-form-item', { hasText: '单价' }).locator('input').first()
  const switchEl = dlg.locator('.el-form-item', { hasText: '换表' }).locator('.el-switch').first()
  const cStarInput = dlg.locator('.el-form-item', { hasText: '上期读数' }).locator('input').first()
  const oldEndInput = dlg.locator('.el-form-item', { hasText: '旧表结束数' }).locator('input').first()
  const newStarInput = dlg.locator('.el-form-item', { hasText: '新表开始数' }).locator('input').first()
  const cThisInput = dlg.locator('.el-form-item', { hasText: '本期读数' }).locator('input').first()
  const usedInput = dlg.locator('.el-form-item', { hasText: '用电量' }).locator('input').first()

  await priceInput.waitFor({ state: 'visible', timeout: 10000 })
  // 断言：单价不可编辑（disabled 或 readonly 任一即可）
  const disabled = await priceInput.isDisabled()
  const ro = await priceInput.getAttribute('readonly')
  assert(disabled || ro !== null, '单价输入框可编辑（应 disabled/readonly）')

  // 开启换表
  await switchEl.click()
  await oldEndInput.waitFor({ state: 'visible', timeout: 10000 })
  await newStarInput.waitFor({ state: 'visible', timeout: 10000 })

  const cStarText = String((await cStarInput.inputValue()) ?? '').trim()
  const cStar = Number(cStarText || '0')
  const cStarSafe = Number.isFinite(cStar) && cStar >= 0 ? cStar : 0

  // 设定一组可控数字，确保两段式计算为正
  const oldEnd = cStarSafe + 50
  const newStar = 10
  const cThis = newStar + 40
  const expected = (oldEnd - cStarSafe) + (cThis - newStar)

  await oldEndInput.fill(String(oldEnd))
  await newStarInput.fill(String(newStar))
  await cThisInput.fill(String(cThis))
  await cThisInput.blur()
  await sleep(600)

  const usedText = String((await usedInput.inputValue()) ?? '').trim()
  const usedNum = Number(usedText || '0')
  assert(Number.isFinite(usedNum), `用电量不是数字：${usedText}`)
  assert(Math.abs(usedNum - expected) < 0.0001, `换表公式计算不正确：expected=${expected} got=${usedNum}（c_star=${cStarSafe}, oldEnd=${oldEnd}, newStar=${newStar}, c_this=${cThis}）`)

  await page.screenshot({ path: outPngMeterChange, fullPage: true })
}

async function verifySplitLogicExample(page, dlg) {
  // 确保没有弹窗遮罩拦截点击
  await closeTopDialogIfAny(page)

  // 目标：用电量=107，个人优惠=15（来自在住人员 electric），断言分摊=35.80
  const { getPool } = await import('../server/db.js')
  const pool = await getPool()

  // 找一个“当前在住人数=2 且两人优惠电量都为 15”的房间（更贴近你给的 205 示例）
  const pickRs = await pool.request().query(`
    SELECT TOP (1)
      LTRIM(RTRIM(ISNULL(room_code, N''))) AS room_code
    FROM dbo.Hr_room_in
    WHERE LTRIM(RTRIM(ISNULL(del, N'0'))) = N'0'
      AND LTRIM(RTRIM(ISNULL(out_room, N'0'))) = N'0'
      AND LTRIM(RTRIM(ISNULL(room_code, N''))) <> N''
    GROUP BY LTRIM(RTRIM(ISNULL(room_code, N'')))
    HAVING COUNT(1) = 2
       AND SUM(
         CASE
           WHEN ISNUMERIC(REPLACE(LTRIM(RTRIM(ISNULL(electric, N'0'))), N' ', N'')) = 1
             AND CONVERT(int, REPLACE(LTRIM(RTRIM(ISNULL(electric, N'0'))), N' ', N'')) = 15
           THEN 1 ELSE 0 END
       ) = 2
    ORDER BY MAX(id) DESC
  `)
  const pickedRoomCode = String(pickRs.recordset?.[0]?.room_code ?? '').trim()
  assert(pickedRoomCode, '未找到“在住2人且优惠电量均为15”的房间，无法做 35.80 例子验证')

  // 回到房间列表按房号过滤并打开该房间的电费管理（复用页面已打开，直接操作）
  const kwInput = page.getByPlaceholder('搜索入住宿舍：房号/楼栋/名称/房型')
  await kwInput.fill(pickedRoomCode)
  await page.locator('.filter-card').first().getByRole('button', { name: '立即查询' }).click()
  await sleep(1200)
  const rows = page.locator('.el-table__body-wrapper tbody tr')
  assert((await rows.count()) > 0, `按房号过滤后无数据：${pickedRoomCode}`)
  const target = rows.first()
  await target.getByRole('button', { name: '电费管理' }).click()

  const dlg2 = page.getByRole('dialog', { name: new RegExp(`电费管理中心\\s*-\\s*房间\\s*${pickedRoomCode}`) })
  await dlg2.waitFor({ state: 'visible', timeout: 15000 })

  // 关闭换表，确保走普通公式
  const switchEl = dlg2.locator('.el-form-item', { hasText: '换表' }).locator('.el-switch').first()
  const oldEndInput = dlg2.locator('.el-form-item', { hasText: '旧表结束数' }).locator('input').first()
  if (await oldEndInput.isVisible().catch(() => false)) {
    await switchEl.click()
    await sleep(300)
  }

  const cStarInput = dlg2.locator('.el-form-item', { hasText: '上期读数' }).locator('input').first()
  const cThisInput = dlg2.locator('.el-form-item', { hasText: '本期读数' }).locator('input').first()
  const usedInput = dlg2.locator('.el-form-item', { hasText: '用电量' }).locator('input').first()

  const cStarText = String((await cStarInput.inputValue()) ?? '').trim()
  const cStar = Number(cStarText || '0')
  const cStarSafe = Number.isFinite(cStar) && cStar >= 0 ? cStar : 0
  await cThisInput.fill(String(cStarSafe + 107))
  await cThisInput.blur()
  await sleep(800)

  const usedText = String((await usedInput.inputValue()) ?? '').trim()
  assert(Number(usedText) === 107, `用电量未达到 107：${usedText}`)

  // 断言：表格分摊金额为 35.80
  const firstShareCell = dlg2.locator('.el-table__body-wrapper tbody tr').first().locator('td').last()
  const shareText = String((await firstShareCell.textContent()) ?? '').trim()
  assert(shareText.includes('35.80'), `分摊金额不正确：${shareText}（期望包含 35.80）`)

  await page.screenshot({ path: outPngSplitFix, fullPage: true })

  // 关闭弹窗，避免影响后续步骤
  await closeTopDialogIfAny(page)
}

async function main() {
  assert(userCode && password, '请在 .env 配置 E2E_USERCODE 与 E2E_PASSWORD')
  mkdirSync(outDir, { recursive: true })

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  try {
    await login(page)
    const { dlg, roomCode } = await openElectricDialog(page)
    await verifyMonthLinkage(page, dlg)
    await verifyMeterChangeFormula(page, dlg)
    await verifyAutoCalc(page, dlg)
    await saveAndVerifyDb(page, dlg, roomCode)
    await verifySplitLogicExample(page, dlg)
    console.log('E2E 完成：', outPngMonth03, outPngMonth02, outPngMeterChange, outPngDialog, outPngSplitFix, outPngAfterSave)
  } finally {
    await browser.close()
  }
}

main().catch((e) => {
  console.error('E2E 失败：', e)
  process.exit(1)
})

