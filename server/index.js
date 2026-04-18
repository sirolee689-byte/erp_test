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
import * as XLSX from 'xlsx'
import { createApiPermissionGate } from './apiPermissionGate.js'
import { serializePermissionsForStore } from './permissions.js'
import {
  createOperationAuditMiddleware,
  createOperationAuditPrepareMiddleware,
} from './operationAuditMiddleware.js'
import { configureOperationLogWriter, writeLog, writeOperationLog, SYS_OPERATION_LOGS_FROM } from './operationLogWriter.js'

dotenv.config()

const app = express()

// 说明：
// - 开发阶段前端通过 Vite 代理 /api，不会跨域
// - 但如果你单独访问后端，保留 cors 也更稳妥
app.use(cors())
// v1.1.2：批量更新需要上传 Excel（base64），默认 100kb 不够用
app.use(express.json({ limit: '20mb' }))

/**
 * v1.0.7+：除登录/健康检查外，/api/* 需带 Bearer token；已配置规则的接口再校验按钮级权限
 * getCurrentUserFromReq 在下方函数声明（函数声明会提升，闭包在请求到达时已可用）
 */
app.use((req, res, next) => createApiPermissionGate({ getCurrentUserFromReq })(req, res, next))

/**
 * v1.1.1+：操作审计「准备」——在 DELETE/PUT 员工等路由执行前读库，生成中文详情上下文
 */
app.use(createOperationAuditPrepareMiddleware())

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
  // 已通过 apiPermissionGate 时直接复用 req.user，避免重复解析 Bearer
  if (req?.user && typeof req.user === 'object') {
    return req.user
  }

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
    userName: info.userName != null ? String(info.userName) : '',
    roleId: info.roleId,
    roleName: info.roleName,
  }
}

configureOperationLogWriter({ getCurrentUserFromReq })

/**
 * 操作日志「清空」运维特权：工号为 admin（不区分大小写）或角色名为系统管理员
 * @param {ReturnType<typeof getCurrentUserFromReq>} user
 */
function isOperationLogAdminUser(user) {
  if (!user) return false
  const code = String(user.userCode ?? '').trim().toLowerCase()
  if (code === 'admin') return true
  const rn = String(user.roleName ?? '').trim()
  return rn === '系统管理员'
}

/** 缓存日志表列清单，兼容未来表结构扩展 */
let SYS_OPERATION_LOGS_COLSET_PROMISE = null

/**
 * 读取 Sys_OperationLogs 的列名集合（小写）
 * @param {import('mssql').ConnectionPool} pool
 * @returns {Promise<Set<string>>}
 */
async function getOperationLogsColumnSet(pool) {
  if (SYS_OPERATION_LOGS_COLSET_PROMISE) return SYS_OPERATION_LOGS_COLSET_PROMISE
  SYS_OPERATION_LOGS_COLSET_PROMISE = (async () => {
    try {
      const r = await pool.request().input('tableName', sql.NVarChar(128), 'Sys_OperationLogs').query(`
        SELECT COLUMN_NAME AS name
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = N'dbo' AND TABLE_NAME = @tableName
      `)
      const set = new Set()
      for (const row of r.recordset ?? []) {
        const name = String(row?.name ?? '').trim().toLowerCase()
        if (name) set.add(name)
      }
      return set
    } catch (err) {
      console.warn('[操作日志] 读取 Sys_OperationLogs 列清单失败：', err?.message ?? err)
      return new Set()
    }
  })()
  return SYS_OPERATION_LOGS_COLSET_PROMISE
}

/**
 * v1.1.1：全局操作审计（POST/PUT/DELETE 且 HTTP 200 后异步落库）
 */
app.use(
  createOperationAuditMiddleware({
    getCurrentUserFromReq,
    writeOperationLogAsync: async (payload) => {
      const pool = await getPool()
      await writeOperationLog(pool, payload)
    },
  }),
)

/**
 * 健康检查
 */
app.get('/api/health', (req, res) => {
  res.json({ ok: true })
})

/**
 * v1.1.1：操作日志分页查询
 * 说明：
 * - 只返回前端日志页需要的字段别名
 * - 若未来日志表扩展了 pass/status/del，则自动只看“正常记录”
 */
app.get('/api/sys/logs', async (req, res) => {
  try {
    const page = Number(req.query?.page ?? 1)
    const pageSize = Number(req.query?.pageSize ?? 20)
    const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1
    const safePageSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.min(Math.floor(pageSize), 200) : 20
    const offset = (safePage - 1) * safePageSize

    const uname = String(req.query?.uname ?? '').trim()
    const action = String(req.query?.action ?? '').trim()
    const startDate = String(req.query?.startDate ?? '').trim()
    const endDate = String(req.query?.endDate ?? '').trim()

    const pool = await getPool()
    const colset = await getOperationLogsColumnSet(pool)
    const totalReq = pool.request()
    const listReq = pool.request()
    const whereParts = ['1 = 1']

    if (uname) {
      whereParts.push('L.UserName LIKE @unameLike')
      totalReq.input('unameLike', sql.NVarChar(100), `%${uname}%`)
      listReq.input('unameLike', sql.NVarChar(100), `%${uname}%`)
    }
    if (action) {
      whereParts.push('L.Action LIKE @actionLike')
      totalReq.input('actionLike', sql.NVarChar(80), `%${action}%`)
      listReq.input('actionLike', sql.NVarChar(80), `%${action}%`)
    }
    if (startDate) {
      whereParts.push('LTRIM(RTRIM(ISNULL(L.CreateTime, N\'\'))) >= @startDate')
      totalReq.input('startDate', sql.NVarChar(20), `${startDate} 00:00:00`)
      listReq.input('startDate', sql.NVarChar(20), `${startDate} 00:00:00`)
    }
    if (endDate) {
      whereParts.push('LTRIM(RTRIM(ISNULL(L.CreateTime, N\'\'))) <= @endDate')
      totalReq.input('endDate', sql.NVarChar(20), `${endDate} 23:59:59`)
      listReq.input('endDate', sql.NVarChar(20), `${endDate} 23:59:59`)
    }

    // 严格按“正常状态”思路兼容未来表结构；当前 v1.1.1 建表没有这些列时自动跳过
    if (colset.has('pass')) {
      whereParts.push("LTRIM(RTRIM(ISNULL(L.pass, N''))) = N'1'")
    }
    if (colset.has('del')) {
      whereParts.push("(LTRIM(RTRIM(ISNULL(L.del, N''))) = N'' OR LTRIM(RTRIM(ISNULL(L.del, N''))) = N'0')")
    }
    if (colset.has('status')) {
      whereParts.push('(L.Status = 1 OR LTRIM(RTRIM(CONVERT(NVARCHAR(50), ISNULL(L.Status, 1)))) = N\'1\')')
    }

    const whereSql = `WHERE ${whereParts.join(' AND ')}`

    const totalResult = await totalReq.query(`
      SELECT COUNT(1) AS total
      FROM ${SYS_OPERATION_LOGS_FROM} AS L
      ${whereSql}
    `)
    const total = Number(totalResult.recordset?.[0]?.total ?? 0)

    const safeOffset = Math.max(0, Math.floor(Number(offset)) || 0)
    const safeFetch = Math.max(1, Math.min(200, Math.floor(Number(safePageSize)) || 20))

    let listResult
    try {
      listResult = await listReq.query(`
        SELECT
          L.CreateTime AS create_time,
          L.UserId AS user_id,
          L.UserName AS uname,
          L.Action AS action,
          L.Content AS details,
          L.IPAddress AS ip_address
        FROM ${SYS_OPERATION_LOGS_FROM} AS L
        ${whereSql}
        ORDER BY L.LogID DESC
        OFFSET ${safeOffset} ROWS
        FETCH NEXT ${safeFetch} ROWS ONLY
      `)
    } catch (pageErr) {
      const msg = String(pageErr?.message ?? pageErr?.originalError?.message ?? '')
      const shouldFallback =
        msg.includes('Invalid usage of the option NEXT') ||
        msg.includes("Incorrect syntax near 'OFFSET'") ||
        msg.toLowerCase().includes('offset') ||
        msg.toLowerCase().includes('fetch')
      if (!shouldFallback) throw pageErr

      const startRow = safeOffset + 1
      const endRow = safeOffset + safeFetch
      const fb = pool.request()
      if (uname) fb.input('unameLike', sql.NVarChar(100), `%${uname}%`)
      if (action) fb.input('actionLike', sql.NVarChar(80), `%${action}%`)
      if (startDate) fb.input('startDate', sql.NVarChar(20), `${startDate} 00:00:00`)
      if (endDate) fb.input('endDate', sql.NVarChar(20), `${endDate} 23:59:59`)
      fb.input('startRow', sql.Int, startRow)
      fb.input('endRow', sql.Int, endRow)
      listResult = await fb.query(`
        SELECT create_time, user_id, uname, action, details, ip_address
        FROM (
          SELECT
            L.CreateTime AS create_time,
            L.UserId AS user_id,
            L.UserName AS uname,
            L.Action AS action,
            L.Content AS details,
            L.IPAddress AS ip_address,
            ROW_NUMBER() OVER (ORDER BY L.LogID DESC) AS rn
          FROM ${SYS_OPERATION_LOGS_FROM} AS L
          ${whereSql}
        ) AS x
        WHERE x.rn BETWEEN @startRow AND @endRow
      `)
    }

    res.json({ code: 200, msg: 'success', data: { list: listResult.recordset ?? [], total } })
  } catch (err) {
    console.error('GET /api/sys/logs 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库查询失败')
    res.status(500).json({ code: 500, msg: `读取操作日志失败：${detail}`, data: null })
  }
})

/**
 * v1.1.1：清空操作日志（仅工号 admin 或角色「系统管理员」；成功后仍由审计中间件记一条「清空操作日志」）
 */
