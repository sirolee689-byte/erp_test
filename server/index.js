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
  getRequestIp,
} from './operationAuditMiddleware.js'
import { getActorAuditFromReq } from './businessAuditFields.js'
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

/** v1.1.3：宿舍房间 / 入住（物理表名已由库端统一为 Hr_room、Hr_room_in） */
const HR_ROOM_FROM = 'dbo.[Hr_room]'
const HR_ROOM_IN_FROM = 'dbo.[Hr_room_in]'
/** 宿舍电费汇总等：room_code 与 Hr_room.s_code / Hr_room_in.room_code 对应 */
const HR_ROOM_USE_FROM = 'dbo.[Hr_room_use]'

/**
 * 日期/时间列落在 [@mStart, @mEnd) 自然月半开区间；兼容 SQL Server 2008 R2（无 TRY_CONVERT）。
 * 要点：若列已是 datetime，不能再「先转 nvarchar 再 CONVERT 回 datetime」，否则受会话语言/格式影响易报 241。
 * 做法：CASE 短路——日期型直接比较参数；字符型先尝试 style 120 的 yyyy-MM-dd / 8 位 yyyymmdd；
 * 再兜底「旧库常见」：非日期型列但存 varchar 日期且 ISDATE=1 时用隐式 CONVERT（覆盖 2026-4-1 等非零补串，否则入住名单会被整月滤空）。
 * @param {string} colExpr 列引用，如 i.in_time、u.tj_date
 */
function hrSqlDateColumnInMonthRangeSql(colExpr) {
  const c = String(colExpr ?? '').trim()
  const v = `LTRIM(RTRIM(CONVERT(nvarchar(100), ${c})))`
  const iso10 = `REPLACE(REPLACE(SUBSTRING(${v}, 1, 10), N'/', N'-'), N'.', N'-')`
  return (
    `(CASE ` +
    `WHEN ${c} IS NULL THEN 0 ` +
    `WHEN SQL_VARIANT_PROPERTY(CAST(${c} AS sql_variant), N'BaseType') IN (N'datetime', N'smalldatetime', N'date', N'datetime2') ` +
    `THEN CASE WHEN ${c} >= @mStart AND ${c} < @mEnd THEN 1 ELSE 0 END ` +
    `WHEN LEN(${v}) >= 10 AND SUBSTRING(${v}, 5, 1) IN (N'-', N'/', N'.') AND SUBSTRING(${v}, 8, 1) IN (N'-', N'/', N'.') ` +
    `AND ISNUMERIC(SUBSTRING(${v}, 1, 4) + N'e0') = 1 AND ISNUMERIC(SUBSTRING(${v}, 6, 2) + N'e0') = 1 AND ISNUMERIC(SUBSTRING(${v}, 9, 2) + N'e0') = 1 ` +
    `THEN CASE WHEN CONVERT(datetime, ${iso10}, 120) >= @mStart AND CONVERT(datetime, ${iso10}, 120) < @mEnd THEN 1 ELSE 0 END ` +
    `WHEN PATINDEX(N'%[^0-9]%', ${v}) = 0 AND LEN(${v}) >= 8 ` +
    `THEN CASE WHEN CONVERT(datetime, STUFF(STUFF(LEFT(${v}, 8), 5, 0, N'-'), 8, 0, N'-'), 120) >= @mStart AND CONVERT(datetime, STUFF(STUFF(LEFT(${v}, 8), 5, 0, N'-'), 8, 0, N'-'), 120) < @mEnd THEN 1 ELSE 0 END ` +
    `WHEN SQL_VARIANT_PROPERTY(CAST(${c} AS sql_variant), N'BaseType') IN (N'varchar', N'nvarchar', N'char', N'nchar') AND LEN(${v}) > 0 AND ISDATE(${v}) = 1 ` +
    `THEN CASE WHEN CONVERT(datetime, ${v}) >= @mStart AND CONVERT(datetime, ${v}) < @mEnd THEN 1 ELSE 0 END ` +
    `ELSE 0 END) = 1`
  )
}

/** @deprecated 语义别名：入住单 in_time 按月 */
function hrRoomInTimeBetweenMonthSql(colExpr) {
  return hrSqlDateColumnInMonthRangeSql(colExpr)
}

/** 电费表 tj_date 按月（与 hrSqlDateColumnInMonthRangeSql 同一套比较逻辑） */
function hrRoomUseTjDateBetweenMonthSql(colExpr) {
  return hrSqlDateColumnInMonthRangeSql(colExpr)
}

/**
 * 入住名单展示用姓名：优先 staff_truename，空则回退 staff_code（旧数据可能未写入姓名）
 * @param {string} tableAlias 表别名，如 x
 */
function hrRoomInStaffDisplayNameSql(tableAlias) {
  const a = String(tableAlias ?? 'x').trim()
  const tru = `LTRIM(RTRIM(CONVERT(nvarchar(400), ISNULL(${a}.staff_truename, N''))))`
  const code = `LTRIM(RTRIM(ISNULL(${a}.staff_code, N'')))`
  return `CASE WHEN ${tru} <> N'' THEN ${tru} ELSE ${code} END`
}

/**
 * Hr_room_use.c_sum_money 在库中可能为 nvarchar：SUM 前转为 decimal；空或非数字视为 0。
 * 去掉空格与英文逗号后再 ISNUMERIC + CAST（SQL Server 2008 R2，无 TRY_CONVERT）。
 * @param {string} colExpr 列引用，如 u.c_sum_money
 */
function hrRoomUseCsumMoneyAsDecimalSql(colExpr) {
  const c = String(colExpr ?? 'u.c_sum_money').trim()
  const norm = `REPLACE(REPLACE(LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(${c}, N'')))), N' ', N''), N',', N'')`
  return `CASE WHEN ${norm} = N'' THEN CAST(0 AS decimal(18,2)) WHEN ISNUMERIC(${norm}) = 1 THEN CAST(${norm} AS decimal(18,2)) ELSE CAST(0 AS decimal(18,2)) END`
}

/**
 * 将入住/退宿日期列转为 datetime 或 NULL（非法或空则为 NULL），供 DATEDIFF 使用
 * @param {string} colExpr 列引用
 */
function hrRoomDateTimeExprNullableSql(colExpr) {
  const c = String(colExpr ?? '').trim()
  const v = `LTRIM(RTRIM(CONVERT(nvarchar(100), ${c})))`
  const iso10 = `REPLACE(REPLACE(SUBSTRING(${v}, 1, 10), N'/', N'-'), N'.', N'-')`
  return (
    `CASE ` +
    `WHEN ${c} IS NULL THEN NULL ` +
    `WHEN SQL_VARIANT_PROPERTY(CAST(${c} AS sql_variant), N'BaseType') IN (N'datetime', N'smalldatetime', N'date', N'datetime2') ` +
    `THEN CAST(${c} AS datetime) ` +
    `WHEN LEN(${v}) >= 10 AND SUBSTRING(${v}, 5, 1) IN (N'-', N'/', N'.') AND SUBSTRING(${v}, 8, 1) IN (N'-', N'/', N'.') ` +
    `AND ISNUMERIC(SUBSTRING(${v}, 1, 4) + N'e0') = 1 AND ISNUMERIC(SUBSTRING(${v}, 6, 2) + N'e0') = 1 AND ISNUMERIC(SUBSTRING(${v}, 9, 2) + N'e0') = 1 ` +
    `THEN CONVERT(datetime, ${iso10}, 120) ` +
    `WHEN PATINDEX(N'%[^0-9]%', ${v}) = 0 AND LEN(${v}) >= 8 ` +
    `THEN CONVERT(datetime, STUFF(STUFF(LEFT(${v}, 8), 5, 0, N'-'), 8, 0, N'-'), 120) ` +
    `WHEN SQL_VARIANT_PROPERTY(CAST(${c} AS sql_variant), N'BaseType') IN (N'varchar', N'nvarchar', N'char', N'nchar') AND LEN(${v}) > 0 AND ISDATE(${v}) = 1 ` +
    `THEN CONVERT(datetime, ${v}) ` +
    `ELSE NULL END`
  )
}

/**
 * 办理入住：将前端/旧库习惯的入住日期字符串解析为 JS Date，供与历史区间做 SQL 参数比较
 * @param {string} inTimeTrim
 * @param {string} fallbackNowStr
 */
