/**
 * 后端 API 服务入口
 * 目标：
 * - 连接 SQL Server
 * - 提供 Sys_Users 查询接口给前端页面使用
 */
import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { getPool, sql } from './db.js'
import crypto from 'node:crypto'
import bcrypt from 'bcrypt'

dotenv.config()

const app = express()

// 说明：
// - 开发阶段前端通过 Vite 代理 /api，不会跨域
// - 但如果你单独访问后端，保留 cors 也更稳妥
app.use(cors())
app.use(express.json())

/**
 * 简易登录态（后端内存版）
 * 小白版解释：
 * - 你登录成功后，后端会生成一个随机 token
 * - 这个 token 会先放在后端内存里（Map）
 * - 前端也会把 token 存到浏览器 localStorage（用于路由守卫判断是否登录）
 *
 * 注意：
 * - 这是“最简版”登录，重启后端会清空内存 token
 * - 目前只用于“页面拦截”，并没有对其他接口做强制鉴权（后续可升级）
 */
const tokenStore = new Map()
// 关键：token 默认有效期 8 小时
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000

/**
 * 密码加密（bcrypt）配置
 *
 * 小白版解释：什么是 Salt（盐值）？它到底有什么用？（保姆级说明）
 * - 你可以把“盐值”理解成：给每个密码额外撒上一把“随机调料”。
 * - 如果只对密码做普通哈希（比如 hash("123456")），那么所有人用同样的密码，哈希结果也会一模一样。
 *   这会带来一个大问题：
 *   - 黑客只要提前准备一份“常见密码 -> 哈希结果”的对照表（彩虹表），就能快速反查出你的密码。
 * - bcrypt 的做法是：每次加密时都会生成一个随机的 salt，并把 salt 和成本参数一起“编码进最终字符串”里。
 *   所以：
 *   - 同样的明文密码，给不同用户加密，得到的结果也不一样（因为盐不同）。
 *   - 黑客很难用一份固定对照表批量破解所有人的密码。
 *
 * 另外一个关键点：SALT_ROUNDS（成本因子）是什么意思？
 * - rounds 越大，每次 hash 的计算越慢（更耗 CPU）。
 * - 慢的好处是：黑客暴力猜密码的速度会大幅下降（安全性更高）。
 * - 但也不能太大，否则你自己登录/改密码会变慢。
 */
const BCRYPT_SALT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS ?? 10)

/**
 * 判断数据库里的密码是不是 bcrypt 格式
 * 你要求的兼容规则：只要不是以 "$2b$" 开头，就当作旧的明文测试数据处理。
 */
function isBcryptHash(passwordText) {
  return String(passwordText ?? '').startsWith('$2b$')
}

/**
 * 把“明文密码”加密成 bcrypt 字符串
 * 说明：bcrypt.hash 会内部生成 salt，并把 salt 编码进结果里。
 */
async function hashPassword(plainPassword) {
  return await bcrypt.hash(String(plainPassword ?? ''), BCRYPT_SALT_ROUNDS)
}

/**
 * 校验“用户输入的明文密码”是否匹配“数据库里的密码”
 * - 如果数据库里是 bcrypt：用 bcrypt.compare（安全校验）
 * - 如果数据库里是旧明文：允许直接字符串对比（兼容 50+ 条测试数据）
 */
async function verifyPassword(plainPassword, dbPasswordText) {
  const input = String(plainPassword ?? '')
  const dbPassword = String(dbPasswordText ?? '')

  // 关键：新数据（bcrypt）走 compare
  if (isBcryptHash(dbPassword)) {
    return await bcrypt.compare(input, dbPassword)
  }

  // 关键：旧数据（明文）走直接对比（仅用于兼容历史测试数据）
  return input === dbPassword
}

/**
 * v1.0.7：校验写入用户时的 RoleID 是否指向启用中的角色
 * 成功返回 { ok: true, roleId }，失败返回 { ok: false, msg }
 */
async function assertWritableRoleId(pool, roleIdRaw) {
  const roleId = Number(roleIdRaw)
  if (!Number.isFinite(roleId) || roleId <= 0) {
    return { ok: false, msg: 'RoleID 不合法（必须是正整数）' }
  }
  const chk = await pool.request().input('RoleID', sql.Int, roleId).query(`
    SELECT TOP (1) RoleID
    FROM Sys_Roles
    WHERE RoleID = @RoleID AND Status = 1
  `)
  if (!chk.recordset?.[0]) {
    return { ok: false, msg: '角色不存在或已禁用' }
  }
  return { ok: true, roleId }
}

/**
 * 从请求中取出 token，并找到“当前登录用户”
 * 小白版解释：
 * - 前端每次请求需要“当前身份”的接口时，会带上请求头：
 *   Authorization: Bearer xxxxx
 * - 我们在后端把 xxxxx 取出来，再去 tokenStore（内存 Map）里查
 * - 查到就说明这个 token 还有效，我们就知道“当前是谁”
 */
function getCurrentUserFromReq(req) {
  // 关键：读取 Authorization 请求头
  const auth = String(req.headers?.authorization ?? '').trim()
  // 关键：标准写法是 "Bearer token"
  const prefix = 'Bearer '
  if (!auth.startsWith(prefix)) return null

  // 关键：取出真正的 token 字符串
  const token = auth.slice(prefix.length).trim()
  if (!token) return null

  // 关键：从内存仓库取出 token 对应的信息
  const info = tokenStore.get(token)
  if (!info) return null

  // 关键：过期就删掉（避免内存越积越多）
  if (Date.now() > Number(info.expiresAt ?? 0)) {
    tokenStore.delete(token)
    return null
  }

  return {
    token,
    userId: info.userId,
    userCode: info.userCode,
    roleId: info.roleId,
    roleName: info.roleName,
  }
}

/**
 * 健康检查
 */
app.get('/api/health', (req, res) => {
  res.json({ ok: true })
})

/**
 * 角色分页列表（Sys_Roles）
 * v1.0.7：角色管理页 + 操作员下拉框共用本接口
 * - 查询参数：page、pageSize、status（1=启用视图 / 0=回收站）、keyword（模糊匹配 RoleName、Description）
 * - 返回：{ code, msg, list, total }
 * - 操作员弹窗拉启用角色：传 page=1&pageSize=500&status=1 即可（与模块分页标准一致）
 */