app.delete('/api/sys/logs/clear', async (req, res) => {
  try {
    const me = getCurrentUserFromReq(req)
    if (!isOperationLogAdminUser(me)) {
      res.status(403).json({ code: 403, msg: '仅管理员可清空操作日志', data: null })
      return
    }
    const pool = await getPool()
    await pool.request().query(`DELETE FROM ${SYS_OPERATION_LOGS_FROM}`)
    res.json({ code: 200, msg: 'success', data: { cleared: true } })
  } catch (err) {
    console.error('DELETE /api/sys/logs/clear 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库执行失败')
    res.status(500).json({ code: 500, msg: `清空操作日志失败：${detail}`, data: null })
  }
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
          r.Status,
          r.Permissions
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
          Status,
          Permissions
        FROM (
          SELECT
            r.RoleID,
            r.RoleName,
            r.Description,
            r.Status,
            r.Permissions,
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
        INSERT INTO Sys_Roles (RoleName, Description, Status, Permissions)
        OUTPUT INSERTED.RoleID, INSERTED.RoleName, INSERTED.Description, INSERTED.Status, INSERTED.Permissions
        VALUES (@RoleName, @Description, 1, NULL)
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
        OUTPUT INSERTED.RoleID, INSERTED.RoleName, INSERTED.Description, INSERTED.Status, INSERTED.Permissions
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
        OUTPUT INSERTED.RoleID, INSERTED.RoleName, INSERTED.Description, INSERTED.Status, INSERTED.Permissions
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
      OUTPUT INSERTED.RoleID, INSERTED.RoleName, INSERTED.Description, INSERTED.Status, INSERTED.Permissions
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
 * 仅更新角色的菜单权限（Sys_Roles.Permissions：JSON 对象或兼容旧版数组，序列化后入库）
 */
app.put('/api/roles/permissions', async (req, res) => {
  try {
    const roleId = Number(req.body?.RoleID)
    if (!Number.isFinite(roleId) || roleId <= 0) {
      res.status(400).json({ code: 400, msg: 'RoleID 不合法', data: null })
      return
    }

    const parsed = serializePermissionsForStore(req.body?.Permissions)
    if (!parsed.ok) {
      res.status(400).json({ code: 400, msg: parsed.msg, data: null })
      return
    }

    const pool = await getPool()
    const request = pool.request()
    request.input('RoleID', sql.Int, roleId)
    request.input('Permissions', sql.NVarChar(sql.MAX), parsed.jsonStr)

    const result = await request.query(`
      UPDATE Sys_Roles
      SET Permissions = @Permissions
      OUTPUT INSERTED.RoleID, INSERTED.RoleName, INSERTED.Description, INSERTED.Status, INSERTED.Permissions
      WHERE RoleID = @RoleID
    `)

    const updated = result.recordset?.[0]
    if (!updated) {
      res.status(404).json({ code: 404, msg: '未找到该角色', data: null })
      return
    }

    res.json({ code: 200, msg: 'success', data: updated })
  } catch (err) {
    console.error('更新 /api/roles/permissions 失败：', err)
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
    const account = String(req.body?.Account ?? '').trim()
    const fallbackUserCode = String(req.body?.UserCode ?? '').trim()
    const password = String(req.body?.Password ?? '')

    // 关键：基础必填校验（避免空请求打到数据库）
    if (!account) {
      // 兼容旧前端：未升级时仍传 UserCode
      if (fallbackUserCode) {
        res.status(400).json({ code: 400, msg: '登录账号不能为空（请升级前端以使用 Account 登录）', data: null })
        return
      }
      res.status(400).json({ code: 400, msg: '登录账号不能为空', data: null })
      return
    }
    if (!String(password).trim()) {
      res.status(400).json({ code: 400, msg: '密码不能为空', data: null })
      return
    }

    // 关键：获取数据库连接池
    const pool = await getPool()
    const userColset = await getSysUsersColumnSet(pool)

    // 关键：参数化查询（防 SQL 注入 + nvarchar 兼容中文）
    const request = pool.request()
    request.input('Account', sql.NVarChar(50), account)

    // 关键：查一条用户记录（按 Account 精确匹配）
    const result = await request.query(`
      SELECT TOP (1)
        u.UserID,
        u.UserCode,
        ${userColset.has('account') ? 'u.Account AS Account,' : ''}
        u.UserName,
        u.Password,
        u.Status,
        ${userColset.has('is_active') ? 'u.is_active AS is_active,' : ''}
        u.RoleID,
        r.RoleName AS RoleName,
        r.Permissions AS Permissions
      FROM Sys_Users AS u
      LEFT JOIN Sys_Roles AS r ON u.RoleID = r.RoleID
      WHERE ${userColset.has('account') ? 'u.Account = @Account' : 'u.UserCode = @Account'}
    `)

    // 关键：拿到用户行
    const userRow = result.recordset?.[0]

    // 1) 校验工号是否存在
    if (!userRow) {
      res.status(400).json({ code: 400, msg: '账号不存在', data: null })
      return
    }

    // 2) 校验账号是否被禁用（Status=0）
    if (Number(userRow.Status) === 0) {
      res.status(403).json({ code: 403, msg: '账号已被禁用，请联系管理员', data: null })
      return
    }
    // v1.1.2：账号是否可登录（is_active=0 则封禁）
    if (userColset.has('is_active') && Number(userRow.is_active ?? 1) === 0) {
      res.status(403).json({ code: 403, msg: '该账号已封禁或员工已离职', data: null })
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
      // 约定：把登录账号写入 userCode，便于各处统一展示（旧字段名不改）
      userCode: String(userRow.Account ?? userRow.UserCode ?? ''),
      // v1.0.8：审核写入 Auditor 时用真实姓名（与 Sys_Users.UserName 一致）
      userName: String(userRow.UserName ?? ''),
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
          Account: userRow.Account ?? null,
          UserName: userRow.UserName,
          Status: userRow.Status,
          RoleID: userRow.RoleID != null ? Number(userRow.RoleID) : null,
          RoleName: userRow.RoleName != null ? String(userRow.RoleName) : null,
          // v1.0.7：菜单权限 JSON 字符串（与 Sys_Roles.Permissions 一致）；NULL 表示未配置，前端按「不限制」处理
          Permissions:
            userRow.Permissions != null && userRow.Permissions !== undefined
              ? String(userRow.Permissions)
              : null,
        },
      },
    })
  } catch (err) {
    // 关键：服务端打印详细错误，前端只看中文提示
    console.error('登录 /api/login 失败：', err)
    const sqlMsg = String(err?.originalError?.info?.message ?? err?.message ?? '')
    const isMissingPermissionsColumn =
      err?.number === 207 && sqlMsg.includes('Permissions')
    if (isMissingPermissionsColumn) {
      res.status(500).json({
        code: 500,
        msg:
          '登录失败：数据库缺少 Sys_Roles.Permissions 列。请在 SQL Server 执行迁移脚本 scripts/migrations/sqlserver_v1.0.7_rbac_phase1.txt 中第 7 段（ALTER TABLE添加 NVARCHAR(MAX)），然后重试。',
        data: null,
      })
      return
    }
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

/** v1.0.8+：已审核（pass=1）禁止改删时返回的固定文案（与 .cursorrules 一致） */
const HR_DEPT_AUDIT_LOCK_MSG = '该记录已审核锁定，请反审后再操作'

/**
 * 旧系统部门表名：仅允许字母数字下划线，避免拼接进 SQL 时被注入；可在 .env 设置 HR_LEGACY_DEPT_TABLE
 */
const HR_LEGACY_DEPT_TABLE = (() => {
  const t = String(process.env.HR_LEGACY_DEPT_TABLE ?? 'HR_Departments').trim()
  if (!/^[a-zA-Z0-9_]{1,64}$/.test(t)) {
    console.warn('[部门资料] HR_LEGACY_DEPT_TABLE 不合法，已回退为 HR_Departments')
    return 'HR_Departments'
  }
  return t
})()

/** 已解析的 FROM子句，如 dbo.[HR_Departments] */
const HR_LEGACY_DEPT_FROM = `dbo.[${HR_LEGACY_DEPT_TABLE}]`

/** 旧表对外 JSON 字段顺序与大小写（与 Navicat 结构一致，严禁改名） */
const HR_LEGACY_DEPT_KEYS = [
  'code',
  'name',
  'manager',
  // v1.1.0：备注（迁移脚本新增列）
  'remark',
  'ParentID',
  'addtime',
  'edittime',
  'deltime',
  'intime',
  'del',
  'flag',
  'info',
  'systemcode',
  // v1.1.0：新增部门/岗位时记录创建人（旧表字段：uid/uname）
  'uid',
  'uname',
  'pass',
  'passid',
  'passuname',
  'passuid',
  'passutruename',
  'passtime',
  'uploadtime',
  'ip',
  'delid',
  'delname',
  'deltruename',
]

/**
 * 从驱动返回的行对象里按字段名取值（兼容不同大小写键名），并输出统一小写字段名
 * @param {Record<string, any>|null|undefined} raw
 */
function mapLegacyDeptRow(raw) {
  if (!raw) return null
  const out = {}
  for (const key of HR_LEGACY_DEPT_KEYS) {
    let v = raw[key]
    if (v === undefined) {
      const rk = Object.keys(raw).find((k) => k.toLowerCase() === key)
      if (rk) v = raw[rk]
    }
    out[key] = v === undefined ? null : v
  }
  return out
}

/**
 * 旧表审核状态：pass 为 nvarchar，'1' 表示已审核
 * @param {any} passVal
 */
function legacyDeptPassIsAudited(passVal) {
  return String(passVal ?? '').trim() === '1'
}

/** del 为空或0 表示仍在用（未逻辑删除） */
function legacyDeptRowIsActive(row) {
  if (!row) return false
  const d = String(row.del ?? '').trim()
  return d === '' || d === '0'
}

/**
 * 当前时间写入 nvarchar 时间字段（与旧系统字符串时间兼容）
 */
function legacyDeptNowString() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/**
 * 旧表 code 主键：在整表取「可解析为整数的 code」的最大值 +1，生成新编码（字符串）。
 * 部门与岗位统一用数字字符串，避免前端手填冲突。
 */
/**
 * 名称查重（在册=未逻辑删除）
 *
 * 规则（按你最新需求）：
 * - 顶级部门（ParentID 为空/0）：name 全局不可重复（只与顶级部门比，不与岗位比）
 * - 岗位（ParentID 非空/非0）：同一 ParentID 下 name 不可重复（跨部门允许重复）
 *
 * @param {import('mssql').ConnectionPool} pool
 * @param {{ nameTrim: string, excludeCodeRaw?: string|null, parentIdTrim?: string|null }} args
 */
async function legacyDeptActiveNameExists(pool, args) {
  const name = String(args?.nameTrim ?? '').trim()
  if (!name) return false
  const exclude = String(args?.excludeCodeRaw ?? '').trim()
  const parentId = String(args?.parentIdTrim ?? '').trim()

  const isPost = parentId.length > 0 && parentId !== '0'

  const req = pool.request()
  req.input('name', sql.NVarChar(50), name)
  req.input('exclude', sql.NVarChar(50), exclude.length ? exclude : null)
  req.input('isPost', sql.Int, isPost ? 1 : 0)
  req.input('pid', sql.NVarChar(50), isPost ? parentId : null)
  const r = await req.query(`
    SELECT TOP (1) t.code
    FROM ${HR_LEGACY_DEPT_FROM} AS t
    WHERE (${HR_LEGACY_WHERE_ACTIVE})
      AND LTRIM(RTRIM(ISNULL(t.name, N''))) = @name
      AND (
        (@isPost = 0 AND (ISNULL(t.ParentID, N'') = N'' OR t.ParentID = N'0')) -- 顶级部门范围
        OR
        (@isPost = 1 AND LTRIM(RTRIM(ISNULL(t.ParentID, N''))) = LTRIM(RTRIM(@pid))) -- 同部门岗位范围
      )
      AND (@exclude IS NULL OR LTRIM(RTRIM(ISNULL(t.code, N''))) <> LTRIM(RTRIM(@exclude)))
  `)
  return Boolean(r.recordset?.[0]?.code)
}

async function allocateNextLegacyDeptCode(pool) {
  // 兼容 SQL Server 2008 R2 等：无 TRY_CONVERT，用 PATINDEX 筛「纯数字」再 CAST
  const r = await pool.request().query(`
    SELECT MAX(CAST(LTRIM(RTRIM(ISNULL(t.code, N''))) AS BIGINT)) AS maxNum
    FROM ${HR_LEGACY_DEPT_FROM} AS t
    WHERE LEN(LTRIM(RTRIM(ISNULL(t.code, N'')))) > 0
      AND PATINDEX(N'%[^0-9]%', LTRIM(RTRIM(ISNULL(t.code, N'')))) = 0
  `)
  const raw = r.recordset?.[0]?.maxNum
  const maxNum = raw == null || raw === '' ? 0 : Number(raw)
  const safeMax = Number.isFinite(maxNum) && maxNum > 0 ? maxNum : 0
  const next = safeMax + 1
  if (next > Number.MAX_SAFE_INTEGER) {
    throw new Error('部门编码数值超出系统可处理范围')
  }
  return String(next)
}

/** 列表只显示未逻辑删除：del 为空、'' 或 '0' */
const HR_LEGACY_WHERE_ACTIVE = `(ISNULL(t.del, N'') = N'' OR t.del = N'0')`

/**
 * 旧部门表行「已审核」：与 legacyDeptPassIsAudited 一致，但用 CAST 兼容 pass 存为 int/bit 等类型
 * （仅用 WHERE；别名必须为 t）
 */
const HR_LEGACY_WHERE_PASS_AUDITED = `LTRIM(RTRIM(COALESCE(CAST(t.pass AS NVARCHAR(50)), N''))) = N'1'`

/**
 * 按 code 读一条（map 后的对象）
 * @param {import('mssql').ConnectionPool} pool
 * @param {string} codeRaw
 */
async function fetchLegacyDeptByCode(pool, codeRaw) {
  const code = String(codeRaw ?? '').trim()
  if (!code) return null
  const r = await pool.request().input('code', sql.NVarChar(50), code).query(`
    SELECT TOP (1)
      t.code, t.name, t.manager, t.remark, t.ParentID, t.addtime, t.edittime, t.deltime, t.intime,
      t.del, t.flag, t.info, t.systemcode, t.uid, t.uname, t.pass, t.passid, t.passuname, t.passuid, t.passutruename,
      t.passtime, t.uploadtime, t.ip, t.delid, t.delname, t.deltruename
    FROM ${HR_LEGACY_DEPT_FROM} AS t
    WHERE t.code = @code
  `)
  return mapLegacyDeptRow(r.recordset?.[0])
}

/**
 * 顶级部门下拉：GET /api/hr/departments/options
 * - 只返回顶级部门（ParentID 为空），用于部门资料页「新增岗位」选所属部门等
 * - **不按 pass 过滤**（未审核部门也可作为岗位的 ParentID）
 * - 字段名与旧表一致：code / name
 */
app.get('/api/hr/departments/options', async (req, res) => {
  try {
    const pool = await getPool()
    const r = await pool.request().query(`
      SELECT t.code, t.name
      FROM ${HR_LEGACY_DEPT_FROM} AS t
      WHERE
        (${HR_LEGACY_WHERE_ACTIVE})
        AND (ISNULL(t.ParentID, N'') = N'' OR t.ParentID = N'0')
      ORDER BY t.code
    `)
    const list = (r.recordset ?? []).map((row) => ({ code: row?.code ?? null, name: row?.name ?? null }))
    res.json({ code: 200, msg: 'success', data: { list } })
  } catch (err) {
    console.error('GET /api/hr/departments/options 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库查询失败')
    res.status(500).json({ code: 500, msg: `读取部门下拉失败：${detail}`, data: null })
  }
})

/**
 * v1.1.0：岗位下拉（从 HR_Departments 接管表取岗位）
 * GET /api/hr/departments/posts?parentId=部门code
 * - 只返回 ParentID=parentId 的在册记录（del 正常）
 * - **不按 pass 过滤**（与部门资料维护口径一致）
 * - 字段：code / name
 */
app.get('/api/hr/departments/posts', async (req, res) => {
  try {
    const parentId = String(req.query?.parentId ?? '').trim()
    if (!parentId) {
      res.status(400).json({ code: 400, msg: 'parentId（部门编码）不能为空', data: null })
      return
    }
    const pool = await getPool()
    const r = await pool.request().input('pid', sql.NVarChar(50), parentId).query(`
      SELECT t.code, t.name
      FROM ${HR_LEGACY_DEPT_FROM} AS t
      WHERE
        (${HR_LEGACY_WHERE_ACTIVE})
        AND LTRIM(RTRIM(ISNULL(t.ParentID, N''))) = LTRIM(RTRIM(@pid))
      ORDER BY t.code
    `)
    const list = (r.recordset ?? []).map((row) => ({ code: row?.code ?? null, name: row?.name ?? null }))
    res.json({ code: 200, msg: 'success', data: { list } })
  } catch (err) {
    console.error('GET /api/hr/departments/posts 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库查询失败')
    res.status(500).json({ code: 500, msg: `读取岗位下拉失败：${detail}`, data: null })
  }
})

/**
 * 员工档案专用：入职部门下拉（仅已审核顶级部门）
 * GET /api/hr/staff/department-options
 */
app.get('/api/hr/staff/department-options', async (req, res) => {
  try {
    const pool = await getPool()
    const r = await pool.request().query(`
      SELECT t.code, t.name
      FROM ${HR_LEGACY_DEPT_FROM} AS t
      WHERE
        (${HR_LEGACY_WHERE_ACTIVE})
        AND (${HR_LEGACY_WHERE_PASS_AUDITED})
        AND (ISNULL(t.ParentID, N'') = N'' OR t.ParentID = N'0')
      ORDER BY t.code
    `)
    const list = (r.recordset ?? []).map((row) => ({ code: row?.code ?? null, name: row?.name ?? null }))
    res.json({ code: 200, msg: 'success', data: { list } })
  } catch (err) {
    console.error('GET /api/hr/staff/department-options 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库查询失败')
    res.status(500).json({ code: 500, msg: `读取入职部门下拉失败：${detail}`, data: null })
  }
})

/**
 * 员工档案专用：岗位下拉（仅已审核岗位，且挂在指定 parentId 下）
 * GET /api/hr/staff/department-posts?parentId=部门code
 */
app.get('/api/hr/staff/department-posts', async (req, res) => {
  try {
    const parentId = String(req.query?.parentId ?? '').trim()
    if (!parentId) {
      res.status(400).json({ code: 400, msg: 'parentId（部门编码）不能为空', data: null })
      return
    }
    const pool = await getPool()
    const r = await pool.request().input('pid', sql.NVarChar(50), parentId).query(`
      SELECT t.code, t.name
      FROM ${HR_LEGACY_DEPT_FROM} AS t
      WHERE
        (${HR_LEGACY_WHERE_ACTIVE})
        AND (${HR_LEGACY_WHERE_PASS_AUDITED})
        AND LTRIM(RTRIM(ISNULL(t.ParentID, N''))) = LTRIM(RTRIM(@pid))
      ORDER BY t.code
    `)
    const list = (r.recordset ?? []).map((row) => ({ code: row?.code ?? null, name: row?.name ?? null }))
    res.json({ code: 200, msg: 'success', data: { list } })
  } catch (err) {
    console.error('GET /api/hr/staff/department-posts 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库查询失败')
    res.status(500).json({ code: 500, msg: `读取岗位下拉失败：${detail}`, data: null })
  }
})

/**
 * 部门分页列表（旧表）：GET /api/hr/departments
 * -默认每页 20；keyword 模糊匹配 name、code
 * - 返回 list 中每条字段名均为小写，与旧库列名一致
 */
app.get('/api/hr/departments', async (req, res) => {
  try {
    const pageRaw = req.query?.page
    const pageSizeRaw = req.query?.pageSize
    const page = Number(pageRaw ?? 1)
    const pageSize = Number(pageSizeRaw ?? 20)
    const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1
    const safePageSize =
      Number.isFinite(pageSize) && pageSize > 0 ? Math.min(Math.floor(pageSize), 200) : 20
    const offset = (safePage - 1) * safePageSize

    const keywordRaw = String(req.query?.keyword ?? '').trim()
    const hasKeyword = keywordRaw.length > 0
    const likeKey = `%${keywordRaw}%`

    // 审核筛选：默认只看已审核（pass='1'），开关切换后只看待审核（pass='0'）
    const passRaw = String(req.query?.pass ?? '1').trim()
    const pass = passRaw === '0' ? '0' : '1'

    const pool = await getPool()

    // 说明：这里统一使用别名 s（与你给的参考代码一致）
    const whereActive = `(ISNULL(s.del, N'') = N'' OR s.del = N'0')`
    const whereBase = `WHERE ${whereActive}`
    // 说明：旧库 pass 可能存在空格（如 '1 '），这里统一 trim 后再判断，并且严格等于 @pass
    const wherePass = ` AND LTRIM(RTRIM(ISNULL(s.pass, N''))) = @pass`
    const whereKw = hasKeyword
      ? ` AND (s.name LIKE @key OR s.code LIKE @key OR ISNULL(s.remark, N'') LIKE @key)`
      : ''

    const totalReq = pool.request()
    totalReq.input('pass', sql.NVarChar(10), pass)
    if (hasKeyword) totalReq.input('key', sql.NVarChar(200), likeKey)
    const totalResult = await totalReq.query(`
      SELECT COUNT(1) AS total
      FROM ${HR_LEGACY_DEPT_FROM} AS s
      ${whereBase}${wherePass}${whereKw}
    `)
    const total = Number(totalResult.recordset?.[0]?.total ?? 0)

    const safeOffset = Math.max(0, Math.floor(Number(offset)) || 0)
    const safeFetch = Math.max(1, Math.min(200, Math.floor(Number(safePageSize)) || 20))

    const listReq = pool.request()
    listReq.input('pass', sql.NVarChar(10), pass)
    if (hasKeyword) listReq.input('key', sql.NVarChar(200), likeKey)

    const listSelect = `
      SELECT
        s.code, s.name, s.manager, s.remark, s.ParentID, s.addtime, s.edittime, s.deltime, s.intime,
        s.del, s.flag, s.info, s.systemcode, s.uid, s.uname, s.pass, s.passid, s.passuname, s.passuid, s.passutruename,
        s.passtime, s.uploadtime, s.ip, s.delid, s.delname, s.deltruename
      FROM ${HR_LEGACY_DEPT_FROM} AS s
      ${whereBase}${wherePass}${whereKw}
      ORDER BY s.code
    `

    let listResult
    try {
      listResult = await listReq.query(`
        ${listSelect}
        OFFSET ${safeOffset} ROWS
        FETCH NEXT ${safeFetch} ROWS ONLY
      `)
    } catch (pageErr) {
      const msg = String(pageErr?.message ?? pageErr?.originalError?.message ?? '')
      const shouldFallback =
        msg.includes("Invalid usage of the option NEXT") ||
        msg.includes("Incorrect syntax near 'OFFSET'") ||
        msg.toLowerCase().includes('offset') ||
        msg.toLowerCase().includes('fetch')
      if (!shouldFallback) throw pageErr

      const startRow = safeOffset + 1
      const endRow = safeOffset + safeFetch
      const fb = pool.request()
      fb.input('startRow', sql.Int, startRow)
      fb.input('endRow', sql.Int, endRow)
      fb.input('pass', sql.NVarChar(10), pass)
      if (hasKeyword) fb.input('key', sql.NVarChar(200), likeKey)
      listResult = await fb.query(`
        SELECT
          code, name, manager, remark, ParentID, addtime, edittime, deltime, intime,
          del, flag, info, systemcode, pass, passid, passuname, passuid, passutruename,
          passtime, uploadtime, ip, delid, delname, deltruename
        FROM (
          SELECT
            s.code, s.name, s.manager, s.remark, s.ParentID, s.addtime, s.edittime, s.deltime, s.intime,
            s.del, s.flag, s.info, s.systemcode, s.uid, s.uname, s.pass, s.passid, s.passuname, s.passuid, s.passutruename,
            s.passtime, s.uploadtime, s.ip, s.delid, s.delname, s.deltruename,
            ROW_NUMBER() OVER (ORDER BY s.code) AS rn
          FROM ${HR_LEGACY_DEPT_FROM} AS s
          ${whereBase}${wherePass}${whereKw}
        ) AS x
        WHERE x.rn BETWEEN @startRow AND @endRow
      `)
    }

    const list = (listResult.recordset ?? []).map((row) => mapLegacyDeptRow(row)).filter(Boolean)

    res.json({ code: 200, msg: 'success', data: { list, total } })
  } catch (err) {
    console.error('GET /api/hr/departments 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库查询失败')
    res.status(500).json({ code: 500, msg: `读取部门资料失败：${detail}`, data: null })
  }
})

/**
 * 部门树形列表：GET /api/hr/departments/tree
 * - 用于前端树形表格（部门作为父节点，岗位作为子节点）
 * - 过滤规则与分页列表一致：默认 pass='1'，keyword 模糊匹配 name/code/remark
 * - 返回：{ list, total }，其中 list 为树形结构（children 挂岗位）
 */
app.get('/api/hr/departments/tree', async (req, res) => {
  try {
    const keywordRaw = String(req.query?.keyword ?? '').trim()
    const hasKeyword = keywordRaw.length > 0
    const likeKey = `%${keywordRaw}%`

    const passRaw = String(req.query?.pass ?? '1').trim()
    const pass = passRaw === '0' ? '0' : '1'

    const pool = await getPool()

    const whereActive = `(ISNULL(s.del, N'') = N'' OR s.del = N'0')`
    const whereBase = `WHERE ${whereActive}`
    const wherePass = ` AND LTRIM(RTRIM(ISNULL(s.pass, N''))) = @pass`
    const whereKw = hasKeyword
      ? ` AND (s.name LIKE @key OR s.code LIKE @key OR ISNULL(s.remark, N'') LIKE @key)`
      : ''

    const reqAll = pool.request()
    reqAll.input('pass', sql.NVarChar(10), pass)
    if (hasKeyword) reqAll.input('key', sql.NVarChar(200), likeKey)

    // 说明：树形模式需要全量（或足够大）数据；这里做一个上限保护，避免误扫几十万
    const r = await reqAll.query(`
      SELECT TOP (5000)
        s.code, s.name, s.manager, s.remark, s.ParentID, s.addtime, s.edittime, s.deltime, s.intime,
        s.del, s.flag, s.info, s.systemcode, s.uid, s.uname, s.pass, s.passid, s.passuname, s.passuid, s.passutruename,
        s.passtime, s.uploadtime, s.ip, s.delid, s.delname, s.deltruename
      FROM ${HR_LEGACY_DEPT_FROM} AS s
      ${whereBase}${wherePass}${whereKw}
      ORDER BY s.code
    `)

    const flat = (r.recordset ?? []).map((row) => mapLegacyDeptRow(row)).filter(Boolean)

    /** @type {Record<string, any>} */
    const deptByCode = {}
    const depts = []
    const posts = []

    for (const row of flat) {
      const pid = String(row?.ParentID ?? '').trim()
      const isPost = pid !== '' && pid !== '0'
      if (isPost) posts.push(row)
      else depts.push({ ...row, children: [] })
    }

    for (const d of depts) {
      deptByCode[String(d.code ?? '').trim()] = d
    }

    for (const p of posts) {
      const pid = String(p?.ParentID ?? '').trim()
      const parent = deptByCode[pid]
      if (parent) {
        parent.children.push(p)
      } else {
        // 找不到父部门时：降级当作顶级展示，避免岗位“消失”
        depts.push({ ...p, children: [] })
      }
    }

    // 排序：保持 code 升序；岗位也按 code 升序
    depts.sort((a, b) => String(a?.code ?? '').localeCompare(String(b?.code ?? ''), 'zh-Hans-CN'))
    for (const d of depts) {
      if (Array.isArray(d.children)) {
        d.children.sort((a, b) => String(a?.code ?? '').localeCompare(String(b?.code ?? ''), 'zh-Hans-CN'))
      }
    }

    const total = flat.length
    res.json({ code: 200, msg: 'success', data: { list: depts, total } })
  } catch (err) {
    console.error('GET /api/hr/departments/tree 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库查询失败')
    res.status(500).json({ code: 500, msg: `读取部门树失败：${detail}`, data: null })
  }
})

/**
 * 新增：POST /api/hr/departments
 * body: { name, remark?, ParentID? } — code 由服务端按整表最大数字 code +1 生成；pass/del 默认未审、未删
 */
app.post('/api/hr/departments', async (req, res) => {
  // 在 Network「响应标头」里可看到：用于确认请求是否打到「本仓库当前」后端（旧进程不会带此头）
  res.setHeader('X-ERP-Dept-Post', 'v1.1.0-auto-code')
  try {
    const body = req.body ?? {}
    const name = String(body.name ?? '').trim()
    const remark = String(body.remark ?? '').trim()
    const parentId = String(body.ParentID ?? '').trim()
    if (!name) {
      res.status(400).json({ code: 400, msg: 'name（名称）不能为空', data: null })
      return
    }

    const pool = await getPool()
    if (
      await legacyDeptActiveNameExists(pool, {
        nameTrim: name,
        excludeCodeRaw: null,
        parentIdTrim: parentId || null,
      })
    ) {
      const isPost = String(parentId ?? '').trim().length > 0
      res.status(400).json({
        code: 400,
        msg: isPost
          ? `岗位名称「${name}」在该部门下已存在，不能重复`
          : `部门名称「${name}」已存在，不能重复`,
        data: null,
      })
      return
    }

    let code
    try {
      code = await allocateNextLegacyDeptCode(pool)
    } catch (allocErr) {
      const d = String(allocErr?.message ?? '生成编码失败')
      res.status(500).json({ code: 500, msg: `新增部门失败：${d}`, data: null })
      return
    }

    // 说明：ParentID 非空时视为“岗位”，必须选择所属部门
    if (parentId) {
      if (parentId === code) {
        res.status(400).json({ code: 400, msg: 'ParentID 不能等于自身编码', data: null })
        return
      }
    }

    // 岗位必须有父部门：ParentID 指向一个“顶级部门”（ParentID 为空）
    if (parentId) {
      const pr = await pool.request().input('p', sql.NVarChar(50), parentId).query(`
        SELECT TOP (1) t.code, t.ParentID, t.del
        FROM ${HR_LEGACY_DEPT_FROM} AS t
        WHERE t.code = @p
      `)
      const parentRow = mapLegacyDeptRow(pr.recordset?.[0])
      if (!parentRow || !legacyDeptRowIsActive(parentRow)) {
        res.status(400).json({ code: 400, msg: '所属部门不存在或已删除，请重新选择', data: null })
        return
      }
      const ppid = String(parentRow?.ParentID ?? '').trim()
      if (ppid && ppid !== '0') {
        res.status(400).json({ code: 400, msg: '所属部门必须是顶级部门（不能选择岗位/子级）', data: null })
        return
      }
    }

    const now = legacyDeptNowString()
    const me = getCurrentUserFromReq(req)
    const uidStr = me?.userId != null ? String(me.userId) : ''
    const uname = me?.userName != null ? String(me.userName) : ''
    const ins = pool.request()
    ins.input('code', sql.NVarChar(50), code)
    ins.input('name', sql.NVarChar(50), name)
    ins.input('remark', sql.NVarChar(500), remark || null)
    ins.input('ParentID', sql.NVarChar(50), parentId || null)
    ins.input('uid', sql.NVarChar(50), uidStr || null)
    ins.input('uname', sql.NVarChar(50), uname || null)
    ins.input('now', sql.NVarChar(50), now)
    await ins.query(`
      INSERT INTO ${HR_LEGACY_DEPT_FROM} (code, name, manager, ParentID, remark, uid, uname, pass, del, addtime, edittime)
      VALUES (@code, @name, NULL, @ParentID, @remark, @uid, @uname, N'0', N'0', @now, @now)
    `)

    const row = await fetchLegacyDeptByCode(pool, code)
    res.json({ code: 200, msg: 'success', data: row })
  } catch (err) {
    console.error('POST /api/hr/departments 失败：', err)
    const n = Number(err?.number ?? err?.originalError?.number ?? 0)
    if (n === 2627 || n === 2601) {
      res.status(400).json({ code: 400, msg: 'code已存在，不能重复', data: null })
      return
    }
    const detail = String(err?.message ?? '数据库写入失败')
    res.status(500).json({ code: 500, msg: `新增部门失败：${detail}`, data: null })
  }
})

/**
 * 编辑：PUT /api/hr/departments
 * body: { code, name, remark?, ParentID? } — code 定位行，不可改主键
 */
app.put('/api/hr/departments', async (req, res) => {
  try {
    const body = req.body ?? {}
    const code = String(body.code ?? '').trim()
    const name = String(body.name ?? '').trim()
    const remark = String(body.remark ?? '').trim()
    const parentId = String(body.ParentID ?? '').trim()
    if (!code) {
      res.status(400).json({ code: 400, msg: 'code 不能为空', data: null })
      return
    }
    if (!name) {
      res.status(400).json({ code: 400, msg: 'name（名称）不能为空', data: null })
      return
    }
    // 说明：未审核的岗位允许改所属部门；已审核直接拦截（见下方 existing.pass 判断）
    if (parentId && parentId === code) {
      res.status(400).json({ code: 400, msg: 'ParentID 不能等于自身编码', data: null })
      return
    }

    const pool = await getPool()
    const existing = await fetchLegacyDeptByCode(pool, code)
    if (!existing || !legacyDeptRowIsActive(existing)) {
      res.status(404).json({ code: 404, msg: '未找到该部门或已删除', data: null })
      return
    }
    if (legacyDeptPassIsAudited(existing.pass)) {
      res.status(400).json({ code: 400, msg: HR_DEPT_AUDIT_LOCK_MSG, data: null })
      return
    }

    // 如果传了 ParentID（表示岗位/调整归属），则校验父部门必须是顶级部门
    if (parentId) {
      const pr = await pool.request().input('p', sql.NVarChar(50), parentId).query(`
        SELECT TOP (1) t.code, t.ParentID, t.del
        FROM ${HR_LEGACY_DEPT_FROM} AS t
        WHERE t.code = @p
      `)
      const parentRow = mapLegacyDeptRow(pr.recordset?.[0])
      if (!parentRow || !legacyDeptRowIsActive(parentRow)) {
        res.status(400).json({ code: 400, msg: '所属部门不存在或已删除，请重新选择', data: null })
        return
      }
      const ppid = String(parentRow?.ParentID ?? '').trim()
      if (ppid && ppid !== '0') {
        res.status(400).json({ code: 400, msg: '所属部门必须是顶级部门（不能选择岗位/子级）', data: null })
        return
      }
    }

    if (
      await legacyDeptActiveNameExists(pool, {
        nameTrim: name,
        excludeCodeRaw: code,
        parentIdTrim: parentId || null,
      })
    ) {
      const isPost = String(parentId ?? '').trim().length > 0
      res.status(400).json({
        code: 400,
        msg: isPost
          ? `岗位名称「${name}」在该部门下已存在，不能重复`
          : `部门名称「${name}」已存在，不能重复`,
        data: null,
      })
      return
    }

    const now = legacyDeptNowString()
    const upd = pool.request()
    upd.input('code', sql.NVarChar(50), code)
    upd.input('name', sql.NVarChar(50), name)
    upd.input('remark', sql.NVarChar(500), remark || null)
    upd.input('ParentID', sql.NVarChar(50), parentId || null)
    upd.input('now', sql.NVarChar(50), now)
    await upd.query(`
      UPDATE t
      SET t.name = @name, t.remark = @remark, t.ParentID = @ParentID, t.edittime = @now
      FROM ${HR_LEGACY_DEPT_FROM} AS t
      WHERE t.code = @code AND (${HR_LEGACY_WHERE_ACTIVE})
    `)

    const row = await fetchLegacyDeptByCode(pool, code)
    res.json({ code: 200, msg: 'success', data: row })
  } catch (err) {
    console.error('PUT /api/hr/departments 失败：', err)
    const detail = String(err?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `修改部门失败：${detail}`, data: null })
  }
})

/**
 * 逻辑删除：DELETE /api/hr/departments/:code
 * - 已审核禁止；写入 del、deltime、edittime 及删除人信息（若有列）
 */
app.delete('/api/hr/departments/:code', async (req, res) => {
  try {
    const code = String(req.params.code ?? '').trim()
    if (!code) {
      res.status(400).json({ code: 400, msg: 'code 不合法', data: null })
      return
    }

    const me = getCurrentUserFromReq(req)
    const pool = await getPool()
    const existing = await fetchLegacyDeptByCode(pool, code)
    if (!existing || !legacyDeptRowIsActive(existing)) {
      res.status(404).json({ code: 404, msg: '未找到该部门或已删除', data: null })
      return
    }
    if (legacyDeptPassIsAudited(existing.pass)) {
      res.status(400).json({ code: 400, msg: HR_DEPT_AUDIT_LOCK_MSG, data: null })
      return
    }

    const now = legacyDeptNowString()
    const delId = me?.userId != null ? String(me.userId) : ''
    const delName = String(me?.userCode ?? '').trim()
    const delTrueName = String(me?.userName ?? '').trim()

    const upd = pool.request()
    upd.input('code', sql.NVarChar(50), code)
    upd.input('now', sql.NVarChar(50), now)
    upd.input('delid', sql.NVarChar(50), delId || null)
    upd.input('delname', sql.NVarChar(50), delName || null)
    upd.input('deltruename', sql.NVarChar(50), delTrueName || null)
    await upd.query(`
      UPDATE t
      SET
        t.del = N'1',
        t.deltime = @now,
        t.edittime = @now,
        t.delid = @delid,
        t.delname = @delname,
        t.deltruename = @deltruename
      FROM ${HR_LEGACY_DEPT_FROM} AS t
      WHERE t.code = @code AND (${HR_LEGACY_WHERE_ACTIVE})
    `)

    res.json({ code: 200, msg: 'success', data: { code } })
  } catch (err) {
    console.error('DELETE /api/hr/departments 失败：', err)
    const detail = String(err?.message ?? '数据库删除失败')
    res.status(500).json({ code: 500, msg: `删除部门失败：${detail}`, data: null })
  }
})

/**
 * 审核：PUT /api/hr/departments/audit
 * body: { code } — pass=N'1'，审核人写入 passutruename 等
 */
app.put('/api/hr/departments/audit', async (req, res) => {
  try {
    const me = getCurrentUserFromReq(req)
    const auditorName = String(me?.userName ?? me?.userCode ?? '').trim() || '未知'
    const userCode = String(me?.userCode ?? '').trim()
    const uidStr = me?.userId != null ? String(me.userId) : ''

    const body = req.body ?? {}
    const code = String(body.code ?? '').trim()
    if (!code) {
      res.status(400).json({ code: 400, msg: 'code 不能为空', data: null })
      return
    }

    const pool = await getPool()
    const existing = await fetchLegacyDeptByCode(pool, code)
    if (!existing || !legacyDeptRowIsActive(existing)) {
      res.status(404).json({ code: 404, msg: '未找到该部门或已删除', data: null })
      return
    }
    if (legacyDeptPassIsAudited(existing.pass)) {
      res.status(400).json({ code: 400, msg: '当前已是已审核状态', data: null })
      return
    }

    const now = legacyDeptNowString()
    const q = pool.request()
    q.input('code', sql.NVarChar(50), code)
    q.input('now', sql.NVarChar(50), now)
    q.input('passutruename', sql.NVarChar(50), auditorName)
    q.input('passuname', sql.NVarChar(50), userCode || null)
    q.input('passuid', sql.NVarChar(50), uidStr || null)
    q.input('passid', sql.NVarChar(50), uidStr || null)
    await q.query(`
      UPDATE t
      SET
        t.pass = N'1',
        t.passutruename = @passutruename,
        t.passuname = @passuname,
        t.passuid = @passuid,
        t.passid = @passid,
        t.passtime = @now,
        t.edittime = @now
      FROM ${HR_LEGACY_DEPT_FROM} AS t
      WHERE t.code = @code AND (${HR_LEGACY_WHERE_ACTIVE})
    `)

    const row = await fetchLegacyDeptByCode(pool, code)
    res.json({ code: 200, msg: 'success', data: row })
  } catch (err) {
    console.error('PUT /api/hr/departments/audit 失败：', err)
    const detail = String(err?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `审核失败：${detail}`, data: null })
  }
})

/**
 * 批量审核：PUT /api/hr/departments/audit-batch
 * body: { codes: string[] } — 仅用于“当前页批量审核”（建议 <= 200）
 */
app.put('/api/hr/departments/audit-batch', async (req, res) => {
  try {
    const me = getCurrentUserFromReq(req)
    const auditorName = String(me?.userName ?? me?.userCode ?? '').trim() || '未知'
    const userCode = String(me?.userCode ?? '').trim()
    const uidStr = me?.userId != null ? String(me.userId) : ''

    const body = req.body ?? {}
    const codesRaw = body.codes
    const codes = Array.isArray(codesRaw)
      ? [...new Set(codesRaw.map((c) => String(c ?? '').trim()).filter(Boolean))]
      : []

    if (!codes.length) {
      res.status(400).json({ code: 400, msg: 'codes 不能为空', data: null })
      return
    }
    if (codes.length > 200) {
      res.status(400).json({ code: 400, msg: '批量审核数量过多（最多 200 条）', data: null })
      return
    }

    const pool = await getPool()
    const tx = new sql.Transaction(pool)
    await tx.begin()
    try {
      const now = legacyDeptNowString()
      let successCount = 0
      /** @type {{ code: string, msg: string }[]} */
      const failed = []

      for (const code of codes) {
        try {
          const existing = await fetchLegacyDeptByCode(tx, code)
          if (!existing || !legacyDeptRowIsActive(existing)) {
            failed.push({ code, msg: '未找到或已删除' })
            continue
          }
          if (legacyDeptPassIsAudited(existing.pass)) {
            // 已审核不算失败，直接跳过
            continue
          }
          const q = new sql.Request(tx)
          q.input('code', sql.NVarChar(50), code)
          q.input('now', sql.NVarChar(50), now)
          q.input('passutruename', sql.NVarChar(50), auditorName)
          q.input('passuname', sql.NVarChar(50), userCode || null)
          q.input('passuid', sql.NVarChar(50), uidStr || null)
          q.input('passid', sql.NVarChar(50), uidStr || null)
          await q.query(`
            UPDATE t
            SET
              t.pass = N'1',
              t.passutruename = @passutruename,
              t.passuname = @passuname,
              t.passuid = @passuid,
              t.passid = @passid,
              t.passtime = @now,
              t.edittime = @now
            FROM ${HR_LEGACY_DEPT_FROM} AS t
            WHERE t.code = @code AND (${HR_LEGACY_WHERE_ACTIVE})
          `)
          successCount += 1
        } catch (innerErr) {
          const detail = String(innerErr?.message ?? '审核失败')
          failed.push({ code, msg: detail })
        }
      }

      await tx.commit()
      res.json({ code: 200, msg: 'success', data: { successCount, failed, total: codes.length } })
    } catch (innerErr) {
      try {
        await tx.rollback()
      } catch {
        // ignore
      }
      throw innerErr
    }
  } catch (err) {
    console.error('PUT /api/hr/departments/audit-batch 失败：', err)
    const detail = String(err?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `批量审核失败：${detail}`, data: null })
  }
})

