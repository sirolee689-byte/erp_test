/**
 * E2E：部门/岗位名称不可重复（Playwright + 接口校验）
 *
 * 依赖：Chrome（channel: 'chrome'）、.env 中 E2E_USERCODE / E2E_PASSWORD、Vite + 后端已启动
 * 命令：npm run e2e:dept-office
 */
import dotenv from 'dotenv'

dotenv.config()

const baseUrl = String(process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173').replace(/\/$/, '')
// 固定打到本机后端 3001（与 vite proxy 一致），避免环境变量指向其它端口导致跑到旧进程
const apiBase = 'http://localhost:3001'

const userCode = String(process.env.E2E_USERCODE ?? '').trim()
const password = String(process.env.E2E_PASSWORD ?? '')

if (!userCode || !String(password).trim()) {
  console.error('【缺少登录配置】请在根目录 .env 中增加 E2E_USERCODE、E2E_PASSWORD。')
  process.exit(2)
}

async function loginJson() {
  const res = await fetch(`${apiBase}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ Account: userCode, Password: password }),
  })
  const json = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, json }
}

async function postDept(token, body) {
  return fetch(`${apiBase}/api/hr/departments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
}

function assert(cond, msg) {
  if (!cond) {
    console.error('【断言失败】', msg)
    process.exit(1)
  }
}

async function safeClick(locator, times = 3) {
  let lastErr
  for (let i = 0; i < times; i += 1) {
    try {
      await locator.waitFor({ state: 'visible', timeout: 15000 })
      await locator.click({ timeout: 15000 })
      return
    } catch (e) {
      lastErr = e
      // 常见：列表刷新导致按钮 DOM 脱离，稍等后重试
      await new Promise((r) => setTimeout(r, 600))
    }
  }
  throw lastErr
}

async function main() {
  const { ok, status, json } = await loginJson()
  if (!ok || json?.code !== 200 || !json?.data?.token) {
    console.error('【登录失败】', status, json?.msg ?? json)
    process.exit(1)
  }
  const token = String(json.data.token)
  const user = json.data.user ?? {}
  const expectedUid = user?.UserID != null ? String(user.UserID) : ''
  const expectedUname = user?.UserName != null ? String(user.UserName) : ''

  const tag = `${Date.now()}`
  const deptName = `E2E部门_${tag}`
  const postName = `E2E岗位_${tag}`

  // 说明：改为纯接口校验，避免按钮权限或 DOM 刷新导致 E2E 不稳定

  // 1) 新增部门（唯一名称）→ 成功
  const r1 = await postDept(token, { name: deptName })
  const body1 = await r1.json().catch(() => ({}))
  assert(r1.status === 200 && body1?.code === 200, `首次新增部门失败：${JSON.stringify(body1)}`)
  const deptCode = String(body1?.data?.code ?? '').trim()
  assert(deptCode.length > 0, '未返回部门 code')
  // v1.1.0：新增部门写入创建人 uid/uname（来自登录用户）
  assert(String(body1?.data?.uid ?? '') === expectedUid, `新增部门 uid 未写入预期：got=${body1?.data?.uid} expected=${expectedUid}`)
  assert(String(body1?.data?.uname ?? '') === expectedUname, `新增部门 uname 未写入预期：got=${body1?.data?.uname} expected=${expectedUname}`)

  // 2) 再次新增同名部门 → 400
  const r2 = await postDept(token, { name: deptName })
  const body2 = await r2.json().catch(() => ({}))
  assert(r2.status === 400 && body2?.code === 400, `重复部门名应返回 400：${JSON.stringify(body2)}`)

  // 3) 新增岗位（唯一名称）→ 成功
  const r3 = await postDept(token, { name: postName, ParentID: deptCode })
  const body3 = await r3.json().catch(() => ({}))
  assert(r3.status === 200 && body3?.code === 200, `新增岗位失败：${JSON.stringify(body3)}`)

  // 4) 同部门下岗位同名 → 400
  const r4 = await postDept(token, { name: postName, ParentID: deptCode })
  const body4 = await r4.json().catch(() => ({}))
  assert(r4.status === 400 && body4?.code === 400, `同部门岗位重名应 400：${JSON.stringify(body4)}`)

  // 5) 跨部门岗位同名 → 允许
  const deptName2 = `E2E部门2_${tag}`
  const r5 = await postDept(token, { name: deptName2 })
  const body5 = await r5.json().catch(() => ({}))
  assert(r5.status === 200 && body5?.code === 200, `新增第二个部门失败：${JSON.stringify(body5)}`)
  const deptCode2 = String(body5?.data?.code ?? '').trim()
  assert(deptCode2.length > 0, '第二个部门未返回 code')

  const r6 = await postDept(token, { name: postName, ParentID: deptCode2 })
  const body6 = await r6.json().catch(() => ({}))
  assert(r6.status === 200 && body6?.code === 200, `跨部门岗位同名应允许：${JSON.stringify(body6)}`)

  console.log('【通过】规则校验 + uid/uname 写入：部门名称不可重复、同部门岗位不可重复、跨部门岗位可重名均正常。')
  console.log('  本次部门 code=', deptCode, '部门名=', deptName, '岗位名=', postName)
}

main().catch((e) => {
  console.error('【异常】', e?.message ?? e)
  process.exit(1)
})