function parseCheckInInTimeToDateOrNow(inTimeTrim, fallbackNowStr) {
  const s = String(inTimeTrim ?? '').trim() || String(fallbackNowStr ?? '').trim()
  if (!s) return new Date()
  const normalized = s.replace(/\//g, '-').replace(/\./g, '-')
  const d = new Date(normalized)
  if (!Number.isNaN(d.getTime())) return d
  const d2 = new Date(s)
  if (!Number.isNaN(d2.getTime())) return d2
  return new Date()
}

/**
 * 是否在 API JSON 中附带 SQL 调试信息（含 precedingErrors）。
 * - 设置 DEBUG_API=true 时始终附带
 * - 或未设置 NODE_ENV=production 时附带（本地 node server 常见未设 NODE_ENV，便于排错）
 */
function shouldAttachSqlDebugToApiResponse() {
  if (String(process.env.DEBUG_API ?? 'false').toLowerCase() === 'true') return true
  return String(process.env.NODE_ENV ?? '').toLowerCase() !== 'production'
}

/**
 * 将 mssql/tedious 的 RequestError 序列化为可放进 JSON 的纯对象（不含连接串）
 * @param {unknown} err
 */
function serializeMssqlRequestErrorForClient(err) {
  const e = err && typeof err === 'object' ? err : {}
  const pe = Array.isArray(e.precedingErrors) ? e.precedingErrors : []
  return {
    name: e.name != null ? String(e.name) : undefined,
    code: e.code != null ? String(e.code) : undefined,
    message: e.message != null ? String(e.message) : undefined,
    number: e.number,
    lineNumber: e.lineNumber,
    state: e.state,
    class: e.class,
    serverName: e.serverName != null ? String(e.serverName) : undefined,
    procName: e.procName != null ? String(e.procName) : undefined,
    precedingErrors: pe.map((x) => ({
      message: x?.message != null ? String(x.message) : undefined,
      number: x?.number,
      lineNumber: x?.lineNumber,
      state: x?.state,
      code: x?.code != null ? String(x.code) : undefined,
    })),
  }
}

/**
 * 住宿业务：解析查询年月，返回 [mStart, mEnd) 的 Date 对象（用于 in_time 区间）
 */
function lodgingMonthRangeOrThrow(yearRaw, monthRaw) {
  const now = new Date()
  const y = Math.floor(Number(yearRaw ?? now.getFullYear()))
  const mo = Math.floor(Number(monthRaw ?? now.getMonth() + 1))
  if (!Number.isFinite(y) || y < 1990 || y > 2100) {
    throw new Error('年份不合法')
  }
  if (!Number.isFinite(mo) || mo < 1 || mo > 12) {
    throw new Error('月份不合法')
  }
  const mStart = new Date(y, mo - 1, 1, 0, 0, 0, 0)
  const nextMo = mo === 12 ? 1 : mo + 1
  const nextY = mo === 12 ? y + 1 : y
  const mEnd = new Date(nextY, nextMo - 1, 1, 0, 0, 0, 0)
  return { y, mo, mStart, mEnd }
}

/** v1.1.1：缓存员工档案表列清单（避免不同库缺列导致 SQL 报错） */
let HR_STAFF_COLSET_PROMISE = null
let HR_ROOM_IN_COLSET_PROMISE = null
let HR_ROOM_COLSET_PROMISE = null

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
 * 读取 Hr_room_in 的列名集合（小写），并缓存到进程内
 * 说明：用于兼容旧库字段不一致（如 status/electric/room_info 是否存在）
 * @param {import('mssql').ConnectionPool} pool
 * @returns {Promise<Set<string>>}
 */
async function getHrRoomInColumnSet(pool) {
  if (HR_ROOM_IN_COLSET_PROMISE) return HR_ROOM_IN_COLSET_PROMISE
  HR_ROOM_IN_COLSET_PROMISE = (async () => {
    try {
      const r = await pool.request().query(`
        SELECT COLUMN_NAME AS name
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = N'dbo' AND TABLE_NAME = N'Hr_room_in'
      `)
      const set = new Set()
      for (const row of r.recordset ?? []) {
        const n = String(row?.name ?? '').trim()
        if (n) set.add(n.toLowerCase())
      }
      return set
    } catch (err) {
      console.warn('[宿舍入住] 读取 Hr_room_in 列清单失败，已降级：', err?.message ?? err)
      return new Set()
    }
  })()
  return HR_ROOM_IN_COLSET_PROMISE
}

/**
 * 读取 Hr_room 的列名集合（小写），并缓存到进程内
 * 说明：用于兼容床位字段可能为 BedCount / in_bad
 * @param {import('mssql').ConnectionPool} pool
 * @returns {Promise<Set<string>>}
 */
async function getHrRoomColumnSet(pool) {
  if (HR_ROOM_COLSET_PROMISE) return HR_ROOM_COLSET_PROMISE
  HR_ROOM_COLSET_PROMISE = (async () => {
    try {
      const r = await pool
        .request()
        .input('t', sql.NVarChar(128), HR_ROOM_TABLE)
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
      console.warn('[宿舍房间] 读取 Hr_room 列清单失败，已降级：', err?.message ?? err)
      return new Set()
    }
  })()
  return HR_ROOM_COLSET_PROMISE
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

/**
 * v1.1.3：宿舍房间分页列表（含在住人数）
 * GET /api/hr/dormitory/rooms
 * - page、pageSize：分页
 * - pass：'1' 已审核（默认）/'0' 未审核
 * - keyword：模糊匹配房号 s_code、楼栋 in_lou、名称 name、房型 code
 *
 * 在住人数：Hr_room_in 中 del=0 且 in_room=1 且 out_room=0 的记录条数（不按 pass 过滤，避免与床位占用不一致）
 */
app.get('/api/hr/dormitory/rooms', async (req, res) => {
  res.setHeader('X-ERP-Dormitory-Rooms', 'v1.1.3')
  try {
    const pageRaw = req.query?.page
    const pageSizeRaw = req.query?.pageSize
    const page = Number(pageRaw ?? 1)
    const pageSize = Number(pageSizeRaw ?? 20)
    const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1
    const safePageSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.min(Math.floor(pageSize), 200) : 20
    const offset = (safePage - 1) * safePageSize

    const passRaw = String(req.query?.pass ?? '1').trim()
    const pass = passRaw === '0' ? '0' : '1'

    const keywordRaw = String(req.query?.keyword ?? '').trim()
    const hasKw = keywordRaw.length > 0

    const pool = await getPool()
    const kwPat = hasKw ? `%${keywordRaw}%` : ''

    const whereBase = `
      WHERE LTRIM(RTRIM(ISNULL(r.del, N'0'))) = N'0'
        AND LTRIM(RTRIM(ISNULL(r.pass, N'0'))) = @pass
        AND (
          @hasKw = 0
          OR r.s_code LIKE @kw
          OR r.in_lou LIKE @kw
          OR r.name LIKE @kw
          OR r.code LIKE @kw
        )
    `

    const totalReq = pool.request()
    totalReq.input('pass', sql.NVarChar(10), pass)
    totalReq.input('hasKw', sql.Bit, hasKw ? 1 : 0)
    totalReq.input('kw', sql.NVarChar(200), kwPat)
    const totalRow = await totalReq.query(`
      SELECT COUNT(1) AS total
      FROM ${HR_ROOM_FROM} AS r
      ${whereBase}
    `)
    const total = Number(totalRow.recordset?.[0]?.total ?? 0)

    // 不用 OFFSET/FETCH 绑定变量：部分 SQL Server/驱动会报 “Invalid usage of the option NEXT”
    const startRow = offset + 1
    const endRow = offset + safePageSize

    const listReq = pool.request()
    listReq.input('pass', sql.NVarChar(10), pass)
    listReq.input('hasKw', sql.Bit, hasKw ? 1 : 0)
    listReq.input('kw', sql.NVarChar(200), kwPat)
    listReq.input('startRow', sql.Int, startRow)
    listReq.input('endRow', sql.Int, endRow)

    const listResult = await listReq.query(`
      SELECT
        t.id,
        t.systemcode,
        t.s_code,
        t.s_code1,
        t.code,
        t.name,
        t.in_lou,
        t.in_bad,
        t.pass,
        t.del,
        t.live_in_count
      FROM (
        SELECT
          r.id AS id,
          r.systemcode AS systemcode,
          r.s_code AS s_code,
          r.s_code1 AS s_code1,
          r.code AS code,
          r.name AS name,
          r.in_lou AS in_lou,
          r.in_bad AS in_bad,
          r.pass AS pass,
          r.del AS del,
          ISNULL(occ.cnt, 0) AS live_in_count,
          ROW_NUMBER() OVER (ORDER BY r.in_lou ASC, r.s_code ASC, r.id ASC) AS rn
        FROM ${HR_ROOM_FROM} AS r
        LEFT JOIN (
          SELECT i.room_systemcode AS sc, COUNT(1) AS cnt
          FROM ${HR_ROOM_IN_FROM} AS i
          WHERE LTRIM(RTRIM(ISNULL(i.del, N'0'))) = N'0'
            AND LTRIM(RTRIM(ISNULL(i.in_room, N'1'))) = N'1'
            AND LTRIM(RTRIM(ISNULL(i.out_room, N'0'))) = N'0'
          GROUP BY i.room_systemcode
        ) AS occ ON occ.sc = r.systemcode
        ${whereBase}
      ) AS t
      WHERE t.rn BETWEEN @startRow AND @endRow
      ORDER BY t.rn
    `)

    res.json({
      code: 200,
      msg: 'success',
      data: { total, list: listResult.recordset ?? [] },
    })
  } catch (err) {
    console.error('GET /api/hr/dormitory/rooms 失败：', err)
    const detail = String(err?.message ?? '数据库查询失败')
    res.status(500).json({ code: 500, msg: `加载宿舍房间失败：${detail}`, data: null })
  }
})

/**
 * 宿舍房间详情（单条，含在住人数）：GET /api/hr/dormitory/rooms/:id
 * — 仅未逻辑删除（del=0）可查；不限制 pass，便于在「未审核/已审核」列表中查看
 */
app.get('/api/hr/dormitory/rooms/:id', async (req, res) => {
  res.setHeader('X-ERP-Dormitory-Room-Detail', 'v1.1.3')
  try {
    const id = Number(req.params?.id)
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ code: 400, msg: 'id 不合法', data: null })
      return
    }

    const pool = await getPool()
    const q = pool.request()
    q.input('id', sql.Int, id)
    const rs = await q.query(`
      SELECT TOP 1
        r.id,
        r.systemcode,
        r.s_code,
        r.s_code1,
        r.code,
        r.name,
        r.in_lou,
        r.in_bad,
        r.info,
        r.pass,
        r.del,
        r.uid,
        r.uname,
        r.utruename,
        r.addtime,
        r.edittime,
        r.passutruename,
        r.passuname,
        ISNULL(occ.cnt, 0) AS live_in_count
      FROM ${HR_ROOM_FROM} AS r
      LEFT JOIN (
        SELECT i.room_systemcode AS sc, COUNT(1) AS cnt
        FROM ${HR_ROOM_IN_FROM} AS i
        WHERE LTRIM(RTRIM(ISNULL(i.del, N'0'))) = N'0'
          AND LTRIM(RTRIM(ISNULL(i.in_room, N'1'))) = N'1'
          AND LTRIM(RTRIM(ISNULL(i.out_room, N'0'))) = N'0'
        GROUP BY i.room_systemcode
      ) AS occ ON occ.sc = r.systemcode
      WHERE r.id = @id
        AND LTRIM(RTRIM(ISNULL(r.del, N'0'))) = N'0'
    `)
    const row = rs.recordset?.[0]
    if (!row) {
      res.status(404).json({ code: 404, msg: '未找到该房间或已删除', data: null })
      return
    }
    res.json({ code: 200, msg: 'success', data: row })
  } catch (err) {
    console.error('GET /api/hr/dormitory/rooms/:id 失败：', err)
    const detail = String(err?.message ?? '数据库查询失败')
    res.status(500).json({ code: 500, msg: `读取房间详情失败：${detail}`, data: null })
  }
})

/**
 * 新增宿舍房间：POST /api/hr/dormitory/rooms
 * body: { s_code, s_code1?, code?, in_bad?, info? }
 * - s_code：房号（与列表 s_code 一致）；在册（del=0）下不可重复
 * - s_code1：使用 | 闲置，默认 使用
 * - code：宿舍类型 普通房|空调房|大房，默认 普通房（写入 Hr_room.code）
 * - in_bad：床位数，默认 6
 * - info：备注
 * 新建默认 pass=0、del=0
 */
app.post('/api/hr/dormitory/rooms', async (req, res) => {
  res.setHeader('X-ERP-Dormitory-Room-Post', 'v1.1.3')
  try {
    const body = req.body ?? {}
    const sCode = String(body.s_code ?? '').trim()
    const sCode1Raw = String(body.s_code1 ?? '使用').trim() || '使用'
    const codeTypeRaw = String(body.code ?? '普通房').trim() || '普通房'
    const inBadRaw = body.in_bad
    const info = String(body.info ?? '').trim()

    const allowedState = new Set(['使用', '闲置'])
    const allowedType = new Set(['普通房', '空调房', '大房'])

    if (!sCode) {
      res.status(400).json({ code: 400, msg: '房间号（编码）不能为空', data: null })
      return
    }
    if (!allowedState.has(sCode1Raw)) {
      res.status(400).json({ code: 400, msg: '宿舍状态仅支持：使用、闲置', data: null })
      return
    }
    if (!allowedType.has(codeTypeRaw)) {
      res.status(400).json({ code: 400, msg: '宿舍类型仅支持：普通房、空调房、大房', data: null })
      return
    }

    let inBad = Number(inBadRaw)
    if (!Number.isFinite(inBad)) {
      inBad = 6
    }
    inBad = Math.floor(inBad)
    if (inBad < 1 || inBad > 99) {
      res.status(400).json({ code: 400, msg: '床位数量须在 1～99 之间', data: null })
      return
    }

    const { UID, uname: auditUname } = getActorAuditFromReq(req)
    const me = getCurrentUserFromReq(req)
    const uidStr = UID != null ? String(UID) : ''
    const unameLegacy = String(me?.userCode ?? '').trim() || (auditUname != null ? String(auditUname).trim() : '')
    const utruename = String(me?.userName ?? '').trim() || null
    const nowStr = legacyDeptNowString()
    const ipStr = getRequestIp(req) || null
    const newSystemcode = crypto.randomBytes(20).toString('hex').toUpperCase().slice(0, 40)

    const pool = await getPool()
    const dupReq = pool.request()
    dupReq.input('sCode', sql.NVarChar(50), sCode)
    const dupRs = await dupReq.query(`
      SELECT COUNT(1) AS cnt
      FROM ${HR_ROOM_FROM} AS r
      WHERE LTRIM(RTRIM(ISNULL(r.del, N'0'))) = N'0'
        AND LTRIM(RTRIM(r.s_code)) = @sCode
    `)
    const dup = Number(dupRs.recordset?.[0]?.cnt ?? 0)
    if (dup > 0) {
      res.status(400).json({ code: 400, msg: `房号「${sCode}」已存在（在册记录），请勿重复添加`, data: null })
      return
    }

    const ins = pool.request()
    ins.input('systemcode', sql.NVarChar(50), newSystemcode)
    ins.input('s_code', sql.NVarChar(50), sCode)
    ins.input('s_code1', sql.NVarChar(50), sCode1Raw)
    ins.input('code', sql.NVarChar(50), codeTypeRaw)
    ins.input('name', sql.NVarChar(50), '宿舍')
    ins.input('in_bad', sql.Int, inBad)
    ins.input('info', sql.NVarChar(500), info || null)
    ins.input('uid', sql.NVarChar(50), uidStr || null)
    ins.input('uname', sql.NVarChar(50), unameLegacy || null)
    ins.input('utruename', sql.NVarChar(50), utruename)
    ins.input('addtime', sql.NVarChar(50), nowStr)
    ins.input('ip', sql.NVarChar(50), ipStr)

    const out = await ins.query(`
      INSERT INTO ${HR_ROOM_FROM} (
        systemcode, s_code, s_code1, code, name, in_bad, info,
        uid, uname, utruename, addtime, ip,
        del, pass
      )
      OUTPUT INSERTED.id AS id, INSERTED.systemcode AS systemcode, INSERTED.s_code AS s_code
      VALUES (
        @systemcode, @s_code, @s_code1, @code, @name, @in_bad, @info,
        @uid, @uname, @utruename, @addtime, @ip,
        N'0', N'0'
      )
    `)

    const row = out.recordset?.[0]
    res.json({
      code: 200,
      msg: 'success',
      data: {
        id: row?.id ?? null,
        systemcode: row?.systemcode ?? newSystemcode,
        s_code: row?.s_code ?? sCode,
      },
    })
  } catch (err) {
    console.error('POST /api/hr/dormitory/rooms 失败：', err)
    const n = Number(err?.number ?? err?.originalError?.number ?? 0)
    if (n === 2627 || n === 2601) {
      res.status(400).json({ code: 400, msg: '房间数据冲突（唯一约束），请检查房号是否重复', data: null })
      return
    }
    const detail = String(err?.message ?? '数据库写入失败')
    res.status(500).json({ code: 500, msg: `添加房间失败：${detail}`, data: null })
  }
})