/**
 * 反审：PUT /api/hr/departments/unaudit
 * body: { code }
 */
app.put('/api/hr/departments/unaudit', async (req, res) => {
  try {
    const body = req.body ?? {}
    const code = String(body.code ?? '').trim()
    if (!code) {
      res.status(400).json({ code: 400, msg: 'code 不能为空', data: null })
      return
    }

    const pool = await getPool()
    const existing = await fetchLegacyDeptByCode(pool, code)
    if (!existing || !legacyDeptRowIsActive(existing)) {
      res.status(404).json({ code: 404, msg: '未找到该部门或已删除', data: null })
      return
    }
    if (!legacyDeptPassIsAudited(existing.pass)) {
      res.status(400).json({ code: 400, msg: '当前为未审核状态，无需反审', data: null })
      return
    }

    const now = legacyDeptNowString()
    await pool.request().input('code', sql.NVarChar(50), code).input('now', sql.NVarChar(50), now).query(`
      UPDATE t
      SET
        t.pass = N'0',
        t.passutruename = NULL,
        t.passuname = NULL,
        t.passuid = NULL,
        t.passid = NULL,
        t.passtime = NULL,
        t.edittime = @now
      FROM ${HR_LEGACY_DEPT_FROM} AS t
      WHERE t.code = @code AND (${HR_LEGACY_WHERE_ACTIVE})
    `)

    const row = await fetchLegacyDeptByCode(pool, code)
    res.json({ code: 200, msg: 'success', data: row })
  } catch (err) {
    console.error('PUT /api/hr/departments/unaudit 失败：', err)
    const detail = String(err?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `反审失败：${detail}`, data: null })
  }
})