app.get('/api/roles', async (req, res) => {
  try {
    const pageRaw = req.query?.page
    const pageSizeRaw = req.query?.pageSize
    const page = Number(pageRaw ?? 1)
    const pageSize = Number(pageSizeRaw ?? 10)
    const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1
    const safePageSize =
      Number.isFinite(pageSize) && pageSize > 0 ? Math.min(Math.floor(pageSize), 200) : 10
    const offset = (safePage - 1) * safePageSize

    const statusRaw = req.query?.status
    const parsedStatus = Number(statusRaw)
    const safeStatus = parsedStatus === 0 ? 0 : 1

    const keywordRaw = String(req.query?.keyword ?? '').trim()
    const hasKeyword = keywordRaw.length > 0
    const likeKey = `%${keywordRaw}%`

    const whereSql = hasKeyword
      ? 'WHERE r.Status = @status AND (r.RoleName LIKE @key OR r.Description LIKE @key)'
      : 'WHERE r.Status = @status'

    const pool = await getPool()

    const totalRequest = pool.request()
    totalRequest.input('status', sql.Int, safeStatus)
    if (hasKeyword) {
      totalRequest.input('key', sql.NVarChar(200), likeKey)
    }

    const totalResult = await totalRequest.query(`
      SELECT COUNT(1) AS total
      FROM Sys_Roles AS r
      ${whereSql}
    `)
    const total = Number(totalResult.recordset?.[0]?.total ?? 0)

    const listRequest = pool.request()
    listRequest.input('offset', sql.Int, offset)
    listRequest.input('pageSize', sql.Int, safePageSize)
    listRequest.input('status', sql.Int, safeStatus)
    if (hasKeyword) {
      listRequest.input('key', sql.NVarChar(200), likeKey)
    }

    let result
    try {
      result = await listRequest.query(`
        SELECT
          r.RoleID,
          r.RoleName,
          r.Description,
          r.Status
        FROM Sys_Roles AS r
        ${whereSql}
        ORDER BY r.RoleID ASC
        OFFSET @offset ROWS
        FETCH NEXT @pageSize ROWS ONLY
      `)
    } catch (pageErr) {
      const msg = String(pageErr?.message ?? pageErr?.originalError?.message ?? '')
      const shouldFallback =
        msg.includes("Incorrect syntax near 'OFFSET'") ||
        msg.includes('Invalid usage of the option NEXT') ||
        msg.toLowerCase().includes('offset') ||
        msg.toLowerCase().includes('fetch')
      if (!shouldFallback) throw pageErr

      const startRow = offset + 1
      const endRow = offset + safePageSize
      const fallbackRequest = pool.request()
      fallbackRequest.input('startRow', sql.Int, startRow)
      fallbackRequest.input('endRow', sql.Int, endRow)
      fallbackRequest.input('status', sql.Int, safeStatus)
      if (hasKeyword) {
        fallbackRequest.input('key', sql.NVarChar(200), likeKey)
      }

      result = await fallbackRequest.query(`
        SELECT
          RoleID,
          RoleName,
          Description,
          Status
        FROM (
          SELECT
            r.RoleID,
            r.RoleName,
            r.Description,
            r.Status,
            ROW_NUMBER() OVER (ORDER BY r.RoleID ASC) AS rn
          FROM Sys_Roles AS r
          ${whereSql}
        ) t
        WHERE t.rn BETWEEN @startRow AND @endRow
        ORDER BY t.rn
      `)
    }

    res.json({ code: 200, msg: 'success', list: result.recordset ?? [], total })
  } catch (err) {
    console.error('查询 /api/roles 失败：', err)
    res.status(500).json({ code: 500, msg: '读取角色列表失败', list: [], total: 0 })
  }
})

/**
 * 新增角色（写入 Sys_Roles，默认启用）
 */
app.post('/api/roles', async (req, res) => {
  try {
    const roleName = String(req.body?.RoleName ?? '').trim()
    const descRaw = req.body?.Description
    const description =
      descRaw === undefined || descRaw === null ? null : String(descRaw).trim() || null

    if (!roleName) {
      res.status(400).json({ code: 400, msg: '角色名称不能为空', data: null })
      return
    }

    const pool = await getPool()
    const request = pool.request()
    request.input('RoleName', sql.NVarChar(50), roleName)
    request.input('Description', sql.NVarChar(200), description)

    let result
    try {
      result = await request.query(`
        INSERT INTO Sys_Roles (RoleName, Description, Status)
        OUTPUT INSERTED.RoleID, INSERTED.RoleName, INSERTED.Description, INSERTED.Status
        VALUES (@RoleName, @Description, 1)
      `)
    } catch (dbErr) {
      const errNumber =
        dbErr?.number ??
        dbErr?.originalError?.number ??
        dbErr?.originalError?.info?.number ??
        dbErr?.code
      const errMessage = String(dbErr?.message ?? dbErr?.originalError?.message ?? '')
      if (Number(errNumber) === 2627 || errMessage.includes('Violation of UNIQUE KEY')) {
        res.status(400).json({ code: 400, msg: '角色名称已存在，请勿重复添加', data: null })
        return
      }
      console.error('写入 Sys_Roles 失败（POST /api/roles）：', dbErr)
      res.status(500).json({ code: 500, msg: '数据库写入失败，请联系管理员', data: null })
      return
    }

    res.json({ code: 200, msg: 'success', data: result.recordset?.[0] ?? null })
  } catch (err) {
    console.error('新增 /api/roles 失败：', err)
    res.status(500).json({ code: 500, msg: '数据库写入失败，请联系管理员', data: null })
  }
})

/**
 * 修改角色：分支 A 禁用（Status=0）；分支 B 编辑 RoleName / Description
 */
app.put('/api/roles', async (req, res) => {
  try {
    const body = req.body ?? {}
    const roleId = Number(body.RoleID)
    if (!Number.isFinite(roleId) || roleId <= 0) {
      res.status(400).json({ code: 400, msg: 'RoleID 不合法（必须是正整数）', data: null })
      return
    }

    const pool = await getPool()
    const request = pool.request()
    request.input('RoleID', sql.Int, roleId)

    if (body.Status !== undefined && body.Status !== null) {
      const status = Number(body.Status)
      if (status !== 0) {
        res.status(400).json({ code: 400, msg: '目前仅支持把 Status 更新为 0（禁用）', data: null })
        return
      }
      request.input('Status', sql.Int, 0)
      const result = await request.query(`
        UPDATE Sys_Roles
        SET Status = @Status
        OUTPUT INSERTED.RoleID, INSERTED.RoleName, INSERTED.Description, INSERTED.Status
        WHERE RoleID = @RoleID
      `)
      const updated = result.recordset?.[0]
      if (!updated) {
        res.status(404).json({ code: 404, msg: '未找到该角色（RoleID 不存在）', data: null })
        return
      }
      res.json({ code: 200, msg: 'success', data: updated })
      return
    }

    const roleName = String(body.RoleName ?? '').trim()
    const descRaw = body.Description
    const description =
      descRaw === undefined || descRaw === null ? null : String(descRaw).trim() || null

    if (!roleName) {
      res.status(400).json({ code: 400, msg: '角色名称不能为空', data: null })
      return
    }

    request.input('RoleName', sql.NVarChar(50), roleName)
    request.input('Description', sql.NVarChar(200), description)

    let result
    try {
      result = await request.query(`
        UPDATE Sys_Roles
        SET RoleName = @RoleName, Description = @Description
        OUTPUT INSERTED.RoleID, INSERTED.RoleName, INSERTED.Description, INSERTED.Status
        WHERE RoleID = @RoleID
      `)
    } catch (dbErr) {
      const errNumber =
        dbErr?.number ??
        dbErr?.originalError?.number ??
        dbErr?.originalError?.info?.number ??
        dbErr?.code
      const errMessage = String(dbErr?.message ?? dbErr?.originalError?.message ?? '')
      if (Number(errNumber) === 2627 || errMessage.includes('Violation of UNIQUE KEY')) {
        res.status(400).json({ code: 400, msg: '角色名称已存在，请更换名称', data: null })
        return
      }
      console.error('更新 Sys_Roles 失败（PUT /api/roles）：', dbErr)
      res.status(500).json({ code: 500, msg: '数据库写入失败，请联系管理员', data: null })
      return
    }

    const updated = result.recordset?.[0]
    if (!updated) {
      res.status(404).json({ code: 404, msg: '未找到该角色（RoleID 不存在）', data: null })
      return
    }
    res.json({ code: 200, msg: 'success', data: updated })
  } catch (err) {
    console.error('修改 /api/roles 失败：', err)
    res.status(500).json({ code: 500, msg: '数据库写入失败', data: null })
  }
})