/**
 * 审核宿舍房间：PUT /api/hr/dormitory/rooms/audit
 * body: { id } — 主键 id，仅允许未审核且未删除的记录
 */
app.put('/api/hr/dormitory/rooms/audit', async (req, res) => {
  res.setHeader('X-ERP-Dormitory-Room-Audit', 'v1.1.3')
  try {
    const me = getCurrentUserFromReq(req)
    const auditorName = String(me?.userName ?? me?.userCode ?? '').trim() || '未知'
    const userCode = String(me?.userCode ?? '').trim()
    const uidStr = me?.userId != null ? String(me.userId) : ''

    const body = req.body ?? {}
    const idRaw = body.id
    const id = Number(idRaw)
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ code: 400, msg: 'id（房间主键）不合法', data: null })
      return
    }

    const pool = await getPool()
    const exReq = pool.request()
    exReq.input('id', sql.Int, id)
    const exRs = await exReq.query(`
      SELECT TOP 1 r.id, r.pass, r.del, r.s_code
      FROM ${HR_ROOM_FROM} AS r
      WHERE r.id = @id
    `)
    const existing = exRs.recordset?.[0]
    if (!existing) {
      res.status(404).json({ code: 404, msg: '未找到该房间', data: null })
      return
    }
    if (String(existing?.del ?? '').trim() === '1') {
      res.status(400).json({ code: 400, msg: '该房间已删除，不能审核', data: null })
      return
    }
    if (String(existing?.pass ?? '').trim() === '1') {
      res.status(400).json({ code: 400, msg: '当前已是已审核状态', data: null })
      return
    }

    const now = legacyDeptNowString()
    const passip = getRequestIp(req) || null
    const q = pool.request()
    q.input('id', sql.Int, id)
    q.input('now', sql.NVarChar(50), now)
    q.input('passutruename', sql.NVarChar(50), auditorName)
    q.input('passuname', sql.NVarChar(50), userCode || null)
    q.input('passuid', sql.NVarChar(50), uidStr || null)
    q.input('passid', sql.NVarChar(50), uidStr || null)
    q.input('passip', sql.NVarChar(50), passip)
    await q.query(`
      UPDATE r
      SET
        r.pass = N'1',
        r.passutruename = @passutruename,
        r.passuname = @passuname,
        r.passuid = @passuid,
        r.passid = @passid,
        r.passip = @passip,
        r.edittime = @now
      FROM ${HR_ROOM_FROM} AS r
      WHERE r.id = @id
        AND LTRIM(RTRIM(ISNULL(r.del, N'0'))) = N'0'
        AND LTRIM(RTRIM(ISNULL(r.pass, N'0'))) = N'0'
    `)

    const afterReq = pool.request()
    afterReq.input('id', sql.Int, id)
    const afterRs = await afterReq.query(`
      SELECT TOP 1
        r.id, r.systemcode, r.s_code, r.s_code1, r.code, r.name, r.in_lou, r.in_bad, r.pass, r.del, r.info
      FROM ${HR_ROOM_FROM} AS r
      WHERE r.id = @id
    `)
    res.json({ code: 200, msg: 'success', data: afterRs.recordset?.[0] ?? null })
  } catch (err) {
    console.error('PUT /api/hr/dormitory/rooms/audit 失败：', err)
    const detail = String(err?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `审核失败：${detail}`, data: null })
  }
})

/**
 * 反审宿舍房间：PUT /api/hr/dormitory/rooms/unaudit
 * body: { id } — 仅已审核且未删除
 */
app.put('/api/hr/dormitory/rooms/unaudit', async (req, res) => {
  res.setHeader('X-ERP-Dormitory-Room-Unaudit', 'v1.1.3')
  try {
    const body = req.body ?? {}
    const id = Number(body.id)
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ code: 400, msg: 'id（房间主键）不合法', data: null })
      return
    }

    const pool = await getPool()
    const exReq = pool.request()
    exReq.input('id', sql.Int, id)
    const exRs = await exReq.query(`
      SELECT TOP 1 r.id, r.pass, r.del, r.s_code
      FROM ${HR_ROOM_FROM} AS r
      WHERE r.id = @id
    `)
    const existing = exRs.recordset?.[0]
    if (!existing) {
      res.status(404).json({ code: 404, msg: '未找到该房间', data: null })
      return
    }
    if (String(existing?.del ?? '').trim() === '1') {
      res.status(400).json({ code: 400, msg: '该房间已删除，不能反审', data: null })
      return
    }
    if (String(existing?.pass ?? '').trim() !== '1') {
      res.status(400).json({ code: 400, msg: '当前为未审核状态，无需反审', data: null })
      return
    }

    const now = legacyDeptNowString()
    await pool.request().input('id', sql.Int, id).input('now', sql.NVarChar(50), now).query(`
      UPDATE r
      SET
        r.pass = N'0',
        r.passutruename = NULL,
        r.passuname = NULL,
        r.passuid = NULL,
        r.passid = NULL,
        r.passip = NULL,
        r.edittime = @now
      FROM ${HR_ROOM_FROM} AS r
      WHERE r.id = @id
        AND LTRIM(RTRIM(ISNULL(r.del, N'0'))) = N'0'
        AND LTRIM(RTRIM(ISNULL(r.pass, N'0'))) = N'1'
    `)

    const afterReq = pool.request()
    afterReq.input('id', sql.Int, id)
    const afterRs = await afterReq.query(`
      SELECT TOP 1
        r.id, r.systemcode, r.s_code, r.s_code1, r.code, r.name, r.in_lou, r.in_bad, r.pass, r.del, r.info
      FROM ${HR_ROOM_FROM} AS r
      WHERE r.id = @id
    `)
    res.json({ code: 200, msg: 'success', data: afterRs.recordset?.[0] ?? null })
  } catch (err) {
    console.error('PUT /api/hr/dormitory/rooms/unaudit 失败：', err)
    const detail = String(err?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `反审失败：${detail}`, data: null })
  }
})

/**
 * v1.1.3+：办理入住-员工可选项（在职、非黑名单、且当前不在住）
 * GET /api/hr/dormitory/check-in/staff-options
 * query: { keyword? } — 支持工号/姓名模糊
 */
app.get('/api/hr/dormitory/check-in/staff-options', async (req, res) => {
  res.setHeader('X-ERP-Dormitory-CheckIn-StaffOptions', 'v1.1.3')
  try {
    const keywordRaw = String(req.query?.keyword ?? '').trim()
    const hasKw = keywordRaw.length > 0
    const kw = hasKw ? `%${keywordRaw}%` : ''

    const pool = await getPool()
    const colset = await getHrStaffColumnSet(pool)
    const hasUserCodeCol = colset.has('usercode')

    const q = pool.request()
    q.input('hasKw', sql.Bit, hasKw ? 1 : 0)
    q.input('kw', sql.NVarChar(200), kw)

    const userCodeSelect = hasUserCodeCol ? ', s.UserCode AS userCode' : ', CAST(NULL AS nvarchar(50)) AS userCode'
    const userCodeKw = hasUserCodeCol ? ' OR s.UserCode LIKE @kw ' : ''

    // 旧库口径：在宿 = out_room = '0'
    // 关联口径（兼容）：优先 new_code，否则 code
    const notLivingSql = `
      AND NOT EXISTS (
        SELECT 1
        FROM ${HR_ROOM_IN_FROM} AS i
        WHERE LTRIM(RTRIM(ISNULL(i.del, N'0'))) = N'0'
          AND LTRIM(RTRIM(ISNULL(i.out_room, N'0'))) = N'0'
          AND LTRIM(RTRIM(ISNULL(i.staff_code, N''))) = LTRIM(RTRIM(ISNULL(NULLIF(LTRIM(RTRIM(s.new_code)), N''), s.code)))
      )
    `

    const rs = await q.query(`
      SELECT TOP (50)
        ISNULL(NULLIF(LTRIM(RTRIM(s.new_code)), N''), LTRIM(RTRIM(s.code))) AS code,
        s.name AS name
        ${userCodeSelect}
      FROM ${HR_STAFF_FROM} AS s
      WHERE LTRIM(RTRIM(ISNULL(s.del, N'0'))) = N'0'
        AND LTRIM(RTRIM(ISNULL(s.status, N''))) = N'在职'
        AND ISNULL(s.is_blacklist, 0) = 0
        AND (
          @hasKw = 0
          OR s.new_code LIKE @kw
          OR s.code LIKE @kw
          OR s.name LIKE @kw
          ${userCodeKw}
        )
        ${notLivingSql}
      ORDER BY ISNULL(NULLIF(LTRIM(RTRIM(s.new_code)), N''), LTRIM(RTRIM(s.code))) ASC
    `)

    res.json({ code: 200, msg: 'success', data: rs.recordset ?? [] })
  } catch (err) {
    console.error('GET /api/hr/dormitory/check-in/staff-options 失败：', err)
    const detail = String(err?.message ?? '数据库查询失败')
    res.status(500).json({ code: 500, msg: `加载可选员工失败：${detail}`, data: null })
  }
})

/**
 * v1.1.3：办理入住（写入 Hr_room_in）
 * POST /api/hr/dormitory/check-in
 * body: { staff_code, room_code, pass? } — pass 与房间列表一致，用于定位「已审/未审」房间资料，默认 '1'
 * v1.1.4+：INSERT 前校验在住（out_room=0）与历史已退宿区间（out_room=1）时间重叠
 */