/** v1.0.9：人事档案（Hr_staff）已审核禁止改删固定文案 */
const HR_STAFF_AUDIT_LOCK_MSG = '该记录已审核锁定，请反审后再操作'

/** v1.0.9：员工表名固定为 Hr_staff（可用 .env 覆盖） */
const HR_STAFF_TABLE = (() => {
  const t = String(process.env.HR_STAFF_TABLE ?? 'Hr_staff').trim()
  if (!/^[a-zA-Z0-9_]{1,64}$/.test(t)) {
    console.warn('[员工档案] HR_STAFF_TABLE 不合法，已回退为 Hr_staff')
    return 'Hr_staff'
  }
  return t
})()

/** 已解析的 FROM 子句，如 dbo.[Hr_staff] */
const HR_STAFF_FROM = `dbo.[${HR_STAFF_TABLE}]`

/** v1.1.1：缓存员工档案表列清单（避免不同库缺列导致 SQL 报错） */
let HR_STAFF_COLSET_PROMISE = null

/** v1.1.2：缓存 Sys_Users 列清单（用于兼容 is_active 可能未迁移） */
let SYS_USERS_COLSET_PROMISE = null

/**
 * 读取 Sys_Users 的列名集合（小写），并缓存到进程内
 * @param {import('mssql').ConnectionPool} pool
 * @returns {Promise<Set<string>>}
 */