/**
 * 恢复角色（Status 从 0 改回 1）
 */
app.put('/api/roles/resume', async (req, res) => {
  try {
    const roleId = Number(req.body?.RoleID)
    if (!Number.isFinite(roleId) || roleId <= 0) {
      res.status(400).json({ code: 400, msg: 'RoleID 不合法（必须是正整数）', data: null })
      return
    }

    const pool = await getPool()
    const request = pool.request()
    request.input('RoleID', sql.Int, roleId)
    request.input('Status', sql.Int, 1)

    const result = await request.query(`
      UPDATE Sys_Roles
      SET Status = @Status
      OUTPUT INSERTED.RoleID, INSERTED.RoleName, INSERTED.Description, INSERTED.Status
      WHERE RoleID = @RoleID
    `)

    const updated = result.recordset?.[0]
    if (!updated) {
      res.status(404).json({ code: 404, msg: '未找到该角色（RoleID 不存在）', data: null })
      return
    }

    res.json({ code: 200, msg: 'success', data: updated })
  } catch (err) {
    console.error('恢复 /api/roles/resume 失败：', err)
    res.status(500).json({ code: 500, msg: '数据库写入失败', data: null })
  }
})

/**
 * 物理删除角色（仅允许删除已禁用且无操作员绑定的角色）
 */
app.delete('/api/roles/:id', async (req, res) => {
  try {
    const roleId = Number(req.params.id)
    if (!Number.isFinite(roleId) || roleId <= 0) {
      res.status(400).json({ code: 400, msg: 'RoleID 不合法', data: null })
      return
    }

    const pool = await getPool()
    const q1 = await pool.request().input('RoleID', sql.Int, roleId).query(`
      SELECT TOP (1) Status FROM Sys_Roles WHERE RoleID = @RoleID
    `)
    const row = q1.recordset?.[0]
    if (!row) {
      res.status(404).json({ code: 404, msg: '未找到该角色', data: null })
      return
    }
    if (Number(row.Status) !== 0) {
      res.status(400).json({ code: 400, msg: '请先禁用角色并放入回收站后，再执行删除', data: null })
      return
    }

    const q2 = await pool.request().input('RoleID', sql.Int, roleId).query(`
      SELECT COUNT(1) AS cnt FROM Sys_Users WHERE RoleID = @RoleID
    `)
    const cnt = Number(q2.recordset?.[0]?.cnt ?? 0)
    if (cnt > 0) {
      res.status(400).json({ code: 400, msg: '仍有操作员绑定此角色，无法删除', data: null })
      return
    }

    const del = await pool.request().input('RoleID', sql.Int, roleId).query(`
      DELETE FROM Sys_Roles WHERE RoleID = @RoleID
    `)
    const affected = Number(del.rowsAffected?.[0] ?? 0)
    if (affected === 0) {
      res.status(404).json({ code: 404, msg: '删除失败：未找到该角色', data: null })
      return
    }

    res.json({ code: 200, msg: 'success', data: { RoleID: roleId } })
  } catch (err) {
    console.error('删除 DELETE /api/roles/:id 失败：', err)
    res.status(500).json({ code: 500, msg: '数据库写入失败', data: null })
  }
})

/**
 * 登录接口
 *
 * 路由：POST /api/login
 *
 * 校验顺序（按你的需求）：
 * 1) 校验工号是否存在
 * 2) 校验账号是否被禁用（Status=0）
 * 3) 校验密码是否正确
 *
 * 返回格式（统一风格）：
 * - 成功：{ code: 200, msg: 'success', data: { token, user } }
 * - 失败：{ code: 400/403/500, msg: '中文原因', data: null }
 */
app.post('/api/login', async (req, res) => {
  try {
    // 关键：从请求体读取用户输入
    const userCode = String(req.body?.UserCode ?? '').trim()
    const password = String(req.body?.Password ?? '')

    // 关键：基础必填校验（避免空请求打到数据库）
    if (!userCode) {
      res.status(400).json({ code: 400, msg: '工号不能为空', data: null })
      return
    }
    if (!String(password).trim()) {
      res.status(400).json({ code: 400, msg: '密码不能为空', data: null })
      return
    }

    // 关键：获取数据库连接池
    const pool = await getPool()

    // 关键：参数化查询（防 SQL 注入 + nvarchar 兼容中文）
    const request = pool.request()
    request.input('UserCode', sql.NVarChar(50), userCode)

    // 关键：查一条用户记录（按工号精确匹配）
    const result = await request.query(`
      SELECT TOP (1)
        u.UserID,
        u.UserCode,
        u.UserName,
        u.Password,
        u.Status,
        u.RoleID,
        r.RoleName AS RoleName
      FROM Sys_Users AS u
      LEFT JOIN Sys_Roles AS r ON u.RoleID = r.RoleID
      WHERE u.UserCode = @UserCode
    `)

    // 关键：拿到用户行
    const userRow = result.recordset?.[0]

    // 1) 校验工号是否存在
    if (!userRow) {
      res.status(400).json({ code: 400, msg: '工号不存在', data: null })
      return
    }

    // 2) 校验账号是否被禁用（Status=0）
    if (Number(userRow.Status) === 0) {
      res.status(403).json({ code: 403, msg: '账号已被禁用，请联系管理员', data: null })
      return
    }

    // 3) 校验密码是否正确
    const dbPassword = String(userRow.Password ?? '')

    // 关键：v1.0.6 密码安全升级
    // - 新用户/改过密码的用户：数据库里会存 bcrypt 字符串（以 $2b$ 开头）
    // - 旧的 50+ 条测试数据：数据库里可能还是明文
    // - 所以这里必须做兼容校验：bcrypt 用 compare；明文用直接对比
    const passOk = await verifyPassword(password, dbPassword)
    if (!passOk) {
      res.status(400).json({ code: 400, msg: '密码错误', data: null })
      return
    }

    // 关键：生成随机 token（作为登录凭证）
    const token = crypto.randomBytes(24).toString('hex')

    // 关键：保存到后端内存（可用于后续接口鉴权升级）
    tokenStore.set(token, {
      userId: Number(userRow.UserID),
      userCode: String(userRow.UserCode ?? ''),
      // v1.0.7：附带角色，便于后续把接口鉴权与角色打通（当前仍以 token 为主）
      roleId: userRow.RoleID != null ? Number(userRow.RoleID) : null,
      roleName: String(userRow.RoleName ?? ''),
      // 关键：到期时间
      expiresAt: Date.now() + TOKEN_TTL_MS,
    })

    // 关键：返回给前端（前端会存到 localStorage）
    res.json({
      code: 200,
      msg: 'success',
      data: {
        token,
        user: {
          UserID: userRow.UserID,
          UserCode: userRow.UserCode,
          UserName: userRow.UserName,
          Status: userRow.Status,
          RoleID: userRow.RoleID != null ? Number(userRow.RoleID) : null,
          RoleName: userRow.RoleName != null ? String(userRow.RoleName) : null,
        },
      },
    })
  } catch (err) {
    // 关键：服务端打印详细错误，前端只看中文提示
    console.error('登录 /api/login 失败：', err)
    res.status(500).json({ code: 500, msg: '登录失败：数据库读取异常，请联系管理员', data: null })
  }
})