app.post('/api/hr/dormitory/check-in', async (req, res) => {
  res.setHeader('X-ERP-Dormitory-CheckIn', 'v1.1.4-overlap')
  try {
    const body = req.body ?? {}
    const staffCode = String(body.staff_code ?? '').trim()
    const roomCode = String(body.room_code ?? '').trim()
    const passForRoom = String(body.pass ?? '1').trim() === '0' ? '0' : '1'
    const inTimeRaw = body.in_time
    const inTime = inTimeRaw != null ? String(inTimeRaw).trim() : ''
    const roomInfoRaw = body.room_info
    const roomInfo = roomInfoRaw != null ? String(roomInfoRaw).trim() : ''
    const electricRaw = body.electric
    const electricNum = Number(electricRaw ?? 0)
    const electric = Number.isFinite(electricNum) && electricNum >= 0 ? electricNum : 0

    if (!staffCode || !roomCode) {
      res.status(400).json({ code: 400, msg: '员工工号与房间编码（房号）不能为空', data: null })
      return
    }

    const pool = await getPool()
    const colset = await getHrStaffColumnSet(pool)
    const hasUserCodeCol = colset.has('usercode')
    const inColset = await getHrRoomInColumnSet(pool)
    const roomColset = await getHrRoomColumnSet(pool)
    const hasElectricCol = inColset.has('electric')
    const hasRoomInfoCol = inColset.has('room_info')
    const hasInTimeCol = inColset.has('in_time')
    const hasBedCountCol = roomColset.has('bedcount')

    const { UID, uname: auditUname } = getActorAuditFromReq(req)
    const me = getCurrentUserFromReq(req)
    const uidStr = UID != null ? String(UID) : ''
    const unameLegacy = String(me?.userCode ?? '').trim() || (auditUname != null ? String(auditUname).trim() : '')
    const utruename = String(me?.userName ?? '').trim() || null
    const nowStr = legacyDeptNowString()
    const ipStr = getRequestIp(req) || null

    const tx = new sql.Transaction(pool)
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE)
    try {
      const roomReq = new sql.Request(tx)
      roomReq.input('roomCode', sql.NVarChar(50), roomCode)
      roomReq.input('pass', sql.NVarChar(10), passForRoom)
      const roomRs = await roomReq.query(`
        SELECT TOP 4
          r.id,
          r.systemcode,
          r.s_code,
          r.in_bad,
          ${hasBedCountCol ? 'r.BedCount AS BedCount,' : 'CAST(NULL AS int) AS BedCount,'}
          r.s_code1,
          r.name,
          r.code,
          r.info,
          r.water,
          r.electric,
          r.zt,
          r.intime
        FROM ${HR_ROOM_FROM} AS r
        WHERE LTRIM(RTRIM(ISNULL(r.del, N'0'))) = N'0'
          AND LTRIM(RTRIM(ISNULL(r.pass, N'0'))) = @pass
          AND LTRIM(RTRIM(r.s_code)) = @roomCode
      `)
      const roomRows = roomRs.recordset ?? []
      if (roomRows.length === 0) {
        await tx.rollback()
        res.status(400).json({
          code: 400,
          msg: '未找到匹配的房间：请确认房号正确，且与当前「审核视图」一致（已审核/未审核）',
          data: null,
        })
        return
      }
      if (roomRows.length > 1) {
        await tx.rollback()
        res.status(400).json({
          code: 400,
          msg: '房号在系统中存在多条房间资料，无法唯一确定房间，请联系管理员核对 Hr_room.s_code',
          data: null,
        })
        return
      }

      const room = roomRows[0]
      const roomSystemcode = String(room?.systemcode ?? '').trim()
      if (!roomSystemcode) {
        await tx.rollback()
        res.status(400).json({ code: 400, msg: '房间资料缺少 systemcode，无法办理入住', data: null })
        return
      }

      const useState = String(room?.s_code1 ?? '').trim()
      if (useState && useState !== '使用') {
        await tx.rollback()
        res.status(400).json({ code: 400, msg: `该房间当前状态为「${useState}」，仅「使用」中的房间可办理入住`, data: null })
        return
      }

      const capBedCount = Number(room?.BedCount)
      const capInBad = Number(room?.in_bad)
      const bedCapRaw = Number.isFinite(capBedCount) && capBedCount > 0 ? capBedCount : capInBad
      const bedCap = Number.isFinite(bedCapRaw) && bedCapRaw > 0 ? bedCapRaw : 4

      const occReq = new sql.Request(tx)
      occReq.input('roomCode', sql.NVarChar(50), roomCode)
      const occRs = await occReq.query(`
        SELECT COUNT(1) AS cnt
        FROM ${HR_ROOM_IN_FROM} AS i
        WHERE LTRIM(RTRIM(ISNULL(i.del, N'0'))) = N'0'
          AND LTRIM(RTRIM(ISNULL(i.out_room, N'0'))) = N'0'
          AND LTRIM(RTRIM(ISNULL(i.room_code, N''))) = @roomCode
      `)
      const occ = Number(occRs.recordset?.[0]?.cnt ?? 0)
      if (occ >= bedCap) {
        await tx.rollback()
        // 业务强制文案：前端也依赖该提示做“满员拦截”验证
        res.status(400).json({ code: 400, msg: '该房间已满员，无法办理入住', data: null })
        return
      }

      const staffReq = new sql.Request(tx)
      staffReq.input('staffCode', sql.NVarChar(50), staffCode)
      // 口径锁定：Hr_staff.new_code = Hr_room_in.staff_code
      // 兼容：允许传老工号 code / UserCode 时也能匹配到 new_code（便于手工输入）
      const staffWhereExtra = hasUserCodeCol
        ? 'AND (LTRIM(RTRIM(s.new_code)) = @staffCode OR LTRIM(RTRIM(s.code)) = @staffCode OR LTRIM(RTRIM(ISNULL(s.UserCode, N\'\'))) = @staffCode)'
        : 'AND (LTRIM(RTRIM(s.new_code)) = @staffCode OR LTRIM(RTRIM(s.code)) = @staffCode)'
      const staffRs = await staffReq.query(`
        SELECT TOP 1
          s.code AS code,
          s.new_code AS new_code,
          s.name AS name,
          s.status AS status,
          ISNULL(s.is_blacklist, 0) AS is_blacklist,
          s.in_bm AS in_bm,
          s.join_department AS join_department
        FROM ${HR_STAFF_FROM} AS s
        WHERE LTRIM(RTRIM(ISNULL(s.del, N'0'))) = N'0'
          ${staffWhereExtra}
      `)
      const staffRow = staffRs.recordset?.[0]
      if (!staffRow) {
        await tx.rollback()
        res.status(400).json({
          code: 400,
          msg: '未找到可用的在职员工档案（请核对工号，含 UserCode 时亦会匹配）',
          data: null,
        })
        return
      }
      if (String(staffRow?.status ?? '').trim() !== '在职') {
        await tx.rollback()
        res.status(400).json({ code: 400, msg: '该员工不在职，无法办理入住', data: null })
        return
      }
      if (Number(staffRow?.is_blacklist ?? 0) !== 0) {
        await tx.rollback()
        res.status(400).json({ code: 400, msg: '该员工在黑名单中，无法办理入住', data: null })
        return
      }

      const staffDbCode = String(staffRow?.code ?? '').trim()
      const staffNewCode = String(staffRow?.new_code ?? '').trim()
      const staffName = String(staffRow?.name ?? '').trim() || null
      const staffDeptName = String(staffRow?.join_department ?? '').trim() || null
      const staffBmSys = String(staffRow?.join_department ?? '').trim() || null
      // 兼容：new_code 可能为空；此时用 code 作为宿舍关联员工编码
      const staffLinkCode = staffNewCode || staffDbCode || staffCode

      // 第一步：在住拦截（须用 staffLinkCode，与即将写入 Hr_room_in.staff_code 一致）
      const stayReq = new sql.Request(tx)
      stayReq.input('staffLinkCode', sql.NVarChar(50), staffLinkCode)
      const stayRs = await stayReq.query(`
        SELECT TOP 1 i.id
        FROM ${HR_ROOM_IN_FROM} AS i
        WHERE LTRIM(RTRIM(ISNULL(i.del, N'0'))) = N'0'
          AND LTRIM(RTRIM(ISNULL(i.out_room, N'0'))) = N'0'
          AND LTRIM(RTRIM(ISNULL(i.staff_code, N''))) = LTRIM(RTRIM(@staffLinkCode))
      `)
      if (stayRs.recordset?.[0]) {
        await tx.rollback()
        res.status(400).json({
          code: 400,
          msg: '该员工当前处于在住状态，请先办理退宿后再重新申请',
          data: null,
        })
        return
      }

      // 第二步：历史闭区间重叠（已退宿 out_room=1；端点用 datetime 表达式兼容 nvarchar/datetime 列，SQL2008）
      const newInDt = parseCheckInInTimeToDateOrNow(inTime, nowStr)
      const outEndDtExpr = `COALESCE(${hrRoomDateTimeExprNullableSql('i.out_time')}, ${hrRoomDateTimeExprNullableSql('i.out_time2')})`
      const ovReq = new sql.Request(tx)
      ovReq.input('staffLinkCode', sql.NVarChar(50), staffLinkCode)
      ovReq.input('newInDt', sql.DateTime, newInDt)
      const ovRs = await ovReq.query(`
        SELECT TOP 1
          i.id,
          LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(i.in_time, N'')))) AS disp_in,
          LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(i.out_time, ISNULL(i.out_time2, N''))))) AS disp_out
        FROM ${HR_ROOM_IN_FROM} AS i
        WHERE LTRIM(RTRIM(ISNULL(i.del, N'0'))) = N'0'
          AND LTRIM(RTRIM(ISNULL(i.out_room, N'0'))) = N'1'
          AND LTRIM(RTRIM(ISNULL(i.staff_code, N''))) = LTRIM(RTRIM(@staffLinkCode))
          AND ${hrRoomDateTimeExprNullableSql('i.in_time')} IS NOT NULL
          AND ${outEndDtExpr} IS NOT NULL
          AND @newInDt >= ${hrRoomDateTimeExprNullableSql('i.in_time')}
          AND @newInDt <= ${outEndDtExpr}
      `)
      const overlapHit = ovRs.recordset?.[0]
      if (overlapHit) {
        await tx.rollback()
        const di = String(overlapHit?.disp_in ?? '').trim() || '未知'
        const dout = String(overlapHit?.disp_out ?? '').trim() || '未知'
        res.status(400).json({
          code: 400,
          msg: `时间冲突：该员工在 [${di}] 至 [${dout}] 已有住宿记录，请核实后再试`,
          data: null,
        })
        return
      }

      // 旧库字段自检：不存在就提示（便于你回到 Navicat/旧系统核对字段）
      /** @type {string[]} */
      const missing = []
      if (!hasInTimeCol) missing.push('Hr_room_in.in_time')
      if (!hasRoomInfoCol) missing.push('Hr_room_in.room_info')
      if (!hasElectricCol) missing.push('Hr_room_in.electric')
      if (!inColset.has('room_code')) missing.push('Hr_room_in.room_code')
      if (!inColset.has('staff_code')) missing.push('Hr_room_in.staff_code')
      if (!inColset.has('out_room')) missing.push('Hr_room_in.out_room')
      if (!inColset.has('pass')) missing.push('Hr_room_in.pass')
      if (missing.length > 0) {
        await tx.rollback()
        res.status(400).json({ code: 400, msg: `旧表字段缺失，无法办理入住：${missing.join('、')}`, data: null })
        return
      }
      if (!staffLinkCode) {
        await tx.rollback()
        res.status(400).json({ code: 400, msg: '该员工档案缺少可用编码（code/new_code），无法办理入住', data: null })
        return
      }

      const newSystemcode = crypto.randomBytes(20).toString('hex').toUpperCase().slice(0, 40)
      const roomIdStr = String(room?.id ?? '').trim()

      const ins = new sql.Request(tx)
      ins.input('uid', sql.NVarChar(50), uidStr || null)
      ins.input('uname', sql.NVarChar(50), unameLegacy || null)
      ins.input('utruename', sql.NVarChar(50), utruename)
      ins.input('addtime', sql.NVarChar(50), nowStr)
      ins.input('ip', sql.NVarChar(50), ipStr)
      ins.input('systemcode', sql.NVarChar(50), newSystemcode)
      ins.input('name', sql.NVarChar(50), String(room?.name ?? '').trim() || null)
      ins.input('code', sql.NVarChar(50), String(room?.code ?? '').trim() || null)
      ins.input('s_code', sql.NVarChar(50), String(room?.s_code ?? '').trim() || null)
      ins.input('s_code1', sql.NVarChar(50), String(room?.s_code1 ?? '').trim() || null)
      ins.input('zt', sql.NVarChar(50), room?.zt != null ? String(room.zt).trim() || null : null)
      ins.input('intime', sql.NVarChar(50), room?.intime != null ? String(room.intime).trim() || null : null)
      ins.input('staff_code', sql.NVarChar(50), staffLinkCode)
      ins.input('staff_truename', sql.NVarChar(50), staffName)
      ins.input('staff_systemcode', sql.NVarChar(50), staffLinkCode || null)
      ins.input('staff_bm_name', sql.NVarChar(50), staffDeptName)
      ins.input('staff_bm_systemcode', sql.NVarChar(50), staffBmSys)
      ins.input('room_id', sql.NVarChar(50), roomIdStr || null)
      ins.input('room_code', sql.NVarChar(50), roomCode)
      ins.input('room_systemcode', sql.NVarChar(50), roomSystemcode)
      ins.input('in_time', sql.NVarChar(50), inTime || nowStr)
      ins.input('room_info', sql.NVarChar(500), roomInfo || (room?.info != null ? String(room.info).trim() || null : null))
      ins.input('room_water', sql.NVarChar(50), room?.water != null ? String(room.water).trim() || null : null)
      ins.input('room_electric', sql.NVarChar(50), room?.electric != null ? String(room.electric).trim() || null : null)
      if (hasElectricCol) ins.input('electric', sql.Decimal(18, 2), electric)

      const electricCols = hasElectricCol ? ', electric' : ''
      const electricVals = hasElectricCol ? ', @electric' : ''

      await ins.query(`
        INSERT INTO ${HR_ROOM_IN_FROM} (
          uid, uname, utruename, addtime, ip,
          del, pass,
          systemcode,
          name, code, s_code, s_code1, zt, intime,
          staff_code, staff_truename, staff_systemcode, staff_bm_name, staff_bm_systemcode,
          room_id, room_code, room_systemcode,
          in_room, out_room, in_time,
          room_info, room_water, room_electric
          ${electricCols}
        )
        VALUES (
          @uid, @uname, @utruename, @addtime, @ip,
          N'0', N'1',
          @systemcode,
          @name, @code, @s_code, @s_code1, @zt, @intime,
          @staff_code, @staff_truename, @staff_systemcode, @staff_bm_name, @staff_bm_systemcode,
          @room_id, @room_code, @room_systemcode,
          N'1', N'0', @in_time,
          @room_info, @room_water, @room_electric
          ${electricVals}
        )
      `)

      await tx.commit()
      // 操作审计：用更可读的中文文案写入 Sys_OperationLogs.Content
      req.__auditDormCheckInContent = `管理员[${unameLegacy || '未知'}]办理入住：房间[${roomCode}], 员工[${staffName || staffDbCode || staffCode || '未知'}], 优惠电量[${electric}]`
      res.json({
        code: 200,
        msg: 'success',
        data: { id: newSystemcode, staff_code: staffLinkCode, room_code: roomCode },
      })
    } catch (innerErr) {
      try {
        await tx.rollback()
      } catch {
        // ignore
      }
      throw innerErr
    }
  } catch (err) {
    console.error('POST /api/hr/dormitory/check-in 失败：', err)
    const n = Number(err?.number ?? err?.originalError?.number ?? 0)
    if (n === 2627 || n === 2601) {
      res.status(400).json({ code: 400, msg: '入住单写入冲突（唯一键/重复），请重试', data: null })
      return
    }
    const detail = String(err?.message ?? '数据库写入失败')
    res.status(500).json({ code: 500, msg: `办理入住失败：${detail}`, data: null })
  }
})