async function getSysUsersColumnSet(pool) {
  if (SYS_USERS_COLSET_PROMISE) return SYS_USERS_COLSET_PROMISE
  SYS_USERS_COLSET_PROMISE = (async () => {
    try {
      const r = await pool.request().query(`
        SELECT COLUMN_NAME AS name
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = N'dbo' AND TABLE_NAME = N'Sys_Users'
      `)
      const set = new Set()
      for (const row of r.recordset ?? []) {
        const n = String(row?.name ?? '').trim()
        if (n) set.add(n.toLowerCase())
      }
      return set
    } catch (err) {
      console.warn('[Sys_Users] 读取列清单失败，已降级：', err?.message ?? err)
      return new Set()
    }
  })()
  return SYS_USERS_COLSET_PROMISE
}

/**
 * 读取 Hr_staff 的列名集合（小写），并缓存到进程内
 * @param {import('mssql').ConnectionPool} pool
 * @returns {Promise<Set<string>>}
 */
async function getHrStaffColumnSet(pool) {
  if (HR_STAFF_COLSET_PROMISE) return HR_STAFF_COLSET_PROMISE
  HR_STAFF_COLSET_PROMISE = (async () => {
    try {
      const r = await pool
        .request()
        .input('t', sql.NVarChar(128), HR_STAFF_TABLE)
        .query(`
          SELECT COLUMN_NAME AS name
          FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = N'dbo' AND TABLE_NAME = @t
        `)
      const set = new Set()
      for (const row of r.recordset ?? []) {
        const n = String(row?.name ?? '').trim()
        if (n) set.add(n.toLowerCase())
      }
      return set
    } catch (err) {
      // 降级策略：列探测失败时不阻断主流程（但也不会尝试写入扩展字段）
      console.warn('[员工档案] 读取 Hr_staff 列清单失败，已降级：', err?.message ?? err)
      return new Set()
    }
  })()
  return HR_STAFF_COLSET_PROMISE
}

/**
 * 判断 pass 是否已审核：旧表 pass 为 nvarchar，'1' 表示已审核
 * @param {any} v
 */
function staffPassIsAudited(v) {
  return String(v ?? '').trim() === '1'
}

/**
 * 卡号是否与「在职且未逻辑删除」的员工冲突（离职、已删除不参与占用判断）
 * @param {import('mssql').ConnectionPool | import('mssql').Transaction} poolOrTx
 * @param {string} card 10 位数字卡号
 * @param {string} [excludeCode] 编辑时排除当前工号
 * @returns {Promise<string|null>} 冲突方工号，无冲突返回 null
 */
async function findActiveStaffCodeByCardNumber(poolOrTx, card, excludeCode = '') {
  const c = String(card ?? '').trim()
  if (!/^\d{10}$/.test(c)) return null
  const rq = new sql.Request(poolOrTx)
  rq.input('card', sql.NVarChar(50), c)
  const ex = String(excludeCode ?? '').trim()
  if (ex) rq.input('ex', sql.NVarChar(50), ex)
  const r = await rq.query(`
    SELECT TOP (1) LTRIM(RTRIM(CAST(s.code AS NVARCHAR(50)))) AS code
    FROM ${HR_STAFF_FROM} AS s
    WHERE LTRIM(RTRIM(ISNULL(s.card_number, N''))) = @card
      AND LTRIM(RTRIM(ISNULL(s.del, N'0'))) <> N'1'
      AND LTRIM(RTRIM(ISNULL(s.status, N''))) <> N'离职'
      ${ex ? ' AND LTRIM(RTRIM(CAST(s.code AS NVARCHAR(50)))) <> @ex' : ''}
  `)
  const row = r.recordset?.[0]
  const hit = row?.code != null ? String(row.code).trim() : ''
  return hit || null
}

/**
 * v1.1.2：批量更新 Excel 字段清洗（统一为字符串并去首尾空格）
 * @param {any} v
 */
function normalizeExcelCellString(v) {
  const s = String(v ?? '').replace(/\u00a0/g, ' ').trim()
  return s
}

/**
 * v1.1.0：员工档案编码生成
 * 规则：YYYYMMDD + 两位流水号（01..99）
 * - 并发安全：SERIALIZABLE + UPDLOCK/HOLDLOCK 锁住当天前缀范围，避免重复
 * @param {import('mssql').ConnectionPool|import('mssql').Transaction} poolOrTx
 * @param {string} yyyymmdd
 */
async function allocateNextStaffCode(poolOrTx, yyyymmdd) {
  const prefix = String(yyyymmdd ?? '').trim()
  if (!/^\d{8}$/.test(prefix)) {
    throw new Error('日期前缀不合法（期望 YYYYMMDD）')
  }
  const req = poolOrTx.request()
  req.input('prefix', sql.NVarChar(8), prefix)
  const r = await req.query(`
    SELECT MAX(CAST(RIGHT(LTRIM(RTRIM(s.code)), 2) AS INT)) AS maxSeq
    FROM ${HR_STAFF_FROM} AS s WITH (UPDLOCK, HOLDLOCK)
    WHERE
      LEN(LTRIM(RTRIM(ISNULL(s.code, N'')))) = 10
      AND LEFT(LTRIM(RTRIM(s.code)), 8) = @prefix
      AND PATINDEX(N'%[^0-9]%', LTRIM(RTRIM(s.code))) = 0
  `)
  const maxSeqRaw = r.recordset?.[0]?.maxSeq
  const maxSeq = maxSeqRaw == null ? 0 : Number(maxSeqRaw)
  const safeMax = Number.isFinite(maxSeq) && maxSeq > 0 ? maxSeq : 0
  const next = safeMax + 1
  if (next < 1 || next > 99) {
    throw new Error('当天员工档案编码流水号已用尽（01-99）')
  }
  return `${prefix}${String(next).padStart(2, '0')}`
}

/**
 * v1.0.9：按 code 读取一条（只查你指定的有效字段）
 * @param {import('mssql').ConnectionPool} pool
 * @param {string} codeRaw
 */
async function fetchStaffByCode(pool, codeRaw) {
  const code = String(codeRaw ?? '').trim()
  if (!code) return null
  const colset = await getHrStaffColumnSet(pool)
  const extraSelect = []
  if (colset.has('uid')) extraSelect.push('s.uid AS uid')
  if (colset.has('uname')) extraSelect.push('s.uname AS uname')
  if (colset.has('utruename')) extraSelect.push('s.utruename AS utruename')
  if (colset.has('addtime')) extraSelect.push('s.addtime AS addtime')
  if (colset.has('status')) extraSelect.push('s.status AS status')
  if (colset.has('leave_date')) extraSelect.push('s.leave_date AS leave_date')

  const r = await pool.request().input('code', sql.NVarChar(50), code).query(`
    SELECT TOP (1)
      s.id AS id,
      s.code AS code,
      s.new_code AS new_code,
      s.name AS name,
      s.sex AS sex,
      s.nation AS nation,
      s.highest AS highest,
      s.yn_firend AS yn_firend,
      s.birth AS birth,
      s.in_bm AS in_bm,
      s.card_number AS card_number,
      s.join_department AS join_department,
      s.position AS position,
      s.meal_type AS meal_type,
      s.yn_history AS yn_history,
      s.remark AS remark,
      s.intime AS intime,
      s.pass AS pass,
      s.del AS del
      ${extraSelect.length ? `,\n      ${extraSelect.join(',\n      ')}` : ''}
    FROM ${HR_STAFF_FROM} AS s
    WHERE s.code = @code
  `)
  return r.recordset?.[0] ?? null
}

/**
 * v1.1.2：按 id 读取员工（用于办理离职）
 * @param {import('mssql').ConnectionPool|import('mssql').Transaction} poolOrTx
 * @param {number} idRaw
 */
async function fetchStaffById(poolOrTx, idRaw) {
  const id = Number(idRaw)
  if (!Number.isFinite(id) || id <= 0) return null
  const r = await poolOrTx.request().input('id', sql.Int, Math.floor(id)).query(`
    SELECT TOP (1)
      s.id AS id,
      s.code AS code,
      s.name AS name,
      s.pass AS pass,
      s.del AS del,
      s.status AS status,
      s.leave_date AS leave_date,
      s.leave_reason AS leave_reason,
      s.is_blacklist AS is_blacklist,
      s.blacklist_reason AS blacklist_reason
    FROM ${HR_STAFF_FROM} AS s
    WHERE s.id = @id
  `)
  return r.recordset?.[0] ?? null
}

/**
 * v1.1.2：按姓名查询员工列表（允许重名）
 * @param {import('mssql').ConnectionPool} pool
 * @param {string} nameRaw
 */
async function fetchStaffListByName(pool, nameRaw) {
  const name = String(nameRaw ?? '').trim()
  if (!name) return []
  const r = await pool.request().input('name', sql.NVarChar(50), name).query(`
    SELECT
      s.code AS code,
      s.name AS name,
      s.pass AS pass
    FROM ${HR_STAFF_FROM} AS s
    WHERE LTRIM(RTRIM(ISNULL(s.name, N''))) = LTRIM(RTRIM(@name))
    ORDER BY s.code DESC
  `)
  return r.recordset ?? []
}

/**
 * v1.1.2：按「部门名称」找唯一顶级部门 code（必须唯一、且已审核、且未删除）
 * @param {import('mssql').ConnectionPool} pool
 * @param {string} deptNameRaw
 */
async function fetchUniqueAuditedTopDeptByName(pool, deptNameRaw) {
  const deptName = String(deptNameRaw ?? '').trim()
  if (!deptName) return { ok: false, reason: '部门为空', row: null }
  const r = await pool.request().input('name', sql.NVarChar(100), deptName).query(`
    SELECT TOP (2)
      d.code AS code,
      d.name AS name,
      d.ParentID AS ParentID,
      d.pass AS pass,
      d.del AS del
    FROM ${HR_LEGACY_DEPT_FROM} AS d
    WHERE
      (ISNULL(d.del, N'') = N'' OR d.del = N'0')
      AND LTRIM(RTRIM(ISNULL(d.name, N''))) = LTRIM(RTRIM(@name))
      AND (d.ParentID IS NULL OR LTRIM(RTRIM(ISNULL(d.ParentID, N''))) IN (N'', N'0'))
      AND LTRIM(RTRIM(CAST(ISNULL(d.pass, N'') AS nvarchar(10)))) = N'1'
    ORDER BY d.code
  `)
  const rows = r.recordset ?? []
  if (rows.length === 0) return { ok: false, reason: '部门不存在/未审核/已删除', row: null }
  if (rows.length > 1) return { ok: false, reason: '部门名称重复（匹配到多条顶级部门）', row: null }
  return { ok: true, reason: '', row: rows[0] }
}

/**
 * v1.1.2：按「岗位名称 + 所属部门 code」找唯一岗位 code（必须唯一、且已审核、且未删除）
 * @param {import('mssql').ConnectionPool} pool
 * @param {string} deptCodeRaw
 * @param {string} postNameRaw
 */
async function fetchUniqueAuditedPostByDeptAndName(pool, deptCodeRaw, postNameRaw) {
  const deptCode = String(deptCodeRaw ?? '').trim()
  const postName = String(postNameRaw ?? '').trim()
  if (!deptCode) return { ok: false, reason: '部门编码为空', row: null }
  if (!postName) return { ok: false, reason: '岗位为空', row: null }
  const r = await pool
    .request()
    .input('pid', sql.NVarChar(50), deptCode)
    .input('name', sql.NVarChar(100), postName)
    .query(`
      SELECT TOP (2)
        d.code AS code,
        d.name AS name,
        d.ParentID AS ParentID,
        d.pass AS pass,
        d.del AS del
      FROM ${HR_LEGACY_DEPT_FROM} AS d
      WHERE
        (ISNULL(d.del, N'') = N'' OR d.del = N'0')
        AND LTRIM(RTRIM(ISNULL(d.ParentID, N''))) = LTRIM(RTRIM(@pid))
        AND LTRIM(RTRIM(ISNULL(d.name, N''))) = LTRIM(RTRIM(@name))
        AND LTRIM(RTRIM(CAST(ISNULL(d.pass, N'') AS nvarchar(10)))) = N'1'
      ORDER BY d.code
    `)
  const rows = r.recordset ?? []
  if (rows.length === 0) return { ok: false, reason: '岗位不存在/未审核/已删除（请确认岗位挂在该部门下）', row: null }
  if (rows.length > 1) return { ok: false, reason: '岗位名称重复（同部门下匹配到多条岗位）', row: null }
  return { ok: true, reason: '', row: rows[0] }
}

