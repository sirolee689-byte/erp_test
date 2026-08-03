import crypto from 'node:crypto'
import { getPool, sql } from './db.js'
import { createDiningTableRefs } from './diningDatabase.js'

export const DINING_TOKEN_TTL_MS = 8 * 60 * 60 * 1000

function normalizeEmployee(row) {
  return {
    id: Number(row?.id ?? 0),
    new_code: String(row?.new_code ?? '').trim(),
    name: String(row?.name ?? '').trim(),
    in_bm: String(row?.in_bm ?? '').trim(),
    meal_type: String(row?.meal_type ?? '').trim(),
    // 员工端顶部只显示本人饭卡号：新卡优先，旧卡为空时兜底。
    cardNumber: String(row?.new_card_number ?? '').trim() || String(row?.card_number ?? '').trim(),
  }
}

function normalizeEmployeeSnapshot(row) {
  return {
    ...normalizeEmployee(row),
    in_bm_systemcode: String(row?.in_bm_systemcode ?? '').trim(),
    code: String(row?.code ?? '').trim(),
    card_number: String(row?.card_number ?? '').trim(),
    new_card_number: String(row?.new_card_number ?? '').trim(),
  }
}

export function readDiningBearerToken(req) {
  const auth = String(req?.headers?.authorization ?? '').trim()
  if (!auth.toLowerCase().startsWith('bearer ')) return ''
  return auth.slice(7).trim()
}

export function createDiningAuthService(options = {}) {
  const poolProvider = options.getPool || getPool
  const tokenTtlMs = Number(options.tokenTtlMs ?? DINING_TOKEN_TTL_MS)
  const now = options.now || (() => Date.now())
  const createToken = options.createToken || (() => crypto.randomBytes(24).toString('hex'))
  const tokenStore = options.tokenStore || new Map()
  const staffFrom = options.staffFrom || createDiningTableRefs().staff

  async function login(accountRaw, passwordRaw) {
    const account = String(accountRaw ?? '').trim()
    const password = String(passwordRaw ?? '')
    if (!account || !password) {
      return { ok: false, status: 400, msg: '请输入员工工号和密码' }
    }

    const pool = await poolProvider()
    const result = await pool
      .request()
      .input('account', sql.NVarChar(50), account)
      .query(`
        SELECT TOP (2)
          s.id,
          s.new_code,
          s.password,
          s.name,
          s.in_bm,
          s.in_bm_systemcode,
          s.meal_type,
          s.code,
          s.card_number,
          s.new_card_number
        FROM ${staffFrom} AS s
        WHERE LTRIM(RTRIM(ISNULL(s.new_code, N''))) = @account
          AND LTRIM(RTRIM(ISNULL(s.del, N'0'))) = N'0'
          AND LTRIM(RTRIM(ISNULL(s.pass, N'0'))) = N'1'
        ORDER BY s.id ASC
      `)

    const rows = result.recordset || []
    if (rows.length === 0) {
      return { ok: false, status: 401, msg: '工号不存在、未审核或已停用' }
    }
    if (rows.length > 1) {
      return { ok: false, status: 500, msg: '该员工工号存在重复资料，请联系管理员处理' }
    }

    // 旧员工表的 password 是 nvarchar(50) 明文列；第一版只兼容读取，不改写存储方式。
    if (String(rows[0].password ?? '') !== password) {
      return { ok: false, status: 401, msg: '密码错误' }
    }

    const employee = normalizeEmployeeSnapshot(rows[0])
    const user = normalizeEmployee(employee)
    const token = createToken()
    tokenStore.set(token, {
      user,
      employee,
      expiresAt: now() + tokenTtlMs,
    })
    return { ok: true, token, user }
  }

  function getSession(tokenRaw) {
    const token = String(tokenRaw ?? '').trim()
    const session = token ? tokenStore.get(token) : null
    if (!session) return null
    if (Number(session.expiresAt) <= now()) {
      tokenStore.delete(token)
      return null
    }
    return session.user
  }

  function getEmployee(tokenRaw) {
    const token = String(tokenRaw ?? '').trim()
    const session = token ? tokenStore.get(token) : null
    if (!session) return null
    if (Number(session.expiresAt) <= now()) {
      tokenStore.delete(token)
      return null
    }
    return session.employee
  }

  function logout(tokenRaw) {
    const token = String(tokenRaw ?? '').trim()
    if (token) tokenStore.delete(token)
  }

  function invalidateEmployeeSessions(employeeId) {
    const target = String(employeeId ?? '')
    for (const [token, session] of tokenStore.entries()) {
      if (String(session?.employee?.id ?? '') === target) tokenStore.delete(token)
    }
  }

  async function changePassword(employee, oldPasswordRaw, newPasswordRaw) {
    const oldPassword = String(oldPasswordRaw ?? '')
    const newPassword = String(newPasswordRaw ?? '')
    if (!oldPassword || !newPassword) {
      return { ok: false, status: 400, msg: '请输入旧密码和新密码' }
    }
    if (newPassword.length > 50) {
      return { ok: false, status: 400, msg: '新密码不能超过50个字符' }
    }

    const pool = await poolProvider()
    const result = await pool.request()
      .input('employeeId', sql.Int, Number(employee?.id ?? 0))
      .input('oldPassword', sql.NVarChar(50), oldPassword)
      .input('newPassword', sql.NVarChar(50), newPassword)
      .query(`
        UPDATE ${staffFrom}
        SET password = @newPassword
        WHERE id = @employeeId
          AND password = @oldPassword
          AND LTRIM(RTRIM(ISNULL(del, N'0'))) = N'0'
          AND LTRIM(RTRIM(ISNULL(pass, N'0'))) = N'1'
      `)
    if (Number(result.rowsAffected?.[0] ?? 0) !== 1) {
      return { ok: false, status: 401, msg: '旧密码错误或员工账号已失效' }
    }
    invalidateEmployeeSessions(employee?.id)
    return { ok: true }
  }

  return { login, getSession, getEmployee, logout, changePassword, invalidateEmployeeSessions, tokenStore }
}