/**
 * 获取用户列表（规范返回格式）
 *
 * 返回示例：
 * {
 *   "code": 200,
 *   "msg": "success",
 *   "data": [ ...用户列表 ]
 * }
 */
app.get('/api/users', async (req, res) => {
  try {
    // =========================
    // 关键：从 URL 查询参数读取分页参数
    // 小白版解释：
    // - 前端会这样请求：/api/users?page=1&pageSize=10
    // - req.query 就是把 ? 后面的参数拿出来
    // - 我们在后端把它们转成数字，带上默认值
    // =========================
    const pageRaw = req.query?.page
    const pageSizeRaw = req.query?.pageSize

    // 关键：page 默认 1（第一页）
    const page = Number(pageRaw ?? 1)
    // 关键：pageSize 默认 10（每页 10 条）
    const pageSize = Number(pageSizeRaw ?? 10)

    // 关键：对分页参数做保护，避免出现 page=0 / pageSize=999999 之类的异常
    const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1
    const safePageSize =
      Number.isFinite(pageSize) && pageSize > 0 ? Math.min(Math.floor(pageSize), 200) : 10

    // 关键：OFFSET 的含义是“跳过多少条”
    // 例子：第 1 页跳过 0 条；第 2 页跳过 10 条（假设 pageSize=10）
    const offset = (safePage - 1) * safePageSize

    // =========================
    // 关键：从 URL 查询参数读取“双视图状态”status
    // 小白版解释（你要的“双视图切换”怎么影响 SQL）：
    // - 前端有一个变量 selectedStatus（在职=1，回收站=0）
    // - 前端请求时会带上 status：/api/users?status=1&page=1&pageSize=10
    // - 后端拿到 status 后，会在 SQL 里加 WHERE Status = 1 或 Status = 0
    // - 这就实现了：同一个接口，根据一个变量切换不同视图的数据
    // =========================
    const statusRaw = req.query?.status

    // 关键：status 只允许 1 或 0；如果没传或传错，默认按“在职操作员”（Status=1）
    const parsedStatus = Number(statusRaw)
    const safeStatus = parsedStatus === 0 ? 0 : 1

    // =========================
    // 关键：从 URL 查询参数读取搜索关键字 keyword（模糊搜索）
    // 小白版解释：
    // - 前端搜索框输入“001”或“张三”
    // - 点击查询后，会请求：/api/users?status=1&keyword=001&page=1&pageSize=10
    // - 后端拿到 keyword 后，会在 SQL 里加：
    //   (UserCode LIKE @key OR UserName LIKE @key)
    // =========================
    const keywordRaw = String(req.query?.keyword ?? '').trim()

    // 关键：如果 keyword 为空，就不加 LIKE 条件；如果不为空，就开启模糊搜索
    const hasKeyword = keywordRaw.length > 0

    // 关键：双视图切换后的搜索规则
    // 小白版解释：
    // - 现在不再是“搜索默认只搜启用”
    // - 而是：你在哪个视图，就只搜哪个视图的数据
    //   - 在职视图：Status=1（只搜启用）
    //   - 回收站视图：Status=0（只搜禁用）
    // - 所以这里永远会带上 Status 过滤，再按需叠加 keyword 的 LIKE
    const alwaysFilterByStatus = true

    // 关键：LIKE 的参数值写成 %关键字%（% 的意思是“任意长度的任意字符”）
    // 例子：
    // - key = '%001%'：可以匹配 '001' / 'A001B' / 'X001'
    // - key = '%张%'：可以匹配 '张三' / '小张' / '老张三'
    const likeKey = `%${keywordRaw}%`

    // 关键：把 WHERE 子句单独拼出来，便于在“总数查询”和“列表查询”里复用
    // 小白版解释（LIKE 模糊匹配怎么工作）：
    // - UserCode LIKE @key 表示“工号里包含关键字”
    // - UserName LIKE @key 表示“姓名里包含关键字”
    // - OR 表示“满足其中一个就算匹配”
    // - Status = @status 表示“只取当前视图对应的状态”
    //
    // 组合规则：
    // - 永远带 Status 过滤（由前端 status 控制）
    // - 如果 keyword 不为空，再加 LIKE 条件
    const whereSql = hasKeyword
      ? 'WHERE u.Status = @status AND (u.UserCode LIKE @key OR u.UserName LIKE @key)'
      : 'WHERE u.Status = @status'

    // =========================
    // 关键：从连接池获取可复用的数据库连接（避免每次请求都重新握手）
    // =========================
    const pool = await getPool()

    // =========================
    // 关键：先查询总条数 total（用于前端分页器显示“总条数”）
    // 小白版解释：
    // - 你要在页面底部显示 “共多少条”
    // - 所以后端必须先 COUNT 一下表里一共有多少行
    // =========================
    const totalRequest = pool.request()

    // 关键：把当前视图的状态作为参数传给 SQL（防注入）
    if (alwaysFilterByStatus) {
      totalRequest.input('status', sql.Int, safeStatus)
    }

    // 关键：如果开启了搜索，就把 @key 作为 nvarchar 参数传给 SQL（防注入 + 防中文乱码）
    if (hasKeyword) {
      totalRequest.input('key', sql.NVarChar(100), likeKey)
    }

    const totalResult = await totalRequest.query(`
      SELECT COUNT(1) AS total
      FROM Sys_Users AS u
      LEFT JOIN Sys_Roles AS r ON u.RoleID = r.RoleID
      ${whereSql}
    `)

    // 关键：从结果里取出 total（如果没取到就当 0）
    const total = Number(totalResult.recordset?.[0]?.total ?? 0)

    // =========================
    // 关键：分页查询用户列表（SQL Server：OFFSET ... FETCH NEXT）
    // 小白版解释：
    // - ORDER BY：先确定排序（否则分页会乱）
    // - OFFSET @offset：跳过 offset 条
    // - FETCH NEXT @pageSize：再取 pageSize 条
    // =========================
    const listRequest = pool.request()

    // 关键：把分页参数作为 SQL 参数传进去（避免拼字符串造成注入风险）
    listRequest.input('offset', sql.Int, offset)
    listRequest.input('pageSize', sql.Int, safePageSize)

    // 关键：把当前视图的状态作为参数传给 SQL（防注入）
    if (alwaysFilterByStatus) {
      listRequest.input('status', sql.Int, safeStatus)
    }

    // 关键：如果开启了搜索，就把 @key 作为 nvarchar 参数传给 SQL（防注入 + 防中文乱码）
    if (hasKeyword) {
      listRequest.input('key', sql.NVarChar(100), likeKey)
    }

    // 关键：明确列名，保证前端表格字段稳定
    // 说明：
    // - 你要求用 OFFSET...FETCH NEXT 做分页（SQL Server 2012+ 支持）
    // - 但如果你的 SQL Server 版本/兼容级别较老，会报：
    //   - “Incorrect syntax near 'OFFSET'”
    //   - “Invalid usage of the option NEXT in the FETCH statement.”
    // - 为了保证你在任何内网环境都能跑通，这里做一个“自动降级”：
    //   - 优先用 OFFSET...FETCH
    //   - 失败则改用 ROW_NUMBER() 方式分页（老版本也支持）
    let result
    try {
      // 关键：优先使用 OFFSET...FETCH NEXT（你指定的分页语法）
      result = await listRequest.query(`
        SELECT
          u.UserID,
          u.UserCode,
          u.UserName,
          u.Status,
          u.CreatedAt,
          u.RoleID,
          r.RoleName AS RoleName
        FROM Sys_Users AS u
        LEFT JOIN Sys_Roles AS r ON u.RoleID = r.RoleID
        ${whereSql}
        ORDER BY u.CreatedAt DESC
        OFFSET @offset ROWS
        FETCH NEXT @pageSize ROWS ONLY
      `)
    } catch (pageErr) {
      // 关键：识别“数据库不支持 OFFSET/FETCH”的典型报错
      const msg = String(pageErr?.message ?? pageErr?.originalError?.message ?? '')
      const shouldFallback =
        msg.includes("Incorrect syntax near 'OFFSET'") ||
        msg.includes('Invalid usage of the option NEXT') ||
        msg.toLowerCase().includes('offset') ||
        msg.toLowerCase().includes('fetch')

      // 关键：如果不是分页语法问题，就继续抛出，让外层 catch 处理
      if (!shouldFallback) throw pageErr

      // 关键：使用 ROW_NUMBER() 降级分页
      // 小白版解释：
      // - ROW_NUMBER() 会给每一行一个连续编号 rn（按 CreatedAt DESC 排序）
      // - 然后我们只取 rn 在某个范围内的行，就实现了“第 N 页”
      const startRow = offset + 1
      const endRow = offset + safePageSize

      const fallbackRequest = pool.request()
      fallbackRequest.input('startRow', sql.Int, startRow)
      fallbackRequest.input('endRow', sql.Int, endRow)

      // 关键：如果开启了搜索，就把 @key 作为 nvarchar 参数传给 SQL（防注入 + 防中文乱码）
      if (hasKeyword) {
        fallbackRequest.input('key', sql.NVarChar(100), likeKey)
      }
      // 关键：降级分页同样要带上 status 参数
      if (alwaysFilterByStatus) {
        fallbackRequest.input('status', sql.Int, safeStatus)
      }

      result = await fallbackRequest.query(`
        SELECT
          UserID,
          UserCode,
          UserName,
          Status,
          CreatedAt,
          RoleID,
          RoleName
        FROM (
          SELECT
            u.UserID,
            u.UserCode,
            u.UserName,
            u.Status,
            u.CreatedAt,
            u.RoleID,
            r.RoleName AS RoleName,
            ROW_NUMBER() OVER (ORDER BY u.CreatedAt DESC) AS rn
          FROM Sys_Users AS u
          LEFT JOIN Sys_Roles AS r ON u.RoleID = r.RoleID
          ${whereSql}
        ) t
        WHERE t.rn BETWEEN @startRow AND @endRow
        ORDER BY t.rn
      `)
    }

    // =========================
    // 关键：按约定格式返回（新增 total 字段）
    // =========================
    res.json({
      code: 200,
      msg: 'success',
      // 关键：列表统一用 list 字段（符合模块标准化要求）
      list: result.recordset ?? [],
      total,
    })
  } catch (err) {
    // 关键：服务端记录详细错误，便于排查（前端只拿到通用错误提示）
    console.error('查询 /api/users 失败：', err)

    // 关键：返回统一结构，前端可直接根据 code 判断是否成功
    res.status(500).json({
      code: 500,
      msg: 'error',
      list: [],
      total: 0,
    })
  }
})