/**
 * v1.0.9：员工分页列表（只选有效字段，避免扫空字段）
 *
 * 查询优先级（按你要求）：
 * - 先 name 模糊（只要 name 有值就走 LIKE）
 * - 再 code 精确
 * - 再 card_number 精确
 *
 * 参数：
 * - page（默认 1）
 * - pageSize（默认 20）
 * - pass（可选，默认 '1' 已审核；'0' 未审核）
 * - include_leaved（仅当 del=0 时生效）：'0' 排除离职；'1' 仅 status=离职；'all' 不按 status 筛选（兼容）
 * - name（可选，模糊）
 * - code（可选，精确）
 * - card_number（可选，精确）
 *
 * 返回：{ list, total }（字段名保持原样小写）
 */
app.get('/api/hr/staff', async (req, res) => {
  try {
    const pageRaw = req.query?.page
    const pageSizeRaw = req.query?.pageSize
    const page = Number(pageRaw ?? 1)
    const pageSize = Number(pageSizeRaw ?? 20)
    const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1
    const safePageSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.min(Math.floor(pageSize), 200) : 20
    const offset = (safePage - 1) * safePageSize

    const nameRaw = String(req.query?.name ?? '').trim()
    const codeRaw = String(req.query?.code ?? '').trim()
    const cardRaw = String(req.query?.card_number ?? '').trim()

    const hasName = nameRaw.length > 0
    const hasCode = !hasName && codeRaw.length > 0
    const hasCard = !hasName && !hasCode && cardRaw.length > 0

    /** 与部门列表一致：默认只看已审核 pass='1'；传 pass=0 只看未审核 */
    const passRaw = String(req.query?.pass ?? '1').trim()
    const pass = passRaw === '0' ? '0' : '1'
    const wherePass = ' AND LTRIM(RTRIM(ISNULL(s.pass, N\'\'))) = @pass'

    /** v1.1.2：del=0 默认只看未删除；传 del=1 显示已删除 */
    const delRaw = String(req.query?.del ?? '0').trim()
    const del = delRaw === '1' ? '1' : '0'
    const whereDel = ' AND LTRIM(RTRIM(ISNULL(s.del, N\'0\'))) = @del'

    /** del=1 时不按 status 筛；del=0 时 include_leaved：0=排除离职 1=仅离职 all=不筛 */
    let whereStatus = ''
    if (del !== '1') {
      const scopeRaw = String(req.query?.include_leaved ?? '0').trim().toLowerCase()
      if (scopeRaw === '0' || scopeRaw === 'false') {
        whereStatus = ` AND LTRIM(RTRIM(ISNULL(s.status, N''))) <> N'离职'`
      } else if (scopeRaw === '1' || scopeRaw === 'true') {
        whereStatus = ` AND LTRIM(RTRIM(ISNULL(s.status, N''))) = N'离职'`
      } else {
        whereStatus = ''
      }
    }

    const pool = await getPool()

    let whereSql = ''
    const totalReq = pool.request()
    const listReq = pool.request()
    totalReq.input('pass', sql.NVarChar(10), pass)
    listReq.input('pass', sql.NVarChar(10), pass)
    totalReq.input('del', sql.NVarChar(10), del)
    listReq.input('del', sql.NVarChar(10), del)

    if (hasName) {
      whereSql = `WHERE s.name LIKE @nameLike${wherePass}${whereDel}${whereStatus}`
      totalReq.input('nameLike', sql.NVarChar(200), `%${nameRaw}%`)
      listReq.input('nameLike', sql.NVarChar(200), `%${nameRaw}%`)
    } else if (hasCode) {
      whereSql = `WHERE s.code = @code${wherePass}${whereDel}${whereStatus}`
      totalReq.input('code', sql.NVarChar(50), codeRaw)
      listReq.input('code', sql.NVarChar(50), codeRaw)
    } else if (hasCard) {
      whereSql = `WHERE s.card_number = @cardNumber${wherePass}${whereDel}${whereStatus}`
      totalReq.input('cardNumber', sql.NVarChar(50), cardRaw)
      listReq.input('cardNumber', sql.NVarChar(50), cardRaw)
    } else {
      whereSql = `WHERE 1 = 1${wherePass}${whereDel}${whereStatus}`
    }

    const totalResult = await totalReq.query(`
      SELECT COUNT(1) AS total
      FROM ${HR_STAFF_FROM} AS s
      ${whereSql}
    `)
    const total = Number(totalResult.recordset?.[0]?.total ?? 0)

    const safeOffset = Math.max(0, Math.floor(Number(offset)) || 0)
    const safeFetch = Math.max(1, Math.min(200, Math.floor(Number(safePageSize)) || 20))

    const listSelect = `
      SELECT
        s.id AS id,
        s.code AS code,
        s.new_code AS new_code,
        s.name AS name,
        s.sex AS sex,
        s.nation AS nation,
        s.highest AS highest,
        s.yn_firend AS yn_firend,
        s.birth AS birth,
        s.in_bm AS in_bm,
        s.card_number AS card_number,
        s.join_department AS join_department,
        s.position AS position,
        s.meal_type AS meal_type,
        s.yn_history AS yn_history,
        s.remark AS remark,
        s.intime AS intime,
        s.pass AS pass,
        s.del AS del,
        ISNULL(NULLIF(LTRIM(RTRIM(ISNULL(s.status, N''))), N''), N'在职') AS status,
        s.leave_date AS leave_date
      FROM ${HR_STAFF_FROM} AS s
      ${whereSql}
      ORDER BY s.code
    `

    let listResult
    try {
      listResult = await listReq.query(`
        ${listSelect}
        OFFSET ${safeOffset} ROWS
        FETCH NEXT ${safeFetch} ROWS ONLY
      `)
    } catch (pageErr) {
      const msg = String(pageErr?.message ?? pageErr?.originalError?.message ?? '')
      const shouldFallback =
        msg.includes('Invalid usage of the option NEXT') ||
        msg.includes("Incorrect syntax near 'OFFSET'") ||
        msg.toLowerCase().includes('offset') ||
        msg.toLowerCase().includes('fetch')
      if (!shouldFallback) throw pageErr

      const startRow = safeOffset + 1
      const endRow = safeOffset + safeFetch
      const fb = pool.request()
      fb.input('startRow', sql.Int, startRow)
      fb.input('endRow', sql.Int, endRow)
      fb.input('pass', sql.NVarChar(10), pass)
      fb.input('del', sql.NVarChar(10), del)
      if (hasName) fb.input('nameLike', sql.NVarChar(200), `%${nameRaw}%`)
      if (hasCode) fb.input('code', sql.NVarChar(50), codeRaw)
      if (hasCard) fb.input('cardNumber', sql.NVarChar(50), cardRaw)

      listResult = await fb.query(`
        SELECT id, code, new_code, name, sex, nation, highest, yn_firend, birth, in_bm, card_number, join_department, position, meal_type, yn_history, remark, intime, pass, del, status, leave_date
        FROM (
          SELECT
            s.id AS id,
            s.code AS code,
            s.new_code AS new_code,
            s.name AS name,
            s.sex AS sex,
            s.nation AS nation,
            s.highest AS highest,
            s.yn_firend AS yn_firend,
            s.birth AS birth,
            s.in_bm AS in_bm,
            s.card_number AS card_number,
            s.join_department AS join_department,
            s.position AS position,
            s.meal_type AS meal_type,
            s.yn_history AS yn_history,
            s.remark AS remark,
            s.intime AS intime,
            s.pass AS pass,
            s.del AS del,
            ISNULL(NULLIF(LTRIM(RTRIM(ISNULL(s.status, N''))), N''), N'在职') AS status,
            s.leave_date AS leave_date,
            ROW_NUMBER() OVER (ORDER BY s.code) AS rn
          FROM ${HR_STAFF_FROM} AS s
          ${whereSql}
        ) AS x
        WHERE x.rn BETWEEN @startRow AND @endRow
      `)
    }

    res.json({ code: 200, msg: 'success', data: { list: listResult.recordset ?? [], total } })
  } catch (err) {
    console.error('GET /api/hr/staff 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库查询失败')
    res.status(500).json({ code: 500, msg: `读取员工档案失败：${detail}`, data: null })
  }
})

/**
 * v1.1.0：只读核验（给 RPA 截图用）
 * GET /api/hr/staff/debug-code?name=xxx&card_number=1234567890
 */
app.get('/api/hr/staff/debug-code', async (req, res) => {
  try {
    const name = String(req.query?.name ?? '').trim()
    const card = String(req.query?.card_number ?? '').trim()
    if (!name || !card) {
      res.status(400).json({ code: 400, msg: 'name 与 card_number 不能为空', data: null })
      return
    }

    const today = new Date()
    const p = (n) => String(n).padStart(2, '0')
    const prefix = `${today.getFullYear()}${p(today.getMonth() + 1)}${p(today.getDate())}`

    const pool = await getPool()
    const reqMax = pool.request()
    reqMax.input('prefix', sql.NVarChar(8), prefix)
    const maxR = await reqMax.query(`
      SELECT MAX(CAST(RIGHT(LTRIM(RTRIM(s.code)), 2) AS INT)) AS maxSeq
      FROM ${HR_STAFF_FROM} AS s
      WHERE
        LEN(LTRIM(RTRIM(ISNULL(s.code, N'')))) = 10
        AND LEFT(LTRIM(RTRIM(s.code)), 8) = @prefix
        AND PATINDEX(N'%[^0-9]%', LTRIM(RTRIM(s.code))) = 0
    `)
    const maxSeqRaw = maxR.recordset?.[0]?.maxSeq
    const maxSeq = maxSeqRaw == null ? 0 : Number(maxSeqRaw)
    const safeMax = Number.isFinite(maxSeq) && maxSeq > 0 ? maxSeq : 0
    const expectedNext = `${prefix}${String(safeMax + 1).padStart(2, '0')}`

    const q = pool.request()
    q.input('name', sql.NVarChar(50), name)
    q.input('card', sql.NVarChar(50), card)
    const r = await q.query(`
      SELECT TOP (1)
        s.code, s.new_code, s.name, s.card_number, s.join_department, s.position,
        s.sex, s.nation, s.highest, s.yn_firend, s.birth,
        s.meal_type, s.yn_history, s.remark, s.intime, s.pass, s.del
      FROM ${HR_STAFF_FROM} AS s
      WHERE LTRIM(RTRIM(ISNULL(s.name, N''))) = LTRIM(RTRIM(@name))
        AND LTRIM(RTRIM(ISNULL(s.card_number, N''))) = LTRIM(RTRIM(@card))
      ORDER BY s.code DESC
    `)

    res.json({
      code: 200,
      msg: 'success',
      data: { todayPrefix: prefix, expectedNext, found: r.recordset?.[0] ?? null },
    })
  } catch (err) {
    console.error('GET /api/hr/staff/debug-code 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库查询失败')
    res.status(500).json({ code: 500, msg: `核验失败：${detail}`, data: null })
  }
})

/**
 * v1.1.2：员工档案详情（按 code）
 * GET /api/hr/staff/:code
 * - 说明：用于前端「查看」详情；允许查看已删除记录
 */
app.get('/api/hr/staff/:code', async (req, res) => {
  try {
    const code = String(req.params?.code ?? '').trim()
    if (!code) {
      res.status(400).json({ code: 400, msg: 'code 不能为空', data: null })
      return
    }
    const pool = await getPool()
    const row = await fetchStaffByCode(pool, code)
    if (!row) {
      res.status(404).json({ code: 404, msg: '未找到该员工', data: null })
      return
    }
    res.json({ code: 200, msg: 'success', data: row })
  } catch (err) {
    console.error('GET /api/hr/staff/:code 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库查询失败')
    res.status(500).json({ code: 500, msg: `读取员工详情失败：${detail}`, data: null })
  }
})

/**
 * v1.1.0：新增员工（按 Excel 字段调整 + 字段映射到旧表）
 *
 * 核心规则：
 * - code：禁止手动输入。服务端按 YYYYMMDD + 两位流水号生成（如 2024041601）
 * - new_code：新档案编码（可选，手动输入）
 * - card_number：卡号（必填，固定 10 位数字；唯一性仅相对「未删除且非离职」员工）
 * - join_department / position：入职部门/岗位（前端从 HR_Departments 实时下拉）
 * - sex / meal_type（饭餐类型：员工餐、管理餐；空则按员工餐）/ yn_history（是否曾在我司应聘：是、否）
 * - intime：默认当天（前端可改）
 *
 * body: { name, new_code, card_number, join_department, position, sex, nation, highest, yn_firend, birth, meal_type, yn_history, remark, intime }
 * - pass 默认 '0'（未审核）
 */