/**
 * 入住管理：按房号查询当前在住人员（out_room=0）
 * GET /api/hr/dormitory/room-occupants
 * query: { room_code }
 */
app.get('/api/hr/dormitory/room-occupants', async (req, res) => {
  res.setHeader('X-ERP-Dormitory-Room-Occupants', 'v1.1.3')
  try {
    const roomCode = String(req.query?.room_code ?? '').trim()
    if (!roomCode) {
      res.status(400).json({ code: 400, msg: 'room_code（房号）不能为空', data: null })
      return
    }

    const pool = await getPool()
    const q = pool.request()
    q.input('roomCode', sql.NVarChar(50), roomCode)

    const rs = await q.query(`
      SELECT
        i.id,
        LTRIM(RTRIM(ISNULL(i.staff_code, N''))) AS staff_code,
        LTRIM(RTRIM(ISNULL(i.staff_truename, N''))) AS staff_truename,
        LTRIM(RTRIM(ISNULL(d.name, ISNULL(s.join_department, i.staff_bm_name)))) AS dept_name,
        LTRIM(RTRIM(ISNULL(i.in_time, N''))) AS in_time,
        LTRIM(RTRIM(ISNULL(i.electric, N''))) AS electric,
        LTRIM(RTRIM(ISNULL(i.room_info, N''))) AS room_info
      FROM ${HR_ROOM_IN_FROM} AS i
      LEFT JOIN ${HR_STAFF_FROM} AS s
        ON LTRIM(RTRIM(ISNULL(s.new_code, N''))) = LTRIM(RTRIM(ISNULL(i.staff_code, N'')))
      LEFT JOIN ${HR_LEGACY_DEPT_FROM} AS d
        ON LTRIM(RTRIM(ISNULL(d.code, N''))) = LTRIM(RTRIM(ISNULL(s.join_department, N'')))
      WHERE LTRIM(RTRIM(ISNULL(i.del, N'0'))) = N'0'
        AND LTRIM(RTRIM(ISNULL(i.out_room, N'0'))) = N'0'
        AND LTRIM(RTRIM(ISNULL(i.room_code, N''))) = @roomCode
      ORDER BY i.id DESC
    `)

    res.json({ code: 200, msg: 'success', data: rs.recordset ?? [] })
  } catch (err) {
    console.error('GET /api/hr/dormitory/room-occupants 失败：', err)
    const detail = String(err?.message ?? '数据库查询失败')
    res.status(500).json({ code: 500, msg: `加载入住人员失败：${detail}`, data: null })
  }
})

/**
 * 入住管理：编辑备注（仅更新当前行 room_info）
 * PUT /api/hr/dormitory/room-in/room-info
 * body: { id, room_info }
 */
app.put('/api/hr/dormitory/room-in/room-info', async (req, res) => {
  res.setHeader('X-ERP-Dormitory-RoomIn-RoomInfo', 'v1.1.3')
  try {
    const body = req.body ?? {}
    const id = Number(body.id)
    const roomInfo = body.room_info != null ? String(body.room_info).trim() : ''
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ code: 400, msg: 'id 不合法', data: null })
      return
    }

    const pool = await getPool()
    const exReq = pool.request().input('id', sql.Int, id)
    const exRs = await exReq.query(`
      SELECT TOP 1 i.id, i.room_info, i.staff_truename, i.room_code
      FROM ${HR_ROOM_IN_FROM} AS i
      WHERE i.id = @id
        AND LTRIM(RTRIM(ISNULL(i.del, N'0'))) = N'0'
    `)
    const row = exRs.recordset?.[0]
    if (!row) {
      res.status(404).json({ code: 404, msg: '未找到该入住记录', data: null })
      return
    }

    const { UID, uname: auditUname } = getActorAuditFromReq(req)
    const me = getCurrentUserFromReq(req)
    const uidStr = UID != null ? String(UID) : ''
    const unameLegacy = String(me?.userCode ?? '').trim() || (auditUname != null ? String(auditUname).trim() : '')
    const nowStr = legacyDeptNowString()
    const ipStr = getRequestIp(req) || null

    const q = pool.request()
    q.input('id', sql.Int, id)
    q.input('roomInfo', sql.NVarChar(500), roomInfo || null)
    q.input('uid', sql.NVarChar(50), uidStr || null)
    q.input('uname', sql.NVarChar(50), unameLegacy || null)
    q.input('edittime', sql.NVarChar(50), nowStr)
    q.input('editip', sql.NVarChar(50), ipStr)
    await q.query(`
      UPDATE i
      SET
        i.room_info = @roomInfo,
        i.uid = COALESCE(@uid, i.uid),
        i.uname = COALESCE(@uname, i.uname),
        i.edittime = @edittime,
        i.editip = @editip
      FROM ${HR_ROOM_IN_FROM} AS i
      WHERE i.id = @id
        AND LTRIM(RTRIM(ISNULL(i.del, N'0'))) = N'0'
    `)

    const staffName = String(row?.staff_truename ?? '').trim() || '未知'
    const roomCode = String(row?.room_code ?? '').trim() || '未知'
    req.__auditDormRoomInfoContent = `管理员[${unameLegacy || '未知'}]修改了入住备注：房间[${roomCode}] 员工[${staffName}] 备注[${roomInfo || '空'}]`

    res.json({ code: 200, msg: 'success', data: { id, room_info: roomInfo } })
  } catch (err) {
    console.error('PUT /api/hr/dormitory/room-in/room-info 失败：', err)
    const detail = String(err?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `保存备注失败：${detail}`, data: null })
  }
})

/**
 * 办理退宿：仅更新当前行，不影响历史
 * PUT /api/hr/dormitory/check-out
 * body: { id, out_time } — out_time 形如 'YYYY-MM-DD HH:mm'
 */
app.put('/api/hr/dormitory/check-out', async (req, res) => {
  res.setHeader('X-ERP-Dormitory-CheckOut', 'v1.1.3')
  try {
    const body = req.body ?? {}
    const id = Number(body.id)
    const outTime = String(body.out_time ?? '').trim()
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ code: 400, msg: 'id 不合法', data: null })
      return
    }
    if (!outTime) {
      res.status(400).json({ code: 400, msg: 'out_time（退宿时间）不能为空', data: null })
      return
    }

    const pool = await getPool()
    const exReq = pool.request()
    exReq.input('id', sql.Int, id)
    const exRs = await exReq.query(`
      SELECT TOP 1
        i.id,
        i.out_room,
        i.staff_truename,
        i.in_time
      FROM ${HR_ROOM_IN_FROM} AS i
      WHERE i.id = @id
        AND LTRIM(RTRIM(ISNULL(i.del, N'0'))) = N'0'
    `)
    const row = exRs.recordset?.[0]
    if (!row) {
      res.status(404).json({ code: 404, msg: '未找到该入住记录', data: null })
      return
    }
    if (String(row?.out_room ?? '').trim() === '1') {
      res.status(400).json({ code: 400, msg: '该记录已退宿，无需重复操作', data: null })
      return
    }

    // 退宿时间不得小于入住时间（SQL Server 2008R2 兼容解析）
    const chkReq = pool.request()
    chkReq.input('inTime', sql.NVarChar(50), row?.in_time != null ? String(row.in_time).trim() : '')
    chkReq.input('outTime', sql.NVarChar(50), outTime)
    const chkRs = await chkReq.query(`
      SELECT
        ${hrRoomDateTimeExprNullableSql('@inTime')} AS in_dt,
        ${hrRoomDateTimeExprNullableSql('@outTime')} AS out_dt
    `)
    const inDt = chkRs.recordset?.[0]?.in_dt ?? null
    const outDt = chkRs.recordset?.[0]?.out_dt ?? null
    if (!inDt) {
      res.status(400).json({ code: 400, msg: '入住时间格式异常，无法校验退宿时间（请联系管理员核对该条记录）', data: null })
      return
    }
    if (!outDt) {
      res.status(400).json({ code: 400, msg: '退宿时间格式不合法，请重新选择', data: null })
      return
    }
    if (new Date(outDt).getTime() < new Date(inDt).getTime()) {
      res.status(400).json({ code: 400, msg: '退宿时间不得小于入住时间', data: null })
      return
    }

    const { UID, uname: auditUname } = getActorAuditFromReq(req)
    const me = getCurrentUserFromReq(req)
    const uidStr = UID != null ? String(UID) : ''
    const unameLegacy = String(me?.userCode ?? '').trim() || (auditUname != null ? String(auditUname).trim() : '')
    const nowStr = legacyDeptNowString()
    const ipStr = getRequestIp(req) || null
    const staffName = String(row?.staff_truename ?? '').trim() || '未知'

    const q = pool.request()
    q.input('id', sql.Int, id)
    q.input('outTime', sql.NVarChar(50), outTime)
    q.input('uid', sql.NVarChar(50), uidStr || null)
    q.input('uname', sql.NVarChar(50), unameLegacy || null)
    q.input('edittime', sql.NVarChar(50), nowStr)
    q.input('editip', sql.NVarChar(50), ipStr)
    await q.query(`
      UPDATE i
      SET
        i.out_room = N'1',
        i.out_time = @outTime,
        i.uid = COALESCE(@uid, i.uid),
        i.uname = COALESCE(@uname, i.uname),
        i.edittime = @edittime,
        i.editip = @editip
      FROM ${HR_ROOM_IN_FROM} AS i
      WHERE i.id = @id
        AND LTRIM(RTRIM(ISNULL(i.del, N'0'))) = N'0'
    `)

    // 审计内容（由 operationAuditMiddleware 写入 Sys_OperationLogs.Content）
    req.__auditDormCheckOutContent = `管理员[${unameLegacy || '未知'}]办理了员工[${staffName}]的退宿，日期：[${outTime}]`

    res.json({ code: 200, msg: 'success', data: { id, out_room: '1', out_time: outTime } })
  } catch (err) {
    console.error('PUT /api/hr/dormitory/check-out 失败：', err)
    const detail = String(err?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `办理退宿失败：${detail}`, data: null })
  }
})

/**
 * 住宿管理 — 房间总览（已审房间 + 指定年月的在住聚合 + 电费）
 * GET /api/hr/dormitory/lodging-overview
 * - tj_date：电费查询年月（格式 YYYY-M，例如 2026-3）；不传则由 year/month 拼接（YYYY-M）
 * - year、month：入住人数/名单为“当前在住”（不按月份）；电费按 Hr_room_use.tj_date 精确匹配 tj_date
 * - 电费：同房同月可能多行但金额相同，取 MAX(c_sum_money) 防止重复累加
 * - keyword：房号/楼栋/名称/房型
 * - staffKeyword：在住记录中匹配员工工号或姓名（不限定月份，仅筛「该房是否存在该员工在住」）
 */