/**
 * 恢复用户（把禁用用户 Status 从 0 改回 1）
 *
 * 路由：PUT /api/users/resume
 *
 * 说明（小白版）：
 * - 禁用=Status=0
 * - 恢复=Status=1
 * - 恢复后用户会重新出现在“常规搜索结果/启用列表”里
 */
app.put('/api/users/resume', async (req, res) => {
  try {
    // 关键：从请求体读取要恢复的用户 ID
    const userId = Number(req.body?.UserID)
    if (!Number.isFinite(userId) || userId <= 0) {
      res.status(400).json({ code: 400, msg: 'UserID 不合法（必须是正整数）', data: null })
      return
    }

    // 关键：获取数据库连接池
    const pool = await getPool()

    // 关键：参数化更新（防注入）
    const request = pool.request()
    request.input('UserID', sql.Int, userId)
    request.input('Status', sql.Int, 1)

    // 关键：把 Status 更新为 1，并返回更新后的关键字段
    const result = await request.query(`
      UPDATE Sys_Users
      SET Status = @Status
      OUTPUT INSERTED.UserID, INSERTED.UserCode, INSERTED.UserName, INSERTED.Status, INSERTED.CreatedAt, INSERTED.RoleID
      WHERE UserID = @UserID
    `)

    const updated = result.recordset?.[0]
    if (!updated) {
      res.status(404).json({ code: 404, msg: '未找到该用户（UserID 不存在）', data: null })
      return
    }

    // v1.0.7：补充角色名（OUTPUT 无法直接带出 JOIN 列）
    let roleName = null
    if (updated.RoleID != null) {
      const rn = await pool
        .request()
        .input('RoleID', sql.Int, Number(updated.RoleID))
        .query(`SELECT TOP (1) RoleName FROM Sys_Roles WHERE RoleID = @RoleID`)
      roleName = rn.recordset?.[0]?.RoleName ?? null
    }

    res.json({ code: 200, msg: 'success', data: { ...updated, RoleName: roleName } })
  } catch (err) {
    console.error('恢复 /api/users/resume 失败：', err)
    res.status(500).json({ code: 500, msg: '数据库写入失败，请联系管理员', data: null })
  }
})