app.post('/api/hr/staff', async (req, res) => {
  try {
    const me = getCurrentUserFromReq(req)
    const body = req.body ?? {}
    const name = String(body.name ?? '').trim()
    const card = String(body.card_number ?? '').trim()
    const newCode = String(body.new_code ?? '').trim()
    const joinDepartment = String(body.join_department ?? '').trim()
    const position = String(body.position ?? '').trim()
    const sex = String(body.sex ?? '').trim()
    const nation = String(body.nation ?? '').trim()
    const highest = String(body.highest ?? '').trim()
    const ynFirend = String(body.yn_firend ?? '').trim()
    const birthRaw = String(body.birth ?? '').trim()
    const mealType = String(body.meal_type ?? '').trim() || '员工餐'
    const ynHistory = String(body.yn_history ?? '').trim()
    const remark = String(body.remark ?? '').trim()
    const intimeRaw = String(body.intime ?? '').trim()

    if (!name) {
      res.status(400).json({ code: 400, msg: 'name（姓名）不能为空', data: null })
      return
    }
    if (!/^\d{10}$/.test(card)) {
      res.status(400).json({ code: 400, msg: 'card_number（卡号）必须是 10 位数字', data: null })
      return
    }

    const pool = await getPool()
    const colset = await getHrStaffColumnSet(pool)
    const tx = new sql.Transaction(pool)
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE)
    try {
      const conflictCard = await findActiveStaffCodeByCardNumber(tx, card, '')
      if (conflictCard) {
        await tx.rollback()
        res.status(400).json({ code: 400, msg: `该卡号已被在职员工占用（工号：${conflictCard}）`, data: null })
        return
      }

      const today = new Date()
      const p = (n) => String(n).padStart(2, '0')
      const yyyymmdd = `${today.getFullYear()}${p(today.getMonth() + 1)}${p(today.getDate())}`
      const code = await allocateNextStaffCode(tx, yyyymmdd)
      const intime = intimeRaw || `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`

      // v1.1.1：新增员工写入创建人 + 创建时间（按列存在情况兼容老库）
      const uid = me?.userId != null ? String(me.userId) : ''
      const uname = String(me?.userCode ?? '').trim()
      const utruename = String(me?.userName ?? '').trim()
      const addtimeNow = legacyDeptNowString()

      const ins = new sql.Request(tx)
      ins.input('code', sql.NVarChar(50), code)
      ins.input('new_code', sql.NVarChar(50), newCode || null)
      ins.input('name', sql.NVarChar(50), name)
      ins.input('card_number', sql.NVarChar(50), card)
      ins.input('join_department', sql.NVarChar(50), joinDepartment || null)
      ins.input('position', sql.NVarChar(50), position || null)
      ins.input('sex', sql.NVarChar(50), sex || null)
      ins.input('nation', sql.NVarChar(50), nation || null)
      ins.input('highest', sql.NVarChar(50), highest || null)
      ins.input('yn_firend', sql.NVarChar(50), ynFirend || null)
      ins.input('birth', sql.NVarChar(50), birthRaw || null)
      ins.input('meal_type', sql.NVarChar(50), mealType || null)
      ins.input('yn_history', sql.NVarChar(50), ynHistory || null)
      ins.input('remark', sql.NVarChar(500), remark || null)
      ins.input('intime', sql.NVarChar(50), intime || null)

      /** @type {string[]} */
      const cols = [
        'code',
        'new_code',
        'name',
        'card_number',
        'join_department',
        'position',
        'sex',
        'nation',
        'highest',
        'yn_firend',
        'birth',
        'meal_type',
        'yn_history',
        'remark',
        'intime',
        'pass',
        'del',
      ]
      /** @type {string[]} */
      const vals = [
        '@code',
        '@new_code',
        '@name',
        '@card_number',
        '@join_department',
        '@position',
        '@sex',
        '@nation',
        '@highest',
        '@yn_firend',
        '@birth',
        '@meal_type',
        '@yn_history',
        '@remark',
        '@intime',
        "N'0'",
        "N'0'",
      ]

      if (colset.has('uname')) {
        ins.input('uname', sql.NVarChar(50), uname || null)
        cols.push('uname')
        vals.push('@uname')
      }
      if (colset.has('uid')) {
        ins.input('uid', sql.NVarChar(50), uid || null)
        cols.push('uid')
        vals.push('@uid')
      }
      if (colset.has('utruename')) {
        ins.input('utruename', sql.NVarChar(50), utruename || null)
        cols.push('utruename')
        vals.push('@utruename')
      }
      if (colset.has('addtime')) {
        ins.input('addtime', sql.NVarChar(50), addtimeNow || null)
        cols.push('addtime')
        vals.push('@addtime')
      }

      await ins.query(`
        INSERT INTO ${HR_STAFF_FROM} (${cols.join(', ')})
        VALUES (${vals.join(', ')})
      `)

      await tx.commit()
      const row = await fetchStaffByCode(pool, code)
      res.json({ code: 200, msg: 'success', data: row })
    } catch (innerErr) {
      try {
        await tx.rollback()
      } catch {
        // ignore
      }
      throw innerErr
    }
  } catch (err) {
    console.error('POST /api/hr/staff 失败：', err)
    const n = Number(err?.number ?? err?.originalError?.number ?? 0)
    if (n === 2627 || n === 2601) {
      res.status(400).json({ code: 400, msg: 'code 已存在，不能重复', data: null })
      return
    }
    const detail = String(err?.message ?? '数据库写入失败')
    res.status(500).json({ code: 500, msg: `新增员工失败：${detail}`, data: null })
  }
})

/**
 * v1.0.9：编辑员工（已审核 pass='1' 禁止）
 * body: { code, name, sex, nation, highest, yn_firend, birth, in_bm, card_number, join_department, position, meal_type, yn_history, remark, intime, new_code }
 * - card_number：若填写 10 位数字，唯一性仅相对「未删除且非离职」员工（不含本人工号）
 */
app.put('/api/hr/staff', async (req, res) => {
  try {
    const body = req.body ?? {}
    const code = String(body.code ?? '').trim()
    const name = String(body.name ?? '').trim()
    const sex = String(body.sex ?? '').trim()
    const nation = String(body.nation ?? '').trim()
    const highest = String(body.highest ?? '').trim()
    const ynFirend = String(body.yn_firend ?? '').trim()
    const birth = String(body.birth ?? '').trim()
    const inBm = String(body.in_bm ?? '').trim()
    const card = String(body.card_number ?? '').trim()
    const joinDepartment = String(body.join_department ?? '').trim()
    const position = String(body.position ?? '').trim()
    const mealType = String(body.meal_type ?? '').trim() || '员工餐'
    const ynHistory = String(body.yn_history ?? '').trim()
    const remark = String(body.remark ?? '').trim()
    const intime = String(body.intime ?? '').trim()
    const newCode = String(body.new_code ?? '').trim()

    if (!code) {
      res.status(400).json({ code: 400, msg: 'code（工号）不能为空', data: null })
      return
    }
    if (!name) {
      res.status(400).json({ code: 400, msg: 'name（姓名）不能为空', data: null })
      return
    }

    const pool = await getPool()
    const existing = await fetchStaffByCode(pool, code)
    if (!existing) {
      res.status(404).json({ code: 404, msg: '未找到该员工', data: null })
      return
    }
    if (staffPassIsAudited(existing.pass)) {
      res.status(400).json({ code: 400, msg: HR_STAFF_AUDIT_LOCK_MSG, data: null })
      return
    }

    if (/^\d{10}$/.test(card)) {
      const conflictCard = await findActiveStaffCodeByCardNumber(pool, card, code)
      if (conflictCard) {
        res.status(400).json({ code: 400, msg: `该卡号已被在职员工占用（工号：${conflictCard}）`, data: null })
        return
      }
    }

    const upd = pool.request()
    upd.input('code', sql.NVarChar(50), code)
    upd.input('name', sql.NVarChar(50), name)
    upd.input('sex', sql.NVarChar(50), sex || null)
    upd.input('nation', sql.NVarChar(50), nation || null)
    upd.input('highest', sql.NVarChar(50), highest || null)
    upd.input('yn_firend', sql.NVarChar(50), ynFirend || null)
    upd.input('birth', sql.NVarChar(50), birth || null)
    upd.input('in_bm', sql.NVarChar(100), inBm || null)
    upd.input('card_number', sql.NVarChar(50), card || null)
    upd.input('join_department', sql.NVarChar(50), joinDepartment || null)
    upd.input('position', sql.NVarChar(50), position || null)
    upd.input('meal_type', sql.NVarChar(50), mealType || null)
    upd.input('yn_history', sql.NVarChar(50), ynHistory || null)
    upd.input('remark', sql.NVarChar(500), remark || null)
    upd.input('intime', sql.NVarChar(50), intime || null)
    upd.input('new_code', sql.NVarChar(50), newCode || null)

    await upd.query(`
      UPDATE s
      SET
        s.name = @name,
        s.sex = @sex,
        s.nation = @nation,
        s.highest = @highest,
        s.yn_firend = @yn_firend,
        s.birth = @birth,
        s.in_bm = @in_bm,
        s.card_number = @card_number,
        s.join_department = @join_department,
        s.position = @position,
        s.meal_type = @meal_type,
        s.yn_history = @yn_history,
        s.remark = @remark,
        s.intime = @intime,
        s.new_code = @new_code
      FROM ${HR_STAFF_FROM} AS s
      WHERE s.code = @code
    `)

    const row = await fetchStaffByCode(pool, code)
    res.json({ code: 200, msg: 'success', data: row })
  } catch (err) {
    console.error('PUT /api/hr/staff 失败：', err)
    const detail = String(err?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `修改员工失败：${detail}`, data: null })
  }
})

/**
 * v1.0.9：删除员工（已审核 pass='1' 禁止）
 */
app.delete('/api/hr/staff/:code', async (req, res) => {
  try {
    const code = String(req.params.code ?? '').trim()
    if (!code) {
      res.status(400).json({ code: 400, msg: 'code 不合法', data: null })
      return
    }

    const pool = await getPool()
    const existing = await fetchStaffByCode(pool, code)
    if (!existing) {
      res.status(404).json({ code: 404, msg: '未找到该员工', data: null })
      return
    }
    if (staffPassIsAudited(existing.pass)) {
      res.status(400).json({ code: 400, msg: HR_STAFF_AUDIT_LOCK_MSG, data: null })
      return
    }

    // v1.1.2：员工档案改为逻辑删除（del=1），便于恢复
    await pool.request().input('code', sql.NVarChar(50), code).query(`
      UPDATE s SET s.del = N'1'
      FROM ${HR_STAFF_FROM} AS s
      WHERE s.code = @code
    `)
    res.json({ code: 200, msg: 'success', data: { code } })
  } catch (err) {
    console.error('DELETE /api/hr/staff 失败：', err)
    const detail = String(err?.message ?? '数据库删除失败')
    res.status(500).json({ code: 500, msg: `删除员工失败：${detail}`, data: null })
  }
})

/**
 * v1.1.2：恢复员工档案（del=0）
 * body: { code }
 */
app.put('/api/hr/staff/restore', async (req, res) => {
  try {
    const body = req.body ?? {}
    const code = String(body.code ?? '').trim()
    if (!code) {
      res.status(400).json({ code: 400, msg: 'code 不能为空', data: null })
      return
    }

    const pool = await getPool()
    const existing = await fetchStaffByCode(pool, code)
    if (!existing) {
      res.status(404).json({ code: 404, msg: '未找到该员工', data: null })
      return
    }
    if (staffPassIsAudited(existing.pass)) {
      res.status(400).json({ code: 400, msg: HR_STAFF_AUDIT_LOCK_MSG, data: null })
      return
    }

    await pool.request().input('code', sql.NVarChar(50), code).query(`
      UPDATE s SET s.del = N'0'
      FROM ${HR_STAFF_FROM} AS s
      WHERE s.code = @code
    `)

    const row = await fetchStaffByCode(pool, code)
    res.json({ code: 200, msg: 'success', data: row })
  } catch (err) {
    console.error('PUT /api/hr/staff/restore 失败：', err)
    const detail = String(err?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `恢复员工失败：${detail}`, data: null })
  }
})

/**
 * v1.1.2：办理离职（事务：员工状态 + 离职日期 + 封禁账号）
 * PUT /api/hr/staff/leave/:id
 */