app.get('/api/hr/dormitory/lodging-overview', async (req, res) => {
  res.setHeader('X-ERP-Dormitory-Lodging-Overview', 'v1.1.10')
  try {
    let range
    try {
      range = lodgingMonthRangeOrThrow(req.query?.year, req.query?.month)
    } catch (e) {
      res.status(400).json({ code: 400, msg: String(e?.message ?? '年月参数错误'), data: null })
      return
    }

    const pageRaw = req.query?.page
    const pageSizeRaw = req.query?.pageSize
    const page = Number(pageRaw ?? 1)
    const pageSize = Number(pageSizeRaw ?? 20)
    const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1
    const safePageSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.min(Math.floor(pageSize), 200) : 20
    const offset = (safePage - 1) * safePageSize

    const keywordRaw = String(req.query?.keyword ?? '').trim()
    const hasKw = keywordRaw.length > 0
    const kwPat = hasKw ? `%${keywordRaw}%` : ''

    const staffRaw = String(req.query?.staffKeyword ?? '').trim()
    const hasStaff = staffRaw.length > 0
    const staffPat = hasStaff ? `%${staffRaw}%` : ''

    const pool = await getPool()

    const whereRoom = `
      WHERE LTRIM(RTRIM(ISNULL(r.pass, N'0'))) = N'1'
        AND LTRIM(RTRIM(ISNULL(r.del, N'0'))) = N'0'
        AND (
          @hasKw = 0
          OR r.s_code LIKE @kw
          OR r.in_lou LIKE @kw
          OR r.name LIKE @kw
          OR r.code LIKE @kw
        )
        AND (
          @hasStaff = 0
          OR EXISTS (
            SELECT 1
            FROM ${HR_ROOM_IN_FROM} AS si
            WHERE LTRIM(RTRIM(ISNULL(si.room_code, N''))) = LTRIM(RTRIM(ISNULL(r.s_code, N'')))
              AND LTRIM(RTRIM(ISNULL(si.del, N'0'))) = N'0'
              AND LTRIM(RTRIM(ISNULL(si.in_room, N'1'))) = N'1'
              AND LTRIM(RTRIM(ISNULL(si.out_room, N'0'))) = N'0'
              AND (
                si.staff_code LIKE @staffKw
                OR si.staff_truename LIKE @staffKw
              )
          )
        )
    `

    const totalReq = pool.request()
    totalReq.input('hasKw', sql.Bit, hasKw ? 1 : 0)
    totalReq.input('kw', sql.NVarChar(200), kwPat)
    totalReq.input('hasStaff', sql.Bit, hasStaff ? 1 : 0)
    totalReq.input('staffKw', sql.NVarChar(200), staffPat)
    const totalRow = await totalReq.query(`
      SELECT COUNT(1) AS total
      FROM ${HR_ROOM_FROM} AS r
      ${whereRoom}
    `)
    const total = Number(totalRow.recordset?.[0]?.total ?? 0)

    const startRow = offset + 1
    const endRow = offset + safePageSize

    const listReq = pool.request()
    listReq.input('hasKw', sql.Bit, hasKw ? 1 : 0)
    listReq.input('kw', sql.NVarChar(200), kwPat)
    listReq.input('hasStaff', sql.Bit, hasStaff ? 1 : 0)
    listReq.input('staffKw', sql.NVarChar(200), staffPat)
    // 电费表 tj_date 为 nvarchar（常见：'YYYY-M'），前端会传 tj_date；未传则按 year/month 兜底
    const tjDateRaw = String(req.query?.tj_date ?? '').trim()
    const tjDate = tjDateRaw || `${range.y}-${range.mo}`
    listReq.input('tj_date', sql.NVarChar(20), tjDate)
    listReq.input('startRow', sql.Int, startRow)
    listReq.input('endRow', sql.Int, endRow)

    const listResult = await listReq.query(`
      SELECT
        t.id,
        t.systemcode,
        t.in_lou,
        t.s_code,
        t.name,
        t.code,
        t.s_code1,
        t.in_bad,
        t.live_in_count,
        t.occupant_names,
        t.c_sum_money
      FROM (
        SELECT
          r.id AS id,
          r.systemcode AS systemcode,
          r.in_lou AS in_lou,
          r.s_code AS s_code,
          r.name AS name,
          r.code AS code,
          r.s_code1 AS s_code1,
          r.in_bad AS in_bad,
          ISNULL(occ.cnt, 0) AS live_in_count,
          occ.names AS occupant_names,
          ele.c_sum_money AS c_sum_money,
          ROW_NUMBER() OVER (ORDER BY r.in_lou ASC, r.s_code ASC, r.id ASC) AS rn
        FROM ${HR_ROOM_FROM} AS r
        LEFT JOIN (
          SELECT
            LTRIM(RTRIM(ISNULL(i.room_code, N''))) AS rc,
            COUNT(1) AS cnt,
            STUFF((
              SELECT N', ' + (${hrRoomInStaffDisplayNameSql('x')})
              FROM ${HR_ROOM_IN_FROM} AS x
              WHERE LTRIM(RTRIM(ISNULL(x.room_code, N''))) = LTRIM(RTRIM(ISNULL(i.room_code, N'')))
                AND LTRIM(RTRIM(ISNULL(x.del, N'0'))) = N'0'
                AND LTRIM(RTRIM(ISNULL(x.in_room, N'1'))) = N'1'
                AND LTRIM(RTRIM(ISNULL(x.out_room, N'0'))) = N'0'
                AND (
                  LTRIM(RTRIM(ISNULL(x.staff_code, N''))) <> N''
                  OR LTRIM(RTRIM(CONVERT(nvarchar(400), ISNULL(x.staff_truename, N'')))) <> N''
                )
              ORDER BY x.staff_code
              FOR XML PATH('')
            ), 1, 2, N'') AS names
          FROM ${HR_ROOM_IN_FROM} AS i
          WHERE LTRIM(RTRIM(ISNULL(i.del, N'0'))) = N'0'
            AND LTRIM(RTRIM(ISNULL(i.in_room, N'1'))) = N'1'
            AND LTRIM(RTRIM(ISNULL(i.out_room, N'0'))) = N'0'
            AND LTRIM(RTRIM(ISNULL(i.room_code, N''))) <> N''
          GROUP BY LTRIM(RTRIM(ISNULL(i.room_code, N'')))
        ) AS occ ON occ.rc = LTRIM(RTRIM(ISNULL(r.s_code, N'')))
        LEFT JOIN (
          SELECT
            LTRIM(RTRIM(ISNULL(u.room_code, N''))) AS room_code,
            CAST(ISNULL(MAX(${hrRoomUseCsumMoneyAsDecimalSql('u.c_sum_money')}), 0) AS decimal(18, 2)) AS c_sum_money
          FROM ${HR_ROOM_USE_FROM} AS u
          WHERE LTRIM(RTRIM(ISNULL(u.del, N'0'))) = N'0'
            AND LTRIM(RTRIM(ISNULL(u.tj_date, N''))) = @tj_date
            AND LTRIM(RTRIM(ISNULL(u.room_code, N''))) <> N''
          GROUP BY LTRIM(RTRIM(ISNULL(u.room_code, N'')))
        ) AS ele ON ele.room_code = LTRIM(RTRIM(ISNULL(r.s_code, N'')))
        ${whereRoom}
      ) AS t
      WHERE t.rn BETWEEN @startRow AND @endRow
      ORDER BY t.rn
    `)

    const list = (listResult.recordset ?? []).map((row) => ({
      ...row,
      remaining_beds: Math.max(0, Number(row?.in_bad ?? 0) - Number(row?.live_in_count ?? 0)),
    }))

    res.json({ code: 200, msg: 'success', data: { total, list, year: range.y, month: range.mo } })
  } catch (err) {
    console.error('GET /api/hr/dormitory/lodging-overview 失败：', err)
    const detail = String(err?.message ?? '数据库查询失败')
    res.status(500).json({
      code: 500,
      msg: `加载住宿总览失败：${detail}`,
      data: shouldAttachSqlDebugToApiResponse() ? { sqlDebug: serializeMssqlRequestErrorForClient(err) } : null,
    })
  }
})

/**
 * 住宿历史列表（住/退宿）：GET /api/hr/dormitory/lodging-history
 * - v1.1.4：不再按 year/month 过滤，默认全量（仅 del=0）；排序 `in_time DESC, id DESC`；分页仍为 ROW_NUMBER（SQL2008）
 * - pass：'1'|'0'|不传=全部；del 固定 0
 * - keyword：员工工号/姓名/宿舍编码模糊
 */
app.get('/api/hr/dormitory/lodging-history', async (req, res) => {
  res.setHeader('X-ERP-Dormitory-Lodging-History', 'v1.1.4')
  try {
    const pageRaw = req.query?.page
    const pageSizeRaw = req.query?.pageSize
    const page = Number(pageRaw ?? 1)
    const pageSize = Number(pageSizeRaw ?? 20)
    const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1
    const safePageSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.min(Math.floor(pageSize), 200) : 20
    const offset = (safePage - 1) * safePageSize

    const passRaw = String(req.query?.pass ?? '').trim()
    let passWhere = ''
    if (passRaw === '0' || passRaw === '1') {
      passWhere = ` AND LTRIM(RTRIM(ISNULL(i.pass, N'0'))) = @pass `
    }

    const keywordRaw = String(req.query?.keyword ?? '').trim()
    const hasKw = keywordRaw.length > 0
    const kwPat = hasKw ? `%${keywordRaw}%` : ''

    const pool = await getPool()
    const inColset = await getHrRoomInColumnSet(pool)
    const hasRoomInfoCol = inColset.has('room_info')
    const hasElectricCol = inColset.has('electric')
    const offsetRows = offset
    const endRow = offset + safePageSize

    const totalReq = pool.request()
    totalReq.input('hasKw', sql.Bit, hasKw ? 1 : 0)
    totalReq.input('kw', sql.NVarChar(200), kwPat)
    if (passRaw === '0' || passRaw === '1') {
      totalReq.input('pass', sql.NVarChar(10), passRaw)
    }
    const totalRow = await totalReq.query(`
      SELECT COUNT(1) AS total
      FROM ${HR_ROOM_IN_FROM} AS i
      LEFT JOIN ${HR_ROOM_FROM} AS r ON r.systemcode = i.room_systemcode
      WHERE LTRIM(RTRIM(ISNULL(i.del, N'0'))) = N'0'
        ${passWhere}
        AND (
          @hasKw = 0
          OR i.staff_code LIKE @kw
          OR i.staff_truename LIKE @kw
          OR i.room_code LIKE @kw
        )
    `)
    const total = Number(totalRow.recordset?.[0]?.total ?? 0)

    const listReq = pool.request()
    listReq.input('hasKw', sql.Bit, hasKw ? 1 : 0)
    listReq.input('kw', sql.NVarChar(200), kwPat)
    listReq.input('startRow', sql.Int, offsetRows + 1)
    listReq.input('endRow', sql.Int, endRow)
    if (passRaw === '0' || passRaw === '1') {
      listReq.input('pass', sql.NVarChar(10), passRaw)
    }

    const roomInfoSelect = hasRoomInfoCol ? 'i.room_info AS room_info,' : "CAST(NULL AS nvarchar(500)) AS room_info,"
    const electricSelect = hasElectricCol ? 'i.electric AS electric,' : 'CAST(NULL AS decimal(18,2)) AS electric,'

    const listResult = await listReq.query(`
      SELECT
        t.id,
        t.staff_code,
        t.staff_truename,
        t.staff_bm_name,
        t.room_code,
        t.dorm_name,
        t.dorm_type,
        t.in_time,
        t.room_info,
        t.electric,
        t.out_time_disp,
        t.stay_duration_label,
        t.pass,
        t.room_id
      FROM (
        SELECT
          i.id AS id,
          i.staff_code AS staff_code,
          i.staff_truename AS staff_truename,
          i.staff_bm_name AS staff_bm_name,
          i.room_code AS room_code,
          ISNULL(r.name, i.name) AS dorm_name,
          ISNULL(r.code, i.code) AS dorm_type,
          i.in_time AS in_time,
          ${roomInfoSelect}
          ${electricSelect}
          CASE
            WHEN NULLIF(LTRIM(RTRIM(ISNULL(i.out_time, N''))), N'') IS NOT NULL
              THEN LTRIM(RTRIM(i.out_time))
            WHEN NULLIF(LTRIM(RTRIM(ISNULL(i.out_time2, N''))), N'') IS NOT NULL
              THEN LTRIM(RTRIM(i.out_time2))
            ELSE N''
          END AS out_time_disp,
          CASE
            WHEN LTRIM(RTRIM(ISNULL(i.out_room, N'0'))) = N'0' THEN N'暂未退宿'
            ELSE
              ISNULL(
                CAST(
                  DATEDIFF(
                    day,
                    ${hrRoomDateTimeExprNullableSql('i.in_time')},
                    COALESCE(
                      ${hrRoomDateTimeExprNullableSql('i.out_time')},
                      ${hrRoomDateTimeExprNullableSql('i.out_time2')}
                    )
                  ) AS nvarchar(20)
                ),
                N'0'
              ) + N'天'
          END AS stay_duration_label,
          i.pass AS pass,
          i.room_id AS room_id,
          ROW_NUMBER() OVER (ORDER BY i.in_time DESC, i.id DESC) AS rn
        FROM ${HR_ROOM_IN_FROM} AS i
        LEFT JOIN ${HR_ROOM_FROM} AS r ON r.systemcode = i.room_systemcode
        WHERE LTRIM(RTRIM(ISNULL(i.del, N'0'))) = N'0'
          ${passWhere}
          AND (
            @hasKw = 0
            OR i.staff_code LIKE @kw
            OR i.staff_truename LIKE @kw
            OR i.room_code LIKE @kw
          )
      ) AS t
      WHERE t.rn BETWEEN @startRow AND @endRow
      ORDER BY t.rn
    `)

    res.json({
      code: 200,
      msg: 'success',
      data: { total, list: listResult.recordset ?? [] },
    })
  } catch (err) {
    console.error('GET /api/hr/dormitory/lodging-history 失败：', err)
    const detail = String(err?.message ?? '数据库查询失败')
    res.status(500).json({
      code: 500,
      msg: `加载住宿历史失败：${detail}`,
      data: shouldAttachSqlDebugToApiResponse() ? { sqlDebug: serializeMssqlRequestErrorForClient(err) } : null,
    })
  }
})