/**
 * 修改当前登录用户的密码
 *
 * 路由：PUT /api/users/change-password
 *
 * 安全点（你要求的）：
 * - 只允许修改“当前登录用户自己的密码”
 * - 后端通过 token 找到当前用户的 UserCode
 * - 然后 SQL 用 WHERE UserCode = @UserCode 来锁定“只更新这一位用户”
 *
 * 请求体（前端传）：
 * - oldPassword：旧密码
 * - newPassword：新密码
 *
 * 返回：
 * - 成功：{ code: 200, msg: 'success', data: null }
 * - 失败：{ code: 400/401/500, msg: '中文原因', data: null }
 */
app.put('/api/users/change-password', async (req, res) => {
  try {
    // 关键：先拿到当前登录用户（通过 Authorization: Bearer token）
    const current = getCurrentUserFromReq(req)
    if (!current?.userCode) {
      res.status(401).json({ code: 401, msg: '未登录或登录已过期，请重新登录', data: null })
      return
    }

    // 关键：读取旧密码、新密码
    const oldPassword = String(req.body?.oldPassword ?? '')
    const newPassword = String(req.body?.newPassword ?? '')

    // 关键：基础必填校验
    if (!String(oldPassword).trim()) {
      res.status(400).json({ code: 400, msg: '旧密码不能为空', data: null })
      return
    }
    if (!String(newPassword).trim()) {
      res.status(400).json({ code: 400, msg: '新密码不能为空', data: null })
      return
    }

    // 关键：获取数据库连接池
    const pool = await getPool()

    // =========================
    // 第 1 步：查出当前用户数据库里的旧密码
    // =========================
    // 小白版解释（最关键的安全点）：
    // - 我们不用 UserID，也不用前端传 UserCode
    // - 只用后端根据 token 得到的 current.userCode
    // - 然后在 SQL 里写：
    //   WHERE UserCode = @UserCode
    // - 这句的意思是：“只查（或只更新）工号等于这个工号的那一行”
    // - 因为 @UserCode 是参数，而且值来自当前登录人，所以能确保“只动当前用户自己的记录”
    const checkReq = pool.request()
    checkReq.input('UserCode', sql.NVarChar(50), String(current.userCode))

    const checkResult = await checkReq.query(`
      SELECT TOP (1)
        UserCode,
        Password
      FROM Sys_Users
      WHERE UserCode = @UserCode
    `)

    const row = checkResult.recordset?.[0]
    if (!row) {
      // 关键：极少数情况：token 里有 userCode，但数据库没有该用户（比如被删了）
      res.status(400).json({ code: 400, msg: '用户不存在，请联系管理员', data: null })
      return
    }

    const dbPassword = String(row.Password ?? '')

    // 关键：v1.0.6 兼容校验旧密码
    // - 如果数据库存的是 bcrypt，就用 bcrypt.compare
    // - 如果数据库存的是旧明文，就允许直接对比（兼容历史测试数据）
    const oldPassOk = await verifyPassword(oldPassword, dbPassword)
    if (!oldPassOk) {
      res.status(400).json({ code: 400, msg: '旧密码验证失败', data: null })
      return
    }

    // =========================
    // 第 2 步：更新密码
    // =========================
    // 关键：只要用户“修改密码”，就强制进入加密模式（数据库不再存明文）
    const newPasswordHash = await hashPassword(newPassword)

    const updateReq = pool.request()
    updateReq.input('UserCode', sql.NVarChar(50), String(current.userCode))
    updateReq.input('NewPassword', sql.NVarChar(200), String(newPasswordHash))

    const updateResult = await updateReq.query(`
      UPDATE Sys_Users
      SET Password = @NewPassword
      WHERE UserCode = @UserCode
    `)

    const affected = Number(updateResult.rowsAffected?.[0] ?? 0)
    if (affected === 0) {
      // 关键：没更新到行，说明 UserCode 没匹配到（理论上不应该）
      res.status(400).json({ code: 400, msg: '修改失败：未匹配到用户记录', data: null })
      return
    }

    res.json({ code: 200, msg: 'success', data: null })
  } catch (err) {
    console.error('修改密码 /api/users/change-password 失败：', err)
    res.status(500).json({ code: 500, msg: '修改失败：数据库写入异常，请联系管理员', data: null })
  }
})

/**
 * 彻底删除用户（物理删除）
 *
 * 路由：DELETE /api/users/:id
 *
 * 阶梯式删除规则（你要求的）：必须先禁用（Status=0）才能删除
 * 小白版解释：
 * - 先禁用：相当于“先放回收站”
 * - 再删除：相当于“清空回收站”，不可恢复
 */
app.delete('/api/users/:id', async (req, res) => {
  try {
    // 关键：从 URL 路径参数拿到 id（:id）
    const userId = Number(req.params?.id)
    if (!Number.isFinite(userId) || userId <= 0) {
      res.status(400).json({ code: 400, msg: 'id 不合法（必须是正整数）', data: null })
      return
    }

    // 关键：获取数据库连接池
    const pool = await getPool()

    // 关键：先查一次状态，确保“必须先禁用才能删除”
    const checkReq = pool.request()
    checkReq.input('UserID', sql.Int, userId)
    const check = await checkReq.query(`
      SELECT TOP (1) UserID, Status
      FROM Sys_Users
      WHERE UserID = @UserID
    `)
    const row = check.recordset?.[0]
    if (!row) {
      res.status(404).json({ code: 404, msg: '未找到该用户（UserID 不存在）', data: null })
      return
    }

    // 关键：如果还在启用（Status=1），禁止直接物理删除
    if (Number(row.Status) === 1) {
      res.status(400).json({ code: 400, msg: '必须先禁用该用户，才能彻底删除', data: null })
      return
    }

    // 关键：执行物理删除（DELETE）
    const delReq = pool.request()
    delReq.input('UserID', sql.Int, userId)
    const del = await delReq.query(`
      DELETE FROM Sys_Users
      WHERE UserID = @UserID
    `)

    // 关键：rowsAffected[0] 表示删除了多少行（0=没删到，1=删到）
    const affected = Number(del.rowsAffected?.[0] ?? 0)
    if (affected === 0) {
      res.status(404).json({ code: 404, msg: '删除失败：未找到该用户', data: null })
      return
    }

    res.json({ code: 200, msg: 'success', data: { UserID: userId } })
  } catch (err) {
    console.error('删除 DELETE /api/users/:id 失败：', err)
    res.status(500).json({ code: 500, msg: '数据库写入失败，请联系管理员', data: null })
  }
})