app.put('/api/hr/staff/leave/:id', async (req, res) => {
  try {
    const id = Number(req.params?.id)
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ code: 400, msg: 'id 不合法', data: null })
      return
    }

    const body = req.body ?? {}
    const leaveDateRaw = String(body.leave_date ?? '').trim()
    const leaveReason = String(body.leave_reason ?? '').trim()
    const isBlacklist = Number(body.is_blacklist ?? 0) === 1 ? 1 : 0
    const blacklistReason = String(body.blacklist_reason ?? '').trim()

    if (!leaveDateRaw) {
      res.status(400).json({ code: 400, msg: 'leave_date（离职日期）不能为空', data: null })
      return
    }
    // 允许 YYYY-MM-DD 或可被 Date 解析的字符串
    const leaveDate = new Date(leaveDateRaw)
    if (Number.isNaN(leaveDate.getTime())) {
      res.status(400).json({ code: 400, msg: 'leave_date（离职日期）格式不正确', data: null })
      return
    }
    if (!leaveReason) {
      res.status(400).json({ code: 400, msg: 'leave_reason（离职原因）不能为空', data: null })
      return
    }
    if (isBlacklist === 1 && !blacklistReason) {
      res.status(400).json({ code: 400, msg: 'blacklist_reason（黑名单备注）不能为空', data: null })
      return
    }

    const pool = await getPool()
    const staffColset = await getHrStaffColumnSet(pool)
    const userColset = await getSysUsersColumnSet(pool)
    if (
      !staffColset.has('status') ||
      !staffColset.has('leave_date') ||
      !staffColset.has('leave_reason') ||
      !staffColset.has('is_blacklist') ||
      !staffColset.has('blacklist_reason')
    ) {
      res.status(400).json({
        code: 400,
        msg:
          '员工表缺少离职/黑名单字段，请先执行迁移：npm run migrate:hr-staff-leave-fields 与 npm run migrate:hr-staff-leave-blacklist-fields',
        data: null,
      })
      return
    }
    if (!userColset.has('is_active')) {
      res.status(400).json({
        code: 400,
        msg: 'Sys_Users 表缺少 is_active 字段，请先执行迁移：npm run migrate:hr-staff-leave-fields',
        data: null,
      })
      return
    }

    const tx = new sql.Transaction(pool)
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE)
    let staffRow = null
    try {
      staffRow = await fetchStaffById(tx, id)
      if (!staffRow) {
        await tx.rollback()
        res.status(404).json({ code: 404, msg: '未找到该员工', data: null })
        return
      }
      if (String(staffRow?.del ?? '').trim() === '1') {
        await tx.rollback()
        res.status(400).json({ code: 400, msg: '该员工已删除，不能办理离职', data: null })
        return
      }

      const staffCode = String(staffRow?.code ?? '').trim()
      const staffName = String(staffRow?.name ?? '').trim()
      if (!staffCode) {
        await tx.rollback()
        res.status(400).json({ code: 400, msg: '员工工号为空，无法办理离职', data: null })
        return
      }

      // 关联系统账号（可选）：并非每个员工都有 Sys_Users 记录
      const userCheck = await tx
        .request()
        .input('v', sql.NVarChar(50), staffCode)
        .query(`
          SELECT TOP (1) u.UserID, u.UserCode, u.Account
          FROM Sys_Users AS u
          WHERE u.Account = @v OR u.UserCode = @v
          ORDER BY u.UserID DESC
        `)
      const userRow = userCheck.recordset?.[0]
      const account = userRow ? String(userRow?.Account ?? userRow?.UserCode ?? '').trim() || staffCode : ''

      await tx
        .request()
        .input('id', sql.Int, Math.floor(id))
        .input('leave_date', sql.DateTime, leaveDate)
        .input('leave_reason', sql.NVarChar(200), leaveReason)
        .input('is_blacklist', sql.Int, isBlacklist)
        .input('blacklist_reason', sql.NVarChar(200), isBlacklist === 1 ? blacklistReason : null)
        .query(`
          UPDATE s
          SET s.status = N'离职',
              s.leave_date = @leave_date,
              s.leave_reason = @leave_reason,
              s.is_blacklist = @is_blacklist,
              s.blacklist_reason = @blacklist_reason
          FROM ${HR_STAFF_FROM} AS s
          WHERE s.id = @id
        `)

      // 若存在关联账号，则封禁；不存在则跳过（不影响员工离职落库）
      if (userRow) {
        const updUser = await tx
          .request()
          .input('v', sql.NVarChar(50), staffCode)
          .query(`
            UPDATE u
            SET u.is_active = 0
            FROM Sys_Users AS u
            WHERE u.Account = @v OR u.UserCode = @v
          `)
        const affected = Number(updUser?.rowsAffected?.[0] ?? 0)
        if (affected <= 0) {
          await tx.rollback()
          res.status(500).json({ code: 500, msg: '封禁账号失败：未更新到 Sys_Users 记录', data: null })
          return
        }
      }

      await tx.commit()

      // 给操作审计中间件使用：落库时写成你要求的中文语义
      if (isBlacklist === 1) {
        req.__auditLeaveContent = `${staffName || staffCode} 已办理离职并列入黑名单，原因：${blacklistReason}`
      } else if (account) {
        req.__auditLeaveContent = `办理了工号为[${staffCode}]的员工离职，封禁其登录账号[${account}]`
      } else {
        req.__auditLeaveContent = `办理了工号为[${staffCode}]的员工离职（该员工未关联系统登录账号，已跳过封禁）`
      }

      await writeLog(req, '办理员工离职', String(req.__auditLeaveContent), { targetTable: 'HR_staff' })

      const fresh = await fetchStaffById(pool, id)
      res.json({ code: 200, msg: 'success', data: fresh })
    } catch (innerErr) {
      try {
        await tx.rollback()
      } catch {
        // ignore
      }
      throw innerErr
    }
  } catch (err) {
    console.error('PUT /api/hr/staff/leave/:id 失败：', err)
    const detail = String(err?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `办理离职失败：${detail}`, data: null })
  }
})

/**
 * v1.0.9：审核（pass='1'）
 */
app.put('/api/hr/staff/audit', async (req, res) => {
  try {
    const body = req.body ?? {}
    const code = String(body.code ?? '').trim()
    if (!code) {
      res.status(400).json({ code: 400, msg: 'code 不能为空', data: null })
      return
    }

    const pool = await getPool()
    const existing = await fetchStaffByCode(pool, code)
    if (!existing) {
      res.status(404).json({ code: 404, msg: '未找到该员工', data: null })
      return
    }
    if (staffPassIsAudited(existing.pass)) {
      res.status(400).json({ code: 400, msg: '当前已是已审核状态', data: null })
      return
    }

    await pool.request().input('code', sql.NVarChar(50), code).query(`
      UPDATE s SET s.pass = N'1'
      FROM ${HR_STAFF_FROM} AS s
      WHERE s.code = @code
    `)
    const row = await fetchStaffByCode(pool, code)
    res.json({ code: 200, msg: 'success', data: row })
  } catch (err) {
    console.error('PUT /api/hr/staff/audit 失败：', err)
    const detail = String(err?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `审核失败：${detail}`, data: null })
  }
})

/**
 * v1.0.9：反审（pass='0'）
 */
app.put('/api/hr/staff/unaudit', async (req, res) => {
  try {
    const body = req.body ?? {}
    const code = String(body.code ?? '').trim()
    if (!code) {
      res.status(400).json({ code: 400, msg: 'code 不能为空', data: null })
      return
    }

    const pool = await getPool()
    const existing = await fetchStaffByCode(pool, code)
    if (!existing) {
      res.status(404).json({ code: 404, msg: '未找到该员工', data: null })
      return
    }
    if (!staffPassIsAudited(existing.pass)) {
      res.status(400).json({ code: 400, msg: '当前为未审核状态，无需反审', data: null })
      return
    }

    await pool.request().input('code', sql.NVarChar(50), code).query(`
      UPDATE s SET s.pass = N'0'
      FROM ${HR_STAFF_FROM} AS s
      WHERE s.code = @code
    `)
    const row = await fetchStaffByCode(pool, code)
    res.json({ code: 200, msg: 'success', data: row })
  } catch (err) {
    console.error('PUT /api/hr/staff/unaudit 失败：', err)
    const detail = String(err?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `反审失败：${detail}`, data: null })
  }
})

/**
 * v1.1.2：批量更新（Excel：姓名 / 部门 / 岗位）
 *
 * 前端上传 xls/xlsx 文件，转换为 base64 传入（避免引入 multipart 上传中间件）
 * body: { fileName, fileBase64 }
 *
 * 关联规则（大白话）：
 * - 先用「姓名」在 Hr_staff 找员工（必须唯一）
 * - 再用「部门」在 HR_Departments 找顶级部门（必须唯一、且已审核、且未删除）
 * - 再用「岗位」在 HR_Departments 找岗位（必须挂在该部门下、且已审核、且未删除）
 * - 最后更新 Hr_staff：in_bm=部门名称（显示用）、join_department=部门code、position=岗位code
 * - 特权：仅本接口允许更新已审核员工（pass='1'），未审核则跳过
 */
app.post('/api/hr/staff/batch-update', async (req, res) => {
  try {
    const body = req.body ?? {}
    const fileName = String(body.fileName ?? '').trim()
    const fileBase64 = String(body.fileBase64 ?? '').trim()

    if (!fileBase64) {
      res.status(400).json({ code: 400, msg: 'fileBase64 不能为空', data: null })
      return
    }
    if (fileName && !/\.(xlsx|xls)$/i.test(fileName)) {
      res.status(400).json({ code: 400, msg: '仅支持上传 xlsx 或 xls 文件', data: null })
      return
    }

    let buffer
    try {
      buffer = Buffer.from(fileBase64, 'base64')
    } catch {
      res.status(400).json({ code: 400, msg: '文件内容解析失败（base64 不合法）', data: null })
      return
    }
    if (!buffer || buffer.length < 10) {
      res.status(400).json({ code: 400, msg: '文件内容为空或不完整', data: null })
      return
    }

    let wb
    try {
      wb = XLSX.read(buffer, { type: 'buffer' })
    } catch (e) {
      res.status(400).json({ code: 400, msg: `Excel 解析失败：${String(e?.message ?? e)}`, data: null })
      return
    }
    const sheetName = wb.SheetNames?.[0]
    if (!sheetName) {
      res.status(400).json({ code: 400, msg: 'Excel 中未找到工作表', data: null })
      return
    }
    const sheet = wb.Sheets?.[sheetName]
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
    if (!Array.isArray(rows) || rows.length < 2) {
      res.status(400).json({ code: 400, msg: 'Excel 内容为空（至少需要表头 + 1 行数据）', data: null })
      return
    }

    const header = (rows[0] ?? []).map((v) => normalizeExcelCellString(v))
    const idxName = header.findIndex((h) => h === '姓名')
    const idxDept = header.findIndex((h) => h === '部门')
    const idxPost = header.findIndex((h) => h === '岗位')
    if (idxName < 0 || idxDept < 0 || idxPost < 0) {
      res.status(400).json({
        code: 400,
        msg: '表头必须包含三列：姓名、部门、岗位（请检查第一行）',
        data: { header },
      })
      return
    }

    const pool = await getPool()

    /** @type {{rowNo:number,name:string,dept:string,post:string,code?:string,status:'success'|'failed'|'skipped',message:string}[]} */
    const details = []

    for (let i = 1; i < rows.length; i++) {
      const r = Array.isArray(rows[i]) ? rows[i] : []
      const name = normalizeExcelCellString(r[idxName])
      const dept = normalizeExcelCellString(r[idxDept])
      const post = normalizeExcelCellString(r[idxPost])
      const rowNo = i + 1

      // 空行直接跳过（不算失败）
      if (!name && !dept && !post) continue

      if (!name || !dept || !post) {
        details.push({ rowNo, name, dept, post, status: 'failed', message: '姓名/部门/岗位 不能为空' })
        continue
      }

      try {
        const staffList = await fetchStaffListByName(pool, name)
        if (!staffList.length) {
          details.push({ rowNo, name, dept, post, status: 'failed', message: '员工不存在（按姓名未匹配到）' })
          continue
        }

        const deptMatch = await fetchUniqueAuditedTopDeptByName(pool, dept)
        if (!deptMatch.ok) {
          details.push({ rowNo, name, dept, post, status: 'failed', message: deptMatch.reason })
          continue
        }
        const deptCode = String(deptMatch.row?.code ?? '').trim()
        if (!deptCode) {
          details.push({ rowNo, name, dept, post, status: 'failed', message: '部门编码为空，无法更新' })
          continue
        }

        const postMatch = await fetchUniqueAuditedPostByDeptAndName(pool, deptCode, post)
        if (!postMatch.ok) {
          details.push({ rowNo, name, dept, post, status: 'failed', message: postMatch.reason })
          continue
        }
        const postCode = String(postMatch.row?.code ?? '').trim()
        if (!postCode) {
          details.push({ rowNo, name, dept, post, status: 'failed', message: '岗位编码为空，无法更新' })
          continue
        }

        let updatedCount = 0
        for (const staffRow of staffList) {
          const staffCode = String(staffRow?.code ?? '').trim()
          if (!staffCode) {
            details.push({ rowNo, name, dept, post, status: 'failed', message: '员工工号为空，无法更新' })
            continue
          }
          if (!staffPassIsAudited(staffRow?.pass)) {
            details.push({
              rowNo,
              name,
              dept,
              post,
              code: staffCode,
              status: 'skipped',
              message: '员工未审核（pass!=1），已跳过',
            })
            continue
          }

          const upd = pool.request()
          upd.input('code', sql.NVarChar(50), staffCode)
          upd.input('in_bm', sql.NVarChar(100), dept)
          upd.input('join_department', sql.NVarChar(50), deptCode)
          upd.input('position', sql.NVarChar(50), postCode)
          await upd.query(`
            UPDATE s
            SET
              s.in_bm = @in_bm,
              s.join_department = @join_department,
              s.position = @position
            FROM ${HR_STAFF_FROM} AS s
            WHERE s.code = @code
          `)
          updatedCount += 1
          details.push({
            rowNo,
            name,
            dept,
            post,
            code: staffCode,
            status: 'success',
            message: `已更新：部门=${deptCode}，岗位=${postCode}`,
          })
        }

        if (updatedCount <= 0) {
          details.push({
            rowNo,
            name,
            dept,
            post,
            status: 'skipped',
            message: '同名员工均为未审核（pass!=1），无可更新记录',
          })
        }
      } catch (e) {
        details.push({
          rowNo,
          name,
          dept,
          post,
          status: 'failed',
          message: `更新异常：${String(e?.message ?? e)}`,
        })
      }
    }

    const total = details.length
    const success = details.filter((d) => d.status === 'success').length
    const failed = details.filter((d) => d.status === 'failed').length
    const skipped = details.filter((d) => d.status === 'skipped').length

    res.json({
      code: 200,
      msg: 'success',
      data: { total, success, failed, skipped, details },
    })
  } catch (err) {
    console.error('POST /api/hr/staff/batch-update 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库处理失败')
    res.status(500).json({ code: 500, msg: `批量更新失败：${detail}`, data: null })
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
  console.log('[部门资料] POST /api/hr/departments：code 由服务端自增，不要求 body.code（若仍提示 code 必填，多为未重启后端或 3001 被其它程序占用）')
})