/**
 * v1.1.4：入住审批管理中心列表（Hr_room_in + Hr_staff + HR_Departments 三表；SQL2008 用 ROW_NUMBER 分页）
 * GET /api/hr/dormitory/lodging-in/audit-center-list
 * query: page, pageSize, pass（'0'=待审核，'1'=已审核；须与 WHERE del/pass 对齐）
 * keyword：工号/姓名/房号/备注/部门名 模糊
 */
app.get('/api/hr/dormitory/lodging-in/audit-center-list', async (req, res) => {
  res.setHeader('X-ERP-Dormitory-Lodging-Audit-Center', 'v1.1.4')
  try {
    const pageRaw = req.query?.page
    const pageSizeRaw = req.query?.pageSize
    const page = Number(pageRaw ?? 1)
    const pageSize = Number(pageSizeRaw ?? 20)
    const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1
    const safePageSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.min(Math.floor(pageSize), 200) : 20
    const offset = (safePage - 1) * safePageSize
    const offsetRows = offset
    const endRow = offset + safePageSize

    const passRaw = String(req.query?.pass ?? '0').trim()
    const passFilter = passRaw === '1' ? '1' : '0'

    const keywordRaw = String(req.query?.keyword ?? '').trim()
    const hasKw = keywordRaw.length > 0
    const kwPat = hasKw ? `%${keywordRaw}%` : ''

    const pool = await getPool()
    const inColset = await getHrRoomInColumnSet(pool)
    if (!inColset.has('pass')) {
      res.status(500).json({
        code: 500,
        msg: '物理表 Hr_room_in 缺少 pass 字段：请在 Navicat 中新增 nvarchar 类型的 pass 列后再使用本模块',
        data: null,
      })
      return
    }
    if (!inColset.has('in_time')) {
      res.status(500).json({
        code: 500,
        msg: '物理表 Hr_room_in 缺少 in_time 字段：请在 Navicat 补列后再使用审核列表',
        data: null,
      })
      return
    }
    if (!inColset.has('staff_truename')) {
      res.status(500).json({
        code: 500,
        msg: '物理表 Hr_room_in 缺少 staff_truename 字段：请在 Navicat 补列后再使用审核列表',
        data: null,
      })
      return
    }
    const hasRoomInfoCol = inColset.has('room_info')
    const roomInfoSelect = hasRoomInfoCol
      ? 'LTRIM(RTRIM(ISNULL(i.room_info, N\'\'))) AS room_info,'
      : "CAST(N'' AS nvarchar(500)) AS room_info,"

    const totalReq = pool.request()
    totalReq.input('pass', sql.NVarChar(10), passFilter)
    totalReq.input('hasKw', sql.Bit, hasKw ? 1 : 0)
    totalReq.input('kw', sql.NVarChar(200), kwPat)
    const totalRow = await totalReq.query(`
      SELECT COUNT(1) AS total
      FROM ${HR_ROOM_IN_FROM} AS i
      LEFT JOIN ${HR_STAFF_FROM} AS s
        ON LTRIM(RTRIM(ISNULL(s.new_code, N''))) = LTRIM(RTRIM(ISNULL(i.staff_code, N'')))
      LEFT JOIN ${HR_LEGACY_DEPT_FROM} AS d
        ON LTRIM(RTRIM(ISNULL(d.code, N''))) = LTRIM(RTRIM(ISNULL(s.join_department, N'')))
      WHERE LTRIM(RTRIM(ISNULL(i.del, N'0'))) = N'0'
        AND LTRIM(RTRIM(ISNULL(i.pass, N'0'))) = @pass
        AND (
          @hasKw = 0
          OR i.staff_code LIKE @kw
          OR i.staff_truename LIKE @kw
          OR i.room_code LIKE @kw
          OR ISNULL(s.name, N'') LIKE @kw
          OR ISNULL(d.name, N'') LIKE @kw
          ${hasRoomInfoCol ? 'OR LTRIM(RTRIM(ISNULL(i.room_info, N\'\'))) LIKE @kw' : ''}
        )
    `)
    const total = Number(totalRow.recordset?.[0]?.total ?? 0)

    const listReq = pool.request()
    listReq.input('pass', sql.NVarChar(10), passFilter)
    listReq.input('hasKw', sql.Bit, hasKw ? 1 : 0)
    listReq.input('kw', sql.NVarChar(200), kwPat)
    listReq.input('startRow', sql.Int, offsetRows + 1)
    listReq.input('endRow', sql.Int, endRow)

    const listResult = await listReq.query(`
      SELECT
        t.id,
        t.apply_date,
        t.in_time,
        t.staff_code,
        t.staff_truename,
        t.emp_name,
        t.dept_name,
        t.room_code,
        t.room_info,
        t.pass
      FROM (
        SELECT
          i.id,
          LTRIM(RTRIM(ISNULL(i.in_time, N''))) AS apply_date,
          LTRIM(RTRIM(ISNULL(i.in_time, N''))) AS in_time,
          LTRIM(RTRIM(ISNULL(i.staff_code, N''))) AS staff_code,
          LTRIM(RTRIM(ISNULL(i.staff_truename, N''))) AS staff_truename,
          LTRIM(RTRIM(ISNULL(s.name, ISNULL(i.staff_truename, N'')))) AS emp_name,
          LTRIM(RTRIM(ISNULL(d.name, N''))) AS dept_name,
          LTRIM(RTRIM(ISNULL(i.room_code, N''))) AS room_code,
          ${roomInfoSelect}
          LTRIM(RTRIM(ISNULL(i.pass, N'0'))) AS pass,
          ROW_NUMBER() OVER (ORDER BY i.id DESC) AS rn
        FROM ${HR_ROOM_IN_FROM} AS i
        LEFT JOIN ${HR_STAFF_FROM} AS s
          ON LTRIM(RTRIM(ISNULL(s.new_code, N''))) = LTRIM(RTRIM(ISNULL(i.staff_code, N'')))
        LEFT JOIN ${HR_LEGACY_DEPT_FROM} AS d
          ON LTRIM(RTRIM(ISNULL(d.code, N''))) = LTRIM(RTRIM(ISNULL(s.join_department, N'')))
        WHERE LTRIM(RTRIM(ISNULL(i.del, N'0'))) = N'0'
          AND LTRIM(RTRIM(ISNULL(i.pass, N'0'))) = @pass
          AND (
            @hasKw = 0
            OR i.staff_code LIKE @kw
            OR i.staff_truename LIKE @kw
            OR i.room_code LIKE @kw
            OR ISNULL(s.name, N'') LIKE @kw
            OR ISNULL(d.name, N'') LIKE @kw
            ${hasRoomInfoCol ? 'OR LTRIM(RTRIM(ISNULL(i.room_info, N\'\'))) LIKE @kw' : ''}
          )
      ) AS t
      WHERE t.rn BETWEEN @startRow AND @endRow
      ORDER BY t.rn
    `)

    res.json({
      code: 200,
      msg: 'success',
      data: { total, list: listResult.recordset ?? [] },
    })
  } catch (err) {
    console.error('GET /api/hr/dormitory/lodging-in/audit-center-list 失败：', err)
    const detail = String(err?.message ?? '数据库查询失败')
    res.status(500).json({ code: 500, msg: `加载审批列表失败：${detail}`, data: null })
  }
})

/**
 * 审核入住单：PUT /api/hr/dormitory/lodging-in/audit
 * body: { id } — Hr_room_in.id
 */
app.put('/api/hr/dormitory/lodging-in/audit', async (req, res) => {
  res.setHeader('X-ERP-Dormitory-Lodging-In-Audit', 'v1.1.4')
  try {
    const me = getCurrentUserFromReq(req)
    const { UID, uname: auditUname } = getActorAuditFromReq(req)
    const auditorName = String(me?.userName ?? me?.userCode ?? auditUname ?? '').trim() || '未知'
    const userCode = String(me?.userCode ?? auditUname ?? '').trim()
    const uidStr = UID != null && String(UID).trim() !== '' ? String(UID) : me?.userId != null ? String(me.userId) : ''

    const body = req.body ?? {}
    const id = Number(body.id)
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ code: 400, msg: 'id 不合法', data: null })
      return
    }

    const pool = await getPool()
    const exReq = pool.request()
    exReq.input('id', sql.Int, id)
    const exRs = await exReq.query(`
      SELECT TOP 1 i.id, i.pass, i.del, i.staff_code, i.room_code
      FROM ${HR_ROOM_IN_FROM} AS i
      WHERE i.id = @id
    `)
    const existing = exRs.recordset?.[0]
    if (!existing) {
      res.status(404).json({ code: 404, msg: '未找到该入住记录', data: null })
      return
    }
    if (String(existing?.del ?? '').trim() === '1') {
      res.status(400).json({ code: 400, msg: '该记录已删除，不能审核', data: null })
      return
    }
    if (String(existing?.pass ?? '').trim() === '1') {
      res.status(400).json({ code: 400, msg: '当前已是已审核状态', data: null })
      return
    }

    const now = legacyDeptNowString()
    const passip = getRequestIp(req) || null
    const q = pool.request()
    q.input('id', sql.Int, id)
    q.input('now', sql.NVarChar(50), now)
    q.input('passutruename', sql.NVarChar(50), auditorName)
    q.input('passuname', sql.NVarChar(50), userCode || null)
    q.input('passuid', sql.NVarChar(50), uidStr || null)
    q.input('passid', sql.NVarChar(50), uidStr || null)
    q.input('passip', sql.NVarChar(50), passip)
    await q.query(`
      UPDATE i
      SET
        i.pass = N'1',
        i.passutruename = @passutruename,
        i.passuname = @passuname,
        i.passuid = @passuid,
        i.passid = @passid,
        i.passip = @passip,
        i.edittime = @now
      FROM ${HR_ROOM_IN_FROM} AS i
      WHERE i.id = @id
        AND LTRIM(RTRIM(ISNULL(i.del, N'0'))) = N'0'
        AND LTRIM(RTRIM(ISNULL(i.pass, N'0'))) = N'0'
    `)

    // 入住审批页专用：操作审计中间件写入 Sys_OperationLogs 的可读摘要
    req.__auditDormLodgingInAuditContent = `管理员[${auditorName}]在「审核入住申请」通过审核：记录 id=${id}，工号[${String(existing?.staff_code ?? '').trim()}]，房号[${String(existing?.room_code ?? '').trim()}]`

    res.json({ code: 200, msg: 'success', data: { id } })
  } catch (err) {
    console.error('PUT /api/hr/dormitory/lodging-in/audit 失败：', err)
    const detail = String(err?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `审核失败：${detail}`, data: null })
  }
})

/**
 * 批量审核入住单：PUT /api/hr/dormitory/lodging-in/audit-batch
 * body: { ids: number[] }
 */