/**
 * 新增用户（操作员资料）
 *
 * 需求：
 * - 接收：UserCode（工号）、UserName（姓名）、Password（密码）、RoleID（角色，v1.0.7）
 * - 写入：Sys_Users
 * - 默认：Status = 1（启用），CreatedAt = 当前时间
 *
 * 安全说明（非常重要）：
 * - 这里使用参数化查询（request.input）防止 SQL 注入
 * - “密码”建议改为加盐哈希后存储（例如 bcrypt），当前按你的需求先直存
 *
 * 返回示例：
 * {
 *   "code": 200,
 *   "msg": "success",
 *   "data": { ...新建记录关键字段... }
 * }
 */
app.post('/api/users', async (req, res) => {
  try {
    // 关键：从请求体中读取前端提交的数据（需要 app.use(express.json()) 才能解析）
    const { UserCode, UserName, Password, RoleID } = req.body ?? {}

    // 关键：做最基础的后端校验，避免插入空数据
    if (!String(UserCode || '').trim()) {
      res.status(400).json({ code: 400, msg: 'UserCode 不能为空', data: null })
      return
    }
    if (!String(UserName || '').trim()) {
      res.status(400).json({ code: 400, msg: 'UserName 不能为空', data: null })
      return
    }
    if (!String(Password || '').trim()) {
      res.status(400).json({ code: 400, msg: 'Password 不能为空', data: null })
      return
    }

    // 关键：获取数据库连接池
    const pool = await getPool()

    const roleCheck = await assertWritableRoleId(pool, RoleID)
    if (!roleCheck.ok) {
      res.status(400).json({ code: 400, msg: roleCheck.msg, data: null })
      return
    }

    // 关键：使用参数化查询，避免把用户输入拼到 SQL 字符串中（防注入）
    const request = pool.request()
    request.input('UserCode', sql.NVarChar(50), String(UserCode).trim())
    request.input('UserName', sql.NVarChar(50), String(UserName).trim())
    request.input('RoleID', sql.Int, roleCheck.roleId)

    // 关键：v1.0.6 安全升级：新增用户时，密码必须先加密再入库（禁止直存明文）
    const passwordHash = await hashPassword(Password)
    request.input('Password', sql.NVarChar(200), String(passwordHash))

    // 关键：执行 SQL 插入（单独 try-catch，专门把“工号重复”这种常见错误识别出来）
    let result
    try {
      // 关键：插入数据，并通过 OUTPUT 返回插入后的关键字段
      result = await request.query(`
        INSERT INTO Sys_Users (UserCode, UserName, Password, Status, CreatedAt, RoleID)
        OUTPUT INSERTED.UserID, INSERTED.UserCode, INSERTED.UserName, INSERTED.Status, INSERTED.CreatedAt, INSERTED.RoleID
        VALUES (@UserCode, @UserName, @Password, 1, GETDATE(), @RoleID)
      `)
    } catch (dbErr) {
      // 关键：识别“唯一键冲突（工号重复）”
      // 小白版解释：
      // - SQL Server 如果违反 UNIQUE KEY，常见错误号是 2627（也可能是 2601）
      // - 有些驱动会把错误号挂在 dbErr.number / dbErr.originalError.number 上
      // - 有些情况只能从错误文本里看到 “Violation of UNIQUE KEY”
      const errNumber =
        dbErr?.number ??
        dbErr?.originalError?.number ??
        dbErr?.originalError?.info?.number ??
        dbErr?.code
      const errMessage = String(dbErr?.message ?? dbErr?.originalError?.message ?? '')

      // 关键：按你的要求，只要错误号是 2627 或文案包含 UNIQUE KEY 关键字，就当作“工号已存在”
      if (Number(errNumber) === 2627 || errMessage.includes('Violation of UNIQUE KEY')) {
        res.status(400).json({
          code: 400,
          msg: '工号已存在，请勿重复添加',
          data: null,
        })
        return
      }

      // 关键：其他数据库写入错误，返回统一中文提示（不要让小白看到一堆英文堆栈）
      console.error('数据库写入失败（POST /api/users）：', dbErr)
      res.status(500).json({
        code: 500,
        msg: '数据库写入失败，请联系管理员',
        data: null,
      })
      return
    }

    // 关键：取出插入后的记录（recordset[0]）
    const created = result.recordset?.[0] ?? null

    let roleName = null
    if (created?.RoleID != null) {
      const rn = await pool
        .request()
        .input('RoleID', sql.Int, Number(created.RoleID))
        .query(`SELECT TOP (1) RoleName FROM Sys_Roles WHERE RoleID = @RoleID`)
      roleName = rn.recordset?.[0]?.RoleName ?? null
    }

    // 关键：按统一格式返回
    res.json({
      code: 200,
      msg: 'success',
      data: created ? { ...created, RoleName: roleName } : created,
    })
  } catch (err) {
    // 关键：服务端打印详细错误，便于你定位“字段不能为空/长度超限/唯一键冲突”等问题
    console.error('新增 /api/users 失败：', err)
    res.status(500).json({
      code: 500,
      msg: '数据库写入失败，请联系管理员',
      data: null,
    })
  }
})

/**
 * 修改用户（编辑 / 禁用）
 *
 * 说明（为什么只做“禁用”，不做物理删除）：
 * - 业务里删除账号往往需要留痕
 * - 所以我们用 Status=0 表示“禁用”，这就是“软删除”
 *
 * 前端会传两种不同的 payload：
 *
 * A) 编辑资料（修改工号/姓名/密码/角色）
 * {
 *   "UserID": 1,
 *   "UserCode": "001",
 *   "UserName": "张三",
 *   "RoleID": 3,
 *   "Password": "可选：不填表示不修改密码"
 * }
 *
 * B) 禁用账号（只改状态）
 * {
 *   "UserID": 1,
 *   "Status": 0
 * }
 *
 * 统一返回：
 * - 成功：{ code: 200, msg: "success", data: ... }
 * - 失败：{ code: xxx, msg: "中文原因", data: null }
 */