export function registerDiningAuthRoutes(app, options = {}) {
  const service = options.service || createDiningAuthService(options)

  app.post('/api/dining/login', async (req, res) => {
    try {
      const result = await service.login(req.body?.account, req.body?.password)
      if (!result.ok) {
        res.status(result.status).json({ code: result.status, msg: result.msg, data: null })
        return
      }
      res.json({
        code: 200,
        msg: 'success',
        data: { token: result.token, user: result.user },
      })
    } catch (err) {
      console.error('报餐系统登录失败：', err)
      res.status(500).json({ code: 500, msg: '报餐系统暂时无法登录，请稍后再试', data: null })
    }
  })

  app.get('/api/dining/session', (req, res) => {
    const user = service.getSession(readDiningBearerToken(req))
    if (!user) {
      res.status(401).json({ code: 401, msg: '报餐登录已失效，请重新登录', data: null })
      return
    }
    res.json({ code: 200, msg: 'success', data: { user } })
  })

  app.post('/api/dining/logout', (req, res) => {
    service.logout(readDiningBearerToken(req))
    res.json({ code: 200, msg: 'success', data: null })
  })

  app.put('/api/dining/password', async (req, res) => {
    const employee = service.getEmployee(readDiningBearerToken(req))
    if (!employee) {
      res.status(401).json({ code: 401, msg: '报餐登录已失效，请重新登录', data: null })
      return
    }
    try {
      const result = await service.changePassword(employee, req.body?.oldPassword, req.body?.newPassword)
      if (!result.ok) {
        res.status(result.status).json({ code: result.status, msg: result.msg, data: null })
        return
      }
      res.json({ code: 200, msg: '密码修改成功，请使用新密码重新登录', data: null })
    } catch (error) {
      console.error('员工报餐密码修改失败：', error)
      res.status(500).json({ code: 500, msg: '密码修改失败，请稍后重试', data: null })
    }
  })

  return service
}