app.put('/api/hr/dormitory/lodging-in/audit-batch', async (req, res) => {
  res.setHeader('X-ERP-Dormitory-Lodging-In-Audit-Batch', 'v1.1.3')
  try {
    const me = getCurrentUserFromReq(req)
    const auditorName = String(me?.userName ?? me?.userCode ?? '').trim() || '未知'
    const userCode = String(me?.userCode ?? '').trim()
    const uidStr = me?.userId != null ? String(me.userId) : ''

    const body = req.body ?? {}
    const idsRaw = body.ids
    const ids = Array.isArray(idsRaw)
      ? [...new Set(idsRaw.map((x) => Math.floor(Number(x))).filter((n) => Number.isFinite(n) && n > 0))]
      : []
    if (ids.length === 0) {
      res.status(400).json({ code: 400, msg: 'ids 不能为空', data: null })
      return
    }
    if (ids.length > 200) {
      res.status(400).json({ code: 400, msg: '单次最多审核 200 条', data: null })
      return
    }

    const idList = ids.join(',')
    const now = legacyDeptNowString()
    const passip = getRequestIp(req) || null

    const pool = await getPool()
    const q = pool.request()
    q.input('now', sql.NVarChar(50), now)
    q.input('passutruename', sql.NVarChar(50), auditorName)
    q.input('passuname', sql.NVarChar(50), userCode || null)
    q.input('passuid', sql.NVarChar(50), uidStr || null)
    q.input('passid', sql.NVarChar(50), uidStr || null)
    q.input('passip', sql.NVarChar(50), passip)

    const upd = await q.query(`
      UPDATE i
      SET
        i.pass = N'1',
        i.passutruename = @passutruename,
        i.passuname = @passuname,
        i.passuid = @passuid,
        i.passid = @passid,
        i.passip = @passip,
        i.edittime = @now
      FROM ${HR_ROOM_IN_FROM} AS i
      WHERE i.id IN (${idList})
        AND LTRIM(RTRIM(ISNULL(i.del, N'0'))) = N'0'
        AND LTRIM(RTRIM(ISNULL(i.pass, N'0'))) = N'0'
    `)

    const affected = Number(upd.rowsAffected?.[0] ?? 0)
    res.json({ code: 200, msg: 'success', data: { requested: ids.length, updated: affected } })
  } catch (err) {
    console.error('PUT /api/hr/dormitory/lodging-in/audit-batch 失败：', err)
    const detail = String(err?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `批量审核失败：${detail}`, data: null })
  }
})

/**
 * v1.1.4：驳回入住申请（逻辑删除）：仅允许 pass='0' 且 del='0'
 * PUT /api/hr/dormitory/lodging-in/reject
 * body: { id } — Hr_room_in.id
 */
app.put('/api/hr/dormitory/lodging-in/reject', async (req, res) => {
  res.setHeader('X-ERP-Dormitory-Lodging-In-Reject', 'v1.1.4')
  try {
    const me = getCurrentUserFromReq(req)
    const { uname: auditUname } = getActorAuditFromReq(req)
    const opName = String(me?.userName ?? me?.userCode ?? auditUname ?? '').trim() || '未知'

    const body = req.body ?? {}
    const id = Number(body.id)
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ code: 400, msg: 'id 不合法', data: null })
      return
    }

    const pool = await getPool()
    const inColset = await getHrRoomInColumnSet(pool)
    const exReq = pool.request()
    exReq.input('id', sql.Int, id)
    const exRs = await exReq.query(`
      SELECT TOP 1 i.id, i.pass, i.del, i.staff_code, i.room_code
      FROM ${HR_ROOM_IN_FROM} AS i
      WHERE i.id = @id
    `)
    const existing = exRs.recordset?.[0]
    if (!existing) {
      res.status(404).json({ code: 404, msg: '未找到该入住记录', data: null })
      return
    }
    if (String(existing?.del ?? '').trim() === '1') {
      res.status(400).json({ code: 400, msg: '该记录已删除', data: null })
      return
    }
    if (String(existing?.pass ?? '').trim() === '1') {
      res.status(400).json({ code: 400, msg: '已审核记录不可驳回删除，请仅在待审核列表操作', data: null })
      return
    }

    const now = legacyDeptNowString()
    const q = pool.request()
    q.input('id', sql.Int, id)
    q.input('now', sql.NVarChar(50), now)
    const setEdit = inColset.has('edittime') ? ', i.edittime = @now' : ''
    await q.query(`
      UPDATE i
      SET i.del = N'1'${setEdit}
      FROM ${HR_ROOM_IN_FROM} AS i
      WHERE i.id = @id
        AND LTRIM(RTRIM(ISNULL(i.del, N'0'))) = N'0'
        AND LTRIM(RTRIM(ISNULL(i.pass, N'0'))) = N'0'
    `)

    req.__auditDormLodgingInRejectContent = `管理员[${opName}]在「审核入住申请」驳回并逻辑删除：记录 id=${id}，工号[${String(existing?.staff_code ?? '').trim()}]，房号[${String(existing?.room_code ?? '').trim()}]`

    res.json({ code: 200, msg: 'success', data: { id } })
  } catch (err) {
    console.error('PUT /api/hr/dormitory/lodging-in/reject 失败：', err)
    const detail = String(err?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `驳回失败：${detail}`, data: null })
  }
})

/**
 * 入住单反审核：PUT /api/dorm/un-audit（按需求独立路径）
 * body: { id } — 仅允许 del=0 且 pass=1 的记录改回 pass=0
 */
app.put('/api/dorm/un-audit', async (req, res) => {
  res.setHeader('X-ERP-Dorm-UnAudit', 'v1.1.4')
  try {
    const me = getCurrentUserFromReq(req)
    const { uname: auditUname } = getActorAuditFromReq(req)
    const opName = String(me?.userName ?? me?.userCode ?? auditUname ?? '').trim() || '未知'

    const body = req.body ?? {}
    const id = Number(body.id)
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ code: 400, msg: 'id 不合法', data: null })
      return
    }

    const pool = await getPool()
    const inColset = await getHrRoomInColumnSet(pool)
    const exReq = pool.request()
    exReq.input('id', sql.Int, id)
    const exRs = await exReq.query(`
      SELECT TOP 1
        i.id,
        i.pass,
        i.del,
        LTRIM(RTRIM(ISNULL(i.staff_code, N''))) AS staff_code,
        LTRIM(RTRIM(ISNULL(i.staff_truename, N''))) AS staff_truename,
        LTRIM(RTRIM(ISNULL(s.name, N''))) AS staff_name_join
      FROM ${HR_ROOM_IN_FROM} AS i
      LEFT JOIN ${HR_STAFF_FROM} AS s
        ON LTRIM(RTRIM(ISNULL(s.new_code, N''))) = LTRIM(RTRIM(ISNULL(i.staff_code, N'')))
      WHERE i.id = @id
    `)
    const existing = exRs.recordset?.[0]
    if (!existing) {
      res.status(404).json({ code: 404, msg: '未找到该入住记录', data: null })
      return
    }
    if (String(existing?.del ?? '').trim() === '1') {
      res.status(400).json({ code: 400, msg: '该记录已删除，不能反审核', data: null })
      return
    }
    if (String(existing?.pass ?? '').trim() !== '1') {
      res.status(400).json({ code: 400, msg: '仅已审核（pass=1）的记录可执行反审核', data: null })
      return
    }

    const nameJoin = String(existing?.staff_name_join ?? '').trim()
    const nameTrue = String(existing?.staff_truename ?? '').trim()
    const staffDisplay = nameJoin || nameTrue || String(existing?.staff_code ?? '').trim() || '未知'

    const now = legacyDeptNowString()
    const q = pool.request()
    q.input('id', sql.Int, id)
    q.input('now', sql.NVarChar(50), now)
    const setEdit = inColset.has('edittime') ? ', i.edittime = @now' : ''
    await q.query(`
      UPDATE i
      SET i.pass = N'0'${setEdit}
      FROM ${HR_ROOM_IN_FROM} AS i
      WHERE i.id = @id
        AND LTRIM(RTRIM(ISNULL(i.del, N'0'))) = N'0'
        AND LTRIM(RTRIM(ISNULL(i.pass, N'0'))) = N'1'
    `)

    req.__auditDormUnAuditContent = `管理员[${opName}]对员工[${staffDisplay}]的入住申请执行了【反审核】操作`

    res.json({ code: 200, msg: 'success', data: { id } })
  } catch (err) {
    console.error('PUT /api/dorm/un-audit 失败：', err)
    const detail = String(err?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `反审核失败：${detail}`, data: null })
  }
})

/**
 * 未审核入住申请物理删除：DELETE /api/dorm/delete-checkin
 * body: { id } — SQL 必须带 pass='0' 条件，禁止删除已审核（pass=1）的正式记录
 */
app.delete('/api/dorm/delete-checkin', async (req, res) => {
  res.setHeader('X-ERP-Dorm-Delete-Checkin', 'v1.1.4')
  try {
    const me = getCurrentUserFromReq(req)
    const { uname: auditUname } = getActorAuditFromReq(req)
    const opName = String(me?.userName ?? me?.userCode ?? auditUname ?? '').trim() || '未知'

    const body = req.body ?? {}
    const id = Number(body.id)
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ code: 400, msg: 'id 不合法', data: null })
      return
    }

    const pool = await getPool()
    const exReq = pool.request()
    exReq.input('id', sql.Int, id)
    const exRs = await exReq.query(`
      SELECT TOP 1
        i.id,
        i.pass,
        LTRIM(RTRIM(ISNULL(i.staff_code, N''))) AS staff_code,
        LTRIM(RTRIM(ISNULL(i.staff_truename, N''))) AS staff_truename,
        LTRIM(RTRIM(ISNULL(s.name, N''))) AS staff_name_join
      FROM ${HR_ROOM_IN_FROM} AS i
      LEFT JOIN ${HR_STAFF_FROM} AS s
        ON LTRIM(RTRIM(ISNULL(s.new_code, N''))) = LTRIM(RTRIM(ISNULL(i.staff_code, N'')))
      WHERE i.id = @id
    `)
    const existing = exRs.recordset?.[0]
    if (!existing) {
      res.status(404).json({ code: 404, msg: '未找到该入住记录', data: null })
      return
    }
    if (String(existing?.pass ?? '').trim() === '1') {
      res.status(400).json({ code: 400, msg: '已审核记录禁止物理删除', data: null })
      return
    }

    const nameJoin = String(existing?.staff_name_join ?? '').trim()
    const nameTrue = String(existing?.staff_truename ?? '').trim()
    const staffDisplay = nameJoin || nameTrue || String(existing?.staff_code ?? '').trim() || '未知'

    const delReq = pool.request()
    delReq.input('id', sql.Int, id)
    // 与业务强制一致：仅当 pass 归一为未审核 '0' 时删除（严禁去掉 AND pass 条件）
    const delRs = await delReq.query(`
      DELETE FROM ${HR_ROOM_IN_FROM}
      WHERE id = @id
        AND LTRIM(RTRIM(ISNULL(pass, N'0'))) = N'0'
    `)
    const affected = Array.isArray(delRs.rowsAffected) ? Number(delRs.rowsAffected[0] ?? 0) : 0
    if (affected <= 0) {
      res.status(400).json({ code: 400, msg: '删除失败：记录不存在或已不是未审核状态', data: null })
      return
    }

    req.__auditDormDeleteCheckinContent = `管理员 [${opName}] 彻底删除了员工 [${staffDisplay}] 的未审核入住申请`

    res.json({ code: 200, msg: 'success', data: { id } })
  } catch (err) {
    console.error('DELETE /api/dorm/delete-checkin 失败：', err)
    const detail = String(err?.message ?? '数据库删除失败')
    res.status(500).json({ code: 500, msg: `删除失败：${detail}`, data: null })
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
  const bootAt = new Date().toISOString()
  console.log(`API 服务已启动：http://localhost:${port}`)
  console.log(`[启动指纹] bootAt=${bootAt}`)
  console.log(`[启动指纹] v1.1.3-ElectricFee-Fix bootAt=${bootAt}`)
  console.log(`Dorm-Module-Query-Trigger-Active ${bootAt}`)
  console.log(`Dorm-CheckIn-SmartLogic-v1.1.3-Active ${bootAt}`)
  console.log(`Dorm-CheckIn-Final-v1.1.3-Active ${bootAt}`)
  console.log(`Dorm-CheckIn-Overlap-Validation-Active ${bootAt}`)
  console.log(`Dorm-CheckOut-OutRoomLogic-Active ${bootAt}`)
  console.log(`Dorm-Manage-Popup-Optimized-Active ${bootAt}`)
  console.log(`Dorm-CheckIn-NullBug-Fixed-${bootAt}`)
  console.log(`Dorm-Audit-ReverseLogic-v1.1.4-Active ${bootAt}`)
  console.log(`Dorm-Audit-HardDelete-Logic-v1.1.4-Active ${bootAt}`)
  console.log(`Dorm-History-NoDateFilter-v1.1.4-Active ${bootAt}`)
  console.log('[部门资料] POST /api/hr/departments：code 由服务端自增，不要求 body.code（若仍提示 code 必填，多为未重启后端或 3001 被其它程序占用）')
  console.log(
    '[宿舍管理] v1.1.10 电费：tj_date=yyyy-m/yy-mm 字符串匹配 + MAX(c_sum_money) 防重复累加；含 lodging-overview/history、入住单 audit*',
  )
})