app.put('/api/users', async (req, res) => {
  try {
    // 关键：从请求体读取用户提交的数据（PUT 也走 JSON body）
    const body = req.body ?? {}

    // 关键：UserID 是定位“要改哪一行”的主键，必须有
    const userId = Number(body.UserID)
    if (!Number.isFinite(userId) || userId <= 0) {
      res.status(400).json({ code: 400, msg: 'UserID 不合法（必须是正整数）', data: null })
      return
    }

    // 关键：获取数据库连接池（复用连接）
    const pool = await getPool()

    // 关键：创建 request 用于参数化查询（防 SQL 注入）
    const request = pool.request()
    request.input('UserID', sql.Int, userId)

    // =========================
    // 分支 1：禁用账号（软删除）
    // =========================
    // 关键：如果前端传了 Status（并且明确要设为 0），我们就只更新状态
    if (body.Status !== undefined && body.Status !== null) {
      // 关键：把状态转为数字
      const status = Number(body.Status)

      // 关键：目前业务只要求“禁用”，即把状态改成 0
      if (status !== 0) {
        res.status(400).json({ code: 400, msg: '目前仅支持把 Status 更新为 0（禁用）', data: null })
        return
      }

      // 关键：参数化写入 Status=0
      request.input('Status', sql.Int, 0)

      // 关键：更新并返回更新后的关键字段（方便前端确认改成功了）
      const result = await request.query(`
        UPDATE Sys_Users
        SET Status = @Status
        OUTPUT INSERTED.UserID, INSERTED.UserCode, INSERTED.UserName, INSERTED.Status, INSERTED.CreatedAt, INSERTED.RoleID
        WHERE UserID = @UserID
      `)

      // 关键：如果没有任何行被更新，说明 UserID 不存在
      const updated = result.recordset?.[0]
      if (!updated) {
        res.status(404).json({ code: 404, msg: '未找到该用户（UserID 不存在）', data: null })
        return
      }

      let roleName = null
      if (updated.RoleID != null) {
        const rn = await pool
          .request()
          .input('RoleID', sql.Int, Number(updated.RoleID))
          .query(`SELECT TOP (1) RoleName FROM Sys_Roles WHERE RoleID = @RoleID`)
        roleName = rn.recordset?.[0]?.RoleName ?? null
      }

      res.json({ code: 200, msg: 'success', data: { ...updated, RoleName: roleName } })
      return
    }

    // =========================
    // 分支 2：编辑资料
    // =========================
    // 关键：读取要更新的字段
    const userCode = String(body.UserCode ?? '').trim()
    const userName = String(body.UserName ?? '').trim()
    const password = body.Password === undefined || body.Password === null ? undefined : String(body.Password)

    const roleCheck = await assertWritableRoleId(pool, body.RoleID)
    if (!roleCheck.ok) {
      res.status(400).json({ code: 400, msg: roleCheck.msg, data: null })
      return
    }

    // 关键：后端必填校验（编辑资料必须至少有工号/姓名）
    if (!userCode) {
      res.status(400).json({ code: 400, msg: 'UserCode 不能为空', data: null })
      return
    }
    if (!userName) {
      res.status(400).json({ code: 400, msg: 'UserName 不能为空', data: null })
      return
    }

    // 关键：把要更新的字段加入参数（nvarchar 防中文乱码）
    request.input('UserCode', sql.NVarChar(50), userCode)
    request.input('UserName', sql.NVarChar(50), userName)
    request.input('RoleID', sql.Int, roleCheck.roleId)

    // 关键：密码的处理策略（小白版解释）
    // - 我们不会从数据库把旧密码读回前端（安全原因）
    // - 所以前端“编辑弹窗”的密码默认留空
    // - 如果你在编辑时真的想改密码，就输入新密码；如果留空，就表示“不修改密码”
    const shouldUpdatePassword = !!String(password ?? '').trim()
    if (shouldUpdatePassword) {
      // 关键：v1.0.6 安全升级：只要修改密码，就强制把明文转成 bcrypt 加密字符串
      const passwordHash = await hashPassword(password)
      request.input('Password', sql.NVarChar(200), String(passwordHash))
    }

    // 关键：根据是否要改密码，拼两种 UPDATE（注意：仍然是参数化，不存在注入风险）
    const sqlText = shouldUpdatePassword
      ? `
        UPDATE Sys_Users
        SET
          UserCode = @UserCode,
          UserName = @UserName,
          Password = @Password,
          RoleID = @RoleID
        OUTPUT INSERTED.UserID, INSERTED.UserCode, INSERTED.UserName, INSERTED.Status, INSERTED.CreatedAt, INSERTED.RoleID
        WHERE UserID = @UserID
      `
      : `
        UPDATE Sys_Users
        SET
          UserCode = @UserCode,
          UserName = @UserName,
          RoleID = @RoleID
        OUTPUT INSERTED.UserID, INSERTED.UserCode, INSERTED.UserName, INSERTED.Status, INSERTED.CreatedAt, INSERTED.RoleID
        WHERE UserID = @UserID
      `

    // 关键：执行更新
    const result = await request.query(sqlText)

    // 关键：如果没有更新到行，说明 UserID 不存在
    const updated = result.recordset?.[0]
    if (!updated) {
      res.status(404).json({ code: 404, msg: '未找到该用户（UserID 不存在）', data: null })
      return
    }

    let roleName = null
    if (updated.RoleID != null) {
      const rn = await pool
        .request()
        .input('RoleID', sql.Int, Number(updated.RoleID))
        .query(`SELECT TOP (1) RoleName FROM Sys_Roles WHERE RoleID = @RoleID`)
      roleName = rn.recordset?.[0]?.RoleName ?? null
    }

    // 关键：返回更新后的记录（前端刷新列表时也能看到最新数据）
    res.json({ code: 200, msg: 'success', data: { ...updated, RoleName: roleName } })
  } catch (err) {
    // 关键：数据库报错（比如唯一键冲突/长度超限）会进入这里
    console.error('修改 /api/users 失败：', err)
    res.status(500).json({ code: 500, msg: 'error', data: null })
  }
})

/**
 * 获取 Sys_Users 列表
 *
 * 重要说明（避免 SQL 注入）：
 * - 本接口不拼接用户输入到 SQL 字符串中
 * - 如后续加入筛选条件，请使用参数化查询（request.input）
 */
app.get('/api/sys-users', async (req, res) => {
  try {
    const pool = await getPool()

    // 说明：
    // - 这里先用 SELECT * 简化展示（你已经创建了 Sys_Users 表）
    // - 生产建议明确列名，并按业务字段排序/分页
    const result = await pool.request().query('SELECT * FROM Sys_Users')

    res.json({
      ok: true,
      data: result.recordset ?? [],
    })
  } catch (err) {
    // 详细错误只写到服务端日志，前端返回可读信息，避免泄露敏感连接信息
    console.error('查询 Sys_Users 失败：', err)
    res.status(500).json({
      ok: false,
      message: '读取 Sys_Users 失败，请检查数据库连接配置与表是否存在。',
      // 开发排错用：不建议在生产环境开启
      ...(String(process.env.DEBUG_API ?? 'false').toLowerCase() === 'true'
        ? {
            debug: {
              name: err?.name,
              code: err?.code,
              message: err?.message,
            },
          }
        : {}),
    })
  }
})

// 可选：优雅关闭（例如 Ctrl+C）
process.on('SIGINT', async () => {
  try {
    await sql.close()
  } finally {
    process.exit(0)
  }
})

const port = process.env.PORT ? Number(process.env.PORT) : 3001
app.listen(port, () => {
  console.log(`API 服务已启动：http://localhost:${port}`)
})

