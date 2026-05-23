/**
 * 后端 API 服务入口
 * 目标：
 * - 连接 SQL Server
 * - 提供 Sys_Users 查询接口给前端页面使用
 */
import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import fs from 'node:fs'
import path from 'node:path'
import multer from 'multer'
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
import { getActorAuditFromReq, getActorAuditTripletFromReq } from './businessAuditFields.js'
import { configureOperationLogWriter, writeLog, writeOperationLog, SYS_OPERATION_LOGS_FROM } from './operationLogWriter.js'
import {
  getSysUsersColumnsMeta,
  getSysUsersColumnSet,
  getSysUsersEntityPkQb,
  getSysUserRowFieldIgnoreCase,
  invalidateSysUsersColumnsMeta,
  isSysUserRowLoginDisabled,
  rejectLegacySysUsersCrud,
  resolveSysUsersPasswordForStorage,
  resolveSysUsersTruenameByUsercode,
  sysUsersAccountCodeExpr,
  sysUsersPasswordExpr,
} from './sysUsersDb.js'
import { mapSqlServerWriteError } from './sqlServerWriteErrors.js'
import {
  getOperatorUserDetail,
  insertOperatorUserLegacy,
  isOperatorUsersV2,
  putOperatorUser,
  queryOperatorUsersPage,
  restoreOperatorUserDel,
} from './operatorUsersHandlers.js'
import { registerPurchaseQuotationRoutes } from './purchaseQuotationHandlers.js'
import { registerOutsourcingQuotationRoutes } from './outsourcingQuotationHandlers.js'
import {
  ensurePaperPatternImportTmpDir,
  handlePaperPatternImportPreviewGet,
} from './paperPatternImportPreview.js'
import { handleGetPaperPatternImportFilesList } from './paperPatternImportFilesList.js'
import { handleGetPaperPatternImportFileDownload } from './paperPatternImportFileDownload.js'
import { getPaperPatternDownloadRoot, getPaperPatternUploadDir } from './paperPatternFilePaths.js'
import { handleGetPaperPatternMapping, handleSavePaperPatternMapping } from './paperPatternImportMapping.js'
import { handlePaperPatternImportValidateGet } from './paperPatternImportValidate.js'
import { handlePostPaperPatternCheckMaterial } from './paperPatternCheckMaterial.js'
import { handlePostPaperPatternMaterialBomFields } from './paperPatternMaterialBomFields.js'
import { handleGetPaperPatternImportParseTree } from './paperPatternImportParseTreeGet.js'
import { handlePostPaperPatternImportCommitBom000 } from './paperPatternImportCommitBom000.js'
import { handlePostPaperPatternImportDeleteBomTree } from './paperPatternImportDeleteBomTree.js'
import { decodePaperPatternUploadFileName } from './paperPatternUploadFileName.js'
import { parsePaperPatternImportTreeFromBuffer } from './paperPatternImportParse.js'
import {
  bomCostMaterialStartsWithCutPrefix,
  bomCostUsageMatchesHidePrefix,
  buildBomCostInsertPayloadFromFlatUsage,
  computeBomUsageYlFromParent,
  resolveBomCostTopFields,
} from './bomUsageYl.js'
import {
  applyBomCostAuditToRows,
  enrichBomCostInsertRowsFromBom000,
  fetchBom000ForBomCostEnrich,
  formatBomCostAuditTimestamp,
  insertBomCostBulkEnriched,
} from './bomCostEnrichFromBom000.js'
import { buildBomPartsUsageTreeNodes } from './bomUsageTreeBuild.js'
import { handlePostBomMasterPropagate } from './bomMasterPropagate.js'

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
 * - 查询参数：page、pageSize、pass（1=启用视图 / 0=回收站）、keyword（模糊匹配 RoleName、Description）
 *   - 兼容旧前端：仍接受 status 参数，并映射到 pass
 * - 返回：{ code, msg, list, total }
 * - 操作员弹窗拉启用角色：传 page=1&pageSize=500&pass=1 即可（与模块分页标准一致）
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

    const passRaw = req.query?.pass ?? req.query?.status
    const parsedPass = Number(passRaw)
    const safePass = parsedPass === 0 ? '0' : '1'

    const keywordRaw = String(req.query?.keyword ?? '').trim()
    const hasKeyword = keywordRaw.length > 0
    const likeKey = `%${keywordRaw}%`

    const whereSql = hasKeyword
      ? 'WHERE r.pass = @pass AND (r.RoleName LIKE @key OR r.Description LIKE @key)'
      : 'WHERE r.pass = @pass'

    const pool = await getPool()

    const totalRequest = pool.request()
    totalRequest.input('pass', sql.NVarChar(1), safePass)
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
    listRequest.input('pass', sql.NVarChar(1), safePass)
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
          r.pass,
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
      fallbackRequest.input('pass', sql.NVarChar(1), safePass)
      if (hasKeyword) {
        fallbackRequest.input('key', sql.NVarChar(200), likeKey)
      }

      result = await fallbackRequest.query(`
        SELECT
          RoleID,
          RoleName,
          Description,
          pass,
          Status,
          Permissions
        FROM (
          SELECT
            r.RoleID,
            r.RoleName,
            r.Description,
            r.pass,
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

    // 规则 16：uid/uname/utruename 仅从登录态取，禁止前端传参覆盖
    const { uidInt, uname: unameVal, utruename: utruenameVal } = getActorAuditTripletFromReq(req)
    if (uidInt == null) {
      res.status(401).json({ code: 401, msg: '无法识别当前操作员，请重新登录后再试', data: null })
      return
    }

    const pool = await getPool()
    const request = pool.request()
    request.input('RoleName', sql.NVarChar(50), roleName)
    request.input('Description', sql.NVarChar(200), description)
    request.input('uid', sql.Int, uidInt)
    request.input('uname', sql.NVarChar(50), unameVal)
    request.input('utruename', sql.NVarChar(50), utruenameVal)
    const addtimeStr = formatBomColorcodeTimestamp()
    request.input('addtime', sql.NVarChar(50), addtimeStr)

    let result
    try {
      result = await request.query(`
        INSERT INTO Sys_Roles (RoleName, Description, pass, Status, Permissions, uid, uname, utruename, addtime)
        OUTPUT
          INSERTED.RoleID,
          INSERTED.RoleName,
          INSERTED.Description,
          INSERTED.pass,
          INSERTED.Status,
          INSERTED.Permissions,
          INSERTED.uid,
          INSERTED.uname,
          INSERTED.utruename,
          INSERTED.addtime,
          INSERTED.edittime,
          INSERTED.deltime
        VALUES (@RoleName, @Description, N'1', 1, NULL, @uid, @uname, @utruename, @addtime)
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
 * 修改角色：分支 A 禁用（pass='0'，并同步 Status=0）；分支 B 编辑 RoleName / Description
 * 兼容：仍接受 body.Status=0 的旧写法
 */
app.put('/api/roles', async (req, res) => {
  try {
    const body = req.body ?? {}
    const roleId = Number(body.RoleID)
    if (!Number.isFinite(roleId) || roleId <= 0) {
      res.status(400).json({ code: 400, msg: 'RoleID 不合法（必须是正整数）', data: null })
      return
    }

    // 规则 16：uid/uname/utruename 仅从登录态取，禁止前端传参覆盖
    const { uidInt, uname: unameVal, utruename: utruenameVal } = getActorAuditTripletFromReq(req)
    if (uidInt == null) {
      res.status(401).json({ code: 401, msg: '无法识别当前操作员，请重新登录后再试', data: null })
      return
    }
    const nowStr = formatBomColorcodeTimestamp()

    const pool = await getPool()
    const request = pool.request()
    request.input('RoleID', sql.Int, roleId)
    request.input('uid', sql.Int, uidInt)
    request.input('uname', sql.NVarChar(50), unameVal)
    request.input('utruename', sql.NVarChar(50), utruenameVal)
    request.input('now', sql.NVarChar(50), nowStr)

    const hasPassInBody = body.pass !== undefined && body.pass !== null
    const hasStatusInBody = body.Status !== undefined && body.Status !== null
    if (hasPassInBody || hasStatusInBody) {
      const nextPass = String(hasPassInBody ? body.pass : Number(body.Status) === 0 ? '0' : '1').trim()
      if (nextPass !== '0') {
        res
          .status(400)
          .json({ code: 400, msg: "目前仅支持把 pass 更新为 '0'（禁用）", data: null })
        return
      }
      request.input('pass', sql.NVarChar(1), '0')
      request.input('Status', sql.Int, 0)
      const result = await request.query(`
        UPDATE Sys_Roles
        SET
          pass = @pass,
          Status = @Status,
          uid = @uid,
          uname = @uname,
          utruename = @utruename,
          deltime = @now,
          edittime = @now
        OUTPUT
          INSERTED.RoleID,
          INSERTED.RoleName,
          INSERTED.Description,
          INSERTED.pass,
          INSERTED.Status,
          INSERTED.Permissions,
          INSERTED.uid,
          INSERTED.uname,
          INSERTED.utruename,
          INSERTED.addtime,
          INSERTED.edittime,
          INSERTED.deltime
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
        SET
          RoleName = @RoleName,
          Description = @Description,
          uid = @uid,
          uname = @uname,
          utruename = @utruename,
          edittime = @now
        OUTPUT
          INSERTED.RoleID,
          INSERTED.RoleName,
          INSERTED.Description,
          INSERTED.pass,
          INSERTED.Status,
          INSERTED.Permissions,
          INSERTED.uid,
          INSERTED.uname,
          INSERTED.utruename,
          INSERTED.addtime,
          INSERTED.edittime,
          INSERTED.deltime
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
 * 恢复角色（pass 从 '0' 改回 '1'，并同步 Status=1）
 */
app.put('/api/roles/resume', async (req, res) => {
  try {
    const roleId = Number(req.body?.RoleID)
    if (!Number.isFinite(roleId) || roleId <= 0) {
      res.status(400).json({ code: 400, msg: 'RoleID 不合法（必须是正整数）', data: null })
      return
    }

    // 规则 16：uid/uname/utruename 仅从登录态取，禁止前端传参覆盖
    const { uidInt, uname: unameVal, utruename: utruenameVal } = getActorAuditTripletFromReq(req)
    if (uidInt == null) {
      res.status(401).json({ code: 401, msg: '无法识别当前操作员，请重新登录后再试', data: null })
      return
    }
    const nowStr = formatBomColorcodeTimestamp()

    const pool = await getPool()
    const request = pool.request()
    request.input('RoleID', sql.Int, roleId)
    request.input('pass', sql.NVarChar(1), '1')
    request.input('Status', sql.Int, 1)
    request.input('uid', sql.Int, uidInt)
    request.input('uname', sql.NVarChar(50), unameVal)
    request.input('utruename', sql.NVarChar(50), utruenameVal)
    request.input('now', sql.NVarChar(50), nowStr)

    const result = await request.query(`
      UPDATE Sys_Roles
      SET
        pass = @pass,
        Status = @Status,
        uid = @uid,
        uname = @uname,
        utruename = @utruename,
        deltime = NULL,
        edittime = @now
      OUTPUT
        INSERTED.RoleID,
        INSERTED.RoleName,
        INSERTED.Description,
        INSERTED.pass,
        INSERTED.Status,
        INSERTED.Permissions,
        INSERTED.uid,
        INSERTED.uname,
        INSERTED.utruename,
        INSERTED.addtime,
        INSERTED.edittime,
        INSERTED.deltime
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

    // 规则 16：uid/uname/utruename 仅从登录态取，禁止前端传参覆盖
    const { uidInt, uname: unameVal, utruename: utruenameVal } = getActorAuditTripletFromReq(req)
    if (uidInt == null) {
      res.status(401).json({ code: 401, msg: '无法识别当前操作员，请重新登录后再试', data: null })
      return
    }
    const nowStr = formatBomColorcodeTimestamp()

    const pool = await getPool()
    const request = pool.request()
    request.input('RoleID', sql.Int, roleId)
    request.input('Permissions', sql.NVarChar(sql.MAX), parsed.jsonStr)
    request.input('uid', sql.Int, uidInt)
    request.input('uname', sql.NVarChar(50), unameVal)
    request.input('utruename', sql.NVarChar(50), utruenameVal)
    request.input('now', sql.NVarChar(50), nowStr)

    const result = await request.query(`
      UPDATE Sys_Roles
      SET
        Permissions = @Permissions,
        uid = @uid,
        uname = @uname,
        utruename = @utruename,
        edittime = @now
      OUTPUT
        INSERTED.RoleID,
        INSERTED.RoleName,
        INSERTED.Description,
        INSERTED.pass,
        INSERTED.Status,
        INSERTED.Permissions,
        INSERTED.uid,
        INSERTED.uname,
        INSERTED.utruename,
        INSERTED.addtime,
        INSERTED.edittime,
        INSERTED.deltime
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
      SELECT TOP (1) pass, Status FROM Sys_Roles WHERE RoleID = @RoleID
    `)
    const row = q1.recordset?.[0]
    if (!row) {
      res.status(404).json({ code: 404, msg: '未找到该角色', data: null })
      return
    }
    const rowPass = String(row.pass ?? '').trim()
    const isDisabled = rowPass === '0' || Number(row.Status) === 0
    if (!isDisabled) {
      res.status(400).json({ code: 400, msg: '请先禁用角色并放入回收站后，再执行删除', data: null })
      return
    }

    const suMeta = await getSysUsersColumnsMeta(pool)
    let cnt = 0
    if (!suMeta.legacyLayout) {
      const q2 = await pool.request().input('RoleID', sql.Int, roleId).query(`
        SELECT COUNT(1) AS cnt FROM Sys_Users WHERE RoleID = @RoleID
      `)
      cnt = Number(q2.recordset?.[0]?.cnt ?? 0)
    }
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
 * 1) 校验账号是否存在（ERP：UserName；旧表：username 登录账号列）
 * 2) 校验账号是否被禁用（有 del 列：del='1'；否则 Status=0）
 * 3) 校验密码是否正确
 *
 * 返回格式（统一风格）：
 * - 成功：{ code: 200, msg: 'success', data: { token, user } }
 * - 失败：{ code: 400/403/500, msg: '中文原因', data: null }
 */
app.post('/api/login', async (req, res) => {
  try {
    // 关键：从请求体读取用户输入（Account 优先；兼容旧前端只传 UserCode）
    let loginVal = String(req.body?.Account ?? '').trim()
    if (!loginVal) loginVal = String(req.body?.UserCode ?? '').trim()
    const password = String(req.body?.Password ?? '')

    if (!loginVal) {
      res.status(400).json({ code: 400, msg: '登录账号不能为空', data: null })
      return
    }
    if (!String(password).trim()) {
      res.status(400).json({ code: 400, msg: '密码不能为空', data: null })
      return
    }

    // 关键：获取数据库连接池
    const pool = await getPool()
    // 每次登录重读 Sys_Users 列清单，避免 INFORMATION_SCHEMA 变更或缓存导致 del/Status 误判
    invalidateSysUsersColumnsMeta()
    const meta = await getSysUsersColumnsMeta(pool)
    const userColset = meta.set

    // 关键：参数化查询（防 SQL 注入 + nvarchar 兼容中文）
    const request = pool.request()
    request.input('LoginId', sql.NVarChar(100), loginVal)

    let result
    if (meta.legacyLayout) {
      // 业务主键：优先 UserID；人事姓名 JOIN 仍用 uid = Hr_staff.id（与主键分离）
      const qUidForStaff = meta.qb('uid')
      const qEntityPk = getSysUsersEntityPkQb(meta)
      const qUsercode = meta.qb('usercode')
      const qUsername = meta.qb('username')
      const qPassword = meta.qb('password')
      const qIsAdmin = meta.set.has('is_admin') ? meta.qb('is_admin') : null
      const qRoleId = meta.qb('roleid')
      const isActiveSel = userColset.has('is_active') ? `u.${meta.qb('is_active')} AS is_active,` : ''
      const delSel = userColset.has('del') ? `u.${meta.qb('del')} AS del,` : ''
      const legacyOperatorV2 = isOperatorUsersV2(meta)
      const roleNameSql = legacyOperatorV2 && qRoleId
        ? qIsAdmin
          ? `CASE WHEN u.${qIsAdmin} = 1 THEN N'系统管理员' WHEN r.RoleName IS NOT NULL AND LTRIM(RTRIM(r.RoleName)) <> N'' THEN r.RoleName ELSE N'普通用户' END`
          : `CASE WHEN r.RoleName IS NOT NULL AND LTRIM(RTRIM(r.RoleName)) <> N'' THEN r.RoleName ELSE N'普通用户' END`
        : qIsAdmin
          ? `CASE WHEN u.${qIsAdmin} = 1 THEN N'系统管理员' ELSE N'普通用户' END`
          : `N'普通用户'`
      const permSql =
        legacyOperatorV2 && qRoleId
          ? qIsAdmin
            ? `CASE WHEN u.${qIsAdmin} = 1 THEN N'{"*":["all"]}' ELSE CAST(r.Permissions AS NVARCHAR(MAX)) END`
            : `CAST(r.Permissions AS NVARCHAR(MAX))`
          : qIsAdmin
            ? `CASE WHEN u.${qIsAdmin} = 1 THEN N'{"*":["all"]}' ELSE N'[]' END`
            : `N'[]'`
      const roleIdSel =
        legacyOperatorV2 && qRoleId ? `u.${qRoleId}` : `CAST(NULL AS INT)`
      const rolesJoin =
        legacyOperatorV2 && qRoleId ? `LEFT JOIN Sys_Roles AS r ON r.RoleID = u.${qRoleId}` : ''
      if (!qEntityPk || !qUidForStaff || !qUsercode || !qUsername || !qPassword) {
        res.status(500).json({
          code: 500,
          msg: '登录失败：Sys_Users 旧表缺少主键列（UserID/uid）、uid（人事关联）、usercode、username 或 password 列',
          data: null,
        })
        return
      }
      result = await request.query(`
        SELECT TOP (1)
          u.${qEntityPk} AS UserID,
          u.${qUsercode} AS UserCode,
          u.${qUsername} AS UserName,
          ${delSel}
          u.${qPassword} AS Password,
          CAST(1 AS INT) AS Status,
          ${isActiveSel}
          ${roleIdSel} AS RoleID,
          CAST(${roleNameSql} AS NVARCHAR(50)) AS RoleName,
          CAST(${permSql} AS NVARCHAR(MAX)) AS Permissions,
          s.[name] AS StaffDisplayName
        FROM Sys_Users AS u
        ${rolesJoin}
        LEFT JOIN ${meta.hrStaffFrom} AS s ON s.[id] = u.${qUidForStaff}
        WHERE u.${qUsername} = @LoginId OR u.${qUsercode} = @LoginId
      `)
    } else {
      // ERP / 标准表：登录账号列 = UserName（库中实际大小写由 qb 解析），密码列 = password（同上）
      const qLogin = meta.qb('username')
      const qPwd = meta.qb('password')
      if (!qLogin || !qPwd) {
        res.status(500).json({
          code: 500,
          msg: '登录失败：Sys_Users 缺少登录账号列（UserName）或密码列（password），请检查表结构',
          data: null,
        })
        return
      }
      const selUserId = userColset.has('userid') ? `u.${meta.qb('userid')} AS UserID` : 'CAST(NULL AS INT) AS UserID'
      const selUserCode = userColset.has('usercode')
        ? `u.${meta.qb('usercode')} AS UserCode`
        : `CAST(N'' AS NVARCHAR(50)) AS UserCode`
      const selDel = userColset.has('del') ? `u.${meta.qb('del')} AS del,` : ''
      const selStatus = userColset.has('status')
        ? `u.${meta.qb('status')} AS Status,`
        : 'CAST(1 AS INT) AS Status,'
      const selIsActive = userColset.has('is_active') ? `u.${meta.qb('is_active')} AS is_active,` : ''
      const selRoleId = userColset.has('roleid')
        ? `u.${meta.qb('roleid')} AS RoleID`
        : 'CAST(NULL AS INT) AS RoleID'
      const joinRoles = userColset.has('roleid')
        ? `LEFT JOIN Sys_Roles AS r ON r.RoleID = u.${meta.qb('roleid')}`
        : `LEFT JOIN Sys_Roles AS r ON 1 = 0`
      result = await request.query(`
        SELECT TOP (1)
          ${selUserId},
          ${selUserCode},
          u.${qLogin} AS UserName,
          ${selDel}
          u.${qPwd} AS Password,
          ${selStatus}
          ${selIsActive}
          ${selRoleId},
          r.RoleName AS RoleName,
          r.Permissions AS Permissions
        FROM Sys_Users AS u
        ${joinRoles}
        WHERE u.${qLogin} = @LoginId
      `)
    }

    // 关键：拿到用户行
    const userRow = result.recordset?.[0]

    // 1) 校验用户名是否存在
    if (!userRow) {
      res.status(400).json({ code: 400, msg: '账号不存在', data: null })
      return
    }

    // 2) 校验账号是否被禁用：Sys_Users.del='1' 为禁用；无 del 列时用 Status=0（见 sysUsersDb.isSysUserRowLoginDisabled）
    if (isSysUserRowLoginDisabled(userRow, userColset)) {
      res.status(403).json({ code: 403, msg: '账号已被禁用，请联系管理员', data: null })
      return
    }
    // v1.1.2：账号是否可登录（is_active=0 则封禁；列名大小写兼容）
    const isActiveRaw = getSysUserRowFieldIgnoreCase(userRow, ['is_active', 'Is_Active', 'IS_ACTIVE'])
    if (userColset.has('is_active') && Number(isActiveRaw ?? 1) === 0) {
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
      // 约定：审计/uname 用工号 UserCode（与 businessAuditFields 一致）
      userCode: String(userRow.UserCode ?? ''),
      // 优先人事档案姓名（旧表 uid=Hr_staff.id）；否则用库中登录账号列
      userName: String(userRow.StaffDisplayName ?? userRow.UserName ?? ''),
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
          Account: userRow.UserName != null ? String(userRow.UserName) : null,
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
 * 查看单条操作员（v1.1.9：旧版 Sys_Users + del/pass 时 JOIN 人事/角色）
 */
app.get('/api/users/:id', async (req, res) => {
  try {
    const userId = Number(req.params?.id)
    if (!Number.isFinite(userId) || userId <= 0) {
      res.status(400).json({ code: 400, msg: 'id 不合法', data: null })
      return
    }
    const pool = await getPool()
    const meta = await getSysUsersColumnsMeta(pool)
    if (!isOperatorUsersV2(meta)) {
      res.status(400).json({ code: 400, msg: '当前库结构不支持该查看接口', data: null })
      return
    }
    const row = await getOperatorUserDetail(pool, meta, userId)
    if (!row) {
      res.status(404).json({ code: 404, msg: '未找到该用户', data: null })
      return
    }
    res.json({ code: 200, msg: 'success', data: row })
  } catch (err) {
    console.error('GET /api/users/:id 失败：', err)
    res.status(500).json({ code: 500, msg: '查询失败', data: null })
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

    // v2 在册列表：pass=1 已审核（默认）；pass=0 显示未审核；回收站 status=0 不按 pass 过滤
    const passRaw = String(req.query?.pass ?? '1').trim()
    const passFilter = passRaw === '0' ? '0' : '1'

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

    const pool = await getPool()
    const meta = await getSysUsersColumnsMeta(pool)

    // 旧系统 Sys_Users：uid/username/usercode 等，只读列表映射为前端字段
    if (meta.legacyLayout) {
      // v1.1.9：含 del+pass 时列表改为 Usercode→Hr_staff.code、RoleID→Sys_Roles，仅 ROW_NUMBER 分页
      if (isOperatorUsersV2(meta)) {
        try {
          const r = await queryOperatorUsersPage(pool, meta, {
            offset,
            safePageSize,
            safeStatus,
            passFilter: safeStatus === 1 ? passFilter : undefined,
            keywordRaw,
          })
          res.json({ code: 200, msg: 'success', list: r.list, total: r.total })
          return
        } catch (opErr) {
          console.error('查询 /api/users（操作员 v2）失败：', opErr)
          res.status(500).json({ code: 500, msg: String(opErr?.message ?? '列表查询失败'), list: [], total: 0 })
          return
        }
      }
      const qUidForStaff = meta.qb('uid')
      const qEntityPk = getSysUsersEntityPkQb(meta)
      const qUsercode = meta.qb('usercode')
      const qUsername = meta.qb('username')
      const qIsAdmin = meta.set.has('is_admin') ? meta.qb('is_admin') : null
      if (!qEntityPk || !qUidForStaff || !qUsercode || !qUsername) {
        res.status(500).json({ code: 500, msg: 'error', list: [], total: 0 })
        return
      }
      // 有 del 时：列表双视图按逻辑删除位（与全库约定一致：'0'/空=正常，'1'=禁用）
      let statusCond = '1=1'
      if (meta.set.has('del')) {
        const qd = meta.qb('del')
        const delActive = `(LTRIM(RTRIM(ISNULL(u.${qd}, N''))) = N'' OR LTRIM(RTRIM(ISNULL(u.${qd}, N''))) = N'0')`
        const delBanned = `(LTRIM(RTRIM(ISNULL(u.${qd}, N''))) = N'1')`
        statusCond = safeStatus === 1 ? delActive : delBanned
      } else if (meta.set.has('status')) {
        statusCond = `u.${meta.qb('status')} = @status`
      } else if (meta.set.has('is_active')) {
        statusCond = `u.${meta.qb('is_active')} = @status`
      }
      const kwCond = hasKeyword
        ? ` AND (u.${qUsercode} LIKE @key OR u.${qUsername} LIKE @key OR s.[name] LIKE @key)`
        : ''
      const baseFrom = `FROM Sys_Users AS u
        LEFT JOIN ${meta.hrStaffFrom} AS s ON s.[id] = u.${qUidForStaff}`
      const whereLegacy = `WHERE ${statusCond}${kwCond}`
      const orderExpr = meta.set.has('createdat')
        ? `u.${meta.qb('createdat')} DESC`
        : `u.${qEntityPk} DESC`
      const roleCase = qIsAdmin
        ? `CASE WHEN u.${qIsAdmin} = 1 THEN N'超级管理员' ELSE N'普通用户' END`
        : `N'普通用户'`
      const selCols = `
          u.${qEntityPk} AS UserID,
          u.${qUsercode} AS UserCode,
          u.${qUsername} AS UserName,
          ${meta.set.has('status') ? `u.${meta.qb('status')} AS Status` : 'CAST(1 AS INT) AS Status'},
          ${meta.set.has('createdat') ? `u.${meta.qb('createdat')} AS CreatedAt` : 'CAST(NULL AS DATETIME) AS CreatedAt'},
          CAST(NULL AS INT) AS RoleID,
          CAST(${roleCase} AS NVARCHAR(50)) AS RoleName`

      const totalReq = pool.request()
      totalReq.input('status', sql.Int, safeStatus)
      if (hasKeyword) totalReq.input('key', sql.NVarChar(100), likeKey)
      const totalR = await totalReq.query(`
        SELECT COUNT(1) AS total
        ${baseFrom}
        ${whereLegacy}
      `)
      const totalLegacy = Number(totalR.recordset?.[0]?.total ?? 0)

      const listReq = pool.request()
      listReq.input('offset', sql.Int, offset)
      listReq.input('pageSize', sql.Int, safePageSize)
      listReq.input('status', sql.Int, safeStatus)
      if (hasKeyword) listReq.input('key', sql.NVarChar(100), likeKey)

      let resultLegacy
      try {
        resultLegacy = await listReq.query(`
          SELECT ${selCols}
          ${baseFrom}
          ${whereLegacy}
          ORDER BY ${orderExpr}
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
        const fb = pool.request()
        fb.input('startRow', sql.Int, startRow)
        fb.input('endRow', sql.Int, endRow)
        fb.input('status', sql.Int, safeStatus)
        if (hasKeyword) fb.input('key', sql.NVarChar(100), likeKey)
        resultLegacy = await fb.query(`
          SELECT UserID, UserCode, UserName, Status, CreatedAt, RoleID, RoleName
          FROM (
            SELECT
              ${selCols},
              ROW_NUMBER() OVER (ORDER BY ${orderExpr}) AS rn
            ${baseFrom}
            ${whereLegacy}
          ) t
          WHERE t.rn BETWEEN @startRow AND @endRow
          ORDER BY t.rn
        `)
      }

      res.json({ code: 200, msg: 'success', list: resultLegacy.recordset ?? [], total: totalLegacy })
      return
    }

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
    let whereSql
    if (meta.set.has('del')) {
      const qd = meta.qb('del')
      const delActive = `(LTRIM(RTRIM(ISNULL(u.${qd}, N''))) = N'' OR LTRIM(RTRIM(ISNULL(u.${qd}, N''))) = N'0')`
      const delBanned = `(LTRIM(RTRIM(ISNULL(u.${qd}, N''))) = N'1')`
      const delPart = safeStatus === 1 ? delActive : delBanned
      whereSql = hasKeyword
        ? `WHERE ${delPart} AND (u.UserCode LIKE @key OR u.UserName LIKE @key)`
        : `WHERE ${delPart}`
    } else {
      whereSql = hasKeyword
        ? 'WHERE u.Status = @status AND (u.UserCode LIKE @key OR u.UserName LIKE @key)'
        : 'WHERE u.Status = @status'
    }

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
    const metaResume = await getSysUsersColumnsMeta(pool)
    if (isOperatorUsersV2(metaResume)) {
      const out = await restoreOperatorUserDel(pool, metaResume, req, userId)
      if (out.error) {
        res.status(out.error.status).json(out.error.json)
        return
      }
      res.json({ code: 200, msg: 'success', data: out.data })
      return
    }
    if (await rejectLegacySysUsersCrud(pool, res)) return

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
    const meta = await getSysUsersColumnsMeta(pool)
    const acExpr = sysUsersAccountCodeExpr(meta)
    const pwExpr = sysUsersPasswordExpr(meta)
    const acColBare = String(acExpr).replace(/^u\./, '')
    const pwColBare = String(pwExpr).replace(/^u\./, '')

    // =========================
    // 第 1 步：查出当前用户数据库里的旧密码
    // =========================
    // 小白版解释（最关键的安全点）：
    // - 我们不用 UserID，也不用前端传 UserCode
    // - 只用后端根据 token 得到的 current.userCode（旧表为 usercode 账号编码）
    // - 然后在 SQL 里写：
    //   WHERE 账号编码列 = @UserCode
    // - 因为 @UserCode 是参数，而且值来自当前登录人，所以能确保“只动当前用户自己的记录”
    const checkReq = pool.request()
    checkReq.input('UserCode', sql.NVarChar(50), String(current.userCode))

    const checkResult = await checkReq.query(`
      SELECT TOP (1)
        ${acExpr} AS UserCode,
        ${pwExpr} AS Password
      FROM Sys_Users AS u
      WHERE ${acExpr} = @UserCode
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
    const pwdResolved = await resolveSysUsersPasswordForStorage(newPassword, meta, hashPassword, pool)
    if (pwdResolved.error) {
      res.status(400).json({ code: 400, msg: pwdResolved.error, data: null })
      return
    }

    const updateReq = pool.request()
    updateReq.input('UserCode', sql.NVarChar(50), String(current.userCode))
    updateReq.input('NewPassword', sql.NVarChar(200), String(pwdResolved.stored))

    const updateResult = await updateReq.query(`
      UPDATE Sys_Users
      SET ${pwColBare} = @NewPassword
      WHERE ${acColBare} = @UserCode
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
    const mapped = mapSqlServerWriteError(err, { hint: '修改密码' })
    const status = mapped?.status ?? 500
    res.status(status).json({
      code: status,
      msg: mapped?.msg ?? '修改失败：数据库写入异常，请联系管理员',
      data: null,
    })
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
    const metaDel = await getSysUsersColumnsMeta(pool)
    if (isOperatorUsersV2(metaDel)) {
      res.status(400).json({
        code: 400,
        msg: '本环境已启用逻辑删除：请使用「软删除」将 del 置为 1，勿使用物理 DELETE。',
        data: null,
      })
      return
    }
    if (await rejectLegacySysUsersCrud(pool, res)) return

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
    const body = req.body ?? {}

    // 关键：v2（del/pass）先分流：密码由 insertOperatorUserLegacy 固定为 123，不要求前端传 Password
    const pool = await getPool()
    const metaUsers = await getSysUsersColumnsMeta(pool)
    if (isOperatorUsersV2(metaUsers)) {
      const out = await insertOperatorUserLegacy(pool, metaUsers, req, body, hashPassword)
      if (out.error) {
        res.status(out.error.status).json(out.error.json)
        return
      }
      res.json({ code: 200, msg: 'success', data: out.data })
      return
    }

    const { UserCode, UserName, Password, RoleID } = body

    // 关键：旧版 Sys_Users 做最基础的后端校验，避免插入空数据
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

    if (await rejectLegacySysUsersCrud(pool, res)) return

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

    const pwdResolved = await resolveSysUsersPasswordForStorage(Password, metaUsers, hashPassword, pool)
    if (pwdResolved.error) {
      res.status(400).json({ code: 400, msg: pwdResolved.error, data: null })
      return
    }
    request.input('Password', sql.NVarChar(200), String(pwdResolved.stored))

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

      const mapped = mapSqlServerWriteError(dbErr, { hint: '新增操作员' })
      console.error('数据库写入失败（POST /api/users）：', dbErr)
      const status = mapped?.status ?? 500
      res.status(status).json({
        code: status,
        msg: mapped?.msg ?? '数据库写入失败，请联系管理员',
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
    console.error('新增 /api/users 失败：', err)
    const mapped = mapSqlServerWriteError(err, { hint: '新增操作员' })
    const status = mapped?.status ?? 500
    res.status(status).json({
      code: status,
      msg: mapped?.msg ?? '数据库写入失败，请联系管理员',
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
    const metaPut = await getSysUsersColumnsMeta(pool)
    if (isOperatorUsersV2(metaPut)) {
      const out = await putOperatorUser(pool, metaPut, req, body, hashPassword)
      if (out.error) {
        res.status(out.error.status).json(out.error.json)
        return
      }
      res.json({ code: 200, msg: 'success', data: out.data })
      return
    }
    if (await rejectLegacySysUsersCrud(pool, res)) return

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

/** BOM 主档物理表（默认 bom_000）；表名仅允许字母数字下划线，防注入拼接 */
const INV_BOM_MASTER_TABLE = (() => {
  const raw = String(process.env.INV_BOM_MASTER_TABLE ?? 'bom_000').trim()
  return /^[A-Za-z0-9_]+$/.test(raw) ? raw : 'bom_000'
})()
const INV_BOM_MASTER_FROM = `dbo.[${INV_BOM_MASTER_TABLE}]`

/** BOM 配件明细表名（默认 Bom_parts）；列类型见 docs/bom_parts.txt；kcac01=主档 systemcode；INV_BOM_PARTS_TABLE 可覆盖 */
const INV_BOM_PARTS_TABLE = (() => {
  const raw = String(process.env.INV_BOM_PARTS_TABLE ?? 'Bom_parts').trim()
  return /^[A-Za-z0-9_]+$/.test(raw) ? raw : 'Bom_parts'
})()
const INV_BOM_PARTS_FROM = `dbo.[${INV_BOM_PARTS_TABLE}]`

/** BOM 成本真实用量落库表（默认 Bom_consumption，已停用维护；历史数据保留；BOM_CONSUMPTION_TABLE 可覆盖） */
const BOM_CONSUMPTION_TABLE = (() => {
  const raw = String(process.env.BOM_CONSUMPTION_TABLE ?? 'Bom_consumption').trim()
  return /^[A-Za-z0-9_]+$/.test(raw) ? raw : 'Bom_consumption'
})()
const BOM_CONSUMPTION_FROM = `dbo.[${BOM_CONSUMPTION_TABLE}]`

/** BOM 成本明细表（默认 bom_cost）；POST /api/bom/usage-calc 事务写入；BOM_COST_TABLE 可覆盖 */
const BOM_COST_TABLE = (() => {
  const raw = String(process.env.BOM_COST_TABLE ?? 'bom_cost').trim()
  return /^[A-Za-z0-9_]+$/.test(raw) ? raw : 'bom_cost'
})()
const BOM_COST_FROM = `dbo.[${BOM_COST_TABLE}]`

/** BOM 币别表（默认 bom_currency，列含 cn_name）；表名仅允许字母数字下划线 */
const INV_BOM_CURRENCY_TABLE = (() => {
  const raw = String(process.env.INV_BOM_CURRENCY_TABLE ?? 'bom_currency').trim()
  return /^[A-Za-z0-9_]+$/.test(raw) ? raw : 'bom_currency'
})()
const INV_BOM_CURRENCY_FROM = `dbo.[${INV_BOM_CURRENCY_TABLE}]`

/** BOM 分类表（默认 Bom_code）：copen=1 且 flag5 非空为「需用量运算」物料编码前缀；INV_BOM_CODE_TABLE 可覆盖 */
const INV_BOM_CODE_TABLE = (() => {
  const raw = String(process.env.INV_BOM_CODE_TABLE ?? 'Bom_code').trim()
  return /^[A-Za-z0-9_]+$/.test(raw) ? raw : 'Bom_code'
})()
const INV_BOM_CODE_FROM = `dbo.[${INV_BOM_CODE_TABLE}]`

/** 库存基本资料：颜色编码（物理表 Bom_colorcode） */
const BOM_COLORCODE_FROM = 'dbo.[Bom_colorcode]'

/** 供应商资料（销售/采购/外协管理 → 基本资料 → 供应商资料） */
const SYS_SUPPLIER_FROM = 'dbo.[System_supplier]'

/** 结算方式（销售/采购/外协管理 → 基本资料 → 结算方式） */
const SYS_SETTLEMENT_METHOD_FROM = 'dbo.[System_settlement_method]'

/** 销售客户（销售/采购/外协管理 → 基本资料 → 销售客户） */
const SYS_SALES_CUSTOMER_FROM = 'dbo.[System_sales_customer]'

/**
 * Bom_colorcode 业务时间串：年-月-日 时:分:秒（月、日不补零；时分秒两位），示例 2026-4-23 11:44:51
 * @param {Date} [date]
 */
function formatBomColorcodeTimestamp(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date)
  const pad2 = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

/** 新增写入 intime：当天本地日历日的 00:00:00（datetime）；列表格式化为 yyyy/M/d，如 2017/9/1 */
function bomColorcodeIntimeEntryDateTime() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/**
 * 按主键 code 读取颜色编码一行（不区分在册/删除，供审核/删除校验）
 * @param {import('mssql').ConnectionPool} pool
 * @param {string} codeRaw
 */
async function fetchBomColorcodeByCode(pool, codeRaw) {
  const code = String(codeRaw ?? '').trim()
  if (!code) return null
  const req = pool.request()
  req.input('code', sql.NVarChar(100), code)
  const r = await req.query(`
    SELECT TOP (1)
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.code, N'')))) AS code,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(b.name, N'')))) AS name,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(b.ename, N'')))) AS ename,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.info, N'')))) AS info,
      LTRIM(RTRIM(CONVERT(nvarchar(10), ISNULL(b.pass, N'')))) AS pass,
      LTRIM(RTRIM(CONVERT(nvarchar(10), ISNULL(b.del, N'')))) AS del
    FROM ${BOM_COLORCODE_FROM} AS b
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.code, N'')))) = @code
  `)
  return r.recordset?.[0] ?? null
}

/** 库存基本资料：使用单位（物理表 Bom_unit；主键 id） */
const BOM_UNIT_FROM = 'dbo.[Bom_unit]'

/**
 * 按主键 id 读取使用单位一行（不区分在册/删除，供审核/删除校验）
 * @param {import('mssql').ConnectionPool} pool
 * @param {number|string} idRaw
 */
async function fetchBomUnitById(pool, idRaw) {
  const id = Number(idRaw)
  if (!Number.isFinite(id) || id <= 0) return null
  const req = pool.request()
  req.input('id', sql.Int, id)
  const r = await req.query(`
    SELECT TOP (1)
      u.id,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(u.name, N'')))) AS name,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(u.info, N'')))) AS info,
      LTRIM(RTRIM(CONVERT(nvarchar(10), ISNULL(u.pass, N'')))) AS pass,
      LTRIM(RTRIM(CONVERT(nvarchar(10), ISNULL(u.del, N'')))) AS del
    FROM ${BOM_UNIT_FROM} AS u
    WHERE u.id = @id
  `)
  return r.recordset?.[0] ?? null
}

/** 库存基本资料：单位转换率（物理表 Bom_unit_change；主键 id） */
const BOM_UNIT_CHANGE_FROM = 'dbo.[Bom_unit_change]'

/**
 * 按主键 id 读取单位转换率一行（不区分在册/删除，供审核/删除校验）
 * @param {import('mssql').ConnectionPool} pool
 * @param {number|string} idRaw
 */
async function fetchBomUnitChangeById(pool, idRaw) {
  const id = Number(idRaw)
  if (!Number.isFinite(id) || id <= 0) return null
  const req = pool.request()
  req.input('id', sql.Int, id)
  const r = await req.query(`
    SELECT TOP (1)
      c.id,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.unit_name, N'')))) AS unit_name,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.unit_name_tow, N'')))) AS unit_name_tow,
      LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(c.change_bl, N'')))) AS change_bl,
      LTRIM(RTRIM(CONVERT(nvarchar(10), ISNULL(c.pass, N'')))) AS pass,
      LTRIM(RTRIM(CONVERT(nvarchar(10), ISNULL(c.del, N'')))) AS del
    FROM ${BOM_UNIT_CHANGE_FROM} AS c
    WHERE c.id = @id
  `)
  return r.recordset?.[0] ?? null
}

/** 库存基本资料：材料分类（物理表 Bom_material；主键 id） */
const BOM_MATERIAL_FROM = 'dbo.[Bom_material]'

/**
 * 按主键 id 读取材料分类一行（不区分在册/删除，供审核/删除校验）
 * @param {import('mssql').ConnectionPool} pool
 * @param {number|string} idRaw
 */
async function fetchBomMaterialById(pool, idRaw) {
  const id = Number(idRaw)
  if (!Number.isFinite(id) || id <= 0) return null
  const req = pool.request()
  req.input('id', sql.Int, id)
  const r = await req.query(`
    SELECT TOP (1)
      m.id,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(CONVERT(nvarchar(100), m.code), N'')))) AS code,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(CONVERT(nvarchar(200), m.name), N'')))) AS name,
      CASE
        WHEN m.customs_code IS NULL THEN N''
        ELSE LTRIM(RTRIM(CONVERT(nvarchar(100), m.customs_code)))
      END AS customs_code,
      CASE
        WHEN m.stocks_in IS NULL THEN N''
        ELSE LTRIM(RTRIM(CONVERT(nvarchar(50), m.stocks_in)))
      END AS stocks_in,
      CASE
        WHEN m.stocks_out IS NULL THEN N''
        ELSE LTRIM(RTRIM(CONVERT(nvarchar(50), m.stocks_out)))
      END AS stocks_out,
      LTRIM(RTRIM(CONVERT(nvarchar(10), ISNULL(m.pass, N'')))) AS pass,
      LTRIM(RTRIM(CONVERT(nvarchar(10), ISNULL(m.del, N'')))) AS del
    FROM ${BOM_MATERIAL_FROM} AS m
    WHERE m.id = @id
  `)
  return r.recordset?.[0] ?? null
}

/** 库存基本资料：车间与部门编码（物理表 Bom_Stocks_workshop；主键 id） */
const BOM_STOCKS_WORKSHOP_FROM = 'dbo.[Bom_Stocks_workshop]'

/**
 * 按主键 id 读取车间与部门编码一行（不区分在册/删除，供审核/删除校验）
 * @param {import('mssql').ConnectionPool} pool
 * @param {number|string} idRaw
 */
async function fetchBomStocksWorkshopById(pool, idRaw) {
  const id = Number(idRaw)
  if (!Number.isFinite(id) || id <= 0) return null
  const req = pool.request()
  req.input('id', sql.Int, id)
  const r = await req.query(`
    SELECT TOP (1)
      w.id,
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(w.code, N'')))) AS code,
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(w.name, N'')))) AS name,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(w.info, N'')))) AS info,
      LTRIM(RTRIM(CONVERT(nvarchar(10), ISNULL(w.pass, N'')))) AS pass,
      LTRIM(RTRIM(CONVERT(nvarchar(10), ISNULL(w.del, N'')))) AS del
    FROM ${BOM_STOCKS_WORKSHOP_FROM} AS w
    WHERE w.id = @id
  `)
  return r.recordset?.[0] ?? null
}

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
 * 配件明细保存：解析 decimal 列（前端可能是字符串或带千分位）
 * @param {unknown} raw
 * @returns {number}
 */
function bomPartParseDecimal(raw) {
  if (raw === null || raw === undefined) return 0
  const s = String(raw).replace(/,/g, '').trim()
  if (s === '') return 0
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

/** 配件用量类字段写入前规整（§2：与 decimal(18,6) 对齐，降低 JS 浮点误差） */
function bomPartRoundDecimal6(raw) {
  const n = bomPartParseDecimal(raw)
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 1e6) / 1e6
}

/** 用量合计：kcac04 * (1 + kcac05)，与前端公式一致 */
function bomPartComputeKcac06(qtyRaw, lossRaw) {
  const q = bomPartRoundDecimal6(qtyRaw)
  const l = bomPartRoundDecimal6(lossRaw)
  return bomPartRoundDecimal6(q * (1 + l))
}

/**
 * Bom_parts：`kcac04`/`kcac05`/`cost_price` 库类型为 numeric/decimal（见 docs/bom_parts.txt）。
 * 禁止使用 bomKcacAsDecimalSql（内部 ISNULL(列, N'')），numeric 列与 nvarchar 字面量混用会触发转换异常。
 * @param {string} colExpr 列引用，如 p.kcac04
 */
function bomPartsNumericColAsDecimalSql(colExpr) {
  const c = String(colExpr ?? '').trim()
  // 与 bom_parts 数值列精度一致（多为 decimal(18,6)）；若用 4 位小数会误把损耗率等舍入（如 0.02345→0.0235）导致明细用量与金额偏差
  return `CAST(ISNULL(${c}, 0) AS decimal(18, 6))`
}

/**
 * Bom_parts.id 为 int（docs/bom_parts.txt）
 * @param {import('mssql').Request} request
 * @param {unknown} rawId
 */
function bomPartsSqlBindId(request, rawId) {
  const s0 = String(rawId ?? '').trim().replace(/\.0+$/, '')
  let v
  if (/^\d+$/.test(s0)) {
    v = parseInt(s0, 10)
  } else {
    const n = Number(rawId)
    if (!Number.isFinite(n)) throw new Error('无效的行 id')
    v = Math.trunc(n)
  }
  if (!Number.isFinite(v) || v < 1 || v > 2147483647) {
    throw new Error('无效的行 id')
  }
  request.input('id', sql.Int, v)
}

/** 是否视为数据库已有行（兼容整数字符串 id） */
function bomPartLineHasDbId(raw) {
  if (raw?.id == null || raw.id === '') return false
  const s = String(raw.id).trim().replace(/\.0+$/, '')
  return /^[1-9]\d*$/.test(s)
}

/** Bom_parts.[Seq]：排序序号（int） */
function bomPartParseSeq(raw) {
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return 0
  const t = Math.trunc(n)
  return t > 2147483647 ? 2147483647 : t
}

/** del 视为在册：空或 0（兼容数值类驱动返回） */
function bomPartsDelLooksActive(delS) {
  const s = String(delS ?? '').trim().toLowerCase()
  if (!s) return true
  if (s === '0') return true
  const n = Number(s.replace(/^'+|'+$/g, ''))
  return Number.isFinite(n) && n === 0
}

/**
 * 同主档 kcac01 + 配件 kcaa01 已有行（含软删），按 id 升序
 * @param {import('mssql').Transaction} tx
 */
async function bomPartsFindRowsByScAndPartCode(tx, systemcode, kcaa01) {
  const code = String(kcaa01 ?? '').trim()
  if (!code) return []
  const r = await new sql.Request(tx)
    .input('kcac01', sql.NVarChar(100), systemcode)
    .input('kcaa01', sql.NVarChar(300), code)
    .query(`
      SELECT p.id,
        LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(10), p.del), N''))) AS del_s
      FROM ${INV_BOM_PARTS_FROM} AS p
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(p.kcac01, N'')))) =
            LTRIM(RTRIM(CONVERT(nvarchar(100), @kcac01)))
        AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(p.kcaa01, N'')))) =
            LTRIM(RTRIM(CONVERT(nvarchar(300), @kcaa01)))
      ORDER BY p.id ASC
    `)
  return Array.isArray(r.recordset) ? r.recordset : []
}

/**
 * 根据配件物料编码（bom_000.kcaa01）解析对应 BOM 主档 systemcode，写入 Bom_parts.kcac02（跨主表关联）
 * @param {import('mssql').Transaction|import('mssql').ConnectionPool} poolOrTx
 */
async function bomPartsLookupSubBomSystemcode(poolOrTx, partMaterialCode) {
  const code = String(partMaterialCode ?? '').trim()
  if (!code) return ''
  const r = await new sql.Request(poolOrTx)
    .input('kcaa01', sql.NVarChar(300), code)
    .query(`
      SELECT TOP 1
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.systemcode, N'')))) AS sub_sc
      FROM ${INV_BOM_MASTER_FROM} AS b
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.kcaa01, N'')))) = @kcaa01
        AND (ISNULL(b.del, N'') = N'' OR LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), b.del), N''))) = N'0')
      ORDER BY b.id DESC
    `)
  return String(r.recordset?.[0]?.sub_sc ?? '').trim()
}

/** 保存明细时从 bom_000 同步至 Bom_parts 的 kcaa 列（kcaa01～kcaa35，以库内实际存在列为准） */
/** 物理列名为 kcaa01～kcaa35（不足两位须补零，禁止生成 kcaa1/kcaa9） */
const BOM_PARTS_KCAA_SYNC_NAMES = Array.from({ length: 35 }, (_, i) => `kcaa${String(i + 1).padStart(2, '0')}`)

/**
 * 无子档 BOM 时：这些列用请求体写回；其余 kcaa 列保持行内原值（避免误清空历史扩展字段）
 * @type {ReadonlySet<string>}
 */
const BOM_PARTS_KCAA_PAYLOAD_FALLBACK = new Set(['kcaa02', 'kcaa03', 'kcaa04', 'kcaa11'])

/**
 * 按配件行 p.kcaa01 匹配 bom_000 在册最新行（TOP 1 ORDER BY b.id DESC，与 GET 配件明细一致）
 * @param {string} alias
 */
function bomPartsSqlOuterApplyLatestBom000ByPartKcaa01(alias = 'b0') {
  const kcaaSelect = BOM_PARTS_KCAA_SYNC_NAMES.map((c) => `b.[${c}]`).join(',\n          ')
  return (
    `OUTER APPLY (
      SELECT TOP 1
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.systemcode, N'')))) AS sub_systemcode,
        ${kcaaSelect}
      FROM ${INV_BOM_MASTER_FROM} AS b
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.kcaa01, N'')))) =
            LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(p.kcaa01, N''))))
        AND (ISNULL(b.del, N'') = N'' OR LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), b.del), N''))) = N'0')
      ORDER BY b.id DESC
    ) AS ${alias}`
  )
}

/**
 * UPDATE SET：kcaa 优先取自 OUTER APPLY 子 BOM；无匹配时 kcaa01 用 @kcaa01Up，kcaa02/03/04/11 用请求参数，其余保持原列
 * @param {Set<string>} partColset getInvBomPartsColumnSet
 * @param {string} alias
 * @returns {string[]}
 */
function bomPartsBuildKcaaSyncAssignments(partColset, alias = 'b0') {
  const parts = []
  for (const col of BOM_PARTS_KCAA_SYNC_NAMES) {
    if (!partColset.has(col)) continue
    if (col === 'kcaa01') {
      parts.push(`p.[kcaa01] = ISNULL(${alias}.[kcaa01], @kcaa01Up)`)
      continue
    }
    if (BOM_PARTS_KCAA_PAYLOAD_FALLBACK.has(col)) {
      parts.push(`p.[${col}] = ISNULL(${alias}.[${col}], @${col})`)
    } else {
      parts.push(`p.[${col}] = ISNULL(${alias}.[${col}], p.[${col}])`)
    }
  }
  return parts
}

/** 子 BOM 在 bom_000 的 systemcode（与 kcac02 同源） */
function bomPartsSqlSubSystemcodeIsnullPreserve(partsCol, alias = 'b0') {
  return `p.[${partsCol}] = ISNULL(NULLIF(LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(${alias}.sub_systemcode, N'')))), N''), p.[${partsCol}])`
}

/** kcac02：子 BOM systemcode；无子档时保留行内原值 */
function bomPartsBuildKcac02Assignment(partColset, alias = 'b0') {
  if (!partColset.has('kcac02')) return null
  return bomPartsSqlSubSystemcodeIsnullPreserve('kcac02', alias)
}

/** systemcode：与 kcac02 一致，写入配件行上的子 BOM 身份证号（库内有该列时） */
function bomPartsBuildPartsSystemcodeAssignment(partColset, alias = 'b0') {
  if (!partColset.has('systemcode')) return null
  return bomPartsSqlSubSystemcodeIsnullPreserve('systemcode', alias)
}

/**
 * 单行保存 UPDATE：WHERE id + kcac01（主档 systemcode）双重锁定；kcaa01～35、kcac02、systemcode（若存在列）从 bom_000 同步；kcac04/05/06、cost_price、remark、Seq 来自请求体
 * @param {import('mssql').Transaction} tx
 * @param {Set<string>} partColset
 * @param {string} systemcode 主档 systemcode（即明细 kcac01）
 * @param {unknown} rawId 行 id
 * @param {Record<string, unknown>} raw 单行 lines[]
 */
async function bomPartsApplyFullLineUpdate(tx, partColset, systemcode, rawId, raw) {
  const kcaa01Up = String(raw?.kcaa01 ?? '').trim()
  const kcac04 = bomPartRoundDecimal6(raw?.kcac04)
  const kcac05 = bomPartRoundDecimal6(raw?.kcac05)
  const kcac06 = bomPartRoundDecimal6(
    raw?.kcac06 !== undefined && raw?.kcac06 !== null
      ? raw.kcac06
      : bomPartComputeKcac06(kcac04, kcac05),
  )
  const costNum = bomPartParseDecimal(raw?.cost_price)
  const seqNum = bomPartParseSeq(raw?.seq)

  const q = new sql.Request(tx)
  bomPartsSqlBindId(q, rawId)
  q.input('kcac01', sql.NVarChar(100), systemcode)
  q.input('kcaa01Up', sql.NVarChar(300), kcaa01Up)
  q.input('kcaa02', sql.NVarChar(500), raw?.kcaa02 != null ? String(raw.kcaa02) : '')
  q.input('kcaa03', sql.NVarChar(500), raw?.kcaa03 != null ? String(raw.kcaa03) : '')
  q.input('kcaa04', sql.NVarChar(100), raw?.kcaa04 != null ? String(raw.kcaa04) : '')
  q.input('kcaa11', sql.NVarChar(200), raw?.kcaa11 != null ? String(raw.kcaa11) : '')
  q.input('kcac04', sql.Decimal(18, 6), kcac04)
  q.input('kcac05', sql.Decimal(18, 6), kcac05)
  q.input('cost_price', sql.Decimal(18, 4), costNum)
  q.input('remark', sql.NVarChar(500), raw?.remark != null ? String(raw.remark) : '')
  q.input('seq', sql.Int, seqNum)
  if (partColset.has('kcac06')) {
    q.input('kcac06', sql.Decimal(18, 6), kcac06)
  }

  const applySql = bomPartsSqlOuterApplyLatestBom000ByPartKcaa01('b0')
  const setParts = []
  const kcac02Sql = bomPartsBuildKcac02Assignment(partColset, 'b0')
  if (kcac02Sql) setParts.push(kcac02Sql)
  const partsScSql = bomPartsBuildPartsSystemcodeAssignment(partColset, 'b0')
  if (partsScSql) setParts.push(partsScSql)
  setParts.push(...bomPartsBuildKcaaSyncAssignments(partColset, 'b0'))
  setParts.push('p.kcac04 = @kcac04', 'p.kcac05 = @kcac05')
  if (partColset.has('kcac06')) {
    setParts.push('p.kcac06 = @kcac06')
  }
  setParts.push('p.cost_price = @cost_price', 'p.remark = @remark', 'p.[Seq] = @seq')

  const ur = await q.query(`
    UPDATE p
    SET ${setParts.join(', ')}
    FROM ${INV_BOM_PARTS_FROM} AS p
    ${applySql}
    WHERE p.id = @id
      AND LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(p.kcac01, N'')))) =
          LTRIM(RTRIM(CONVERT(nvarchar(100), @kcac01)))
      AND (ISNULL(p.del, N'') = N'' OR p.del = N'0')
  `)
  const rowsAffected = Number(ur.rowsAffected?.[0] ?? 0)
  return { rowsAffected, kcaa01Up, kcac04, kcac05 }
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

/**
 * v1.1.9：与 `src/views/dormitory/ElectricManage.vue` 的 shareRows 计算保持一致（按住宿天数权重分摊总用电量，再扣个人优惠电量，再乘 0.93；金额向下取到分）
 * @param {number} usedElectric 宿舍总用电量（与弹窗一致：取 Hr_room_use.c_electric 数值）
 * @param {any[]} occupantsRaw 已含 stay_days、electric 等字段的行
 */
function computeDormElectricSharesByDayWeight(usedElectric, occupantsRaw) {
  const list = Array.isArray(occupantsRaw) ? occupantsRaw : []
  const cnt = list.length
  if (cnt <= 0) return []
  const totalDays = list.reduce((sum, r) => sum + Number(r?.stay_days ?? 0), 0)
  const denomDays = Number.isFinite(totalDays) && totalDays > 0 ? totalDays : 0
  const ele = Number(usedElectric ?? 0)
  const totalEle = Number.isFinite(ele) && ele > 0 ? ele : 0
  return list.map((r) => {
    const disc = Number(r?.electric_discount ?? 0)
    const discount = Number.isFinite(disc) && disc >= 0 ? disc : 0
    const days = Number(r?.stay_days ?? 0)
    const stayDays = Number.isFinite(days) && days > 0 ? days : 0
    const shareEle = denomDays > 0 ? (totalEle / denomDays) * stayDays : 0
    const billedEle = Math.max(0, shareEle - discount)
    const money = billedEle * 0.93
    const safe = Number.isFinite(money) && money >= 0 ? money : 0
    const floored = Math.floor(safe * 100) / 100
    return { ...r, share_money: floored, share_electric: shareEle }
  })
}

/**
 * 分摊报表财务口径（规则 18）：仅「已匹配有效档案行」且 pass=1 的人员参与用电量分母与金额；其余人员仍列出，电量与金额均为 0，避免未审档案从报表消失。
 */
function isDormElectricFeeEligibleForAllocationShare(row) {
  const pass = String(row?.staff_pass ?? '').trim()
  const archive = String(row?.staff_archive_code ?? '').trim()
  return archive.length > 0 && pass === '1'
}

/** 不参与电费分摊池（未审/无档案/住宿天数无效）——用于异常说明计数 */
function isDormElectricExcludedFromFeeSharePool(row) {
  if (!isDormElectricFeeEligibleForAllocationShare(row)) return true
  const days = Number(row?.stay_days ?? 0)
  return !Number.isFinite(days) || days <= 0
}

/**
 * v1.1.6+：在 `computeDormElectricSharesByDayWeight` 基础上增加「仅已审人员进分母」；未审或无档案行 share_money/share_electric 固定为 0。
 * @param {number} usedElectric
 * @param {any[]} occupantsMapped 已通过 `mapDormElectricOccupantsWithDiscountForAllocation` 的行（须含 staff_pass、staff_archive_code）
 */
function computeDormElectricSharesByDayWeightWithFeeEligibility(usedElectric, occupantsMapped) {
  const list = Array.isArray(occupantsMapped) ? occupantsMapped : []
  const cnt = list.length
  if (cnt <= 0) return []
  const eligibleDays = list.reduce((sum, r) => {
    if (!isDormElectricFeeEligibleForAllocationShare(r)) return sum
    const d = Number(r?.stay_days ?? 0)
    const stayDays = Number.isFinite(d) && d > 0 ? d : 0
    return sum + stayDays
  }, 0)
  const denomDays = Number.isFinite(eligibleDays) && eligibleDays > 0 ? eligibleDays : 0
  const ele = Number(usedElectric ?? 0)
  const totalEle = Number.isFinite(ele) && ele > 0 ? ele : 0
  return list.map((r) => {
    const eligible = isDormElectricFeeEligibleForAllocationShare(r)
    if (!eligible) {
      return { ...r, share_money: 0, share_electric: 0, fee_eligible: false, fee_share_applied: false }
    }
    const disc = Number(r?.electric_discount ?? 0)
    const discount = Number.isFinite(disc) && disc >= 0 ? disc : 0
    const days = Number(r?.stay_days ?? 0)
    const stayDays = Number.isFinite(days) && days > 0 ? days : 0
    if (stayDays <= 0) {
      return { ...r, share_money: 0, share_electric: 0, fee_eligible: true, fee_share_applied: false }
    }
    const shareEle = denomDays > 0 ? (totalEle / denomDays) * stayDays : 0
    const billedEle = Math.max(0, shareEle - discount)
    const money = billedEle * 0.93
    const safe = Number.isFinite(money) && money >= 0 ? money : 0
    const floored = Math.floor(safe * 100) / 100
    return {
      ...r,
      share_money: floored,
      share_electric: shareEle,
      fee_eligible: true,
      fee_share_applied: true,
    }
  })
}

/** 姓名展示：未审或无匹配档案标「(档案未审)」；已审但住宿天数为 0 标「(住宿天数异常)」 */
function buildDormElectricStaffDisplayName(row) {
  const eligible = isDormElectricFeeEligibleForAllocationShare(row)
  const name = String(row?.staff_truename ?? '').trim()
  const code = String(row?.staff_code ?? '').trim()
  const base = name || code || '（无名）'
  if (!eligible) return `${base}(档案未审)`
  const days = Number(row?.stay_days ?? 0)
  if (!Number.isFinite(days) || days <= 0) return `${base}(住宿天数异常)`
  return name || code || '（无名）'
}

/** 与电费弹窗 context 一致：优惠电量仅统计 >0；住宿天数取整且非负 */
function mapDormElectricOccupantsWithDiscountForAllocation(rows) {
  return (rows ?? []).map((r) => {
    const disc = Number(String(r?.electric ?? '').trim() || '0')
    const daysNum = Number(r?.stay_days)
    const stayDays = Number.isFinite(daysNum) && daysNum > 0 ? Math.floor(daysNum) : 0
    return {
      ...r,
      electric_discount: Number.isFinite(disc) && disc > 0 ? disc : 0,
      stay_days: stayDays,
    }
  })
}

/**
 * 指定自然月与房号：分摊报表专用；v1.1.7 时间窗与 electric/context 一致（in_time < 次月初 且 未退或退宿 >= 月初）
 * - **Hr_staff 使用 LEFT JOIN**：只要入住表有行就必须出现在报表；未匹配档案或 pass≠1 时由 Node 侧标「(档案未审)」且金额按规则置 0（规则 18）
 * - **ON 条件**：仅 `new_code=staff_code` 且 `del=0`；**不在 WHERE 中按 pass 剔除**
 * - **部门/职务**：LEFT JOIN HR_Departments；若未匹配到员工档案（s 为空）或部门名为空，显示「未设定」
 * @param {import('mssql').ConnectionPool} pool
 * @param {string} roomCode
 * @param {string} mStartStr YYYY-MM-DD HH:mm:ss
 * @param {string} mEndStr 次月一日 00:00:00
 */
async function fetchDormElectricOccupantsMonthForAllocation(pool, roomCode, mStartStr, mEndStr) {
  const occReq = pool.request().input('roomCode', sql.NVarChar(50), roomCode)
  occReq.input('hasMonth', sql.Bit, 1)
  occReq.input('mStartStr', sql.NVarChar(19), mStartStr)
  occReq.input('mEndStr', sql.NVarChar(19), mEndStr)
  const occRs = await occReq.query(`
      DECLARE @mStart datetime = CASE WHEN @hasMonth = 1 THEN CONVERT(datetime, @mStartStr, 120) ELSE NULL END;
      DECLARE @mEnd datetime = CASE WHEN @hasMonth = 1 THEN CONVERT(datetime, @mEndStr, 120) ELSE NULL END;

      SELECT
        i.id,
        LTRIM(RTRIM(ISNULL(i.staff_code, N''))) AS staff_code,
        LTRIM(RTRIM(ISNULL(s.code, N''))) AS staff_archive_code,
        LTRIM(RTRIM(ISNULL(s.pass, N'0'))) AS staff_pass,
        LTRIM(RTRIM(ISNULL(i.staff_truename, N''))) AS staff_truename,
        CASE
          WHEN s.new_code IS NULL THEN N'未设定'
          WHEN NULLIF(LTRIM(RTRIM(CONVERT(nvarchar(400), ISNULL(dept.name, N'')))), N'') IS NOT NULL
            THEN LTRIM(RTRIM(CONVERT(nvarchar(400), ISNULL(dept.name, N''))))
          ELSE N'未设定'
        END AS dept_name,
        CASE
          WHEN s.new_code IS NULL THEN N'未设定'
          WHEN NULLIF(LTRIM(RTRIM(CONVERT(nvarchar(400), ISNULL(pos.name, N'')))), N'') IS NOT NULL
            THEN LTRIM(RTRIM(CONVERT(nvarchar(400), ISNULL(pos.name, N''))))
          ELSE N'未设定'
        END AS position_name,
        LTRIM(RTRIM(ISNULL(i.in_time, N''))) AS in_time,
        LTRIM(RTRIM(ISNULL(i.electric, N''))) AS electric,
        CASE
          WHEN @hasMonth = 0 THEN NULL
          ELSE
            CASE
              WHEN ${hrRoomDateTimeExprNullableSql('i.in_time')} IS NULL THEN NULL
              ELSE
                (
                  (
                    (
                      CASE
                        WHEN ${hrRoomDateTimeExprNullableSql("COALESCE(i.out_time2, i.out_time)")} IS NULL THEN DATEDIFF(day, 0, DATEADD(day, -1, @mEnd))
                        WHEN DATEDIFF(day, 0, ${hrRoomDateTimeExprNullableSql("COALESCE(i.out_time2, i.out_time)")}) < DATEDIFF(day, 0, DATEADD(day, -1, @mEnd))
                          THEN DATEDIFF(day, 0, ${hrRoomDateTimeExprNullableSql("COALESCE(i.out_time2, i.out_time)")})
                        ELSE DATEDIFF(day, 0, DATEADD(day, -1, @mEnd))
                      END
                    )
                    -
                    (
                      CASE
                        WHEN DATEDIFF(day, 0, ${hrRoomDateTimeExprNullableSql('i.in_time')}) > DATEDIFF(day, 0, @mStart)
                          THEN DATEDIFF(day, 0, ${hrRoomDateTimeExprNullableSql('i.in_time')})
                        ELSE DATEDIFF(day, 0, @mStart)
                      END
                    )
                  ) + 1
                )
            END
        END AS stay_days
      FROM ${HR_ROOM_IN_FROM} AS i
      LEFT JOIN ${HR_STAFF_FROM} AS s
        ON LTRIM(RTRIM(ISNULL(s.new_code, N''))) = LTRIM(RTRIM(ISNULL(i.staff_code, N'')))
        AND LTRIM(RTRIM(ISNULL(s.del, N'0'))) = N'0'
      LEFT JOIN ${HR_LEGACY_DEPT_FROM} AS dept
        ON LTRIM(RTRIM(ISNULL(dept.code, N''))) = LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(s.join_department, N''))))
      LEFT JOIN ${HR_LEGACY_DEPT_FROM} AS pos
        ON LTRIM(RTRIM(ISNULL(pos.code, N''))) = LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(s.position, N''))))
      WHERE LTRIM(RTRIM(ISNULL(i.del, N'0'))) = N'0'
        AND (
          @hasMonth = 0
          OR (
            ${hrRoomDateTimeExprNullableSql('i.in_time')} < @mEnd
            AND (
              ${hrRoomDateTimeExprNullableSql("COALESCE(i.out_time2, i.out_time)")} IS NULL
              OR ${hrRoomDateTimeExprNullableSql("COALESCE(i.out_time2, i.out_time)")} >= @mStart
            )
          )
        )
        AND (
          @hasMonth = 1
          OR LTRIM(RTRIM(ISNULL(i.out_room, N'0'))) = N'0'
        )
        AND LTRIM(RTRIM(ISNULL(i.room_code, N''))) = @roomCode
      ORDER BY i.id DESC
    `)
  return occRs.recordset ?? []
}

/** 与 `fetchDormElectricOccupantsMonthForAllocation` 同一 v1.1.7 在住窗，仅统计 Hr_room_in 行数（不联 staff），用于异常说明与明细行数对账 */
async function fetchDormElectricRoomInMonthOverlapCount(pool, roomCode, mStartStr, mEndStr) {
  const occReq = pool.request().input('roomCode', sql.NVarChar(50), roomCode)
  occReq.input('hasMonth', sql.Bit, 1)
  occReq.input('mStartStr', sql.NVarChar(19), mStartStr)
  occReq.input('mEndStr', sql.NVarChar(19), mEndStr)
  const occRs = await occReq.query(`
      DECLARE @mStart datetime = CASE WHEN @hasMonth = 1 THEN CONVERT(datetime, @mStartStr, 120) ELSE NULL END;
      DECLARE @mEnd datetime = CASE WHEN @hasMonth = 1 THEN CONVERT(datetime, @mEndStr, 120) ELSE NULL END;

      SELECT COUNT(1) AS cnt
      FROM ${HR_ROOM_IN_FROM} AS i
      WHERE LTRIM(RTRIM(ISNULL(i.del, N'0'))) = N'0'
        AND (
          @hasMonth = 0
          OR (
            ${hrRoomDateTimeExprNullableSql('i.in_time')} < @mEnd
            AND (
              ${hrRoomDateTimeExprNullableSql("COALESCE(i.out_time2, i.out_time)")} IS NULL
              OR ${hrRoomDateTimeExprNullableSql("COALESCE(i.out_time2, i.out_time)")} >= @mStart
            )
          )
        )
        AND (
          @hasMonth = 1
          OR LTRIM(RTRIM(ISNULL(i.out_room, N'0'))) = N'0'
        )
        AND LTRIM(RTRIM(ISNULL(i.room_code, N''))) = @roomCode
    `)
  const n = Number(occRs.recordset?.[0]?.cnt ?? 0)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

/** v1.1.1：缓存员工档案表列清单（避免不同库缺列导致 SQL 报错） */
let HR_STAFF_COLSET_PROMISE = null
let HR_ROOM_IN_COLSET_PROMISE = null
let HR_ROOM_COLSET_PROMISE = null
let SYS_SETTLEMENT_METHOD_COLSET_PROMISE = null
let SYS_SUPPLIER_COLSET_PROMISE = null
let SYS_SALES_CUSTOMER_COLSET_PROMISE = null
/** BOM 主档（默认 bom_000）列清单缓存 */
let INV_BOM_MASTER_COLSET_PROMISE = null

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

/** v1.2.2：缓存 System_supplier 列清单（兼容旧库字段不一致导致 SQL 报错） */
async function getSystemSupplierColumnSet(pool) {
  if (SYS_SUPPLIER_COLSET_PROMISE) return SYS_SUPPLIER_COLSET_PROMISE
  SYS_SUPPLIER_COLSET_PROMISE = (async () => {
    try {
      const r = await pool.request().query(`
        SELECT COLUMN_NAME AS name
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = N'dbo' AND TABLE_NAME = N'System_supplier'
      `)
      const set = new Set()
      for (const row of r.recordset ?? []) {
        const n = String(row?.name ?? '').trim()
        if (n) set.add(n.toLowerCase())
      }
      return set
    } catch (err) {
      console.warn('[供应商资料] 读取 System_supplier 列清单失败，已降级：', err?.message ?? err)
      return new Set()
    }
  })()
  return SYS_SUPPLIER_COLSET_PROMISE
}

/**
 * bom_000（表名来自 INV_BOM_MASTER_TABLE）列清单，兼容旧库缺列
 * @param {import('mssql').ConnectionPool} pool
 */
async function getInvBomMasterColumnSet(pool) {
  if (INV_BOM_MASTER_COLSET_PROMISE) return INV_BOM_MASTER_COLSET_PROMISE
  const tbl = INV_BOM_MASTER_TABLE
  INV_BOM_MASTER_COLSET_PROMISE = (async () => {
    try {
      const r = await pool.request().input('tn', sql.NVarChar(128), tbl).query(`
        SELECT COLUMN_NAME AS name
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = N'dbo' AND TABLE_NAME = @tn
      `)
      const set = new Set()
      for (const row of r.recordset ?? []) {
        const n = String(row?.name ?? '').trim()
        if (n) set.add(n.toLowerCase())
      }
      return set
    } catch (err) {
      console.warn('[BOM主档] 读取 bom_000 列清单失败，已降级：', err?.message ?? err)
      return new Set()
    }
  })()
  return INV_BOM_MASTER_COLSET_PROMISE
}

/** Bom_parts 列清单（缓存），用于软删写 del/deltime 等兼容 */
let INV_BOM_PARTS_COLSET_PROMISE = null
async function getInvBomPartsColumnSet(pool) {
  if (INV_BOM_PARTS_COLSET_PROMISE) return INV_BOM_PARTS_COLSET_PROMISE
  const tbl = INV_BOM_PARTS_TABLE
  INV_BOM_PARTS_COLSET_PROMISE = (async () => {
    try {
      const r = await pool.request().input('tn', sql.NVarChar(128), tbl).query(`
        SELECT COLUMN_NAME AS name
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = N'dbo' AND TABLE_NAME = @tn
      `)
      const set = new Set()
      for (const row of r.recordset ?? []) {
        const n = String(row?.name ?? '').trim()
        if (n) set.add(n.toLowerCase())
      }
      return set
    } catch (err) {
      console.warn('[BOM配件表] 读取列清单失败，已降级：', err?.message ?? err)
      return new Set()
    }
  })()
  return INV_BOM_PARTS_COLSET_PROMISE
}

/**
 * Bom_parts.del 物理类型：少数旧库为 int/bit，多数为 nvarchar；错误类型会导致「软删」未命中或表现异常
 * @param {import('mssql').ConnectionPool} pool
 */
async function getInvBomPartsDelColumnKind(pool) {
  try {
    const r = await pool.request().input('tn', sql.NVarChar(128), INV_BOM_PARTS_TABLE).query(`
      SELECT DATA_TYPE AS dt
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = N'dbo' AND TABLE_NAME = @tn AND COLUMN_NAME = N'del'
    `)
    const dt = String(r.recordset?.[0]?.dt ?? '').toLowerCase()
    if (dt === 'bit' || dt === 'tinyint' || dt === 'smallint' || dt === 'int' || dt === 'bigint')
      return 'numeric'
    return 'nvarchar'
  } catch {
    return 'nvarchar'
  }
}

/** v1.2.2：缓存 System_settlement_method 列清单（兼容旧库字段不一致导致 SQL 报错） */
async function getSystemSettlementMethodColumnSet(pool) {
  if (SYS_SETTLEMENT_METHOD_COLSET_PROMISE) return SYS_SETTLEMENT_METHOD_COLSET_PROMISE
  SYS_SETTLEMENT_METHOD_COLSET_PROMISE = (async () => {
    try {
      const r = await pool.request().query(`
        SELECT COLUMN_NAME AS name
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = N'dbo' AND TABLE_NAME = N'System_settlement_method'
      `)
      const set = new Set()
      for (const row of r.recordset ?? []) {
        const n = String(row?.name ?? '').trim()
        if (n) set.add(n.toLowerCase())
      }
      return set
    } catch (err) {
      console.warn('[结算方式] 读取 System_settlement_method 列清单失败，已降级：', err?.message ?? err)
      return new Set()
    }
  })()
  return SYS_SETTLEMENT_METHOD_COLSET_PROMISE
}

/** v1.2.3：缓存 System_sales_customer 列清单（兼容旧库字段不一致导致 SQL 报错） */
async function getSystemSalesCustomerColumnSet(pool) {
  if (SYS_SALES_CUSTOMER_COLSET_PROMISE) return SYS_SALES_CUSTOMER_COLSET_PROMISE
  SYS_SALES_CUSTOMER_COLSET_PROMISE = (async () => {
    try {
      const r = await pool.request().query(`
        SELECT COLUMN_NAME AS name
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = N'dbo' AND TABLE_NAME = N'System_sales_customer'
      `)
      const set = new Set()
      for (const row of r.recordset ?? []) {
        const n = String(row?.name ?? '').trim()
        if (n) set.add(n.toLowerCase())
      }
      return set
    } catch (err) {
      console.warn('[销售客户] 读取 System_sales_customer 列清单失败，已降级：', err?.message ?? err)
      return new Set()
    }
  })()
  return SYS_SALES_CUSTOMER_COLSET_PROMISE
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
    const userMeta = await getSysUsersColumnsMeta(pool)
    const userColset = userMeta.set
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
    // 旧版 Sys_Users 可能无 is_active：跳过账号封禁，不拦截离职主流程
    if (!userColset.has('is_active') && !userMeta.legacyLayout) {
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

      // 关联系统账号（可选）：旧表用 uid=Hr_staff.id；ERP 表用工号 UserCode 匹配
      const staffId = Math.floor(Number(staffRow?.id ?? 0))
      let userRow = null
      if (userMeta.legacyLayout && staffId > 0) {
        const qUid = userMeta.qb('uid')
        const qUsername = userMeta.qb('username')
        const qUsercode = userMeta.qb('usercode')
        if (qUid && qUsername && qUsercode) {
          const qEntity = getSysUsersEntityPkQb(userMeta)
          const userCheck = await tx.request().input('sid', sql.Int, staffId).query(`
            SELECT TOP (1) u.${qEntity} AS UserID, u.${qUsercode} AS UserCode, u.${qUsername} AS UserName
            FROM Sys_Users AS u
            WHERE u.${qUid} = @sid
          `)
          userRow = userCheck.recordset?.[0]
        }
      } else {
        const userCheck = await tx
          .request()
          .input('v', sql.NVarChar(50), staffCode)
          .query(`
            SELECT TOP (1) u.UserID, u.UserCode, u.UserName
            FROM Sys_Users AS u
            WHERE u.UserCode = @v
            ORDER BY u.UserID DESC
          `)
        userRow = userCheck.recordset?.[0]
      }
      const account = userRow ? String(userRow?.UserName ?? userRow?.UserCode ?? '').trim() || staffCode : ''

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

      // 若存在关联账号且库中有 is_active，则封禁；否则跳过（不影响员工离职落库）
      if (userRow && userColset.has('is_active')) {
        const qIsActive = userMeta.qb('is_active')
        let updUser
        if (userMeta.legacyLayout && staffId > 0 && userMeta.qb('uid')) {
          const qUid = userMeta.qb('uid')
          updUser = await tx.request().input('sid', sql.Int, staffId).query(`
            UPDATE u
            SET u.${qIsActive} = 0
            FROM Sys_Users AS u
            WHERE u.${qUid} = @sid
          `)
        } else {
          updUser = await tx
            .request()
            .input('v', sql.NVarChar(50), staffCode)
            .query(`
              UPDATE u
              SET u.is_active = 0
              FROM Sys_Users AS u
              WHERE u.UserCode = @v
            `)
        }
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
 * v1.1.5：电费管理中心 - 上期读数 + 当前在住人员
 * GET /api/hr/dormitory/electric/context
 * query: { room_code, tj_date? }
 */
app.get('/api/hr/dormitory/electric/context', async (req, res) => {
  res.setHeader('X-ERP-Dormitory-Electric-Context', 'v1.1.5')
  try {
    const roomCode = String(req.query?.room_code ?? '').trim()
    const tjDate = String(req.query?.tj_date ?? '').trim()
    if (!roomCode) {
      res.status(400).json({ code: 400, msg: 'room_code（房号）不能为空', data: null })
      return
    }

    const pool = await getPool()

    // 若传了 tj_date，则按该月份做“跨月在住”重叠过滤（修复：2 月入住不该出现在 1 月统计）
    let hasMonthFilter = false
    let mStartStr = null
    let mEndStr = null
    if (tjDate) {
      const mm = /^(\d{4})-(\d{1,2})$/.exec(tjDate) || /^(\d{4})-(\d{2})$/.exec(tjDate)
      if (!mm) {
        res.status(400).json({ code: 400, msg: 'tj_date 格式不合法，应为 YYYY-M 或 YYYY-MM', data: null })
        return
      }
      const y = Number(mm[1])
      const mo = Number(mm[2])
      const range = lodgingMonthRangeOrThrow(y, mo)
      hasMonthFilter = true
      const pad2 = (n) => String(n).padStart(2, '0')
      const nextMo = mo === 12 ? 1 : mo + 1
      const nextY = mo === 12 ? y + 1 : y
      // 重要：用字符串传入 SQL 再 CONVERT(style 120)，避免 JS Date 时区偏移导致少算一天
      mStartStr = `${y}-${pad2(mo)}-01 00:00:00`
      mEndStr = `${nextY}-${pad2(nextMo)}-01 00:00:00`
    }

    // 上期读数：取该房间最近一条电费记录的本期读数 c_this 作为“上期读数”
    const lastReq = pool.request().input('roomCode', sql.NVarChar(50), roomCode)
    const lastRs = await lastReq.query(`
      SELECT TOP 1
        u.id,
        LTRIM(RTRIM(ISNULL(u.tj_date, N''))) AS tj_date,
        LTRIM(RTRIM(ISNULL(u.c_this, N''))) AS c_this
      FROM ${HR_ROOM_USE_FROM} AS u
      WHERE LTRIM(RTRIM(ISNULL(u.del, N'0'))) = N'0'
        AND LTRIM(RTRIM(ISNULL(u.room_code, N''))) = @roomCode
      ORDER BY u.id DESC
    `)
    const lastRow = lastRs.recordset?.[0] ?? null
    const lastReading = Number(String(lastRow?.c_this ?? '').trim() || '0')
    const lastReadingSafe = Number.isFinite(lastReading) ? lastReading : 0

    // 在住人员：若带月份，则按“时间重叠”过滤；否则保持原口径（当前在住）
    const occReq = pool.request().input('roomCode', sql.NVarChar(50), roomCode)
    occReq.input('hasMonth', sql.Bit, hasMonthFilter ? 1 : 0)
    occReq.input('mStartStr', sql.NVarChar(19), mStartStr)
    occReq.input('mEndStr', sql.NVarChar(19), mEndStr)
    const occRs = await occReq.query(`
      DECLARE @mStart datetime = CASE WHEN @hasMonth = 1 THEN CONVERT(datetime, @mStartStr, 120) ELSE NULL END;
      DECLARE @mEnd datetime = CASE WHEN @hasMonth = 1 THEN CONVERT(datetime, @mEndStr, 120) ELSE NULL END;

      SELECT
        i.id,
        LTRIM(RTRIM(ISNULL(i.staff_code, N''))) AS staff_code,
        LTRIM(RTRIM(ISNULL(i.staff_truename, N''))) AS staff_truename,
        LTRIM(RTRIM(ISNULL(d.name, ISNULL(s.join_department, i.staff_bm_name)))) AS dept_name,
        LTRIM(RTRIM(ISNULL(i.in_time, N''))) AS in_time,
        LTRIM(RTRIM(ISNULL(i.electric, N''))) AS electric,
        CASE
          WHEN @hasMonth = 0 THEN NULL
          ELSE
            CASE
              WHEN ${hrRoomDateTimeExprNullableSql('i.in_time')} IS NULL THEN NULL
              ELSE
                (
                  -- 按“自然日(日期)”计算：先转成 day-index 再相减，避免任何时分秒导致少一天
                  (
                    (
                      CASE
                        WHEN ${hrRoomDateTimeExprNullableSql("COALESCE(i.out_time2, i.out_time)")} IS NULL THEN DATEDIFF(day, 0, DATEADD(day, -1, @mEnd))
                        WHEN DATEDIFF(day, 0, ${hrRoomDateTimeExprNullableSql("COALESCE(i.out_time2, i.out_time)")}) < DATEDIFF(day, 0, DATEADD(day, -1, @mEnd))
                          THEN DATEDIFF(day, 0, ${hrRoomDateTimeExprNullableSql("COALESCE(i.out_time2, i.out_time)")})
                        ELSE DATEDIFF(day, 0, DATEADD(day, -1, @mEnd))
                      END
                    )
                    -
                    (
                      CASE
                        WHEN DATEDIFF(day, 0, ${hrRoomDateTimeExprNullableSql('i.in_time')}) > DATEDIFF(day, 0, @mStart)
                          THEN DATEDIFF(day, 0, ${hrRoomDateTimeExprNullableSql('i.in_time')})
                        ELSE DATEDIFF(day, 0, @mStart)
                      END
                    )
                  ) + 1
                )
            END
        END AS stay_days
      FROM ${HR_ROOM_IN_FROM} AS i
      INNER JOIN ${HR_STAFF_FROM} AS s
        ON LTRIM(RTRIM(ISNULL(s.new_code, N''))) = LTRIM(RTRIM(ISNULL(i.staff_code, N'')))
        AND LTRIM(RTRIM(ISNULL(s.del, N'0'))) = N'0'
        AND LTRIM(RTRIM(ISNULL(s.pass, N'0'))) = N'1'
      LEFT JOIN ${HR_LEGACY_DEPT_FROM} AS d
        ON LTRIM(RTRIM(ISNULL(d.code, N''))) = LTRIM(RTRIM(ISNULL(s.join_department, N'')))
      WHERE LTRIM(RTRIM(ISNULL(i.del, N'0'))) = N'0'
        AND (
          @hasMonth = 0
          OR (
            ${hrRoomDateTimeExprNullableSql('i.in_time')} < @mEnd
            AND (
              ${hrRoomDateTimeExprNullableSql("COALESCE(i.out_time2, i.out_time)")} IS NULL
              OR ${hrRoomDateTimeExprNullableSql("COALESCE(i.out_time2, i.out_time)")} >= @mStart
            )
          )
        )
        AND (
          @hasMonth = 1
          OR LTRIM(RTRIM(ISNULL(i.out_room, N'0'))) = N'0'
        )
        AND LTRIM(RTRIM(ISNULL(i.room_code, N''))) = @roomCode
      ORDER BY i.id DESC
    `)

    const occupants = (occRs.recordset ?? []).map((r) => {
      const disc = Number(String(r?.electric ?? '').trim() || '0')
      const daysNum = Number(r?.stay_days)
      const stayDays = Number.isFinite(daysNum) && daysNum > 0 ? Math.floor(daysNum) : 0
      return {
        ...r,
        electric_discount: Number.isFinite(disc) && disc > 0 ? disc : 0,
        stay_days: stayDays,
      }
    })

    const discountTotal = occupants.reduce((sum, r) => sum + Number(r?.electric_discount ?? 0), 0)
    res.json({
      code: 200,
      msg: 'success',
      data: {
        room_code: roomCode,
        tj_date: tjDate || null,
        last: lastRow ? { id: lastRow.id, tj_date: lastRow.tj_date, c_this: String(lastRow.c_this ?? '').trim() } : null,
        last_reading: lastReadingSafe,
        occupants,
        occupant_count: occupants.length,
        discount_total: discountTotal,
      },
    })
  } catch (err) {
    console.error('GET /api/hr/dormitory/electric/context 失败：', err)
    const detail = String(err?.message ?? '数据库查询失败')
    res.status(500).json({ code: 500, msg: `加载电费数据失败：${detail}`, data: null })
  }
})

/**
 * v1.1.5：电费历史联动（按房号+月份回填抄表）
 * GET /api/dorm/get-electric-history
 * query: { room_code, tj_date }
 *
 * 返回规则：
 * - 若该月份存在记录：返回 found=true + c_star + c_this
 * - 若该月份无记录：返回 found=false + fallback_last_c_this（该房间最近一条记录的 c_this），并由前端将 c_this 置 0
 */
app.get('/api/dorm/get-electric-history', async (req, res) => {
  res.setHeader('X-ERP-Dormitory-Electric-History', 'v1.1.5')
  try {
    const roomCode = String(req.query?.room_code ?? '').trim()
    const tjDate = String(req.query?.tj_date ?? '').trim()
    if (!roomCode) {
      res.status(400).json({ code: 400, msg: 'room_code（房间号）不能为空', data: null })
      return
    }
    if (!tjDate) {
      res.status(400).json({ code: 400, msg: 'tj_date（统计月份）不能为空，例如 2026-03', data: null })
      return
    }

    const pool = await getPool()

    // tj_date 兼容：库里常见为 'YYYY-M'（不补 0），而前端可能传 'YYYY-MM'
    const tjDateTrim = tjDate
    let tjDateAlt = ''
    const m = /^(\d{4})-(\d{1,2})$/.exec(tjDateTrim) || /^(\d{4})-(\d{2})$/.exec(tjDateTrim)
    if (m) {
      const y = m[1]
      const mo = String(Number(m[2]))
      if (mo !== 'NaN') {
        const moPad = String(Number(m[2])).padStart(2, '0')
        // 两个候选：补 0 与不补 0
        const a = `${y}-${mo}`
        const b = `${y}-${moPad}`
        tjDateAlt = a === tjDateTrim ? b : a
      }
    }

    const q = pool.request()
    q.input('room_code', sql.NVarChar(50), roomCode)
    q.input('tj_date', sql.NVarChar(50), tjDate)
    q.input('tj_date_alt', sql.NVarChar(50), tjDateAlt || null)
    const rs = await q.query(`
      SELECT TOP 1
        LTRIM(RTRIM(ISNULL(u.c_star, N''))) AS c_star,
        LTRIM(RTRIM(ISNULL(u.c_this, N''))) AS c_this
      FROM ${HR_ROOM_USE_FROM} AS u
      WHERE LTRIM(RTRIM(ISNULL(u.del, N'0'))) = N'0'
        AND LTRIM(RTRIM(ISNULL(u.room_code, N''))) = @room_code
        AND (
          LTRIM(RTRIM(ISNULL(u.tj_date, N''))) = @tj_date
          OR (@tj_date_alt IS NOT NULL AND LTRIM(RTRIM(ISNULL(u.tj_date, N''))) = @tj_date_alt)
        )
      ORDER BY u.id DESC
    `)

    const row = rs.recordset?.[0] ?? null
    if (row) {
      res.json({
        code: 200,
        msg: 'success',
        data: {
          found: true,
          room_code: roomCode,
          tj_date: tjDate,
          c_star: String(row.c_star ?? '').trim(),
          c_this: String(row.c_this ?? '').trim(),
        },
      })
      return
    }

    const lastReq = pool.request().input('room_code', sql.NVarChar(50), roomCode)
    const lastRs = await lastReq.query(`
      SELECT TOP 1
        LTRIM(RTRIM(ISNULL(u.c_this, N''))) AS c_this
      FROM ${HR_ROOM_USE_FROM} AS u
      WHERE LTRIM(RTRIM(ISNULL(u.del, N'0'))) = N'0'
        AND LTRIM(RTRIM(ISNULL(u.room_code, N''))) = @room_code
      ORDER BY u.id DESC
    `)
    const lastRow = lastRs.recordset?.[0] ?? null

    res.json({
      code: 200,
      msg: 'success',
      data: {
        found: false,
        room_code: roomCode,
        tj_date: tjDate,
        fallback_last_c_this: String(lastRow?.c_this ?? '').trim(),
      },
    })
  } catch (err) {
    console.error('GET /api/dorm/get-electric-history 失败：', err)
    const detail = String(err?.message ?? '数据库查询失败')
    res.status(500).json({ code: 500, msg: `加载电费历史失败：${detail}`, data: null })
  }
})

/**
 * v1.1.6：宿舍电费情况统计报表（列表 + 汇总）
 * GET /api/dorm/electric-report-data
 * - year/month：统计月份；tj_date 可选（与 lodging-overview 一致，默认 `YYYY-M`）
 * - 主表 Hr_room（已审 pass=1）；左连当月 Hr_room_use（tj_date 主/备选格式，同房同月多条取 id 最大一条，与历史回填一致）
 * - 入住人数、优惠电量合计：Hr_room_in 按 v1.1.7 与 lodging-overview 相同的「跨月重叠」窗口（mStart/mEnd 由字符串 CONVERT，避免 JS 时区偏移）
 * - 用电量/单价/合计金额：直接取 Hr_room_use 落库字段（与 /api/hr/dormitory/electric/settle 写入一致）
 */
app.get('/api/dorm/electric-report-data', async (req, res) => {
  res.setHeader('X-ERP-Dormitory-Electric-Report', 'v1.1.6')
  try {
    let range
    try {
      range = lodgingMonthRangeOrThrow(req.query?.year, req.query?.month)
    } catch (e) {
      res.status(400).json({ code: 400, msg: String(e?.message ?? '年月参数错误'), data: null })
      return
    }

    const y = range.y
    const mo = range.mo
    const pad2 = (n) => String(n).padStart(2, '0')
    const nextMo = mo === 12 ? 1 : mo + 1
    const nextY = mo === 12 ? y + 1 : y
    const mStartStr = `${y}-${pad2(mo)}-01 00:00:00`
    const mEndStr = `${nextY}-${pad2(nextMo)}-01 00:00:00`

    const tjDateRaw = String(req.query?.tj_date ?? '').trim()
    const tjDateTrim = tjDateRaw || `${y}-${mo}`

    let tjDateAlt = null
    const mm = /^(\d{4})-(\d{1,2})$/.exec(tjDateTrim) || /^(\d{4})-(\d{2})$/.exec(tjDateTrim)
    if (mm) {
      const yy = Number(mm[1])
      const mmo = Number(mm[2])
      if (Number.isFinite(yy) && Number.isFinite(mmo) && mmo >= 1 && mmo <= 12) {
        const moPad = String(mmo).padStart(2, '0')
        const a = `${yy}-${mmo}`
        const b = `${yy}-${moPad}`
        tjDateAlt = a === tjDateTrim ? b : a
      }
    }

    const pool = await getPool()

    const electricNorm = (col) => {
      const c = String(col ?? '').trim()
      return `REPLACE(REPLACE(LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(${c}, N'')))), N' ', N''), N',', N'.')`
    }

    // 2008 R2 无聚合类 OVER()，汇总单独查一轮，避免语法不兼容
    const statReq = pool.request()
    statReq.input('mStartStr', sql.NVarChar(19), mStartStr)
    statReq.input('mEndStr', sql.NVarChar(19), mEndStr)
    const statRs = await statReq.query(`
      DECLARE @mStart datetime = CONVERT(datetime, @mStartStr, 120);
      DECLARE @mEnd datetime = CONVERT(datetime, @mEndStr, 120);

      SELECT
        COUNT(1) AS stat_room_count,
        SUM(ISNULL(mo.occupant_cnt, 0)) AS stat_people_sum
      FROM ${HR_ROOM_FROM} AS r
      LEFT JOIN (
        SELECT
          LTRIM(RTRIM(ISNULL(i.room_code, N''))) AS rc,
          COUNT(1) AS occupant_cnt
        FROM ${HR_ROOM_IN_FROM} AS i
        WHERE LTRIM(RTRIM(ISNULL(i.del, N'0'))) = N'0'
          AND ${hrRoomDateTimeExprNullableSql('i.in_time')} < @mEnd
          AND (
            ${hrRoomDateTimeExprNullableSql("COALESCE(i.out_time2, i.out_time)")} IS NULL
            OR ${hrRoomDateTimeExprNullableSql("COALESCE(i.out_time2, i.out_time)")} >= @mStart
          )
          AND LTRIM(RTRIM(ISNULL(i.room_code, N''))) <> N''
        GROUP BY LTRIM(RTRIM(ISNULL(i.room_code, N'')))
      ) AS mo ON mo.rc = LTRIM(RTRIM(ISNULL(r.s_code, N'')))
      WHERE LTRIM(RTRIM(ISNULL(r.pass, N'0'))) = N'1'
        AND LTRIM(RTRIM(ISNULL(r.del, N'0'))) = N'0'
    `)
    const statRow = statRs.recordset?.[0] ?? null
    const statRoomCount = Number(statRow?.stat_room_count ?? 0)
    const statPeopleSum = Number(statRow?.stat_people_sum ?? 0)

    const listReq = pool.request()
    listReq.input('mStartStr', sql.NVarChar(19), mStartStr)
    listReq.input('mEndStr', sql.NVarChar(19), mEndStr)
    listReq.input('tj_date', sql.NVarChar(50), tjDateTrim)
    listReq.input('tj_date_alt', sql.NVarChar(50), tjDateAlt || null)
    const rs = await listReq.query(`
      DECLARE @mStart datetime = CONVERT(datetime, @mStartStr, 120);
      DECLARE @mEnd datetime = CONVERT(datetime, @mEndStr, 120);

      SELECT
        r.id AS room_id,
        LTRIM(RTRIM(ISNULL(r.s_code, N''))) AS room_code,
        LTRIM(RTRIM(ISNULL(r.code, N''))) AS room_type_code,
        LTRIM(RTRIM(ISNULL(r.name, N''))) AS room_name,
        ISNULL(mo.occupant_cnt, 0) AS occupant_count_month,
        ISNULL(mo.discount_kwh_sum, 0) AS discount_kwh_month,
        LTRIM(RTRIM(ISNULL(u.tj_date, N''))) AS tj_date,
        LTRIM(RTRIM(ISNULL(u.c_date, N''))) AS meter_read_date,
        LTRIM(RTRIM(ISNULL(u.uname, N''))) AS meter_reader,
        LTRIM(RTRIM(ISNULL(u.c_star, N''))) AS c_star,
        LTRIM(RTRIM(ISNULL(u.c_this, N''))) AS c_this,
        LTRIM(RTRIM(ISNULL(u.c_old_end, N''))) AS c_old_end,
        LTRIM(RTRIM(ISNULL(u.c_new_star, N''))) AS c_new_star,
        LTRIM(RTRIM(ISNULL(u.c_change, N''))) AS c_change,
        LTRIM(RTRIM(ISNULL(u.c_electric, N''))) AS used_electric,
        LTRIM(RTRIM(ISNULL(u.c_money, N''))) AS unit_price,
        CAST(${hrRoomUseCsumMoneyAsDecimalSql('u.c_sum_money')} AS decimal(18, 2)) AS total_money,
        CAST(N'' AS nvarchar(500)) AS remark
      FROM ${HR_ROOM_FROM} AS r
      LEFT JOIN (
        SELECT
          LTRIM(RTRIM(ISNULL(i.room_code, N''))) AS rc,
          COUNT(1) AS occupant_cnt,
          SUM(
            CASE
              WHEN ISNUMERIC(${electricNorm('i.electric')}) = 1 AND CAST(${electricNorm('i.electric')} AS decimal(18, 4)) > 0
                THEN CAST(${electricNorm('i.electric')} AS decimal(18, 4))
              ELSE CAST(0 AS decimal(18, 4))
            END
          ) AS discount_kwh_sum
        FROM ${HR_ROOM_IN_FROM} AS i
        WHERE LTRIM(RTRIM(ISNULL(i.del, N'0'))) = N'0'
          AND ${hrRoomDateTimeExprNullableSql('i.in_time')} < @mEnd
          AND (
            ${hrRoomDateTimeExprNullableSql("COALESCE(i.out_time2, i.out_time)")} IS NULL
            OR ${hrRoomDateTimeExprNullableSql("COALESCE(i.out_time2, i.out_time)")} >= @mStart
          )
          AND LTRIM(RTRIM(ISNULL(i.room_code, N''))) <> N''
        GROUP BY LTRIM(RTRIM(ISNULL(i.room_code, N'')))
      ) AS mo ON mo.rc = LTRIM(RTRIM(ISNULL(r.s_code, N'')))
      OUTER APPLY (
        SELECT TOP 1
          uu.tj_date,
          uu.c_date,
          uu.uname,
          uu.c_star,
          uu.c_this,
          uu.c_old_end,
          uu.c_new_star,
          uu.c_change,
          uu.c_electric,
          uu.c_money,
          uu.c_sum_money
        FROM ${HR_ROOM_USE_FROM} AS uu
        WHERE LTRIM(RTRIM(ISNULL(uu.del, N'0'))) = N'0'
          AND LTRIM(RTRIM(ISNULL(uu.room_code, N''))) = LTRIM(RTRIM(ISNULL(r.s_code, N'')))
          AND (
            LTRIM(RTRIM(ISNULL(uu.tj_date, N''))) = @tj_date
            OR (@tj_date_alt IS NOT NULL AND LTRIM(RTRIM(ISNULL(uu.tj_date, N''))) = @tj_date_alt)
          )
        ORDER BY uu.id DESC
      ) AS u
      WHERE LTRIM(RTRIM(ISNULL(r.pass, N'0'))) = N'1'
        AND LTRIM(RTRIM(ISNULL(r.del, N'0'))) = N'0'
      ORDER BY r.in_lou ASC, r.s_code ASC, r.id ASC
    `)

    const rows = rs.recordset ?? []

    const list = rows.map((row) => ({
      room_id: row.room_id,
      room_code: row.room_code,
      room_type_code: row.room_type_code,
      room_name: row.room_name,
      occupant_count_month: Number(row.occupant_count_month ?? 0),
      discount_kwh_month: Number(row.discount_kwh_month ?? 0),
      tj_date: row.tj_date,
      meter_read_date: row.meter_read_date,
      meter_reader: row.meter_reader,
      c_star: row.c_star,
      c_this: row.c_this,
      c_old_end: row.c_old_end,
      c_new_star: row.c_new_star,
      c_change: row.c_change,
      used_electric: row.used_electric,
      unit_price: row.unit_price,
      total_money: row.total_money,
      remark: row.remark,
    }))

    res.json({
      code: 200,
      msg: 'success',
      data: {
        year: y,
        month: mo,
        tj_date: tjDateTrim,
        stat_room_count: statRoomCount,
        stat_people_sum: statPeopleSum,
        list,
      },
    })
  } catch (err) {
    console.error('GET /api/dorm/electric-report-data 失败：', err)
    const detail = String(err?.message ?? '数据库查询失败')
    res.status(500).json({
      code: 500,
      msg: `加载电费统计报表失败：${detail}`,
      data: shouldAttachSqlDebugToApiResponse() ? { sqlDebug: serializeMssqlRequestErrorForClient(err) } : null,
    })
  }
})

/**
 * v1.1.6+：宿舍费用分摊情况（人员维度；以当月 Hr_room_use 为入口，按 v1.1.9 住宿天数权重与电费弹窗公式一致）
 * GET /api/dorm/electric-allocation-report
 * - 仅包含有电费记录且该月存在 overlap 入住人员的房间；无在住人员的房间不产生行（Tab1 仍保留能耗行）
 */
app.get('/api/dorm/electric-allocation-report', async (req, res) => {
  res.setHeader('X-ERP-Dormitory-Electric-Allocation-Report', 'v1.1.7')
  try {
    let range
    try {
      range = lodgingMonthRangeOrThrow(req.query?.year, req.query?.month)
    } catch (e) {
      res.status(400).json({ code: 400, msg: String(e?.message ?? '年月参数错误'), data: null })
      return
    }

    const y = range.y
    const mo = range.mo
    const pad2 = (n) => String(n).padStart(2, '0')
    const nextMo = mo === 12 ? 1 : mo + 1
    const nextY = mo === 12 ? y + 1 : y
    const mStartStr = `${y}-${pad2(mo)}-01 00:00:00`
    const mEndStr = `${nextY}-${pad2(nextMo)}-01 00:00:00`

    const tjDateRaw = String(req.query?.tj_date ?? '').trim()
    const tjDateTrim = tjDateRaw || `${y}-${mo}`

    let tjDateAlt = null
    const mm = /^(\d{4})-(\d{1,2})$/.exec(tjDateTrim) || /^(\d{4})-(\d{2})$/.exec(tjDateTrim)
    if (mm) {
      const yy = Number(mm[1])
      const mmo = Number(mm[2])
      if (Number.isFinite(yy) && Number.isFinite(mmo) && mmo >= 1 && mmo <= 12) {
        const moPad = String(mmo).padStart(2, '0')
        const a = `${yy}-${mmo}`
        const b = `${yy}-${moPad}`
        tjDateAlt = a === tjDateTrim ? b : a
      }
    }

    const pool = await getPool()
    const useReq = pool.request()
    useReq.input('tj_date', sql.NVarChar(50), tjDateTrim)
    useReq.input('tj_date_alt', sql.NVarChar(50), tjDateAlt || null)
    const useRs = await useReq.query(`
      SELECT
        LTRIM(RTRIM(ISNULL(u.room_code, N''))) AS room_code,
        LTRIM(RTRIM(ISNULL(u.c_star, N''))) AS c_star,
        LTRIM(RTRIM(ISNULL(u.c_this, N''))) AS c_this,
        LTRIM(RTRIM(ISNULL(u.c_electric, N''))) AS c_electric,
        LTRIM(RTRIM(ISNULL(u.c_money, N''))) AS c_money
      FROM (
        SELECT
          uu.*,
          ROW_NUMBER() OVER (
            PARTITION BY LTRIM(RTRIM(ISNULL(uu.room_code, N'')))
            ORDER BY uu.id DESC
          ) AS rn
        FROM ${HR_ROOM_USE_FROM} AS uu
        INNER JOIN ${HR_ROOM_FROM} AS r
          ON LTRIM(RTRIM(ISNULL(r.s_code, N''))) = LTRIM(RTRIM(ISNULL(uu.room_code, N'')))
        WHERE LTRIM(RTRIM(ISNULL(uu.del, N'0'))) = N'0'
          AND LTRIM(RTRIM(ISNULL(r.pass, N'0'))) = N'1'
          AND LTRIM(RTRIM(ISNULL(r.del, N'0'))) = N'0'
          AND (
            LTRIM(RTRIM(ISNULL(uu.tj_date, N''))) = @tj_date
            OR (@tj_date_alt IS NOT NULL AND LTRIM(RTRIM(ISNULL(uu.tj_date, N''))) = @tj_date_alt)
          )
      ) AS u
      WHERE u.rn = 1
      ORDER BY u.room_code ASC
    `)

    const useRows = useRs.recordset ?? []
    const list = []
    let excludedFromFeePoolCount = 0
    const roomCountMismatches = []
    for (const ur of useRows) {
      const roomCode = String(ur?.room_code ?? '').trim()
      if (!roomCode) continue
      const usedParsed = Number(String(ur?.c_electric ?? '').trim() || '0')
      const usedSafe = Number.isFinite(usedParsed) && usedParsed >= 0 ? usedParsed : 0
      const overlapCnt = await fetchDormElectricRoomInMonthOverlapCount(pool, roomCode, mStartStr, mEndStr)
      const rawOcc = await fetchDormElectricOccupantsMonthForAllocation(pool, roomCode, mStartStr, mEndStr)
      const occupants = mapDormElectricOccupantsWithDiscountForAllocation(rawOcc)
      if (occupants.length === 0) {
        if (overlapCnt > 0) {
          roomCountMismatches.push({
            room_code: roomCode,
            hr_room_in_overlap_count: overlapCnt,
            report_row_count: 0,
          })
        }
        continue
      }
      if (overlapCnt !== occupants.length) {
        roomCountMismatches.push({
          room_code: roomCode,
          hr_room_in_overlap_count: overlapCnt,
          report_row_count: occupants.length,
        })
      }
      const shares = computeDormElectricSharesByDayWeightWithFeeEligibility(usedSafe, occupants)
      for (const row of shares) {
        if (isDormElectricExcludedFromFeeSharePool(row)) excludedFromFeePoolCount += 1
        list.push({
          month_label: `${y}-${mo}`,
          tj_date: tjDateTrim,
          room_code: roomCode,
          staff_code: String(row.staff_code ?? '').trim(),
          staff_archive_code: String(row.staff_archive_code ?? '').trim(),
          staff_pass: String(row.staff_pass ?? '').trim(),
          staff_truename: String(row.staff_truename ?? '').trim(),
          staff_display_name: buildDormElectricStaffDisplayName(row),
          dept_name: String(row.dept_name ?? '').trim(),
          position_name: String(row.position_name ?? '').trim(),
          c_star: String(ur.c_star ?? '').trim(),
          c_this: String(ur.c_this ?? '').trim(),
          dorm_used_electric: usedSafe,
          share_electric: row.share_electric,
          personal_discount_electric: row.electric_discount,
          unit_price: String(ur.c_money ?? '').trim() || '0.93',
          stay_days: row.stay_days,
          share_money: row.share_money,
          fee_eligible: row.fee_eligible === true,
          fee_share_applied: row.fee_share_applied === true,
        })
      }
    }

    const anomalyParts = []
    if (excludedFromFeePoolCount > 0) {
      anomalyParts.push(
        `检测到有 ${excludedFromFeePoolCount} 名在住人员因档案状态未通过(pass!=1)或入职日期异常未计入费用分摊；对应行分摊电费已按 0 元显示，请管理员核对后再执行财务扣款。`,
      )
    }
    if (roomCountMismatches.length > 0) {
      const detail = roomCountMismatches
        .map((m) => `${m.room_code}（入住表=${m.hr_room_in_overlap_count}，报表=${m.report_row_count}）`)
        .join('；')
      anomalyParts.push(`以下房间在住人数与报表行数不一致，请排查数据：${detail}`)
    }
    const allocation_anomaly_hint = anomalyParts.length ? anomalyParts.join(' ') : ''

    res.json({
      code: 200,
      msg: 'success',
      data: {
        year: y,
        month: mo,
        tj_date: tjDateTrim,
        list,
        allocation_anomaly_hint,
        allocation_anomaly: {
          excluded_from_fee_pool_count: excludedFromFeePoolCount,
          room_count_mismatches: roomCountMismatches,
        },
      },
    })
  } catch (err) {
    console.error('GET /api/dorm/electric-allocation-report 失败：', err)
    const detail = String(err?.message ?? '数据库查询失败')
    res.status(500).json({
      code: 500,
      msg: `加载费用分摊报表失败：${detail}`,
      data: shouldAttachSqlDebugToApiResponse() ? { sqlDebug: serializeMssqlRequestErrorForClient(err) } : null,
    })
  }
})

/**
 * LIKE 通配符转义（SQL Server 2008 R2：用方括号包裹 % _ [）
 * @param {string} s
 */
function escapeSqlLikePattern(s) {
  return String(s ?? '')
    .replace(/\[/g, '[[]')
    .replace(/%/g, '[%]')
    .replace(/_/g, '[_]')
}

/**
 * BOM 详情：从 Bom_unit_change 解析采购/报价与使用单位的转换方向及转换率（已审、在册）
 * @returns {{ purchase_direction: string, purchase_rate: string, quote_direction: string, quote_rate: string }}
 */
async function fetchBomUnitConversionDetail(pool, uUse, uPo, uQt) {
  const use = String(uUse ?? '').trim()
  const po = String(uPo ?? '').trim()
  const qt = String(uQt ?? '').trim()
  const empty = {
    purchase_direction: '',
    purchase_rate: '',
    quote_direction: '',
    quote_rate: '',
  }
  if (!use) return empty

  const str = (v) => (v == null ? '' : String(v))

  /** 采购 / 报价两条 TOP 1 互不依赖，并行以降低 BOM 详情 GET 尾延迟 */
  const tasks = []
  if (po) {
    tasks.push(
      pool
        .request()
        .input('uUse', sql.NVarChar(200), use)
        .input('uPo', sql.NVarChar(200), po)
        .query(`
        SELECT TOP 1
          LTRIM(RTRIM(CONVERT(nvarchar(80), ISNULL(c.change_bl, N'')))) AS rate,
          CASE
            WHEN LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.unit_name, N'')))) = @uPo
              AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.unit_name_tow, N'')))) = @uUse
              THEN N'po_to_use'
            WHEN LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.unit_name, N'')))) = @uUse
              AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.unit_name_tow, N'')))) = @uPo
              THEN N'use_to_po'
            ELSE N''
          END AS dir
        FROM ${BOM_UNIT_CHANGE_FROM} AS c
        WHERE (ISNULL(c.del, N'') = N'' OR c.del = N'0')
          AND LTRIM(RTRIM(ISNULL(c.pass, N''))) = N'1'
          AND (
            (LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.unit_name, N'')))) = @uPo
              AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.unit_name_tow, N'')))) = @uUse)
            OR
            (LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.unit_name, N'')))) = @uUse
              AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.unit_name_tow, N'')))) = @uPo)
          )
      `)
        .then((r) => ({ kind: 'purchase', row: r.recordset?.[0] })),
    )
  }
  if (qt) {
    tasks.push(
      pool
        .request()
        .input('uUse', sql.NVarChar(200), use)
        .input('uQt', sql.NVarChar(200), qt)
        .query(`
        SELECT TOP 1
          LTRIM(RTRIM(CONVERT(nvarchar(80), ISNULL(c.change_bl, N'')))) AS rate,
          CASE
            WHEN LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.unit_name, N'')))) = @uQt
              AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.unit_name_tow, N'')))) = @uUse
              THEN N'qt_to_use'
            WHEN LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.unit_name, N'')))) = @uUse
              AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.unit_name_tow, N'')))) = @uQt
              THEN N'use_to_qt'
            ELSE N''
          END AS dir
        FROM ${BOM_UNIT_CHANGE_FROM} AS c
        WHERE (ISNULL(c.del, N'') = N'' OR c.del = N'0')
          AND LTRIM(RTRIM(ISNULL(c.pass, N''))) = N'1'
          AND (
            (LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.unit_name, N'')))) = @uQt
              AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.unit_name_tow, N'')))) = @uUse)
            OR
            (LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.unit_name, N'')))) = @uUse
              AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.unit_name_tow, N'')))) = @uQt)
          )
      `)
        .then((r) => ({ kind: 'quote', row: r.recordset?.[0] })),
    )
  }

  let purchase_direction = ''
  let purchase_rate = ''
  let quote_direction = ''
  let quote_rate = ''
  const settled = await Promise.all(tasks)
  for (const item of settled) {
    if (item.kind === 'purchase' && item.row) {
      purchase_direction = str(item.row.dir).trim()
      purchase_rate = str(item.row.rate).trim()
    }
    if (item.kind === 'quote' && item.row) {
      quote_direction = str(item.row.dir).trim()
      quote_rate = str(item.row.rate).trim()
    }
  }

  return { purchase_direction, purchase_rate, quote_direction, quote_rate }
}

/**
 * 生产车间展示：编码, 名称（与分类名称逻辑类似；缺名称时保留逗号后占位便于测试核对）
 */
function buildBomWorkshopDisplay(code15, workshopName) {
  const c = String(code15 ?? '').trim()
  const n = String(workshopName ?? '').trim()
  if (!c && !n) return ''
  if (c && n) return `${c}, ${n}`
  if (c) return `${c}, —`
  return `—, ${n}`
}

/** 主列表生产车间：编码, 名称；缺名称时仅编码（空则空白，不用 em dash） */
function buildBomListWorkshopDisplay(code15, workshopName) {
  const c = String(code15 ?? '').trim()
  const n = String(workshopName ?? '').trim()
  if (!c && !n) return ''
  if (c && n) return `${c}, ${n}`
  return c || n
}

function bomListPurchaseDirectionLabel(kcaa27) {
  const n = Number(kcaa27)
  if (n === 1) return '使用->采购'
  if (n === 0) return '采购->使用'
  return ''
}

function bomListQuoteDirectionLabel(kcaa31) {
  const n = Number(kcaa31)
  if (n === 1) return '使用->报价'
  if (n === 0) return '报价->使用'
  return ''
}

function bomListBondedLabel(sign) {
  const s = String(sign ?? '').trim()
  if (s === '1') return '保税'
  if (s === '0') return '非保税'
  return ''
}

function bomListCustomerSupplyLabel(v) {
  const s = String(v ?? '').trim()
  if (s === '1' || s.toLowerCase() === 'y' || s === '是') return '是'
  if (s === '2' || s === '0' || s.toLowerCase() === 'n' || s === '否') return '否'
  return ''
}

/**
 * bom_000 列表 SELECT 片段：列不存在时 SELECT 空串占位，避免旧库报错
 * @param {Set<string>} colset
 */
function buildInvBomListMasterSelectLines(colset) {
  const has = (c) => colset.has(String(c).toLowerCase())
  const strCol = (col, alias, len = 500) => {
    const csql = col === 'decimal' ? '[decimal]' : col
    if (!has(col)) return `N'' AS ${alias}`
    return `LTRIM(RTRIM(CONVERT(nvarchar(${len}), ISNULL(b.${csql}, N'')))) AS ${alias}`
  }
  const decCol = (col, alias) => {
    if (!has(col)) return `N'' AS ${alias}`
    return `LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(80), b.${col}), N''))) AS ${alias}`
  }
  const intCol = (col, alias) => {
    if (!has(col)) return `CAST(NULL AS int) AS ${alias}`
    return `b.${col} AS ${alias}`
  }
  return [
    strCol('kcaa02_en', 'kcaa02_en', 500),
    strCol('kpname', 'kpname', 500),
    strCol('kcaa05', 'kcaa05', 200),
    strCol('kcaa06', 'kcaa06', 300),
    strCol('kcaa09', 'kcaa09', 300),
    strCol('kcaa10', 'kcaa10', 200),
    strCol('kcaa11', 'kcaa11', 200),
    strCol('kcaa15', 'kcaa15', 50),
    strCol('location', 'location', 200),
    strCol('kcaa25', 'kcaa25', 100),
    decCol('kcaa26', 'kcaa26'),
    intCol('kcaa27', 'kcaa27'),
    strCol('kcaa29', 'kcaa29', 100),
    decCol('kcaa30', 'kcaa30'),
    intCol('kcaa31', 'kcaa31'),
    decCol('kcaa32', 'kcaa32'),
    decCol('kcaa33', 'kcaa33'),
    strCol('kcaa35', 'kcaa35', 80),
    decCol('sale_price', 'sale_price'),
    decCol('cost_price', 'cost_price'),
    intCol('Customer_supply', 'Customer_supply'),
    strCol('Customer_Name', 'Customer_Name', 500),
    strCol('uname', 'uname', 50),
    strCol('utruename', 'utruename', 50),
    strCol('uptruename', 'uptruename', 50),
    `LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(cat.name, N'')))) AS categoryName`,
    `LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(ws.name, N'')))) AS workshopName`,
  ]
}

/**
 * BOM 审计姓名：优先 Sys_Users.truename，无列或无值时回退登录态姓名
 * @param {import('mssql').ConnectionPool} pool
 * @param {{ uidInt: number | null, utruename: string | null }} actor
 */
async function resolveSysUsersTruenameForBomAudit(pool, actor) {
  const fallback = String(actor?.utruename ?? '').trim() || null
  const uidInt = actor?.uidInt
  if (!pool || uidInt == null) return fallback
  const meta = await getSysUsersColumnsMeta(pool)
  const qTruename = meta.qb('truename')
  const qPk = meta.legacyLayout ? meta.qb('uid') : meta.qb('userid')
  if (!qTruename || !qPk) return fallback
  const r = await pool.request().input('bomAuditUid', sql.Int, uidInt).query(`
    SELECT TOP (1) LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(u.${qTruename}, N'')))) AS truename
    FROM Sys_Users AS u
    WHERE u.${qPk} = @bomAuditUid
  `)
  const tn = String(r.recordset?.[0]?.truename ?? '').trim()
  return tn || fallback
}

function pushInvBomEditAuditOnMasterUpdate(colset, setParts, upd, actor) {
  if (colset.has('uptruename') && actor.utruename) {
    setParts.push('uptruename = @uptruename')
    upd.input('uptruename', sql.NVarChar(50), actor.utruename)
  }
}

function mapInvBomListRowExtraFields(row) {
  const str = (v) => (v == null ? '' : String(v))
  const addOp = str(row.utruename).trim()
  const editOp = str(row.uptruename).trim()
  const addtime = str(row.addtime).trim()
  const edittime = str(row.edittime).trim()
  const hasEdit = Boolean(edittime && edittime !== addtime)
  /** 列表「录入人/修改人」列：仅展示 bom_000.utruename / uptruename（时间见「输入/修改时间」列） */
  return {
    kcaa02_en: str(row.kcaa02_en),
    kpname: str(row.kpname),
    categoryName: str(row.categoryName),
    kcaa06: str(row.kcaa06),
    kcaa09: str(row.kcaa09),
    kcaa10: str(row.kcaa10),
    kcaa11: str(row.kcaa11),
    workshopDisplay: buildBomListWorkshopDisplay(row.kcaa15, row.workshopName),
    location: str(row.location),
    kcaa25: str(row.kcaa25),
    kcaa26: str(row.kcaa26),
    purchaseDirectionLabel: bomListPurchaseDirectionLabel(row.kcaa27),
    kcaa29: str(row.kcaa29),
    kcaa30: str(row.kcaa30),
    quoteDirectionLabel: bomListQuoteDirectionLabel(row.kcaa31),
    kcaa32: str(row.kcaa32),
    kcaa33: str(row.kcaa33),
    kcaa35: str(row.kcaa35),
    sale_price: str(row.sale_price),
    cost_price: str(row.cost_price),
    customerSupplyLabel: bomListCustomerSupplyLabel(row.Customer_supply),
    customerName: str(row.Customer_Name),
    bondedLabel: bomListBondedLabel(row.status ?? row.sign),
    addOperatorName: addOp,
    editOperatorName: editOp,
    showEditAuditLine: hasEdit || Boolean(editOp),
  }
}

/**
 * BOM 主档 systemcode：年月日 + MD5(时间随机+用户) + 用户尾缀（截断防超长）
 * @param {string|number|null|undefined} uidPart
 */
function generateInvBomSystemcode(uidPart) {
  const uid = String(uidPart ?? '').trim() || '0'
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const ymd = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
  const rnd = `${Date.now()}_${crypto.randomBytes(12).toString('hex')}_${uid}`
  const md5 = crypto.createHash('md5').update(rnd, 'utf8').digest('hex')
  const tail = (uid.replace(/\D/g, '').slice(-6) || uid.slice(0, 8)).replace(/\s+/g, '')
  const raw = `${ymd}${md5.slice(0, 22)}${tail}`
  return raw.slice(0, 88)
}

/**
 * kcaa01 唯一（在册行）；编辑时排除指定 systemcode
 * @param {import('mssql').ConnectionPool} pool
 * @param {string} kcaa01
 * @param {string} [excludeSystemcode]
 */
async function countInvBomDuplicateKcaa01(pool, kcaa01, excludeSystemcode) {
  const code = String(kcaa01 ?? '').trim()
  if (!code) return 0
  const ex = String(excludeSystemcode ?? '').trim()
  const req = pool.request().input('kcaa01', sql.NVarChar(300), code)
  let sqlEx = ''
  if (ex) {
    req.input('exsc', sql.NVarChar(100), ex)
    sqlEx = ` AND LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.systemcode, N'')))) <> @exsc `
  }
  const r = await req.query(`
    SELECT COUNT(1) AS cnt
    FROM ${INV_BOM_MASTER_FROM} AS b
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.kcaa01, N'')))) = @kcaa01
      AND (ISNULL(b.del, N'') = N'' OR LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), b.del), N''))) = N'0')
      ${sqlEx}
  `)
  return Number(r.recordset?.[0]?.cnt ?? 0)
}

/**
 * bom_000 是否已存在指定 systemcode（任意 del，避免主键/唯一冲突）
 * @param {import('mssql').ConnectionPool} pool
 * @param {string} systemcode
 */
async function invBomMasterSystemcodeExists(pool, systemcode) {
  const sc = String(systemcode ?? '').trim()
  if (!sc) return false
  const r = await pool.request().input('sc', sql.NVarChar(100), sc).query(`
    SELECT TOP (1) 1 AS x
    FROM ${INV_BOM_MASTER_FROM} AS b
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.systemcode, N'')))) = @sc
  `)
  return (r.recordset ?? []).length > 0
}

/**
 * 单位换算建议：使用单位 + 目标单位（采购或报价单位），匹配 Bom_unit_change 已审在册行
 * @returns {{ direction: 0|1|null, rate: string }}
 */
/**
 * 按 systemcode 读取 bom_000 一行（不区分在册/删除，供审核/删除审计）
 * @param {import('mssql').ConnectionPool} pool
 * @param {string} systemcodeRaw
 */
async function fetchInvBomMasterRowBySystemcode(pool, systemcodeRaw) {
  const sc = String(systemcodeRaw ?? '').trim()
  if (!sc) return null
  const r = await pool.request().input('sc', sql.NVarChar(100), sc).query(`
    SELECT TOP (1)
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.systemcode, N'')))) AS systemcode,
      LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(10), b.pass), N''))) AS pass,
      LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), b.del), N''))) AS del,
      LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.kcaa01, N'')))) AS kcaa01,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.kcaa02, N'')))) AS kcaa02
    FROM ${INV_BOM_MASTER_FROM} AS b
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.systemcode, N'')))) = @sc
  `)
  return r.recordset?.[0] ?? null
}

/**
 * BOM 钻取/配件 Tab：按 kcaa01 轻量读主档（无 JOIN、无单位换算）
 * @param {import('mssql').ConnectionPool} pool
 * @param {string} kcaa01Raw
 */
async function fetchInvBomMasterBriefByKcaa01(pool, kcaa01Raw) {
  const code = String(kcaa01Raw ?? '').trim()
  if (!code) return null
  const r = await pool.request().input('code', sql.NVarChar(300), code).query(`
    SELECT TOP (1)
      LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.systemcode, N'')))) AS systemcode,
      LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(10), b.pass), N''))) AS pass,
      LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.kcaa01, N'')))) AS kcaa01,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.kcaa02, N'')))) AS kcaa02,
      LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.kcaa03, N'')))) AS kcaa03
    FROM ${INV_BOM_MASTER_FROM} AS b
    WHERE LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.kcaa01, N'')))) = @code
      AND (ISNULL(b.del, N'') = N'' OR LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), b.del), N''))) = N'0')
  `)
  return r.recordset?.[0] ?? null
}

async function lookupBomUnitChangeDirectionRate(pool, useName, otherName) {
  const use = String(useName ?? '').trim()
  const other = String(otherName ?? '').trim()
  if (!use || !other) return { direction: null, rate: '' }
  const r = await pool
    .request()
    .input('uUse', sql.NVarChar(200), use)
    .input('uOther', sql.NVarChar(200), other)
    .query(`
      SELECT TOP 1
        LTRIM(RTRIM(CONVERT(nvarchar(80), ISNULL(c.change_bl, N'')))) AS rate,
        CASE
          WHEN LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.unit_name, N'')))) = @uOther
            AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.unit_name_tow, N'')))) = @uUse
            THEN 0
          WHEN LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.unit_name, N'')))) = @uUse
            AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.unit_name_tow, N'')))) = @uOther
            THEN 1
          ELSE NULL
        END AS dir
      FROM ${BOM_UNIT_CHANGE_FROM} AS c
      WHERE (ISNULL(c.del, N'') = N'' OR c.del = N'0')
        AND LTRIM(RTRIM(ISNULL(c.pass, N''))) = N'1'
        AND (
          (LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.unit_name, N'')))) = @uOther
            AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.unit_name_tow, N'')))) = @uUse)
          OR
          (LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.unit_name, N'')))) = @uUse
            AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.unit_name_tow, N'')))) = @uOther)
        )
    `)
  const row = r.recordset?.[0]
  if (!row || row.dir == null || row.dir === '') {
    return { direction: null, rate: '' }
  }
  const dirNum = Number(row.dir)
  const direction = dirNum === 0 || dirNum === 1 ? /** @type {0|1} */ (dirNum) : null
  const rate = row.rate != null ? String(row.rate).trim() : ''
  return { direction, rate }
}

/** bom_cost 是否含 del 列（进程内缓存；列表用量聚合可选过滤） */
let BOM_COST_DEL_COLUMN_PROMISE = null
async function getBomCostHasDelColumn(pool) {
  if (BOM_COST_DEL_COLUMN_PROMISE) return BOM_COST_DEL_COLUMN_PROMISE
  BOM_COST_DEL_COLUMN_PROMISE = (async () => {
    try {
      const r = await pool.request().input('tn', sql.NVarChar(128), BOM_COST_TABLE).query(`
        SELECT 1 AS x
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = N'dbo' AND TABLE_NAME = @tn AND COLUMN_NAME = N'del'
      `)
      return (r.recordset?.length ?? 0) > 0
    } catch {
      return false
    }
  })()
  return BOM_COST_DEL_COLUMN_PROMISE
}

/** Map 键：sid + "\\x1f" + pq */
function bomCostSidPqMapKey(sid, pq) {
  return `${String(sid ?? '').trim()}\x1f${String(pq ?? '').trim()}`
}

/**
 * 本页「需运算」行去重后的 (sid,pq)，供单次 GROUP BY 聚合（禁止逐行查 bom_cost）
 * @param {{ is_need_calc?: any, code?: any, systemcode?: any, master_guid?: any }[]} rows
 */
function collectDistinctBomCostSidPqPairsFromListRows(rows) {
  /** @type {{ sid: string, pq: string }[]} */
  const out = []
  const seen = new Set()
  if (!Array.isArray(rows)) return out
  for (const row of rows) {
    if (Number(row?.is_need_calc ?? 0) !== 1) continue
    const pq = row.code != null ? String(row.code).trim() : ''
    if (!pq) continue
    const sc = row.systemcode != null ? String(row.systemcode).trim() : ''
    const guid = row.master_guid != null ? String(row.master_guid).trim() : ''
    for (const sid of [sc, guid]) {
      if (!sid) continue
      const k = bomCostSidPqMapKey(sid, pq)
      if (seen.has(k)) continue
      seen.add(k)
      out.push({ sid, pq })
    }
  }
  return out
}

/**
 * 单次 GROUP BY 聚合 bom_cost（第二步；禁止对 pairs 循环 await query）
 * @param {import('mssql').ConnectionPool} pool
 * @param {{ sid: string, pq: string }[]} pairs
 * @returns {Promise<Map<string, { cnt: number, total4: number, total6: number }>>}
 */
async function fetchBomCostAggregatesMapBySidPqPairs(pool, pairs) {
  const map = new Map()
  if (!pairs.length) return map
  const hasDel = await getBomCostHasDelColumn(pool)
  const delFrag = hasDel ? ` AND (ISNULL(c.del, N'') = N'' OR c.del = N'0')` : ''

  const req = pool.request()
  const orParts = []
  for (let i = 0; i < pairs.length; i += 1) {
    req.input(`bc_agg_sid_${i}`, sql.NVarChar(200), pairs[i].sid)
    req.input(`bc_agg_pq_${i}`, sql.NVarChar(300), pairs[i].pq)
    orParts.push(
      `(LTRIM(RTRIM(CONVERT(nvarchar(200), c.sid))) = @bc_agg_sid_${i} AND LTRIM(RTRIM(CONVERT(nvarchar(300), c.pq))) = @bc_agg_pq_${i})`,
    )
  }
  const r = await req.query(`
    SELECT
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.sid, N'')))) AS sid,
      LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(c.pq, N'')))) AS pq,
      COUNT_BIG(1) AS cnt,
      ISNULL(SUM(ISNULL(CONVERT(decimal(18, 6), c.kcac04), 0)), 0) AS total_kcac04,
      ISNULL(SUM(ISNULL(CONVERT(decimal(18, 6), c.kcac06), 0)), 0) AS total_kcac06
    FROM ${BOM_COST_FROM} AS c
    WHERE (${orParts.join(' OR ')})
    ${delFrag}
    GROUP BY
      LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.sid, N'')))),
      LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(c.pq, N''))))
  `)
  for (const row of r.recordset ?? []) {
    const sid = row.sid != null ? String(row.sid).trim() : ''
    const pq = row.pq != null ? String(row.pq).trim() : ''
    if (!sid || !pq) continue
    map.set(bomCostSidPqMapKey(sid, pq), {
      cnt: Number(row.cnt ?? 0),
      total4: Number(row.total_kcac04 ?? 0),
      total6: Number(row.total_kcac06 ?? 0),
    })
  }
  return map
}

/** 从聚合 Map 取本行（优先 systemcode，其次 GUID） */
function lookupBomCostAggregateForMasterRow(row, aggMap) {
  const pq = row.code != null ? String(row.code).trim() : ''
  const sc = row.systemcode != null ? String(row.systemcode).trim() : ''
  const guid = row.master_guid != null ? String(row.master_guid).trim() : ''
  if (!pq) return null
  if (sc) {
    const hit = aggMap.get(bomCostSidPqMapKey(sc, pq))
    if (hit && hit.cnt > 0) return hit
  }
  if (guid && guid !== sc) {
    const hit2 = aggMap.get(bomCostSidPqMapKey(guid, pq))
    if (hit2 && hit2.cnt > 0) return hit2
  }
  return null
}

/**
 * v1.1.8：BOM 主档分页列表（SQL Server 2008 R2：仅 ROW_NUMBER 分页，禁用 OFFSET-FETCH）
 * GET /api/inv/bom/list
 * - 默认排序：优先按 edittime DESC；edittime 为空则按 addtime DESC（保证打开页面先看到最近更新/新增）
 * - 合并搜索 `keyword`（≥3）：全模糊 + 兼容「连字符不一致」（库内常见 PQ3691 与 PQ-3691）：额外
 *   `(REPLACE(b.kcaa01,N'-',N'') LIKE @kwNormLike OR …kcaa02…)`，@kwNormLike 为去掉关键字中 `-` 后的 `%…%`
 * - 兼容旧参：无 `keyword` 时可用 `code`/`name`（均≥3），分别为 `kcaa01`、`kcaa02` 的全模糊；前后端约定「不足 3 字不筛」
 * - 用户显式搜 `CUT-` 开头（keyword 或 code）时，即使 `bom_cut=0` 也临时取消全局 `kcaa01 NOT LIKE N'CUT-%'`，否则无法命中裁片行
 * - bom_cut=1（仅裁片）：结果仅限 `kcaa01` 以 `CUT-` 开头（`UPPER(trim(kcaa01)) LIKE N'CUT-%'`，大小写不敏感）；keyword/name/code 等其它筛选不变
 * - 过滤：del 在册 + pass（与项目列表页「显示未审核」一致）
 * - 裁片：bom_cut=0 时默认 `kcaa01 NOT LIKE N'CUT-%'`（除非显式 CUT- 搜索）；bom_cut=1 时仅保留 CUT- 前缀行
 * - recycled=1：仅查 del=1（回收站），不按 pass 过滤
 * - bom_code_id：可选；Bom_code.id，按该分类 flag5 前缀匹配 kcaa01（BOM 分类，非 Bom_material）
 * - v1.2.8+：每行返回用量运算列 `usageCalcLabel`（不需运算/未运算/已运算）：`Bom_code`（copen=1 且 flag5 非空）为前缀集，
 *   主档 kcaa01 以任一 flag5 开头且 del=0 为需运算；已运算判定为 bom_cost（表名见 BOM_COST_TABLE）存在 pq=kcaa01 且 sid 为主档 [GUID] 或 systemcode（与现行 POST /api/bom/usage-calc 落库 sid 一致并兼容 GUID）
 * - v1.3.0+：用量（成本）列 — 禁止 OUTER APPLY 逐行扫 bom_cost；第二步对「本页需运算行」去重 (sid,pq) 后 **单次** `GROUP BY sid,pq` 聚合，内存 `Map(sid+'\\x1f'+pq)` 回填；若物理表含 `del` 列则附加在册条件（与 INFORMATION_SCHEMA 探测一致）
 */
/**
 * BOM 列表「BOM 分类」下拉：Bom_code 全表按 id 升序（非 Bom_material）
 * GET /api/inv/bom/bom-code-categories
 */
app.get('/api/inv/bom/bom-code-categories', async (req, res) => {
  try {
    const pool = await getPool()
    const r = await pool.request().query(`
      SELECT
        bc.id,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(bc.flag1, N'')))) AS flag1,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(bc.flag5, N'')))) AS flag5
      FROM ${INV_BOM_CODE_FROM} AS bc
      ORDER BY bc.id ASC
    `)
    const list = (r.recordset ?? []).map((row) => ({
      id: Number(row.id),
      flag1: String(row.flag1 ?? '').trim(),
      flag5: String(row.flag5 ?? '').trim(),
    }))
    res.json({ code: 200, msg: 'success', data: { list } })
  } catch (err) {
    console.error('GET /api/inv/bom/bom-code-categories 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库查询失败')
    res.status(500).json({ code: 500, msg: `读取 BOM 分类失败：${detail}`, data: null })
  }
})

app.get('/api/inv/bom/list', async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query?.page ?? 1) || 1)
    const pageSizeRaw = Number(req.query?.pageSize ?? 10) || 10
    const pageSize = Math.min(100, Math.max(1, pageSizeRaw))

    const recycledRaw = String(req.query?.recycled ?? '').trim().toLowerCase()
    const recycled = recycledRaw === '1' || recycledRaw === 'true' || recycledRaw === 'yes'

    const passRaw = String(req.query?.pass ?? '1').trim()
    const pass = passRaw === '0' ? '0' : '1'

    /** 0=默认排除裁片编码（CUT- 前缀）；1=包含裁片 */
    const bomCutRaw = String(req.query?.bom_cut ?? '0').trim()
    const bomCutInclude = bomCutRaw === '1' || bomCutRaw.toLowerCase() === 'true'

    const keywordRaw = String(req.query?.keyword ?? '').trim()
    const keywordOk = keywordRaw.length >= 3
    const kwLike = keywordOk ? `%${escapeSqlLikePattern(keywordRaw)}%` : ''
    /** 去掉连字符后的关键词（用于匹配 TAG-PQ3691… 与 PQ-3691… 混写）； strip 后不足 3 字则不启用该分支 */
    const keywordNoHyphen = keywordRaw.replace(/-/g, '')
    const keywordNormOk = keywordOk && keywordNoHyphen.length >= 3
    const kwNormLike = keywordNormOk ? `%${escapeSqlLikePattern(keywordNoHyphen)}%` : ''

    const bomCodeIdRaw = Number(req.query?.bom_code_id ?? req.query?.bomCodeId ?? '')
    const bomCodeId =
      Number.isFinite(bomCodeIdRaw) && bomCodeIdRaw > 0 ? Math.trunc(bomCodeIdRaw) : 0
    const hasBomCodeFilter = bomCodeId > 0

    const codeRaw = String(req.query?.code ?? '').trim()
    const nameRaw = String(req.query?.name ?? '').trim()
    const codeOk = !keywordOk && codeRaw.length >= 3
    const nameOk = !keywordOk && nameRaw.length >= 3
    const nameLike = nameOk ? `%${escapeSqlLikePattern(nameRaw)}%` : ''
    const codeContainsLike = codeOk ? `%${escapeSqlLikePattern(codeRaw)}%` : ''

    const pool = await getPool()
    const bomMasterColset = await getInvBomMasterColumnSet(pool)
    const bomListExtraSelect = buildInvBomListMasterSelectLines(bomMasterColset).join(',\n          ')

    /** 用户显式按裁片编码搜索（以 CUT- 开头） */
    const isExplicitCutCodeSearch = codeOk && codeRaw.toUpperCase().startsWith('CUT-')
    /** 统一关键词搜索裁片编码（与 keyword 模式共用 CUT 排除逻辑） */
    const isExplicitCutKeywordSearch = keywordOk && keywordRaw.toUpperCase().startsWith('CUT-')

    const codeNoHyphen = codeRaw.replace(/-/g, '')
    const codeNormOk = codeOk && codeNoHyphen.length >= 3
    const codeNormLike = codeNormOk ? `%${escapeSqlLikePattern(codeNoHyphen)}%` : ''
    const codeCondSql =
      !keywordOk && codeOk
        ? codeNormOk
          ? ` AND (
            b.kcaa01 LIKE @codeContainsLike
            OR REPLACE(b.kcaa01, N'-', N'') LIKE @codeNormLike
          ) `
          : ' AND b.kcaa01 LIKE @codeContainsLike '
        : ''

    const keywordOrSql = keywordOk
      ? keywordNormOk
        ? ` AND (
          (b.kcaa01 LIKE @kwLike OR b.kcaa02 LIKE @kwLike)
          OR (
            REPLACE(b.kcaa01, N'-', N'') LIKE @kwNormLike
            OR REPLACE(b.kcaa02, N'-', N'') LIKE @kwNormLike
          )
        ) `
        : ' AND (b.kcaa01 LIKE @kwLike OR b.kcaa02 LIKE @kwLike) '
      : ''

    /** bom_cut=1：仅保留裁片主档（编码以 CUT- 开头，忽略大小写）；bom_cut=0：默认排除 CUT-，除非用户显式按 CUT- 搜索 */
    let whereCutSql = ''
    if (bomCutInclude) {
      whereCutSql = ` AND UPPER(LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.kcaa01, N''))))) LIKE N'CUT-%' `
    } else if (!isExplicitCutCodeSearch && !isExplicitCutKeywordSearch) {
      whereCutSql = ` AND b.kcaa01 NOT LIKE N'CUT-%' `
    }
    /** Bom_code：flag5 非空时按 kcaa01 前缀；否则 kcaa05 与 id 字符串精确匹配 */
    const whereBomCodeSql = hasBomCodeFilter
      ? ` AND EXISTS (
          SELECT 1
          FROM ${INV_BOM_CODE_FROM} AS bc_f
          WHERE bc_f.id = @bomCodeId
            AND (
              (
                LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(bc_f.flag5, N'')))) <> N''
                AND UPPER(LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.kcaa01, N'')))))
                  LIKE UPPER(LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(bc_f.flag5, N''))))) + N'%'
              )
              OR (
                LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(bc_f.flag5, N'')))) = N''
                AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(b.kcaa05, N''))))
                  = LTRIM(RTRIM(CONVERT(nvarchar(50), bc_f.id)))
              )
            )
        ) `
      : ''
    const whereBase = recycled
      ? `
      WHERE LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), b.del), N''))) = N'1'
      ${whereCutSql}
      ${whereBomCodeSql}
      ${keywordOk ? keywordOrSql : `${codeCondSql}${nameOk ? ' AND b.kcaa02 LIKE @nameLike ' : ''}`}
    `
      : `
      WHERE (ISNULL(b.del, N'') = N'' OR b.del = N'0')
        AND LTRIM(RTRIM(ISNULL(b.pass, N''))) = @pass
      ${whereCutSql}
      ${whereBomCodeSql}
      ${keywordOk ? keywordOrSql : `${codeCondSql}${nameOk ? ' AND b.kcaa02 LIKE @nameLike ' : ''}`}
    `

    const countReq = pool.request()
    if (!recycled) countReq.input('pass', sql.NVarChar(10), pass)
    if (hasBomCodeFilter) countReq.input('bomCodeId', sql.Int, bomCodeId)
    if (keywordOk) countReq.input('kwLike', sql.NVarChar(300), kwLike)
    if (keywordNormOk) countReq.input('kwNormLike', sql.NVarChar(300), kwNormLike)
    if (codeOk) countReq.input('codeContainsLike', sql.NVarChar(300), codeContainsLike)
    if (codeNormOk) countReq.input('codeNormLike', sql.NVarChar(300), codeNormLike)
    if (nameOk) countReq.input('nameLike', sql.NVarChar(300), nameLike)

    const tCount0 = Date.now()
    const totalRow = await countReq.query(`
      SELECT COUNT(1) AS total
      FROM ${INV_BOM_MASTER_FROM} AS b
      ${whereBase}
    `)
    const tCount1 = Date.now()
    if (tCount1 - tCount0 > 500) {
      console.warn(
        `[BOM列表] COUNT 查询耗时 ${tCount1 - tCount0}ms（>500ms）：kcaa01/kcaa02 含前导 % 的全模糊可能无法命中前缀索引，建议在库端评估索引或全文检索 CONTAINS`,
      )
    }
    const total = Number(totalRow.recordset?.[0]?.total ?? 0)

    const safeOffset = (page - 1) * pageSize
    const startRow = safeOffset + 1
    const endRow = safeOffset + pageSize

    const listReq = pool.request()
    if (!recycled) listReq.input('pass', sql.NVarChar(10), pass)
    if (hasBomCodeFilter) listReq.input('bomCodeId', sql.Int, bomCodeId)
    listReq.input('startRow', sql.Int, startRow)
    listReq.input('endRow', sql.Int, endRow)
    if (keywordOk) listReq.input('kwLike', sql.NVarChar(300), kwLike)
    if (keywordNormOk) listReq.input('kwNormLike', sql.NVarChar(300), kwNormLike)
    if (codeOk) listReq.input('codeContainsLike', sql.NVarChar(300), codeContainsLike)
    if (codeNormOk) listReq.input('codeNormLike', sql.NVarChar(300), codeNormLike)
    if (nameOk) listReq.input('nameLike', sql.NVarChar(300), nameLike)

    const tList0 = Date.now()
    const listResult = await listReq.query(`
      ;WITH base AS (
        SELECT
          LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.systemcode, N'')))) AS systemcode,
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(b.[GUID], N'')))) AS master_guid,
          b.kcaa01 AS code,
          b.kcaa02 AS product_name,
          b.kcaa03 AS spec,
          b.kcaa04 AS unit,
          CONVERT(nvarchar(100), ISNULL(b.addtime, N'')) AS addtime,
          CONVERT(nvarchar(100), ISNULL(b.edittime, N'')) AS edittime,
          CONVERT(nvarchar(500), ISNULL(b.remark, N'')) AS remark,
          b.kcaa12 AS isPurchase,
          b.kcaa13 AS isSubcontract,
          b.kcaa14 AS isSelfProduced,
          b.sign AS status,
          b.[version] AS version,
          b.pass AS pass,
          CASE
            WHEN LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), b.del), N''))) = N'1' THEN 0
            WHEN EXISTS (
              SELECT 1
              FROM ${INV_BOM_CODE_FROM} AS bc
              WHERE LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(bc.copen, N'')))) = N'1'
                AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(bc.flag5, N'')))) <> N''
                AND LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.kcaa01, N'')))) LIKE (
                  LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(bc.flag5, N'')))) + N'%'
                )
            ) THEN 1
            ELSE 0
          END AS is_need_calc,
          CASE
            WHEN LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), b.del), N''))) = N'1' THEN 0
            WHEN NOT EXISTS (
              SELECT 1
              FROM ${INV_BOM_CODE_FROM} AS bc2
              WHERE LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(bc2.copen, N'')))) = N'1'
                AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(bc2.flag5, N'')))) <> N''
                AND LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.kcaa01, N'')))) LIKE (
                  LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(bc2.flag5, N'')))) + N'%'
                )
            ) THEN 0
            WHEN EXISTS (
              SELECT 1
              FROM ${BOM_COST_FROM} AS c
              WHERE LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(c.pq, N'')))) = LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.kcaa01, N''))))
                AND (
                  LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.sid, N'')))) = LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(b.[GUID], N''))))
                  OR LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.sid, N'')))) = LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(b.systemcode, N''))))
                )
            ) THEN 1
            ELSE 0
          END AS has_bom_cost_cached,
          ${bomListExtraSelect},
          ROW_NUMBER() OVER (
            ORDER BY
              CASE
                WHEN LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.edittime, N'')))) = N''
                THEN LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.addtime, N''))))
                ELSE LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.edittime, N''))))
              END DESC,
              b.kcaa01 ASC
          ) AS rn
        FROM ${INV_BOM_MASTER_FROM} AS b
        LEFT JOIN ${BOM_MATERIAL_FROM} AS cat
          ON LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(200), b.kcaa05), N''))) = LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(200), cat.code), N'')))
        LEFT JOIN ${BOM_STOCKS_WORKSHOP_FROM} AS ws
          ON LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(200), b.kcaa15), N''))) = LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(200), ws.code), N'')))
        ${whereBase}
      )
      SELECT
        p.systemcode,
        p.master_guid,
        p.code,
        p.product_name,
        p.spec,
        p.unit,
        p.addtime,
        p.edittime,
        p.remark,
        p.isPurchase,
        p.isSubcontract,
        p.isSelfProduced,
        p.status,
        p.version,
        p.pass,
        p.is_need_calc,
        p.has_bom_cost_cached,
        p.kcaa02_en,
        p.kpname,
        p.kcaa05,
        p.kcaa06,
        p.kcaa09,
        p.kcaa10,
        p.kcaa11,
        p.kcaa15,
        p.location,
        p.kcaa25,
        p.kcaa26,
        p.kcaa27,
        p.kcaa29,
        p.kcaa30,
        p.kcaa31,
        p.kcaa32,
        p.kcaa33,
        p.kcaa35,
        p.sale_price,
        p.cost_price,
        p.Customer_supply,
        p.Customer_Name,
        p.uname,
        p.utruename,
        p.uptruename,
        p.categoryName,
        p.workshopName
      FROM base AS p
      WHERE p.rn BETWEEN @startRow AND @endRow
      ORDER BY p.rn
    `)
    const tList1 = Date.now()
    if (tList1 - tList0 > 500) {
      console.warn(
        `[BOM列表] LIST 查询耗时 ${tList1 - tList0}ms（>500ms）：建议 DBA 检查执行计划；大表可考虑全文检索优化含前导 % 的模糊条件`,
      )
    }

    const rawRows = listResult.recordset ?? []
    const bomCostPairs = collectDistinctBomCostSidPqPairsFromListRows(rawRows)
    const bomCostAggMap = await fetchBomCostAggregatesMapBySidPqPairs(pool, bomCostPairs)

    const list = rawRows.map((row) => {
      const isNeedCalc = Number(row.is_need_calc ?? 0) === 1
      const hasBomCostCached = Number(row.has_bom_cost_cached ?? 0) === 1
      let usageCalcLabel = '不需运算'
      let usageCalcStatus = 'none'
      if (isNeedCalc) {
        if (hasBomCostCached) {
          usageCalcLabel = '已运算'
          usageCalcStatus = 'done'
        } else {
          usageCalcLabel = '未运算'
          usageCalcStatus = 'pending'
        }
      }
      const aggHit = lookupBomCostAggregateForMasterRow(row, bomCostAggMap)
      const bomCostAggCnt = aggHit && Number(aggHit.cnt) > 0 ? Number(aggHit.cnt) : 0
      /** 用量（成本）：仅需运算行展示；库内列为 kcac04/kcac06 */
      let bomCostUsageCostText = ''
      if (isNeedCalc) {
        if (!bomCostAggCnt) {
          bomCostUsageCostText = '-'
        } else {
          const sum4 = Number(aggHit?.total4 ?? 0)
          const sum6 = Number(aggHit?.total6 ?? 0)
          const s4 = Number.isFinite(sum4) ? sum4.toFixed(4) : '0.0000'
          const s6 = Number.isFinite(sum6) ? sum6.toFixed(4) : '0.0000'
          bomCostUsageCostText = `成本：${s4},${s6}`
        }
      }
      return {
        systemcode: row.systemcode != null ? String(row.systemcode) : '',
        code: row.code != null ? String(row.code) : '',
        /** bom_000.kcaa02 名称(中文) */
        kcaa02: row.product_name != null ? String(row.product_name) : '',
        name: row.product_name != null ? String(row.product_name) : '',
        spec: row.spec != null ? String(row.spec) : '',
        unit: row.unit != null ? String(row.unit) : '',
        addtime: row.addtime != null ? String(row.addtime) : '',
        edittime: row.edittime != null ? String(row.edittime) : '',
        remark: row.remark != null ? String(row.remark) : '',
        isPurchase: row.isPurchase != null ? String(row.isPurchase) : '',
        isSubcontract: row.isSubcontract != null ? String(row.isSubcontract) : '',
        isSelfProduced: row.isSelfProduced != null ? String(row.isSelfProduced) : '',
        status: row.status != null ? String(row.status) : '',
        version: row.version != null ? String(row.version) : '',
        pass: row.pass != null ? String(row.pass) : '',
        isNeedCalc,
        hasBomCostCache: hasBomCostCached,
        usageCalcLabel,
        usageCalcStatus,
        bomCostUsageCostText,
        ...mapInvBomListRowExtraFields(row),
      }
    })

    res.json({ code: 200, msg: 'success', data: { total, list, recycled } })
  } catch (err) {
    console.error('GET /api/inv/bom/list 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库查询失败')
    res.status(500).json({ code: 500, msg: `读取 BOM 列表失败：${detail}`, data: null })
  }
})

/**
 * 成本 BOM 用量平铺：深度优先与树构建顺序一致；不落库。
 * - 顶层 yl = kcac04；下级 yl = 父节点已算 yl × 当前 kcac04（父为 CUT- 裁片时不乘父用量，子件直接取自身 kcac04）
 * - loss_rate：kcac05>0 用 kcac05；否则 kcaa33>0 用 kcaa33；否则 0
 * - total_qty = yl × (1 + loss_rate)
 * @param {any[]} treeNodes buildBomPartsUsageTreeNodes 返回值
 * @param {number|null|undefined} parentYl 父行已算出的 yl；根层为 null/undefined
 * @param {any[]} [acc]
 * @param {boolean} [parentIsCut] 父行是否为 CUT- 裁片
 * @param {string} [parentTopKcaa01] 直接父行 kcaa01（供子行 top_*）
 * @param {string} [parentTopKcaa02] 直接父行 kcaa02
 * @returns {{ kcaa01: string, kcaa02: string, top_kcaa01: string, top_kcaa02: string, kcaa03: string, kcaa04: string, Describe: string, yl: number, loss_rate: number, total_qty: number, level: number }[]}
 */
function flattenBomPartsCostUsageFlat(
  treeNodes,
  parentYl,
  acc,
  parentIsCut = false,
  parentTopKcaa01 = '',
  parentTopKcaa02 = '',
) {
  const out = acc ?? []
  if (!Array.isArray(treeNodes) || !treeNodes.length) return out
  const isRootLevel = parentYl == null || parentYl === undefined
  for (let i = 0; i < treeNodes.length; i++) {
    const node = treeNodes[i]
    const selfCode = node?.kcaa01 != null ? String(node.kcaa01) : ''
    const selfName = node?.kcaa02 != null ? String(node.kcaa02) : ''
    const topFields = resolveBomCostTopFields(
      isRootLevel,
      selfCode,
      selfName,
      parentTopKcaa01,
      parentTopKcaa02,
    )
    const kcac04 = Number(node?.kcac04 ?? 0)
    const yl = computeBomUsageYlFromParent(kcac04, parentYl, parentIsCut)
    const kcac05 = Number(node?.kcac05 ?? 0)
    const kcaa33 = Number(node?.kcaa33 ?? 0)
    let loss_rate = 0
    if (kcac05 > 0) loss_rate = kcac05
    else if (kcaa33 > 0) loss_rate = kcaa33
    const total_qty = yl * (1 + loss_rate)
    const lv = node?.level != null && Number.isFinite(Number(node.level)) ? Number(node.level) : 1
    const describeVal = String(node?.Describe ?? node?.describe ?? '')
    const seqRaw = node?.Seq != null ? node.Seq : node?.seq
    const seqNum =
      seqRaw != null && seqRaw !== '' && Number.isFinite(Number(seqRaw)) ? Number(seqRaw) : null
    out.push({
      kcaa01: selfCode,
      kcaa02: selfName,
      top_kcaa01: topFields.top_kcaa01,
      top_kcaa02: topFields.top_kcaa02,
      kcaa03: node?.kcaa03 != null ? String(node.kcaa03) : '',
      kcaa04: node?.kcaa04 != null ? String(node.kcaa04) : '',
      Describe: describeVal,
      yl,
      loss_rate,
      total_qty,
      level: lv,
      Seq: seqNum,
    })
    const ch = node?.children
    const thisIsCut = bomCostMaterialStartsWithCutPrefix(node?.kcaa01)
    if (Array.isArray(ch) && ch.length) {
      flattenBomPartsCostUsageFlat(ch, yl, out, thisIsCut, selfCode, selfName)
    }
  }
  return out
}

const BOM_COST_HIDE_PREFIX_CAP_SERVER = 50
const BOM_COST_HIDE_PREFIX_LEN_SERVER = 80

/** @param {unknown[]} list */
function normalizeBomCostHidePrefixesServer(list) {
  const arr = Array.isArray(list) ? list : []
  const seen = new Set()
  const out = []
  for (const item of arr) {
    const t = String(item ?? '').trim().slice(0, BOM_COST_HIDE_PREFIX_LEN_SERVER)
    if (!t) continue
    const k = t.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(t)
    if (out.length >= BOM_COST_HIDE_PREFIX_CAP_SERVER) break
  }
  return out
}

/**
 * 成本 BOM 真实用量 / Bom_consumption：与前端展示合并一致（kcaa01 + Describe；Map + 首次出现顺序）
 * @param {Record<string, unknown>[]} flatRows
 * @param {string[]} hidePrefixes
 */
function aggregateBomConsumptionRealFromFlatServer(flatRows, hidePrefixes) {
  if (!Array.isArray(flatRows) || !flatRows.length) return []
  /** @type {Map<string, { kcaa01: string, kcaa02: string, kcaa03: string, kcaa04: string, Describe: string, sumay: number, sumby: number }>} */
  const map = new Map()
  /** @type {string[]} */
  const order = []
  for (let i = 0; i < flatRows.length; i++) {
    const r = flatRows[i]
    const code = String(r?.kcaa01 ?? '').trim()
    if (!code || bomCostUsageMatchesHidePrefix(code, hidePrefixes)) continue
    const remark = String(r?.Describe ?? '').trim()
    const mergeKey = `${code}\u0000${remark}`
    const yl = Number(r?.yl ?? 0)
    const loss = Number(r?.loss_rate ?? 0)
    const rowTotal = Number.isFinite(Number(r?.total_qty)) ? Number(r.total_qty) : yl * (1 + loss)
    let g = map.get(mergeKey)
    if (!g) {
      g = {
        kcaa01: code,
        kcaa02: r?.kcaa02 != null ? String(r.kcaa02) : '',
        kcaa03: r?.kcaa03 != null ? String(r.kcaa03) : '',
        kcaa04: r?.kcaa04 != null ? String(r.kcaa04) : '',
        Describe: remark,
        sumay: 0,
        sumby: 0,
      }
      map.set(mergeKey, g)
      order.push(mergeKey)
    } else {
      if (!g.kcaa02 && r?.kcaa02) g.kcaa02 = String(r.kcaa02)
      if (!g.kcaa03 && r?.kcaa03) g.kcaa03 = String(r.kcaa03)
      if (!g.kcaa04 && r?.kcaa04) g.kcaa04 = String(r.kcaa04)
    }
    g.sumay += yl
    g.sumby += rowTotal
  }
  /** @type {{ kcaa01: string, kcaa02: string, kcaa03: string, kcaa04: string, sumay: number, sumby: number, kcac05: number }[]} */
  const out = []
  for (let j = 0; j < order.length; j++) {
    const g = map.get(order[j])
    if (!g) continue
    const sumay = g.sumay
    const sumby = g.sumby
    const kcac05 = sumay > 0 ? (sumby - sumay) / sumay : 0
    out.push({
      kcaa01: g.kcaa01,
      kcaa02: g.kcaa02,
      kcaa03: g.kcaa03,
      kcaa04: g.kcaa04,
      Describe: g.Describe,
      sumay,
      sumby,
      kcac05,
    })
  }
  return out
}

/**
 * 批量 INSERT Bom_consumption（单语句多 VALUES；切片控制参数数量）
 * @param {import('mssql').Transaction} tx
 * @param {string} pq
 * @param {string} sid
 * @param {{ kcaa01: string, kcaa02: string, kcaa03: string, kcaa04: string, sumay: number, sumby: number, kcac05: number }[]} rows
 */
async function insertBomConsumptionBulk(tx, pq, sid, rows) {
  if (!rows.length) return
  const pqV = String(pq ?? '').trim()
  const sidV = String(sid ?? '').trim()
  const DEC = sql.Decimal(28, 10)
  const NV300 = sql.NVarChar(300)
  const NV80 = sql.NVarChar(80)
  const ROW_PARAMS = 8
  const maxRowsPerChunk = Math.min(100, Math.floor((2000 - 2) / ROW_PARAMS))

  for (let off = 0; off < rows.length; off += maxRowsPerChunk) {
    const slice = rows.slice(off, off + maxRowsPerChunk)
    const req = new sql.Request(tx)
    req.input('pq', sql.NVarChar(300), pqV)
    req.input('sid', sql.NVarChar(100), sidV)
    const valueTuples = []
    for (let i = 0; i < slice.length; i++) {
      const row = slice[i]
      const pre = `p${off}_${i}_`
      const k2 = String(row.kcaa02 ?? '').trim()
      const k3 = String(row.kcaa03 ?? '').trim()
      const k4 = String(row.kcaa04 ?? '').trim()
      req.input(`${pre}k1`, NV300, String(row.kcaa01 ?? '').trim())
      req.input(`${pre}k2`, NV300, k2 || null)
      req.input(`${pre}k3`, NV300, k3 || null)
      req.input(`${pre}k4`, NV80, k4 || null)
      req.input(`${pre}sa`, DEC, Number.isFinite(Number(row.sumay)) ? Number(row.sumay) : 0)
      req.input(`${pre}sb`, DEC, Number.isFinite(Number(row.sumby)) ? Number(row.sumby) : 0)
      req.input(`${pre}lr`, DEC, Number.isFinite(Number(row.kcac05)) ? Number(row.kcac05) : 0)
      valueTuples.push(`(@pq, @sid, @${pre}k1, @${pre}k2, @${pre}k3, @${pre}k4, @${pre}sa, @${pre}sb, @${pre}lr)`)
    }
    await req.query(`
      INSERT INTO ${BOM_CONSUMPTION_FROM} (pq, sid, kcaa01, kcaa02, kcaa03, kcaa04, sumay, sumby, kcac05)
      VALUES ${valueTuples.join(',\n')}
    `)
  }
}

/** 按主档 systemcode 解析 pq（成品编码）、sid（主档 systemcode），供 bom_cost / Bom_consumption */
async function fetchBomUsageHeadBySystemcode(pool, systemcode) {
  const sc = String(systemcode ?? '').trim()
  if (!sc) return null
  const headRs = await pool
    .request()
    .input('sc', sql.NVarChar(100), sc)
    .query(`
      SELECT TOP 1
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.systemcode, N'')))) AS systemcode,
        LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.kcaa01, N'')))) AS kcaa01
      FROM ${INV_BOM_MASTER_FROM} AS b
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.systemcode, N'')))) = @sc
        AND (ISNULL(b.del, N'') = N'' OR b.del = N'0')
    `)
  const head = headRs.recordset?.[0] ?? null
  const sid = String(head?.systemcode ?? '').trim()
  const pq = String(head?.kcaa01 ?? '').trim() || sc
  if (!sid) return null
  return { sid, pq }
}

/** 查询行 → 前端 bom_cost DTO */
function mapBomCostRecordToDto(r) {
  return {
    id: r.id,
    pq: r.pq != null ? String(r.pq) : '',
    sid: r.sid != null ? String(r.sid) : '',
    kcaa01: r.kcaa01 != null ? String(r.kcaa01) : '',
    kcaa02: r.kcaa02 != null ? String(r.kcaa02) : '',
    kcaa03: r.kcaa03 != null ? String(r.kcaa03) : '',
    kcaa04: r.kcaa04 != null ? String(r.kcaa04) : '',
    kcac04: r.kcac04 != null ? Number(r.kcac04) : 0,
    kcac05: r.kcac05 != null ? Number(r.kcac05) : 0,
    kcac06: r.kcac06 != null ? Number(r.kcac06) : 0,
    kcac07: r.kcac07 != null ? Number(r.kcac07) : null,
    kcac08: r.kcac08 != null ? Number(r.kcac08) : null,
    Describe: r.Describe != null ? String(r.Describe) : '',
    isok: r.isok != null ? Number(r.isok) : 0,
  }
}

/** 查询行 → 前端 Bom_consumption DTO */
function mapBomConsumptionRecordToDto(r) {
  return {
    id: r.id,
    pq: r.pq != null ? String(r.pq) : '',
    sid: r.sid != null ? String(r.sid) : '',
    kcaa01: r.kcaa01 != null ? String(r.kcaa01) : '',
    kcaa02: r.kcaa02 != null ? String(r.kcaa02) : '',
    kcaa03: r.kcaa03 != null ? String(r.kcaa03) : '',
    kcaa04: r.kcaa04 != null ? String(r.kcaa04) : '',
    sumay: r.sumay != null ? Number(r.sumay) : 0,
    sumby: r.sumby != null ? Number(r.sumby) : 0,
    kcac05: r.kcac05 != null ? Number(r.kcac05) : 0,
  }
}

/**
 * BOM 用量运算：递归 Bom_parts + 成本平铺 + 单事务覆盖写入 bom_cost（hidePrefixes 剔除 + 跳过主 BOM 根行，平铺不合并）
 * POST /api/bom/usage-calc
 * body: { systemcode, hidePrefixes?: string[] }
 * 成功：{ success:true, total(bom_cost 行数), data, flatCostUsageRaw, bomCost }（树 data 供「BOM用量表运算」不变）
 */
app.post('/api/bom/usage-calc', async (req, res) => {
  try {
    const systemcode = String(req.body?.systemcode ?? '').trim()
    if (!systemcode) {
      res.status(400).json({ success: false, msg: '参数错误：systemcode 不能为空', total: 0 })
      return
    }
    const hidePrefixes = normalizeBomCostHidePrefixesServer(
      Array.isArray(req.body?.hidePrefixes) ? req.body.hidePrefixes : [],
    )

    const pool = await getPool()
    const head = await fetchBomUsageHeadBySystemcode(pool, systemcode)
    if (!head) {
      res.status(404).json({ success: false, msg: '未找到对应主档或主档缺少 systemcode', total: 0 })
      return
    }
    const { sid, pq } = head

    const tCalc0 = Date.now()
    const bomHeadStack = new Set([systemcode])
    const tTree0 = Date.now()
    const data = await buildBomPartsUsageTreeNodes(pool, systemcode, 1, bomHeadStack)
    const treeMs = Date.now() - tTree0
    const tFlat0 = Date.now()
    const flatCostUsageRaw = flattenBomPartsCostUsageFlat(data, null, [])
    const flatMs = Date.now() - tFlat0
    /** bom_cost：剔除隐藏前缀 + 跳过主档 pq 根行，平铺不合并（Bom_consumption 已停用，历史数据不维护） */
    const bomCostInsertPayload = buildBomCostInsertPayloadFromFlatUsage(flatCostUsageRaw, hidePrefixes, pq)
    const tEnrich0 = Date.now()
    const bom000Map = await fetchBom000ForBomCostEnrich(
      pool,
      bomCostInsertPayload.map((r) => r.kcaa01),
    )
    const bomCostRowsEnriched = enrichBomCostInsertRowsFromBom000(bomCostInsertPayload, bom000Map)
    const enrichMs = Date.now() - tEnrich0
    const actor = getActorAuditTripletFromReq(req)
    const bomCostRowsFinal = applyBomCostAuditToRows(bomCostRowsEnriched, {
      actor,
      addtime: formatBomCostAuditTimestamp(),
    })

    const tTx0 = Date.now()
    const tx = new sql.Transaction(pool)
    await tx.begin()
    try {
      const delBc = new sql.Request(tx)
      delBc.input('pq', sql.NVarChar(300), pq)
      delBc.input('sid', sql.NVarChar(100), sid)
      await delBc.query(`DELETE FROM ${BOM_COST_FROM} WHERE pq = @pq AND sid = @sid`)

      if (bomCostRowsFinal.length) {
        await insertBomCostBulkEnriched(pool, tx, pq, sid, bomCostRowsFinal)
      }

      const upOk = new sql.Request(tx)
      upOk.input('pq', sql.NVarChar(300), pq)
      upOk.input('sid', sql.NVarChar(100), sid)
      await upOk.query(`UPDATE ${BOM_COST_FROM} SET isok = 1 WHERE pq = @pq AND sid = @sid AND isok = 0`)

      await tx.commit()
    } catch (innerErr) {
      try {
        await tx.rollback()
      } catch {
        // ignore
      }
      console.error('POST /api/bom/usage-calc 事务失败：', innerErr)
      res.status(500).json({ success: false, msg: 'bom_cost写入失败', total: 0 })
      return
    }

    const selBc = await pool
      .request()
      .input('pq', sql.NVarChar(300), pq)
      .input('sid', sql.NVarChar(100), sid)
      .query(`
        SELECT id, pq, sid, kcaa01, kcaa02, kcaa03, kcaa04, kcac04, kcac05, kcac06, kcac07, kcac08, [Describe], isok
        FROM ${BOM_COST_FROM}
        WHERE pq = @pq AND sid = @sid
        ORDER BY id ASC
      `)

    const bomCost = (selBc.recordset ?? []).map(mapBomCostRecordToDto)

    const txMs = Date.now() - tTx0
    const totalMs = Date.now() - tCalc0
    console.log(
      '[bom-usage-calc]',
      JSON.stringify({
        systemcode,
        flatRows: flatCostUsageRaw.length,
        bomCostRows: bomCost.length,
        treeMs,
        flatMs,
        enrichMs,
        txMs,
        totalMs,
      }),
    )

    res.json({
      success: true,
      total: bomCost.length,
      data,
      flatCostUsageRaw,
      bomCost,
    })
  } catch (err) {
    if (err?.code === 'BOM_CYCLE') {
      res.status(409).json({ success: false, msg: String(err.message ?? '检测到BOM循环引用'), total: 0 })
      return
    }
    console.error('POST /api/bom/usage-calc 失败：', err)
    res.status(500).json({ success: false, msg: 'bom_cost写入失败', total: 0 })
  }
})

/**
 * BOM 用量表：GET /api/bom/tree?systemcode=xxx
 * - 若 bom_cost 已有 pq+sid 缓存：hasCache=true，直接返回 bom_cost，不递归 Bom_parts、不平铺 flatCostUsageRaw
 * - 否则：hasCache=false，递归树 data + flatCostUsageRaw（前端本地筛选合并预览；首次落库用 POST /api/bom/usage-calc）
 */
app.get('/api/bom/tree', async (req, res) => {
  try {
    const systemcode = String(req.query?.systemcode ?? '').trim()
    const emptyPayload = {
      success: false,
      msg: '',
      data: null,
      hasCache: false,
      bom_cost: [],
      flatCostUsageRaw: [],
    }
    if (!systemcode) {
      res.status(400).json({ ...emptyPayload, success: false, msg: '参数错误：systemcode 不能为空', data: null })
      return
    }
    const pool = await getPool()
    const head = await fetchBomUsageHeadBySystemcode(pool, systemcode)
    if (!head) {
      res
        .status(404)
        .json({ ...emptyPayload, success: false, msg: '未找到对应主档或主档缺少 systemcode', data: null })
      return
    }
    const { pq, sid } = head

    const cntRs = await pool
      .request()
      .input('pq', sql.NVarChar(300), pq)
      .input('sid', sql.NVarChar(100), sid)
      .query(`SELECT COUNT_BIG(*) AS c FROM ${BOM_COST_FROM} WHERE pq = @pq AND sid = @sid`)
    const cacheCount = Number(cntRs.recordset?.[0]?.c ?? 0)

    if (cacheCount > 0) {
      const selBc = await pool
        .request()
        .input('pq', sql.NVarChar(300), pq)
        .input('sid', sql.NVarChar(100), sid)
        .query(`
          SELECT id, pq, sid, kcaa01, kcaa02, kcaa03, kcaa04, kcac04, kcac05, kcac06, kcac07, kcac08, [Describe], isok
          FROM ${BOM_COST_FROM}
          WHERE pq = @pq AND sid = @sid
          ORDER BY id ASC
        `)
      const bomCost = (selBc.recordset ?? []).map(mapBomCostRecordToDto)

      res.json({
        success: true,
        hasCache: true,
        data: [],
        flatCostUsageRaw: [],
        bom_cost: bomCost,
      })
      return
    }

    const bomHeadStack = new Set([systemcode])
    const data = await buildBomPartsUsageTreeNodes(pool, systemcode, 1, bomHeadStack)
    const flatCostUsageRaw = flattenBomPartsCostUsageFlat(data, null, [])
    res.json({
      success: true,
      hasCache: false,
      data,
      flatCostUsageRaw,
      bom_cost: [],
    })
  } catch (err) {
    if (err?.code === 'BOM_CYCLE') {
      res.status(409).json({
        success: false,
        msg: String(err.message ?? '检测到BOM循环引用'),
        data: null,
        hasCache: false,
        bom_cost: [],
        flatCostUsageRaw: [],
      })
      return
    }
    console.error('GET /api/bom/tree 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库查询失败')
    res.status(500).json({
      success: false,
      msg: `读取 BOM 树失败：${detail}`,
      data: null,
      hasCache: false,
      bom_cost: [],
      flatCostUsageRaw: [],
    })
  }
})

/**
 * BOM 配件明细列表（Tab 配件明细）
 * GET /api/inventory/bom/parts/:systemcode — :systemcode 为主档 systemcode（URL 编码）
 * - 单次往返：EXISTS 与旧版「先 TOP 1 主档」等价（无主档则 0 行 → 空列表）；含 del=1 等配件行
 * - bom_000 展示列：原逐行 OUTER APPLY 改为「本单 distinct kcaa01 + ROW_NUMBER」再 LEFT JOIN，语义同 TOP 1 ORDER BY id DESC
 */
app.get('/api/inventory/bom/parts/:systemcode', async (req, res) => {
  try {
    let systemcode = ''
    try {
      systemcode = decodeURIComponent(String(req.params?.systemcode ?? '').trim())
    } catch {
      systemcode = String(req.params?.systemcode ?? '').trim()
    }
    if (!systemcode) {
      res.status(400).json({ code: 400, msg: '参数错误：systemcode 不能为空', data: null })
      return
    }

    const pool = await getPool()
    const r = await pool
      .request()
      .input('sc', sql.NVarChar(100), systemcode)
      .query(`
      WITH part_keys AS (
        SELECT DISTINCT LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(p0.kcaa01, N'')))) AS kcaa01_key
        FROM ${INV_BOM_PARTS_FROM} AS p0
        WHERE LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(p0.kcac01, N'')))) = @sc
      ),
      bh_ranked AS (
        SELECT
          LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.kcaa01, N'')))) AS kcaa01_key,
          LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.kcaa01, N'')))) AS j01,
          LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.kcaa02, N'')))) AS j02,
          LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.kcaa03, N'')))) AS j03,
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(b.kcaa11, N'')))) AS j11,
          LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.systemcode, N'')))) AS child_systemcode,
          LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(10), b.pass), N''))) AS child_pass,
          ROW_NUMBER() OVER (
            PARTITION BY LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.kcaa01, N''))))
            ORDER BY b.id DESC
          ) AS rn
        FROM ${INV_BOM_MASTER_FROM} AS b
        INNER JOIN part_keys AS pk
          ON LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.kcaa01, N'')))) = pk.kcaa01_key
        WHERE (ISNULL(b.del, N'') = N'' OR LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), b.del), N''))) = N'0')
      ),
      bh AS (
        SELECT kcaa01_key, j01, j02, j03, j11, child_systemcode, child_pass
        FROM bh_ranked
        WHERE rn = 1
      )
      SELECT
        p.id,
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(p.kcac01, N'')))) AS kcac01,
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(p.kcac02, N'')))) AS kcac02,
        CASE
          WHEN bh.j01 IS NOT NULL AND LTRIM(RTRIM(bh.j01)) <> N'' THEN bh.j01
          ELSE LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(p.kcaa01, N''))))
        END AS kcaa01,
        CASE
          WHEN bh.j02 IS NOT NULL AND LTRIM(RTRIM(bh.j02)) <> N'' THEN bh.j02
          ELSE LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(p.kcaa02, N''))))
        END AS kcaa02,
        CASE
          WHEN bh.j03 IS NOT NULL AND LTRIM(RTRIM(bh.j03)) <> N'' THEN bh.j03
          ELSE LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(p.kcaa03, N''))))
        END AS kcaa03,
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(p.kcaa04, N'')))) AS kcaa04,
        CASE
          WHEN bh.j11 IS NOT NULL AND LTRIM(RTRIM(bh.j11)) <> N'' THEN bh.j11
          ELSE LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(p.kcaa11, N''))))
        END AS kcaa11,
        ${bomPartsNumericColAsDecimalSql('p.kcac04')} AS kcac04,
        ${bomPartsNumericColAsDecimalSql('p.kcac05')} AS kcac05,
        ${bomPartsNumericColAsDecimalSql('p.kcac06')} AS kcac06,
        ${bomPartsNumericColAsDecimalSql('p.cost_price')} AS cost_price,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(p.remark, N'')))) AS remark,
        p.[Seq] AS seq,
        LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(10), p.del), N''))) AS del,
        LTRIM(RTRIM(ISNULL(bh.child_systemcode, N''))) AS child_systemcode,
        LTRIM(RTRIM(ISNULL(bh.child_pass, N''))) AS child_pass
      FROM ${INV_BOM_PARTS_FROM} AS p
      LEFT OUTER JOIN bh
        ON LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(p.kcaa01, N'')))) = bh.kcaa01_key
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(p.kcac01, N'')))) = @sc
        AND EXISTS (
          SELECT 1
          FROM ${INV_BOM_MASTER_FROM} AS h
          WHERE LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(h.systemcode, N'')))) = @sc
            AND (ISNULL(h.del, N'') = N'' OR h.del = N'0')
        )
      ORDER BY CASE WHEN p.[Seq] IS NULL THEN 1 ELSE 0 END, p.[Seq], p.id
    `)

    const list = (r.recordset ?? []).map((row) => ({
      id: row.id != null ? Number(row.id) : null,
      kcac01: row.kcac01 != null ? String(row.kcac01) : '',
      kcac02: row.kcac02 != null ? String(row.kcac02) : '',
      /** 子件编码对应 bom_000.systemcode，供配件「查看」钻取免二次查主档 */
      childSystemcode:
        row.child_systemcode != null ? String(row.child_systemcode).trim() : '',
      childPass: row.child_pass != null ? String(row.child_pass) : '',
      kcaa01: row.kcaa01 != null ? String(row.kcaa01) : '',
      kcaa02: row.kcaa02 != null ? String(row.kcaa02) : '',
      kcaa03: row.kcaa03 != null ? String(row.kcaa03) : '',
      kcaa04: row.kcaa04 != null ? String(row.kcaa04) : '',
      kcaa11: row.kcaa11 != null ? String(row.kcaa11) : '',
      kcac04: Number(row.kcac04 ?? 0),
      kcac05: Number(row.kcac05 ?? 0),
      kcac06: Number(row.kcac06 ?? 0),
      cost_price: Number(row.cost_price ?? 0),
      remark: row.remark != null ? String(row.remark) : '',
      seq:
        row.seq != null && row.seq !== '' && Number.isFinite(Number(row.seq)) ? Number(row.seq) : null,
      del: row.del != null ? String(row.del) : '0',
    }))

    res.json({ code: 200, msg: 'success', data: { list } })
  } catch (err) {
    console.error('GET /api/inventory/bom/parts/:systemcode 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库查询失败')
    res.status(500).json({ code: 500, msg: `读取 BOM 配件明细失败：${detail}`, data: null })
  }
})

/**
 * BOM 配件明细批量保存：物理删除待删行 + 更新 + 新增
 * PUT /api/inventory/bom/parts/:systemcode
 * POST /api/inventory/bom/save-parts（body.systemcode + 与 PUT 相同 lines）
 * body: { lines: [{ id?, pendingDelete?, kcac01?, kcaa01, kcaa02, kcaa03, kcaa04, kcaa11, kcac04, kcac05, kcac06?, cost_price, remark, seq }] }
 * 保存逻辑：`UPDATE` 双重锁定 `id` + `kcac01`；`kcaa01`～`kcaa35`/`kcac02` 由 `bom_000` OUTER APPLY 同步（见 bomPartsApplyFullLineUpdate）。
 */
async function handleInventoryBomPartsPut(req, res) {
  /** @type {{ systemcode: string, kcaa01: string }[]} */
  const auditPhysicalPartDeletes = []
  /** @type {{ part: string, qty: string, loss: string }[]} */
  const auditUsageUpdates = []
  /** @type {{ master: string, part: string }[]} */
  const auditKcaaSync = []
  try {
    let systemcode = ''
    try {
      systemcode = decodeURIComponent(String(req.params?.systemcode ?? '').trim())
    } catch {
      systemcode = String(req.params?.systemcode ?? '').trim()
    }
    if (!systemcode) {
      res.status(400).json({ code: 400, msg: '参数错误：systemcode 不能为空', data: null })
      return
    }

    const lines = Array.isArray(req.body?.lines) ? req.body.lines : []
    if (!lines.length) {
      res.status(400).json({ code: 400, msg: 'body.lines 不能为空', data: null })
      return
    }

    const pool = await getPool()
    const check = await pool.request().input('sc', sql.NVarChar(100), systemcode).query(`
      SELECT TOP 1
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.systemcode, N'')))) AS systemcode,
        LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.kcaa01, N'')))) AS kcaa01
      FROM ${INV_BOM_MASTER_FROM} AS b
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.systemcode, N'')))) = @sc
        AND (ISNULL(b.del, N'') = N'' OR b.del = N'0')
    `)
    const head = check.recordset?.[0] ?? null
    if (!head || !String(head.systemcode ?? '').trim()) {
      res.status(404).json({ code: 404, msg: '未找到对应主档或主档缺少 systemcode', data: null })
      return
    }
    const bomHeadKcaa01 = String(head.kcaa01 ?? '').trim() || systemcode

    const partColset = await getInvBomPartsColumnSet(pool)
    const delColKind = await getInvBomPartsDelColumnKind(pool)

    const tx = new sql.Transaction(pool)
    await tx.begin()
    try {
      let deleted = 0
      let updated = 0
      let inserted = 0

      /** 先处理 pendingDelete，再更新/新增，避免「未删完就 INSERT」产生重复在册行 */
      const orderedLines = [...lines].sort((a, b) => {
        const pa = !!a?.pendingDelete
        const pb = !!b?.pendingDelete
        if (pa === pb) return 0
        return pa ? -1 : 1
      })

      for (const raw of orderedLines) {
        const pendingDelete = !!raw?.pendingDelete
        const hasId = bomPartLineHasDbId(raw)

        /** 前端传 kcac01 时须与 URL 主档一致，防止误改其它成品下的同名配件行 */
        if (!pendingDelete) {
          const lineMaster = String(raw?.kcac01 ?? '').trim()
          if (lineMaster && lineMaster !== systemcode) {
            throw new Error(
              `明细行的 kcac01（所属主档）须与当前主档 systemcode 一致；收到「${lineMaster}」，期望「${systemcode}」`,
            )
          }
        }

        if (hasId && pendingDelete) {
          const qPre = new sql.Request(tx)
          bomPartsSqlBindId(qPre, raw?.id)
          qPre.input('kcac01', sql.NVarChar(100), systemcode)
          const preRs = await qPre.query(`
            SELECT TOP 1
              LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(p.kcaa01, N'')))) AS kcaa01
            FROM ${INV_BOM_PARTS_FROM} AS p
            WHERE p.id = @id
              AND LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(p.kcac01, N'')))) =
                  LTRIM(RTRIM(CONVERT(nvarchar(100), @kcac01)))
          `)
          const partCode = String(preRs.recordset?.[0]?.kcaa01 ?? '').trim()
          if (!partCode) {
            console.warn(
              `[BOM配件明细] 物理删跳过：未找到 id=${String(raw?.id ?? '')} 且 kcac01 匹配主档 systemcode=${systemcode} 的行`,
            )
            continue
          }
          const q = new sql.Request(tx)
          bomPartsSqlBindId(q, raw?.id)
          q.input('kcac01', sql.NVarChar(100), systemcode)
          q.input('kcaa01Del', sql.NVarChar(300), partCode)
          const ur = await q.query(`
            DELETE p
            FROM ${INV_BOM_PARTS_FROM} AS p
            WHERE LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(p.kcac01, N'')))) =
                  LTRIM(RTRIM(CONVERT(nvarchar(100), @kcac01)))
              AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(p.kcaa01, N'')))) =
                  LTRIM(RTRIM(CONVERT(nvarchar(300), @kcaa01Del)))
              AND p.id = @id
          `)
          const aff = Number(ur.rowsAffected?.[0] ?? 0)
          deleted += aff
          if (aff > 0) {
            auditPhysicalPartDeletes.push({ systemcode, kcaa01: partCode })
          } else {
            console.warn(
              `[BOM配件明细] 物理删未命中：id=${String(raw?.id ?? '')} kcaa01=${partCode} systemcode=${systemcode}`,
            )
          }
          continue
        }

        if (hasId && !pendingDelete) {
          const kcaa01Up = String(raw?.kcaa01 ?? '').trim()
          const subSc = await bomPartsLookupSubBomSystemcode(tx, kcaa01Up)
          const upRes = await bomPartsApplyFullLineUpdate(tx, partColset, systemcode, raw?.id, raw)
          const affUp = upRes.rowsAffected
          updated += affUp
          if (affUp > 0) {
            auditUsageUpdates.push({
              part: kcaa01Up,
              qty: String(upRes.kcac04),
              loss: String(upRes.kcac05),
            })
            if (subSc) {
              auditKcaaSync.push({ master: systemcode, part: kcaa01Up })
            }
          }
          continue
        }

        if (!hasId && !pendingDelete) {
          const kcaa01 = String(raw?.kcaa01 ?? '').trim()
          if (!kcaa01) {
            throw new Error('新增行缺少配件编码 kcaa01')
          }
          const kcac04 = bomPartRoundDecimal6(raw?.kcac04)
          const kcac05 = bomPartRoundDecimal6(raw?.kcac05)
          const kcac06Ins = bomPartRoundDecimal6(
            raw?.kcac06 !== undefined && raw?.kcac06 !== null
              ? raw.kcac06
              : bomPartComputeKcac06(kcac04, kcac05),
          )
          const costNum = bomPartParseDecimal(raw?.cost_price)
          const seqIns = bomPartParseSeq(raw?.seq)

          const existing = await bomPartsFindRowsByScAndPartCode(tx, systemcode, kcaa01)
          if (existing.length > 0) {
            const subMerge = await bomPartsLookupSubBomSystemcode(tx, kcaa01)
            const actives = existing.filter((row) => bomPartsDelLooksActive(row.del_s))
            const targetId = actives.length
              ? Math.min(...actives.map((row) => Number(row.id)))
              : Math.min(...existing.map((row) => Number(row.id)))
            const allIds = existing
              .map((row) => Number(row.id))
              .filter((n) => Number.isFinite(n) && n > 0)
            const otherIds = allIds.filter((id) => id !== targetId)

            /** 合并保留行：先恢复 del/deltime，再统一走「子 BOM 全字段同步」UPDATE */
            const setRevive = []
            if (delColKind === 'numeric') {
              setRevive.push('p.del = @delActiveNum')
            } else {
              setRevive.push(`p.del = N'0'`)
            }
            if (partColset.has('deltime')) {
              setRevive.push('p.deltime = NULL')
            }
            if (setRevive.length) {
              const qr = new sql.Request(tx)
              bomPartsSqlBindId(qr, targetId)
              qr.input('kcac01', sql.NVarChar(100), systemcode)
              if (delColKind === 'numeric') {
                qr.input('delActiveNum', sql.Int, 0)
              }
              await qr.query(`
                UPDATE p
                SET ${setRevive.join(', ')}
                FROM ${INV_BOM_PARTS_FROM} AS p
                WHERE p.id = @id
                  AND LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(p.kcac01, N'')))) =
                      LTRIM(RTRIM(CONVERT(nvarchar(100), @kcac01)))
              `)
            }

            const mergeUp = await bomPartsApplyFullLineUpdate(tx, partColset, systemcode, targetId, {
              ...raw,
              kcaa01,
              kcac04,
              kcac05,
              kcac06: kcac06Ins,
              seq: seqIns,
            })
            const affM = mergeUp.rowsAffected
            updated += affM
            if (affM > 0) {
              auditUsageUpdates.push({
                part: kcaa01,
                qty: String(kcac04),
                loss: String(kcac05),
              })
              if (subMerge) {
                auditKcaaSync.push({ master: systemcode, part: kcaa01 })
              }
            }

            for (const oid of otherIds) {
              const qd = new sql.Request(tx)
              bomPartsSqlBindId(qd, oid)
              qd.input('kcac01', sql.NVarChar(100), systemcode)
              qd.input('kcaa01Dedupe', sql.NVarChar(300), kcaa01)
              const ud = await qd.query(`
                DELETE p
                FROM ${INV_BOM_PARTS_FROM} AS p
                WHERE p.id = @id
                  AND LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(p.kcac01, N'')))) =
                      LTRIM(RTRIM(CONVERT(nvarchar(100), @kcac01)))
                  AND LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(p.kcaa01, N'')))) =
                      LTRIM(RTRIM(CONVERT(nvarchar(300), @kcaa01Dedupe)))
              `)
              const daff = Number(ud.rowsAffected?.[0] ?? 0)
              deleted += daff
              if (daff > 0) {
                auditPhysicalPartDeletes.push({ systemcode, kcaa01: kcaa01 })
              }
            }
            continue
          }

          const subIns = await bomPartsLookupSubBomSystemcode(tx, kcaa01)
          const q = new sql.Request(tx)
          q.input('kcac01', sql.NVarChar(100), systemcode)
          q.input('kcaa01', sql.NVarChar(300), kcaa01)
          q.input('kcaa02', sql.NVarChar(500), raw?.kcaa02 != null ? String(raw.kcaa02) : '')
          q.input('kcaa03', sql.NVarChar(500), raw?.kcaa03 != null ? String(raw.kcaa03) : '')
          q.input('kcaa04', sql.NVarChar(100), raw?.kcaa04 != null ? String(raw.kcaa04) : '')
          q.input('kcaa11', sql.NVarChar(200), raw?.kcaa11 != null ? String(raw.kcaa11) : '')
          q.input('kcac04', sql.Decimal(18, 6), kcac04)
          q.input('kcac05', sql.Decimal(18, 6), kcac05)
          q.input('cost_price', sql.Decimal(18, 4), costNum)
          q.input('remark', sql.NVarChar(500), raw?.remark != null ? String(raw.remark) : '')
          q.input('seq', sql.Int, seqIns)
          const delValSql = delColKind === 'numeric' ? '@delIns' : `N'0'`
          if (delColKind === 'numeric') {
            q.input('delIns', sql.Int, 0)
          }
          let insCols =
            'kcac01, kcaa01, kcaa02, kcaa03, kcaa04, kcaa11, kcac04, kcac05, cost_price, remark, del, [Seq]'
          let insVals = `@kcac01, @kcaa01, @kcaa02, @kcaa03, @kcaa04, @kcaa11, @kcac04, @kcac05, @cost_price, @remark, ${delValSql}, @seq`
          if (partColset.has('kcac06')) {
            q.input('kcac06', sql.Decimal(18, 6), kcac06Ins)
            insCols =
              'kcac01, kcaa01, kcaa02, kcaa03, kcaa04, kcaa11, kcac04, kcac05, kcac06, cost_price, remark, del, [Seq]'
            insVals = `@kcac01, @kcaa01, @kcaa02, @kcaa03, @kcaa04, @kcaa11, @kcac04, @kcac05, @kcac06, @cost_price, @remark, ${delValSql}, @seq`
          }
          if (partColset.has('kcac02')) {
            q.input('kcac02Ins', sql.NVarChar(100), subIns || '')
            insCols = partColset.has('kcac06')
              ? 'kcac01, kcac02, kcaa01, kcaa02, kcaa03, kcaa04, kcaa11, kcac04, kcac05, kcac06, cost_price, remark, del, [Seq]'
              : 'kcac01, kcac02, kcaa01, kcaa02, kcaa03, kcaa04, kcaa11, kcac04, kcac05, cost_price, remark, del, [Seq]'
            insVals = partColset.has('kcac06')
              ? `@kcac01, @kcac02Ins, @kcaa01, @kcaa02, @kcaa03, @kcaa04, @kcaa11, @kcac04, @kcac05, @kcac06, @cost_price, @remark, ${delValSql}, @seq`
              : `@kcac01, @kcac02Ins, @kcaa01, @kcaa02, @kcaa03, @kcaa04, @kcaa11, @kcac04, @kcac05, @cost_price, @remark, ${delValSql}, @seq`
          }
          const ir = await q.query(`
            INSERT INTO ${INV_BOM_PARTS_FROM} (${insCols})
            OUTPUT INSERTED.id AS inserted_id
            VALUES (${insVals})
          `)
          const newId = Number(ir.recordset?.[0]?.inserted_id)
          if (!Number.isFinite(newId) || newId < 1) {
            throw new Error('新增配件明细失败：未取得有效的 INSERTED.id')
          }
          /** 插入后再 UPDATE：与编辑行一致，按 bom_000 同步 kcaa01～35 及 kcac02 */
          const insUp = await bomPartsApplyFullLineUpdate(tx, partColset, systemcode, newId, {
            ...raw,
            kcaa01,
            kcac04,
            kcac05,
            kcac06: kcac06Ins,
            seq: seqIns,
          })
          inserted += 1
          if (insUp.rowsAffected > 0 && subIns) {
            auditKcaaSync.push({ master: systemcode, part: kcaa01 })
          }
        }
      }

      await tx.commit()

      for (const row of auditPhysicalPartDeletes) {
        try {
          await writeLog(
            req,
            '彻底删除BOM配件',
            `[彻底删除]了BOM配件，BOM系统编码：[${row.systemcode}]，移除配件编码：[${row.kcaa01}]`,
            { targetTable: 'Bom_parts' },
          )
        } catch (logErr) {
          console.warn('[BOM配件明细] 审计日志写入失败（不影响保存）：', logErr?.message ?? logErr)
        }
      }

      for (const u of auditUsageUpdates) {
        try {
          await writeLog(
            req,
            '更新BOM配件用量',
            `[更新]了配件用量，BOM：[${bomHeadKcaa01}]，配件：[${u.part}]，用量：[${u.qty}]，损耗：[${u.loss}]`,
            { targetTable: 'Bom_parts' },
          )
        } catch (logErr) {
          console.warn('[BOM配件明细] 用量审计写入失败（不影响保存）：', logErr?.message ?? logErr)
        }
      }

      for (const s of auditKcaaSync) {
        try {
          await writeLog(
            req,
            '同步BOM配件属性',
            `[同步]了BOM配件属性，主BOM：[${s.master}]，配件：[${s.part}]，已同步kcaa01-kcaa35共35个字段。`,
            { targetTable: 'Bom_parts' },
          )
        } catch (logErr) {
          console.warn('[BOM配件明细] 同步属性审计写入失败（不影响保存）：', logErr?.message ?? logErr)
        }
      }

      res.json({
        code: 200,
        msg: 'success',
        data: {
          deleted,
          updated,
          inserted,
          /** @deprecated 兼容旧前端；数值同 deleted */
          softDeleted: deleted,
        },
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
    console.error('PUT /api/inventory/bom/parts/:systemcode 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `保存 BOM 配件明细失败：${detail}`, data: null })
  }
}

app.put('/api/inventory/bom/parts/:systemcode', handleInventoryBomPartsPut)

/** 与 PUT /parts/:systemcode 相同 body；systemcode 放在 body.systemcode */
app.post('/api/inventory/bom/save-parts', async (req, res) => {
  const sc = String(req.body?.systemcode ?? '').trim()
  if (!sc) {
    res.status(400).json({ code: 400, msg: 'body.systemcode 不能为空', data: null })
    return
  }
  req.params = { ...req.params, systemcode: sc }
  return handleInventoryBomPartsPut(req, res)
})

/** BOM 主档一键更新：按物料编码将 bom_000 基础资料写回全库 Bom_parts / bom_cost 引用（不改用量、不重算） */
app.post('/api/inventory/bom/propagate-master', (req, res) =>
  handlePostBomMasterPropagate(req, res, { getPool, writeLog }),
)


/**
 * BOM 编码校验 / 版本提示：查询同编码在册行（编辑时可排除自身 systemcode）
 * GET /api/inventory/bom/check-code?kcaa01=&excludeSystemcode=
 */
app.get('/api/inventory/bom/check-code', async (req, res) => {
  try {
    const kcaa01 = String(req.query?.kcaa01 ?? '').trim()
    if (!kcaa01) {
      res.status(400).json({ code: 400, msg: '参数 kcaa01 不能为空', data: null })
      return
    }
    const exclude = String(req.query?.excludeSystemcode ?? '').trim()
    const pool = await getPool()
    const reqQ = pool.request().input('kcaa01', sql.NVarChar(300), kcaa01)
    let exSql = ''
    if (exclude) {
      reqQ.input('exsc', sql.NVarChar(100), exclude)
      exSql = ` AND LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.systemcode, N'')))) <> @exsc `
    }
    const listRs = await reqQ.query(`
      SELECT TOP 10
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.systemcode, N'')))) AS systemcode,
        LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(40), b.[version]), N''))) AS version,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.kcaa02, N'')))) AS kcaa02,
        LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(10), b.pass), N''))) AS pass
      FROM ${INV_BOM_MASTER_FROM} AS b
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.kcaa01, N'')))) = @kcaa01
        AND (ISNULL(b.del, N'') = N'' OR LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), b.del), N''))) = N'0')
        ${exSql}
      ORDER BY b.id DESC
    `)
    const rows = (listRs.recordset ?? []).map((row) => ({
      systemcode: row.systemcode != null ? String(row.systemcode) : '',
      version: row.version != null ? String(row.version) : '',
      kcaa02: row.kcaa02 != null ? String(row.kcaa02) : '',
      pass: row.pass != null ? String(row.pass) : '',
    }))
    const dup = await countInvBomDuplicateKcaa01(pool, kcaa01, exclude)
    res.json({
      code: 200,
      msg: 'success',
      data: { duplicate: dup > 0, count: dup, rows },
    })
  } catch (err) {
    console.error('GET /api/inventory/bom/check-code 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '查询失败')
    res.status(500).json({ code: 500, msg: detail, data: null })
  }
})

/**
 * 单位换算建议（使用单位 + 采购/报价侧单位）
 * GET /api/inventory/bom/unit-rate-suggest?useUnit=&otherUnit=
 */
app.get('/api/inventory/bom/unit-rate-suggest', async (req, res) => {
  try {
    const useUnit = String(req.query?.useUnit ?? '').trim()
    const otherUnit = String(req.query?.otherUnit ?? '').trim()
    if (!useUnit || !otherUnit) {
      res.status(400).json({ code: 400, msg: 'useUnit、otherUnit 均不能为空', data: null })
      return
    }
    const pool = await getPool()
    const { direction, rate } = await lookupBomUnitChangeDirectionRate(pool, useUnit, otherUnit)
    res.json({
      code: 200,
      msg: 'success',
      data: {
        /** 0：对方→使用；1：使用→对方（与主档 kcaa27/kcaa31 一致） */
        direction,
        rate,
      },
    })
  } catch (err) {
    console.error('GET /api/inventory/bom/unit-rate-suggest 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '查询失败')
    res.status(500).json({ code: 500, msg: detail, data: null })
  }
})

/**
 * BOM 币别下拉：读 bom_currency.cn_name（表名见 INV_BOM_CURRENCY_TABLE）
 * GET /api/inventory/bom/currency-options
 */
app.get('/api/inventory/bom/currency-options', async (req, res) => {
  try {
    const pool = await getPool()
    const rs = await pool.request().query(`
      SELECT DISTINCT LTRIM(RTRIM(ISNULL([cn_name], N''))) AS cn_name
      FROM ${INV_BOM_CURRENCY_FROM}
      WHERE LTRIM(RTRIM(ISNULL([cn_name], N''))) <> N''
      ORDER BY cn_name
    `)
    const rows = (rs.recordset ?? []).map((r) => ({
      cn_name: String(r.cn_name ?? '').trim(),
    }))
    res.json({ code: 200, msg: 'success', data: { rows } })
  } catch (err) {
    console.error('GET /api/inventory/bom/currency-options 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '查询失败')
    res.status(500).json({ code: 500, msg: detail, data: { rows: [] } })
  }
})

/**
 * BOM 主档新增：INSERT bom_000（SQL Server 2008 R2 兼容写法）。
 * save-main：字段列表须含 systemcode、[GUID]、dr_systemcode，VALUES 三连同为最终 systemcode；[version] 固定 N'100'。
 * 逻辑位于 server/index.js（本项目无 server/controllers）。
 * systemcode 可由客户端传入（须库内不存在）；否则服务端生成并重试避免冲突。
 * POST /api/inventory/bom/save-main — 标准入口；POST /api/inventory/bom — 兼容旧调用。
 */
async function handleInvBomMasterSaveMain(req, res) {
  try {
    const body = req.body ?? {}
    const kcaa01 = String(body.kcaa01 ?? '').trim()
    const kcaa02 = String(body.kcaa02 ?? '').trim()
    const kcaa05 = String(body.kcaa05 ?? '').trim()
    const kcaa04 = String(body.kcaa04 ?? '').trim()
    const kcaa25 = String(body.kcaa25 ?? '').trim()
    if (!kcaa01 || !kcaa02) {
      res.status(400).json({ code: 400, msg: '编码与名称不能为空', data: null })
      return
    }
    if (!kcaa05 || !kcaa04 || !kcaa25) {
      res.status(400).json({ code: 400, msg: '分类、使用单位、采购单位不能为空', data: null })
      return
    }
    if (/\s/.test(kcaa01)) {
      res.status(400).json({ code: 400, msg: '编码不能包含空格', data: null })
      return
    }

    const pool = await getPool()
    if ((await countInvBomDuplicateKcaa01(pool, kcaa01, '')) > 0) {
      res.status(400).json({ code: 400, msg: `编码「${kcaa01}」已存在，请勿重复新增`, data: null })
      return
    }

    // 刷新 bom_000 列缓存，避免库内新加列后仍按旧清单 INSERT
    INV_BOM_MASTER_COLSET_PROMISE = null
    const colset = await getInvBomMasterColumnSet(pool)
    const actorBase = getActorAuditTripletFromReq(req)
    const truename = await resolveSysUsersTruenameForBomAudit(pool, actorBase)
    const actor = { ...actorBase, utruename: truename }

    /** save-main 三连键 + 版本列缺一不可（列名按 INFORMATION_SCHEMA 转小写匹配：guid ↔ 物理列 GUID） */
    const saveMainRequired = ['systemcode', 'guid', 'dr_systemcode', 'version']
    const saveMainMissing = saveMainRequired.filter((c) => !colset.has(c))
    if (saveMainMissing.length) {
      res.status(500).json({
        code: 500,
        msg: `bom_000 缺少 save-main 必需列（${saveMainMissing.join(', ')}），无法写入三连键与版本`,
        data: null,
      })
      return
    }

    /** @type {string} */
    let systemcode = String(body.systemcode ?? '').trim()
    if (systemcode) {
      if (await invBomMasterSystemcodeExists(pool, systemcode)) {
        res.status(400).json({ code: 400, msg: 'systemcode 已存在，无法保存', data: null })
        return
      }
    } else {
      let resolved = false
      for (let i = 0; i < 12; i++) {
        const cand = generateInvBomSystemcode(actor.uidInt ?? actor.uname ?? '')
        if (!(await invBomMasterSystemcodeExists(pool, cand))) {
          systemcode = cand
          resolved = true
          break
        }
      }
      if (!resolved || !systemcode) {
        res.status(400).json({ code: 400, msg: 'systemcode 已存在或生成冲突，请稍后重试', data: null })
        return
      }
    }

    const nowStr = formatBomColorcodeTimestamp()

    const str = (k, max = 800) => {
      let s = String(body[k] ?? '').trim()
      if (s.length > max) s = s.slice(0, max)
      return s
    }
    const decNum = (k) => {
      const raw = body[k]
      if (raw === '' || raw === null || raw === undefined) return null
      const n = Number(raw)
      return Number.isFinite(n) ? n : null
    }
    const bitInt = (k) => {
      const v = body[k]
      if (v === true || v === 1 || v === '1') return 1
      return 0
    }
    const dirInt = (k) => {
      const n = Number(body[k])
      if (n === 0 || n === 1) return n
      return 0
    }

    /** @type {string[]} */
    const cols = []
    /** @type {string[]} */
    const vals = []
    const ins = pool.request()

    const pushNvarchar = (col, param, val, len) => {
      if (!colset.has(col.toLowerCase())) return
      cols.push(col === 'decimal' ? '[decimal]' : col)
      vals.push(`@${param}`)
      ins.input(param, sql.NVarChar(len), val ?? '')
    }

    // 三连赋值：同一参数绑定三次，保证 systemcode、GUID、dr_systemcode 绝对一致（2008 R2 兼容）
    ins.input('bom_sc_triple', sql.NVarChar(100), systemcode)
    cols.push('systemcode', '[GUID]', 'dr_systemcode')
    vals.push('@bom_sc_triple', '@bom_sc_triple', '@bom_sc_triple')
    // version：库内多为 int；用数值绑定，避免与 int 列隐式转换歧义
    ins.input('bom_version_ins', sql.Int, 100)
    cols.push('[version]')
    vals.push('@bom_version_ins')
    // 新增主档默认类型：bom_000.type = 1（列存在时写入；保留字列名须加方括号）
    if (colset.has('type')) {
      ins.input('bom_type_default', sql.Int, 1)
      cols.push('[type]')
      vals.push('@bom_type_default')
    }
    pushNvarchar('kcaa01', 'kcaa01', kcaa01, 300)
    pushNvarchar('kcaa02', 'kcaa02', kcaa02, 500)
    pushNvarchar('kcaa02_en', 'kcaa02_en', str('kcaa02_en', 500), 500)
    pushNvarchar('kpname', 'kpname', str('kpname', 500), 500)
    pushNvarchar('kcaa03', 'kcaa03', str('kcaa03', 500), 500)
    pushNvarchar('kcaa05', 'kcaa05', str('kcaa05', 200), 200)
    pushNvarchar('kcaa06', 'kcaa06', str('kcaa06', 300), 300)
    pushNvarchar('kcaa09', 'kcaa09', str('kcaa09', 300), 300)
    pushNvarchar('kcaa10', 'kcaa10', str('kcaa10', 200), 200)
    pushNvarchar('kcaa11', 'kcaa11', str('kcaa11', 200), 200)
    pushNvarchar('location', 'location', str('location', 200) || '国内', 200)
    pushNvarchar('kcaa04', 'kcaa04', str('kcaa04', 100), 100)
    pushNvarchar('kcaa25', 'kcaa25', str('kcaa25', 100), 100)
    pushNvarchar('kcaa29', 'kcaa29', str('kcaa29', 100), 100)
    pushNvarchar('kcaa34', 'kcaa34', str('kcaa34', 80), 80)
    pushNvarchar('kcaa35', 'kcaa35', str('kcaa35', 80), 80)
    pushNvarchar('remark', 'remark', str('remark', 2000), 2000)
    pushNvarchar('Customer_Name', 'Customer_Name', str('Customer_Name', 500), 500)
    pushNvarchar('decimal', 'bom_decimal', str('decimal', 20) || '2', 20)

    if (colset.has('kcaa15')) {
      cols.push('kcaa15')
      vals.push('@kcaa15')
      ins.input('kcaa15', sql.NVarChar(50), str('kcaa15', 50))
    }

    const pushInt = (col, param, v) => {
      if (!colset.has(col.toLowerCase())) return
      cols.push(col)
      vals.push(`@${param}`)
      ins.input(param, sql.Int, v)
    }
    pushInt('kcaa12', 'kcaa12', bitInt('kcaa12'))
    pushInt('kcaa13', 'kcaa13', bitInt('kcaa13'))
    pushInt('kcaa14', 'kcaa14', body.kcaa14 !== undefined && body.kcaa14 !== null ? bitInt('kcaa14') : 1)
    pushInt('Customer_supply', 'Customer_supply', bitInt('Customer_supply'))
    pushInt('kcaa27', 'kcaa27', dirInt('kcaa27'))
    pushInt('kcaa31', 'kcaa31', dirInt('kcaa31'))
    pushInt('sign', 'sign', body.sign !== undefined && body.sign !== null ? bitInt('sign') : 0)

    const pushDec = (col, param) => {
      if (!colset.has(col.toLowerCase())) return
      const n = decNum(param)
      cols.push(col)
      vals.push(`@${param}`)
      ins.input(param, sql.Decimal(18, 6), n != null ? n : 0)
    }
    if (colset.has('sale_price')) {
      const n = decNum('sale_price')
      cols.push('sale_price')
      vals.push('@sale_price')
      ins.input('sale_price', sql.Decimal(18, 6), n != null ? n : 0)
    }
    if (colset.has('cost_price')) {
      const n = decNum('cost_price')
      cols.push('cost_price')
      vals.push('@cost_price')
      ins.input('cost_price', sql.Decimal(18, 6), n != null ? n : 0)
    }
    pushDec('kcaa26', 'kcaa26')
    pushDec('kcaa30', 'kcaa30')
    pushDec('kcaa32', 'kcaa32')
    pushDec('kcaa33', 'kcaa33')

    if (colset.has('pass')) {
      cols.push('pass')
      vals.push("N'0'")
    }
    if (colset.has('del')) {
      cols.push('del')
      vals.push("N'0'")
    }
    if (colset.has('uid') && actor.uidInt != null) {
      cols.push('uid')
      vals.push('@uid')
      ins.input('uid', sql.Int, actor.uidInt)
    }
    if (colset.has('uname') && actor.uname) {
      cols.push('uname')
      vals.push('@uname')
      ins.input('uname', sql.NVarChar(50), actor.uname)
    }
    if (colset.has('utruename') && actor.utruename) {
      cols.push('utruename')
      vals.push('@utruename')
      ins.input('utruename', sql.NVarChar(50), actor.utruename)
    }
    if (colset.has('addtime')) {
      cols.push('addtime')
      vals.push('@addtime')
      ins.input('addtime', sql.NVarChar(50), nowStr)
    }
    if (colset.has('edittime')) {
      cols.push('edittime')
      vals.push('@edittime')
      ins.input('edittime', sql.NVarChar(50), nowStr)
    }

    if (!cols.length) {
      res.status(500).json({ code: 500, msg: '新增失败：未探测到可写入列', data: null })
      return
    }

    const qr = await ins.query(`
      INSERT INTO ${INV_BOM_MASTER_FROM} (${cols.join(', ')})
      VALUES (${vals.join(', ')})
    `)
    if ((qr.rowsAffected?.[0] ?? 0) <= 0) {
      res.status(500).json({ code: 500, msg: '新增失败：数据库未写入', data: null })
      return
    }
    res.json({ code: 200, msg: 'success', data: { systemcode } })
  } catch (err) {
    console.error('POST BOM 主档新增(save-main) 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库写入失败')
    res.status(500).json({ code: 500, msg: `新增 BOM 失败：${detail}`, data: null })
  }
}

app.post('/api/inventory/bom/save-main', handleInvBomMasterSaveMain)
app.post('/api/inventory/bom', handleInvBomMasterSaveMain)

/**
 * BOM 主档保存（未审可改）：按 systemcode 更新
 * PUT /api/inventory/bom
 */
app.put('/api/inventory/bom', async (req, res) => {
  try {
    const body = req.body ?? {}
    const systemcode = String(body.systemcode ?? '').trim()
    if (!systemcode) {
      res.status(400).json({ code: 400, msg: 'systemcode 不能为空', data: null })
      return
    }
    const kcaa01 = String(body.kcaa01 ?? '').trim()
    const kcaa02 = String(body.kcaa02 ?? '').trim()
    const kcaa05 = String(body.kcaa05 ?? '').trim()
    const kcaa04 = String(body.kcaa04 ?? '').trim()
    const kcaa25 = String(body.kcaa25 ?? '').trim()
    if (!kcaa01 || !kcaa02) {
      res.status(400).json({ code: 400, msg: '编码与名称不能为空', data: null })
      return
    }
    if (!kcaa05 || !kcaa04 || !kcaa25) {
      res.status(400).json({ code: 400, msg: '分类、使用单位、采购单位不能为空', data: null })
      return
    }
    if (/\s/.test(kcaa01)) {
      res.status(400).json({ code: 400, msg: '编码不能包含空格', data: null })
      return
    }

    const pool = await getPool()
    if ((await countInvBomDuplicateKcaa01(pool, kcaa01, systemcode)) > 0) {
      res.status(400).json({ code: 400, msg: `编码「${kcaa01}」已被其他 BOM 使用`, data: null })
      return
    }

    const colset = await getInvBomMasterColumnSet(pool)
    const actorBase = getActorAuditTripletFromReq(req)
    const loginUsercode = String(req.user?.userCode ?? '').trim()
    const editorTruename = await resolveSysUsersTruenameByUsercode(pool, loginUsercode)
    const actor = { ...actorBase, utruename: editorTruename }
    const nowStr = formatBomColorcodeTimestamp()

    const str = (k, max = 800) => {
      let s = String(body[k] ?? '').trim()
      if (s.length > max) s = s.slice(0, max)
      return s
    }
    const decNum = (k) => {
      const raw = body[k]
      if (raw === '' || raw === null || raw === undefined) return null
      const n = Number(raw)
      return Number.isFinite(n) ? n : null
    }
    const bitInt = (k) => {
      const v = body[k]
      if (v === true || v === 1 || v === '1') return 1
      return 0
    }
    const dirInt = (k) => {
      const n = Number(body[k])
      if (n === 0 || n === 1) return n
      return 0
    }

    /** @type {string[]} */
    const setParts = []
    const upd = pool.request().input('systemcode', sql.NVarChar(100), systemcode)

    const setNvarchar = (col, param, val, len) => {
      if (!colset.has(col.toLowerCase())) return
      const csql = col === 'decimal' ? '[decimal]' : col
      setParts.push(`${csql} = @${param}`)
      upd.input(param, sql.NVarChar(len), val ?? '')
    }

    setNvarchar('kcaa01', 'kcaa01', kcaa01, 300)
    setNvarchar('kcaa02', 'kcaa02', kcaa02, 500)
    setNvarchar('kcaa02_en', 'kcaa02_en', str('kcaa02_en', 500), 500)
    setNvarchar('kpname', 'kpname', str('kpname', 500), 500)
    setNvarchar('kcaa03', 'kcaa03', str('kcaa03', 500), 500)
    setNvarchar('kcaa05', 'kcaa05', str('kcaa05', 200), 200)
    setNvarchar('kcaa06', 'kcaa06', str('kcaa06', 300), 300)
    setNvarchar('kcaa09', 'kcaa09', str('kcaa09', 300), 300)
    setNvarchar('kcaa10', 'kcaa10', str('kcaa10', 200), 200)
    setNvarchar('kcaa11', 'kcaa11', str('kcaa11', 200), 200)
    setNvarchar('location', 'location', str('location', 200) || '国内', 200)
    setNvarchar('kcaa04', 'kcaa04', str('kcaa04', 100), 100)
    setNvarchar('kcaa25', 'kcaa25', str('kcaa25', 100), 100)
    setNvarchar('kcaa29', 'kcaa29', str('kcaa29', 100), 100)
    setNvarchar('kcaa34', 'kcaa34', str('kcaa34', 80), 80)
    setNvarchar('kcaa35', 'kcaa35', str('kcaa35', 80), 80)
    setNvarchar('remark', 'remark', str('remark', 2000), 2000)
    setNvarchar('Customer_Name', 'Customer_Name', str('Customer_Name', 500), 500)
    setNvarchar('decimal', 'bom_decimal', str('decimal', 20) || '2', 20)

    if (colset.has('kcaa15')) {
      setParts.push('kcaa15 = @kcaa15')
      upd.input('kcaa15', sql.NVarChar(50), str('kcaa15', 50))
    }

    const setInt = (col, param, v) => {
      if (!colset.has(col.toLowerCase())) return
      setParts.push(`${col} = @${param}`)
      upd.input(param, sql.Int, v)
    }
    setInt('kcaa12', 'kcaa12', bitInt('kcaa12'))
    setInt('kcaa13', 'kcaa13', bitInt('kcaa13'))
    setInt('kcaa14', 'kcaa14', bitInt('kcaa14'))
    setInt('Customer_supply', 'Customer_supply', bitInt('Customer_supply'))
    setInt('kcaa27', 'kcaa27', dirInt('kcaa27'))
    setInt('kcaa31', 'kcaa31', dirInt('kcaa31'))
    setInt('sign', 'sign', bitInt('sign'))

    if (colset.has('sale_price')) {
      const n = decNum('sale_price')
      setParts.push('sale_price = @sale_price')
      upd.input('sale_price', sql.Decimal(18, 6), n != null ? n : 0)
    }
    if (colset.has('cost_price')) {
      const n = decNum('cost_price')
      setParts.push('cost_price = @cost_price')
      upd.input('cost_price', sql.Decimal(18, 6), n != null ? n : 0)
    }

    const setDec = (col, param) => {
      if (!colset.has(col.toLowerCase())) return
      const n = decNum(param)
      setParts.push(`${col} = @${param}`)
      upd.input(param, sql.Decimal(18, 6), n != null ? n : 0)
    }
    setDec('kcaa26', 'kcaa26')
    setDec('kcaa30', 'kcaa30')
    setDec('kcaa32', 'kcaa32')
    setDec('kcaa33', 'kcaa33')

    if (colset.has('edittime')) {
      setParts.push('edittime = @edittime')
      upd.input('edittime', sql.NVarChar(50), nowStr)
    }
    pushInvBomEditAuditOnMasterUpdate(colset, setParts, upd, actor)

    // 保存主档时保持 dr_systemcode、guid 与 systemcode 一致
    if (colset.has('dr_systemcode')) {
      setParts.push('dr_systemcode = @sync_dr_systemcode')
      upd.input('sync_dr_systemcode', sql.NVarChar(100), systemcode)
    }
    if (colset.has('guid')) {
      setParts.push('[GUID] = @sync_guid')
      upd.input('sync_guid', sql.NVarChar(100), systemcode)
    }

    if (!setParts.length) {
      res.status(400).json({ code: 400, msg: '无可更新字段', data: null })
      return
    }

    const qr = await upd.query(`
      UPDATE ${INV_BOM_MASTER_FROM}
      SET ${setParts.join(', ')}
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(systemcode, N'')))) = @systemcode
        AND (ISNULL(del, N'') = N'' OR LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), del), N''))) = N'0')
        AND LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(10), pass), N''))) <> N'1'
    `)
    if ((qr.rowsAffected?.[0] ?? 0) <= 0) {
      res.status(400).json({
        code: 400,
        msg: '保存失败：记录不存在、已审核或已删除',
        data: null,
      })
      return
    }
    res.json({ code: 200, msg: 'success', data: { systemcode } })
  } catch (err) {
    console.error('PUT /api/inventory/bom 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `保存 BOM 失败：${detail}`, data: null })
  }
})

/**
 * BOM 主档审核：PUT /api/inventory/bom/audit — body:{ systemcode }
 */
app.put('/api/inventory/bom/audit', async (req, res) => {
  try {
    const systemcode = String(req.body?.systemcode ?? '').trim()
    if (!systemcode) {
      res.status(400).json({ code: 400, msg: 'systemcode 不能为空', data: null })
      return
    }
    const pool = await getPool()
    const existing = await fetchInvBomMasterRowBySystemcode(pool, systemcode)
    if (!existing || !legacyDeptRowIsActive(existing)) {
      res.status(404).json({ code: 404, msg: '未找到该 BOM 或已在回收站', data: null })
      return
    }
    if (legacyDeptPassIsAudited(existing.pass)) {
      res.status(400).json({ code: 400, msg: '当前已是已审核状态', data: null })
      return
    }
    const edittimeStr = formatBomColorcodeTimestamp()
    await pool
      .request()
      .input('sc', sql.NVarChar(100), systemcode)
      .input('edittime', sql.NVarChar(50), edittimeStr)
      .query(`
        UPDATE ${INV_BOM_MASTER_FROM}
        SET pass = N'1', edittime = @edittime
        WHERE LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(systemcode, N'')))) = @sc
          AND (ISNULL(del, N'') = N'' OR LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), del), N''))) = N'0')
      `)
    res.json({ code: 200, msg: 'success', data: { systemcode } })
  } catch (err) {
    console.error('PUT /api/inventory/bom/audit 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `审核失败：${detail}`, data: null })
  }
})

/**
 * BOM 主档批量审核：PUT /api/inventory/bom/audit-batch
 * body: { systemcodes: string[] } — 仅用于列表「当前页批量审核」（建议 <= 200）
 */
app.put('/api/inventory/bom/audit-batch', async (req, res) => {
  try {
    const body = req.body ?? {}
    const raw = body.systemcodes
    const systemcodes = Array.isArray(raw)
      ? [...new Set(raw.map((c) => String(c ?? '').trim()).filter(Boolean))]
      : []

    if (!systemcodes.length) {
      res.status(400).json({ code: 400, msg: 'systemcodes 不能为空', data: null })
      return
    }
    if (systemcodes.length > 200) {
      res.status(400).json({ code: 400, msg: '批量审核数量过多（最多 200 条）', data: null })
      return
    }

    const pool = await getPool()
    const tx = new sql.Transaction(pool)
    await tx.begin()
    try {
      const edittimeStr = formatBomColorcodeTimestamp()
      let successCount = 0
      /** @type {{ systemcode: string, msg: string }[]} */
      const failed = []

      for (const sc of systemcodes) {
        try {
          const existing = await fetchInvBomMasterRowBySystemcode(tx, sc)
          if (!existing || !legacyDeptRowIsActive(existing)) {
            failed.push({ systemcode: sc, msg: '未找到该 BOM 或已在回收站' })
            continue
          }
          if (legacyDeptPassIsAudited(existing.pass)) {
            continue
          }
          const q = new sql.Request(tx)
          q.input('sc', sql.NVarChar(100), sc)
          q.input('edittime', sql.NVarChar(50), edittimeStr)
          await q.query(`
            UPDATE ${INV_BOM_MASTER_FROM}
            SET pass = N'1', edittime = @edittime
            WHERE LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(systemcode, N'')))) = @sc
              AND (ISNULL(del, N'') = N'' OR LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), del), N''))) = N'0')
          `)
          successCount += 1
        } catch (innerErr) {
          const detail = String(innerErr?.message ?? '审核失败')
          failed.push({ systemcode: sc, msg: detail })
        }
      }

      await tx.commit()
      res.json({
        code: 200,
        msg: 'success',
        data: { successCount, failed, total: systemcodes.length },
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
    console.error('PUT /api/inventory/bom/audit-batch 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `批量审核失败：${detail}`, data: null })
  }
})

/**
 * BOM 主档反审：PUT /api/inventory/bom/unaudit — body:{ systemcode }
 */
app.put('/api/inventory/bom/unaudit', async (req, res) => {
  try {
    const systemcode = String(req.body?.systemcode ?? '').trim()
    if (!systemcode) {
      res.status(400).json({ code: 400, msg: 'systemcode 不能为空', data: null })
      return
    }
    const pool = await getPool()
    const existing = await fetchInvBomMasterRowBySystemcode(pool, systemcode)
    if (!existing || !legacyDeptRowIsActive(existing)) {
      res.status(404).json({ code: 404, msg: '未找到该 BOM 或已在回收站', data: null })
      return
    }
    if (!legacyDeptPassIsAudited(existing.pass)) {
      res.status(400).json({ code: 400, msg: '当前为未审核状态，无需反审', data: null })
      return
    }
    const edittimeStr = formatBomColorcodeTimestamp()
    await pool
      .request()
      .input('sc', sql.NVarChar(100), systemcode)
      .input('edittime', sql.NVarChar(50), edittimeStr)
      .query(`
        UPDATE ${INV_BOM_MASTER_FROM}
        SET pass = N'0', edittime = @edittime
        WHERE LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(systemcode, N'')))) = @sc
          AND (ISNULL(del, N'') = N'' OR LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), del), N''))) = N'0')
      `)
    res.json({ code: 200, msg: 'success', data: { systemcode } })
  } catch (err) {
    console.error('PUT /api/inventory/bom/unaudit 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `反审失败：${detail}`, data: null })
  }
})

/**
 * BOM 主档恢复（回收站）：PUT /api/inventory/bom/restore — body:{ systemcode }
 */
app.put('/api/inventory/bom/restore', async (req, res) => {
  try {
    const systemcode = String(req.body?.systemcode ?? '').trim()
    if (!systemcode) {
      res.status(400).json({ code: 400, msg: 'systemcode 不能为空', data: null })
      return
    }
    const pool = await getPool()
    const existing = await fetchInvBomMasterRowBySystemcode(pool, systemcode)
    if (!existing) {
      res.status(404).json({ code: 404, msg: '未找到该 BOM', data: null })
      return
    }
    if (legacyDeptRowIsActive(existing)) {
      res.status(400).json({ code: 400, msg: '当前记录未处于回收站，无需恢复', data: null })
      return
    }
    const edittimeStr = formatBomColorcodeTimestamp()
    await pool
      .request()
      .input('sc', sql.NVarChar(100), systemcode)
      .input('edittime', sql.NVarChar(50), edittimeStr)
      .query(`
        UPDATE ${INV_BOM_MASTER_FROM}
        SET del = N'0', edittime = @edittime
        WHERE LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(systemcode, N'')))) = @sc
          AND LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), del), N''))) = N'1'
      `)
    res.json({ code: 200, msg: 'success', data: { systemcode } })
  } catch (err) {
    console.error('PUT /api/inventory/bom/restore 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `恢复失败：${detail}`, data: null })
  }
})

/**
 * BOM 主档彻底删除：DELETE /api/inventory/bom/systemcode/:systemcode/permanent（仅回收站 del=1）
 */
app.delete('/api/inventory/bom/systemcode/:systemcode/permanent', async (req, res) => {
  try {
    let systemcode = ''
    try {
      systemcode = decodeURIComponent(String(req.params?.systemcode ?? '').trim())
    } catch {
      systemcode = String(req.params?.systemcode ?? '').trim()
    }
    if (!systemcode) {
      res.status(400).json({ code: 400, msg: 'systemcode 不能为空', data: null })
      return
    }
    const pool = await getPool()
    const existing = await fetchInvBomMasterRowBySystemcode(pool, systemcode)
    if (!existing) {
      res.status(404).json({ code: 404, msg: '未找到该 BOM', data: null })
      return
    }
    if (legacyDeptRowIsActive(existing)) {
      res.status(400).json({
        code: 400,
        msg: '仅回收站中的记录可彻底删除，请先将记录移入回收站',
        data: null,
      })
      return
    }
    const delResult = await pool.request().input('sc', sql.NVarChar(100), systemcode).query(`
      DELETE FROM ${INV_BOM_MASTER_FROM}
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(systemcode, N'')))) = @sc
        AND LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), del), N''))) = N'1'
    `)
    const affected = Array.isArray(delResult.rowsAffected)
      ? Number(delResult.rowsAffected[0] ?? 0)
      : Number(delResult.rowsAffected ?? 0)
    if (!Number.isFinite(affected) || affected < 1) {
      res.status(404).json({ code: 404, msg: '未找到可彻底删除的回收站记录', data: null })
      return
    }
    res.json({ code: 200, msg: 'success', data: { systemcode } })
  } catch (err) {
    console.error('DELETE /api/inventory/bom/systemcode/:systemcode/permanent 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库删除失败')
    res.status(500).json({ code: 500, msg: `彻底删除失败：${detail}`, data: null })
  }
})

/**
 * BOM 主档逻辑删除：DELETE /api/inventory/bom/systemcode/:systemcode — 已审核禁止
 */
app.delete('/api/inventory/bom/systemcode/:systemcode', async (req, res) => {
  try {
    let systemcode = ''
    try {
      systemcode = decodeURIComponent(String(req.params?.systemcode ?? '').trim())
    } catch {
      systemcode = String(req.params?.systemcode ?? '').trim()
    }
    if (!systemcode) {
      res.status(400).json({ code: 400, msg: 'systemcode 不能为空', data: null })
      return
    }
    const pool = await getPool()
    const existing = await fetchInvBomMasterRowBySystemcode(pool, systemcode)
    if (!existing || !legacyDeptRowIsActive(existing)) {
      res.status(404).json({ code: 404, msg: '未找到该 BOM 或已在回收站', data: null })
      return
    }
    if (legacyDeptPassIsAudited(existing.pass)) {
      res.status(400).json({ code: 400, msg: HR_STAFF_AUDIT_LOCK_MSG, data: null })
      return
    }
    const deltimeStr = formatBomColorcodeTimestamp()
    await pool
      .request()
      .input('sc', sql.NVarChar(100), systemcode)
      .input('deltime', sql.NVarChar(50), deltimeStr)
      .query(`
        UPDATE ${INV_BOM_MASTER_FROM}
        SET del = N'1', deltime = @deltime
        WHERE LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(systemcode, N'')))) = @sc
          AND (ISNULL(del, N'') = N'' OR LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), del), N''))) = N'0')
      `)
    res.json({ code: 200, msg: 'success', data: { systemcode } })
  } catch (err) {
    console.error('DELETE /api/inventory/bom/systemcode/:systemcode 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `删除失败：${detail}`, data: null })
  }
})

/**
 * BOM 主档轻量查询（配件钻取）：无 JOIN、无单位换算
 * GET /api/inventory/bom/:id/brief — :id 为 kcaa01（须注册在 /:id 全量详情之前）
 */
app.get('/api/inventory/bom/:id/brief', async (req, res) => {
  try {
    let code = ''
    try {
      code = decodeURIComponent(String(req.params?.id ?? '').trim())
    } catch {
      code = String(req.params?.id ?? '').trim()
    }
    if (!code) {
      res.status(400).json({ code: 400, msg: '参数错误：编码不能为空', data: null })
      return
    }

    const pool = await getPool()
    const row = await fetchInvBomMasterBriefByKcaa01(pool, code)
    if (!row) {
      res.status(404).json({ code: 404, msg: '未找到该编码对应的 BOM 资料', data: null })
      return
    }

    const str = (v) => (v == null ? '' : String(v))
    const basic = {
      systemcode: str(row.systemcode),
      pass: str(row.pass),
      kcaa01: str(row.kcaa01),
      kcaa02: str(row.kcaa02),
      kcaa03: str(row.kcaa03),
    }

    res.json({ code: 200, msg: 'success', data: { basic } })
  } catch (err) {
    console.error('GET /api/inventory/bom/:id/brief 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库查询失败')
    res.status(500).json({ code: 500, msg: `读取 BOM 主档摘要失败：${detail}`, data: null })
  }
})

/**
 * BOM 主档详情（基础资料步骤）：仅选取约定列，不查询 kcaa16
 * GET /api/inventory/bom/:id — :id 为 kcaa01（URL 编码，支持含 / 的编码）
 * - LEFT JOIN Bom_material：kcaa05=code，带出 categoryName；分类展示名称
 * - LEFT JOIN Bom_Stocks_workshop：kcaa15=code，workshopName；workshop_display 为「编码, 名称」
 * - unit_conversion：采购/报价与使用的转换方向（po_to_use 等）及转换率；sale_price、kcaa34_display；kpname 开票名称
 * - systemcode：主档稳定键，供 Bom_parts.kcac01 关联
 */
app.get('/api/inventory/bom/:id', async (req, res) => {
  try {
    let code = ''
    try {
      code = decodeURIComponent(String(req.params?.id ?? '').trim())
    } catch {
      code = String(req.params?.id ?? '').trim()
    }
    if (!code) {
      res.status(400).json({ code: 400, msg: '参数错误：编码不能为空', data: null })
      return
    }

    const pool = await getPool()
    const r = await pool.request().input('code', sql.NVarChar(300), code).query(`
      SELECT TOP 1
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.systemcode, N'')))) AS systemcode,
        LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(10), b.pass), N''))) AS pass,
        LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.kcaa01, N'')))) AS kcaa01,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.kcaa02, N'')))) AS kcaa02,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.kcaa02_en, N'')))) AS kcaa02_en,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.kpname, N'')))) AS kpname,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.kcaa03, N'')))) AS kcaa03,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(b.kcaa11, N'')))) AS kcaa11,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(b.kcaa05, N'')))) AS kcaa05,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(cat.name, N'')))) AS categoryName,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(b.kcaa10, N'')))) AS kcaa10,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(b.location, N'')))) AS location,
        LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.kcaa06, N'')))) AS kcaa06,
        LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.kcaa09, N'')))) AS kcaa09,
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.kcaa04, N'')))) AS kcaa04,
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.kcaa25, N'')))) AS kcaa25,
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.kcaa29, N'')))) AS kcaa29,
        LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(80), b.cost_price), N''))) AS cost_price,
        LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(80), b.sale_price), N''))) AS sale_price,
        LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(80), b.kcaa34), N''))) AS kcaa34,
        LTRIM(RTRIM(CONVERT(nvarchar(80), ISNULL(b.kcaa35, N'')))) AS kcaa35,
        LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(80), b.[decimal]), N''))) AS bom_decimal,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.remark, N'')))) AS remark,
        LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(80), b.kcaa32), N''))) AS kcaa32,
        LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(80), b.kcaa33), N''))) AS kcaa33,
        LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(80), b.kcaa26), N''))) AS kcaa26,
        LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), b.kcaa27), N''))) AS kcaa27,
        LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(80), b.kcaa30), N''))) AS kcaa30,
        LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), b.kcaa31), N''))) AS kcaa31,
        LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), b.kcaa12), N''))) AS kcaa12,
        LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), b.kcaa13), N''))) AS kcaa13,
        LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), b.kcaa14), N''))) AS kcaa14,
        LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), b.kcaa15), N''))) AS kcaa15,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(ws.name, N'')))) AS workshopName,
        LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), b.Customer_supply), N''))) AS Customer_supply,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.Customer_Name, N'')))) AS Customer_Name,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(sup.s_name, N'')))) AS supplierName,
        LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), b.sign), N''))) AS sign
      FROM ${INV_BOM_MASTER_FROM} AS b
      LEFT JOIN ${BOM_MATERIAL_FROM} AS cat
        ON LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(200), b.kcaa05), N''))) = LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(200), cat.code), N'')))
      LEFT JOIN ${BOM_STOCKS_WORKSHOP_FROM} AS ws
        ON LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(200), b.kcaa15), N''))) = LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(200), ws.code), N'')))
      LEFT JOIN ${SYS_SUPPLIER_FROM} AS sup
        ON LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(500), b.Customer_Name), N''))) = LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(100), sup.s_code), N'')))
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(300), ISNULL(b.kcaa01, N'')))) = @code
    `)

    const row = r.recordset?.[0] ?? null
    if (!row) {
      res.status(404).json({ code: 404, msg: '未找到该编码对应的 BOM 资料', data: null })
      return
    }

    const str = (v) => (v == null ? '' : String(v))
    const flagChecked = (v) => {
      const s = str(v).trim()
      return s === '1' || s.toLowerCase() === 'y' || s === '是'
    }
    const csRaw = str(row.Customer_supply).trim()
    const customer_supply_checked =
      csRaw === ''
        ? false
        : Number.isFinite(Number(csRaw))
          ? Number(csRaw) === 1
          : flagChecked(row.Customer_supply)

    let unit_conversion = await fetchBomUnitConversionDetail(pool, row.kcaa04, row.kcaa25, row.kcaa29)
    const k26s = str(row.kcaa26).trim()
    const k30s = str(row.kcaa30).trim()
    if (k26s) unit_conversion = { ...unit_conversion, purchase_rate: k26s }
    if (k30s) unit_conversion = { ...unit_conversion, quote_rate: k30s }
    const k27s = str(row.kcaa27).trim()
    if (k27s === '0') unit_conversion = { ...unit_conversion, purchase_direction: 'po_to_use' }
    else if (k27s === '1') unit_conversion = { ...unit_conversion, purchase_direction: 'use_to_po' }
    const k31s = str(row.kcaa31).trim()
    if (k31s === '0') unit_conversion = { ...unit_conversion, quote_direction: 'qt_to_use' }
    else if (k31s === '1') unit_conversion = { ...unit_conversion, quote_direction: 'use_to_qt' }

    /** BOM 币别 kcaa34：测试期固定码表；未知编码原样返回便于核对库值 */
    const kcaa34Raw = str(row.kcaa34).trim()
    const kcaa34DisplayMap = { '001': '001,人民币', '002': '002,美元', '003': '003,港元' }
    const kcaa34_display =
      kcaa34Raw === '' ? '' : Object.prototype.hasOwnProperty.call(kcaa34DisplayMap, kcaa34Raw) ? kcaa34DisplayMap[kcaa34Raw] : kcaa34Raw

    const workshop_display = buildBomWorkshopDisplay(row.kcaa15, row.workshopName)
    const supplier_display = buildBomWorkshopDisplay(row.Customer_Name, row.supplierName)

    const basic = {
      systemcode: str(row.systemcode),
      pass: str(row.pass),
      kcaa01: str(row.kcaa01),
      kcaa02: str(row.kcaa02),
      kcaa02_en: str(row.kcaa02_en),
      kpname: str(row.kpname),
      kcaa03: str(row.kcaa03),
      kcaa11: str(row.kcaa11),
      kcaa05: str(row.kcaa05),
      categoryName: str(row.categoryName),
      kcaa10: str(row.kcaa10),
      location: str(row.location),
      kcaa06: str(row.kcaa06),
      kcaa09: str(row.kcaa09),
      kcaa04: str(row.kcaa04),
      kcaa25: str(row.kcaa25),
      kcaa29: str(row.kcaa29),
      cost_price: str(row.cost_price),
      sale_price: str(row.sale_price),
      kcaa34: kcaa34Raw,
      kcaa34_display: kcaa34_display,
      kcaa35: str(row.kcaa35),
      decimal: str(row.bom_decimal),
      remark: str(row.remark),
      kcaa32: str(row.kcaa32),
      kcaa33: str(row.kcaa33),
      kcaa26: str(row.kcaa26),
      kcaa27: str(row.kcaa27),
      kcaa30: str(row.kcaa30),
      kcaa31: str(row.kcaa31),
      Customer_Name: str(row.Customer_Name),
      supplier_display,
      sign: str(row.sign),
      unit_conversion,
      workshop_display,
      kcaa15: str(row.kcaa15),
      kcaa12_checked: flagChecked(row.kcaa12),
      kcaa13_checked: flagChecked(row.kcaa13),
      kcaa14_checked: flagChecked(row.kcaa14),
      customer_supply_checked,
    }

    res.json({ code: 200, msg: 'success', data: { basic } })
  } catch (err) {
    console.error('GET /api/inventory/bom/:id 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库查询失败')
    res.status(500).json({ code: 500, msg: `读取 BOM 详情失败：${detail}`, data: null })
  }
})

/**
 * 销售/采购/外协管理：供应商资料分页列表（物理表 System_supplier；SQL Server 2008 R2：ROW_NUMBER 分页）
 * GET /api/supply-chain/suppliers/list
 * - 默认：只查已审核 pass=1 且在册 del=0（或空/NULL）
 * - 可切换：pass=0（显示未审核）；回收站 recycled=1（仅 del=1，不按 pass 过滤）
 */
app.get('/api/supply-chain/suppliers/list', async (req, res) => {
  try {
    const pool = await getPool()
    const page = Math.max(1, Number(req.query?.page ?? 1) || 1)
    const pageSizeRaw = Number(req.query?.pageSize ?? 20) || 20
    const pageSize = Math.min(100, Math.max(1, pageSizeRaw))

    const recycledRaw = String(req.query?.recycled ?? '').trim().toLowerCase()
    const recycled = recycledRaw === '1' || recycledRaw === 'true' || recycledRaw === 'yes'

    const passRaw = String(req.query?.pass ?? '1').trim()
    const pass = passRaw === '0' ? '0' : '1'

    const keywordRaw = String(req.query?.keyword ?? '').trim()
    const hasKeyword = keywordRaw.length > 0
    const kwPat = hasKeyword ? `%${escapeSqlLikePattern(keywordRaw)}%` : ''

    const whereBase = recycled
      ? `
        WHERE LTRIM(RTRIM(ISNULL(s.del, N''))) = N'1'
          ${hasKeyword ? ' AND (s.s_code LIKE @kw OR s.s_name LIKE @kw OR s.s_sname LIKE @kw) ' : ''}
      `
      : `
        WHERE (ISNULL(s.del, N'') = N'' OR s.del = N'0')
          AND LTRIM(RTRIM(ISNULL(s.pass, N''))) = @pass
          ${hasKeyword ? ' AND (s.s_code LIKE @kw OR s.s_name LIKE @kw OR s.s_sname LIKE @kw) ' : ''}
      `

    const countReq = pool.request()
    if (!recycled) countReq.input('pass', sql.NVarChar(10), pass)
    if (hasKeyword) countReq.input('kw', sql.NVarChar(200), kwPat)
    const totalRow = await countReq.query(`
      SELECT COUNT(1) AS total
      FROM ${SYS_SUPPLIER_FROM} AS s
      ${whereBase}
    `)
    const total = Number(totalRow.recordset?.[0]?.total ?? 0)

    const safeOffset = (page - 1) * pageSize
    const startRow = safeOffset + 1
    const endRow = safeOffset + pageSize

    const listReq = pool.request()
    if (!recycled) listReq.input('pass', sql.NVarChar(10), pass)
    listReq.input('startRow', sql.Int, startRow)
    listReq.input('endRow', sql.Int, endRow)
    if (hasKeyword) listReq.input('kw', sql.NVarChar(200), kwPat)

    const listResult = await listReq.query(`
      SELECT
        x.id,
        x.s_code,
        x.pass,
        x.del,
        x.s_name,
        x.s_sname,
        x.s_sh,
        x.s_lb,
        x.s_lxr,
        x.s_mobile,
        x.s_tel,
        x.s_payfor,
        x.s_jh,
        x.s_wx_jh,
        x.sl,
        x.kplx,
        x.kplxx,
        x.kplxxx,
        x.s_address,
        x.s_business,
        x.s_bank,
        x.s_bank_number,
        x.s_info
      FROM (
        SELECT
          s.id AS id,
          LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(s.s_code, N'')))) AS s_code,
          LTRIM(RTRIM(CONVERT(nvarchar(10), ISNULL(s.pass, N'')))) AS pass,
          LTRIM(RTRIM(CONVERT(nvarchar(10), ISNULL(s.del, N'')))) AS del,
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(s.s_name, N'')))) AS s_name,
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(s.s_sname, N'')))) AS s_sname,
          LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(s.s_sh, N'')))) AS s_sh,
          LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(s.s_lb, N'')))) AS s_lb,
          LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(s.s_lxr, N'')))) AS s_lxr,
          LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(s.s_mobile, N'')))) AS s_mobile,
          LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(s.s_tel, N'')))) AS s_tel,
          LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(s.s_payfor, N'')))) AS s_payfor,
          LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(s.s_jh, N'')))) AS s_jh,
          LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(s.s_wx_jh, N'')))) AS s_wx_jh,
          LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(s.sl, N'')))) AS sl,
          LTRIM(RTRIM(CONVERT(nvarchar(10), ISNULL(s.kplx, N'')))) AS kplx,
          LTRIM(RTRIM(CONVERT(nvarchar(10), ISNULL(s.kplxx, N'')))) AS kplxx,
          LTRIM(RTRIM(CONVERT(nvarchar(10), ISNULL(s.kplxxx, N'')))) AS kplxxx,
          LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(s.s_address, N'')))) AS s_address,
          LTRIM(RTRIM(CONVERT(nvarchar(1000), ISNULL(s.s_business, N'')))) AS s_business,
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(s.s_bank, N'')))) AS s_bank,
          LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(s.s_bank_number, N'')))) AS s_bank_number,
          LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(s.s_info, N'')))) AS s_info,
          ROW_NUMBER() OVER (ORDER BY s.id DESC) AS rn
        FROM ${SYS_SUPPLIER_FROM} AS s
        ${whereBase}
      ) AS x
      WHERE x.rn BETWEEN @startRow AND @endRow
      ORDER BY x.rn
    `)

    const list = (listResult.recordset ?? []).map((row) => ({
      id: row.id != null ? Number(row.id) : null,
      s_code: row.s_code ?? '',
      pass: row.pass ?? '',
      del: row.del ?? '',
      s_name: row.s_name ?? '',
      s_sname: row.s_sname ?? '',
      s_sh: row.s_sh ?? '',
      s_lb: row.s_lb ?? '',
      s_lxr: row.s_lxr ?? '',
      s_mobile: row.s_mobile ?? '',
      s_tel: row.s_tel ?? '',
      s_payfor: row.s_payfor ?? '',
      s_jh: row.s_jh ?? '',
      s_wx_jh: row.s_wx_jh ?? '',
      sl: row.sl ?? '',
      kplx: row.kplx ?? '',
      kplxx: row.kplxx ?? '',
      kplxxx: row.kplxxx ?? '',
      s_address: row.s_address ?? '',
      s_business: row.s_business ?? '',
      s_bank: row.s_bank ?? '',
      s_bank_number: row.s_bank_number ?? '',
      s_info: row.s_info ?? '',
    }))

    res.json({ code: 200, msg: 'success', data: { total, list } })
  } catch (err) {
    console.error('GET /api/supply-chain/suppliers/list 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库查询失败')
    res.status(500).json({ code: 500, msg: `读取供应商资料失败：${detail}`, data: null })
  }
})

/**
 * 供应商资料：建议编码（用于前端 placeholder）
 * GET /api/supply-chain/suppliers/suggest-code
 * 规则：
 * - 优先：从 s_code 中挑选“纯数字”的最大值 + 1
 * - 兜底：MAX(id) + 1
 */
app.get('/api/supply-chain/suppliers/suggest-code', async (req, res) => {
  try {
    const pool = await getPool()
    const r = await pool.request().query(`
      SELECT
        ISNULL(
          MAX(
            CASE
              WHEN LTRIM(RTRIM(ISNULL(s.s_code, N''))) <> N''
                AND PATINDEX('%[^0-9]%', LTRIM(RTRIM(ISNULL(s.s_code, N'')))) = 0
                AND ISNUMERIC(LTRIM(RTRIM(ISNULL(s.s_code, N'')))) = 1
              THEN CAST(LTRIM(RTRIM(ISNULL(s.s_code, N'0'))) AS INT)
              ELSE NULL
            END
          ),
          0
        ) AS max_numeric_code,
        ISNULL(MAX(CASE WHEN s.id IS NULL THEN 0 ELSE s.id END), 0) AS max_id
      FROM ${SYS_SUPPLIER_FROM} AS s
    `)
    const maxNumeric = Number(r.recordset?.[0]?.max_numeric_code ?? 0)
    const maxId = Number(r.recordset?.[0]?.max_id ?? 0)
    const n = Number.isFinite(maxNumeric) && maxNumeric > 0 ? maxNumeric + 1 : maxId + 1
    res.json({ code: 200, msg: 'success', data: { suggestedCode: String(n) } })
  } catch (err) {
    console.error('GET /api/supply-chain/suppliers/suggest-code 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库查询失败')
    res.status(500).json({ code: 500, msg: `获取建议编码失败：${detail}`, data: null })
  }
})

/**
 * 供应商资料：新增（手动编码 s_code）
 * POST /api/supply-chain/suppliers
 * - 默认：pass='0'，del='0'
 * - 审计字段：uid/uname/utruename/addtime（若列存在则写入；值来自 req.user）
 */
app.post('/api/supply-chain/suppliers', async (req, res) => {
  try {
    const body = req.body ?? {}
    const s_code = String(body.s_code ?? '').trim()
    const s_name = String(body.s_name ?? '').trim()
    if (!s_code) {
      res.status(400).json({ code: 400, msg: '新增失败：编码不能为空', data: null })
      return
    }

    const pool = await getPool()
    const colset = await getSystemSupplierColumnSet(pool)

    // 编码唯一（仅在册）
    const dupReq = pool.request().input('s_code', sql.NVarChar(100), s_code)
    const dupRs = await dupReq.query(`
      SELECT COUNT(1) AS cnt
      FROM ${SYS_SUPPLIER_FROM} AS s
      WHERE (ISNULL(s.del, N'') = N'' OR s.del = N'0')
        AND LTRIM(RTRIM(ISNULL(s.s_code, N''))) = @s_code
    `)
    const dup = Number(dupRs.recordset?.[0]?.cnt ?? 0)
    if (dup > 0) {
      res.status(400).json({ code: 400, msg: `新增失败：编码「${s_code}」已存在`, data: null })
      return
    }

    const nowStr = formatBomColorcodeTimestamp()
    const actor = getActorAuditTripletFromReq(req)

    /** @type {Array<{ col: string, key: string, type: any, len?: number }>} */
    const fields = [
      { col: 's_code', key: 's_code', type: sql.NVarChar, len: 100 },
      { col: 's_name', key: 's_name', type: sql.NVarChar, len: 200 },
      { col: 's_sname', key: 's_sname', type: sql.NVarChar, len: 200 },
      { col: 's_sh', key: 's_sh', type: sql.NVarChar, len: 100 },
      { col: 's_lb', key: 's_lb', type: sql.NVarChar, len: 100 },
      { col: 's_lxr', key: 's_lxr', type: sql.NVarChar, len: 100 },
      { col: 's_mobile', key: 's_mobile', type: sql.NVarChar, len: 50 },
      { col: 's_tel', key: 's_tel', type: sql.NVarChar, len: 50 },
      { col: 's_payfor', key: 's_payfor', type: sql.NVarChar, len: 100 },
      { col: 's_jh', key: 's_jh', type: sql.NVarChar, len: 50 },
      { col: 's_wx_jh', key: 's_wx_jh', type: sql.NVarChar, len: 50 },
      { col: 'sl', key: 'sl', type: sql.NVarChar, len: 50 },
      { col: 'kplx', key: 'kplx', type: sql.NVarChar, len: 10 },
      { col: 'kplxx', key: 'kplxx', type: sql.NVarChar, len: 10 },
      { col: 'kplxxx', key: 'kplxxx', type: sql.NVarChar, len: 10 },
      { col: 's_address', key: 's_address', type: sql.NVarChar, len: 500 },
      { col: 's_business', key: 's_business', type: sql.NVarChar, len: 1000 },
      { col: 's_bank', key: 's_bank', type: sql.NVarChar, len: 200 },
      { col: 's_bank_number', key: 's_bank_number', type: sql.NVarChar, len: 100 },
      { col: 's_info', key: 's_info', type: sql.NVarChar, len: 500 },
    ]

    /** @type {string[]} */
    const cols = []
    /** @type {string[]} */
    const vals = []
    const insReq = pool.request()

    // 业务字段
    for (const f of fields) {
      if (!colset.has(f.col.toLowerCase())) continue
      cols.push(f.col)
      vals.push(`@${f.key}`)
      const v = String(body[f.key] ?? '').trim()
      insReq.input(f.key, f.type(f.len ?? 50), v)
    }

    // 默认状态位
    if (colset.has('pass')) {
      cols.push('pass')
      vals.push("N'0'")
    }
    if (colset.has('del')) {
      cols.push('del')
      vals.push("N'0'")
    }

    // 审计字段（列存在才写）
    if (colset.has('uid') && actor.uidInt != null) {
      cols.push('uid')
      vals.push('@uid')
      insReq.input('uid', sql.Int, actor.uidInt)
    }
    if (colset.has('uname') && actor.uname) {
      cols.push('uname')
      vals.push('@uname')
      insReq.input('uname', sql.NVarChar(50), actor.uname)
    }
    if (colset.has('utruename') && actor.utruename) {
      cols.push('utruename')
      vals.push('@utruename')
      insReq.input('utruename', sql.NVarChar(50), actor.utruename)
    }
    if (colset.has('addtime')) {
      cols.push('addtime')
      vals.push('@addtime')
      insReq.input('addtime', sql.NVarChar(50), nowStr)
    }

    if (!cols.length) {
      res.status(500).json({ code: 500, msg: '新增失败：未探测到可写入的列（请检查 System_supplier 表结构）', data: null })
      return
    }

    const r = await insReq.query(`
      INSERT INTO ${SYS_SUPPLIER_FROM} (${cols.join(', ')})
      VALUES (${vals.join(', ')})
    `)
    const ok = (r.rowsAffected?.[0] ?? 0) > 0
    if (!ok) {
      res.status(500).json({ code: 500, msg: '新增失败：数据库未写入记录', data: null })
      return
    }
    res.json({ code: 200, msg: 'success', data: null })
  } catch (err) {
    console.error('POST /api/supply-chain/suppliers 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库写入失败')
    res.status(500).json({ code: 500, msg: `新增供应商失败：${detail}`, data: null })
  }
})

/**
 * 供应商资料：编辑（仅未审核且在册可改）
 * PUT /api/supply-chain/suppliers
 * - 规则：WHERE id=@id AND del 在册 AND pass<>'1'
 */
app.put('/api/supply-chain/suppliers', async (req, res) => {
  try {
    const body = req.body ?? {}
    const id = Number(body.id)
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ code: 400, msg: '参数错误：id 必须为正整数', data: null })
      return
    }
    const s_code = String(body.s_code ?? '').trim()
    if (!s_code) {
      res.status(400).json({ code: 400, msg: '保存失败：编码不能为空', data: null })
      return
    }

    const pool = await getPool()
    const colset = await getSystemSupplierColumnSet(pool)
    const nowStr = formatBomColorcodeTimestamp()
    const actor = getActorAuditTripletFromReq(req)

    // 编码唯一（仅在册，排除自己）
    const dupReq = pool
      .request()
      .input('id', sql.Int, id)
      .input('s_code', sql.NVarChar(100), s_code)
    const dupRs = await dupReq.query(`
      SELECT COUNT(1) AS cnt
      FROM ${SYS_SUPPLIER_FROM} AS s
      WHERE (ISNULL(s.del, N'') = N'' OR s.del = N'0')
        AND LTRIM(RTRIM(ISNULL(s.s_code, N''))) = @s_code
        AND s.id <> @id
    `)
    const dup = Number(dupRs.recordset?.[0]?.cnt ?? 0)
    if (dup > 0) {
      res.status(400).json({ code: 400, msg: `保存失败：编码「${s_code}」已存在`, data: null })
      return
    }

    /** @type {Array<{ col: string, key: string, type: any, len?: number }>} */
    const fields = [
      { col: 's_code', key: 's_code', type: sql.NVarChar, len: 100 },
      { col: 's_name', key: 's_name', type: sql.NVarChar, len: 200 },
      { col: 's_sname', key: 's_sname', type: sql.NVarChar, len: 200 },
      { col: 's_sh', key: 's_sh', type: sql.NVarChar, len: 100 },
      { col: 's_lb', key: 's_lb', type: sql.NVarChar, len: 100 },
      { col: 's_lxr', key: 's_lxr', type: sql.NVarChar, len: 100 },
      { col: 's_mobile', key: 's_mobile', type: sql.NVarChar, len: 50 },
      { col: 's_tel', key: 's_tel', type: sql.NVarChar, len: 50 },
      { col: 's_payfor', key: 's_payfor', type: sql.NVarChar, len: 100 },
      { col: 's_jh', key: 's_jh', type: sql.NVarChar, len: 50 },
      { col: 's_wx_jh', key: 's_wx_jh', type: sql.NVarChar, len: 50 },
      { col: 'sl', key: 'sl', type: sql.NVarChar, len: 50 },
      { col: 'kplx', key: 'kplx', type: sql.NVarChar, len: 10 },
      { col: 'kplxx', key: 'kplxx', type: sql.NVarChar, len: 10 },
      { col: 'kplxxx', key: 'kplxxx', type: sql.NVarChar, len: 10 },
      { col: 's_address', key: 's_address', type: sql.NVarChar, len: 500 },
      { col: 's_business', key: 's_business', type: sql.NVarChar, len: 1000 },
      { col: 's_bank', key: 's_bank', type: sql.NVarChar, len: 200 },
      { col: 's_bank_number', key: 's_bank_number', type: sql.NVarChar, len: 100 },
      { col: 's_info', key: 's_info', type: sql.NVarChar, len: 500 },
    ]

    /** @type {string[]} */
    const setParts = []
    const updReq = pool.request().input('id', sql.Int, id)

    for (const f of fields) {
      if (!colset.has(f.col.toLowerCase())) continue
      setParts.push(`${f.col} = @${f.key}`)
      const v = String(body[f.key] ?? '').trim()
      updReq.input(f.key, f.type(f.len ?? 50), v)
    }

    if (colset.has('uid') && actor.uidInt != null) {
      setParts.push('uid = @uid')
      updReq.input('uid', sql.Int, actor.uidInt)
    }
    if (colset.has('uname') && actor.uname) {
      setParts.push('uname = @uname')
      updReq.input('uname', sql.NVarChar(50), actor.uname)
    }
    if (colset.has('utruename') && actor.utruename) {
      setParts.push('utruename = @utruename')
      updReq.input('utruename', sql.NVarChar(50), actor.utruename)
    }
    if (colset.has('edittime')) {
      setParts.push('edittime = @edittime')
      updReq.input('edittime', sql.NVarChar(50), nowStr)
    }

    if (!setParts.length) {
      res.status(400).json({ code: 400, msg: '保存失败：无可更新字段', data: null })
      return
    }

    const r = await updReq.query(`
      UPDATE ${SYS_SUPPLIER_FROM}
      SET ${setParts.join(', ')}
      WHERE id = @id
        AND (ISNULL(del, N'') = N'' OR del = N'0')
        AND LTRIM(RTRIM(ISNULL(pass, N''))) <> N'1'
    `)
    if ((r.rowsAffected?.[0] ?? 0) <= 0) {
      res.status(400).json({ code: 400, msg: '保存失败：已审核记录不可修改，或该记录已删除', data: null })
      return
    }
    res.json({ code: 200, msg: 'success', data: null })
  } catch (err) {
    console.error('PUT /api/supply-chain/suppliers 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `保存供应商失败：${detail}`, data: null })
  }
})

/**
 * 供应商资料：审核 / 反审 / 恢复 / 软删
 * - 审核：pass=1
 * - 反审：pass=0（并清空审核人字段，如列存在）
 * - 恢复：del=0（仅回收站记录）
 * - 软删：del=1（仅未审核记录）
 */
app.put('/api/supply-chain/suppliers/audit', async (req, res) => {
  try {
    const id = Number(req.body?.id)
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ code: 400, msg: '参数错误：id 必须为正整数', data: null })
      return
    }
    const pool = await getPool()
    const colset = await getSystemSupplierColumnSet(pool)
    const nowStr = formatBomColorcodeTimestamp()
    const actor = getActorAuditTripletFromReq(req)
    const reqDb = pool.request().input('id', sql.Int, id)

    const setParts = ["pass = N'1'"]
    if (colset.has('edittime')) setParts.push('edittime = @edittime')
    if (colset.has('passtime')) setParts.push('passtime = @passtime')
    if (colset.has('passuid') && actor.uidInt != null) setParts.push('passuid = @passuid')
    if (colset.has('passuname') && actor.uname) setParts.push('passuname = @passuname')
    if (colset.has('passutruename') && actor.utruename) setParts.push('passutruename = @passutruename')
    if (colset.has('passip')) setParts.push('passip = @passip')

    if (colset.has('edittime')) reqDb.input('edittime', sql.NVarChar(50), nowStr)
    if (colset.has('passtime')) reqDb.input('passtime', sql.NVarChar(50), nowStr)
    if (colset.has('passuid') && actor.uidInt != null) reqDb.input('passuid', sql.Int, actor.uidInt)
    if (colset.has('passuname') && actor.uname) reqDb.input('passuname', sql.NVarChar(50), actor.uname)
    if (colset.has('passutruename') && actor.utruename) reqDb.input('passutruename', sql.NVarChar(50), actor.utruename)
    if (colset.has('passip')) reqDb.input('passip', sql.NVarChar(64), getRequestIp(req))

    const r = await reqDb.query(`
      UPDATE ${SYS_SUPPLIER_FROM}
      SET ${setParts.join(', ')}
      WHERE id = @id AND (ISNULL(del, N'') = N'' OR del = N'0') AND LTRIM(RTRIM(ISNULL(pass, N''))) <> N'1'
    `)
    if ((r.rowsAffected?.[0] ?? 0) <= 0) {
      res.status(400).json({ code: 400, msg: '审核失败：请确认该记录在册且当前为未审核状态', data: null })
      return
    }
    res.json({ code: 200, msg: 'success', data: null })
  } catch (err) {
    console.error('PUT /api/supply-chain/suppliers/audit 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `审核供应商失败：${detail}`, data: null })
  }
})

app.put('/api/supply-chain/suppliers/unaudit', async (req, res) => {
  try {
    const id = Number(req.body?.id)
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ code: 400, msg: '参数错误：id 必须为正整数', data: null })
      return
    }
    const pool = await getPool()
    const colset = await getSystemSupplierColumnSet(pool)
    const nowStr = formatBomColorcodeTimestamp()
    const reqDb = pool.request().input('id', sql.Int, id)

    const setParts = ["pass = N'0'"]
    if (colset.has('edittime')) setParts.push('edittime = @edittime')
    if (colset.has('passtime')) setParts.push('passtime = NULL')
    if (colset.has('passuid')) setParts.push('passuid = NULL')
    if (colset.has('passuname')) setParts.push('passuname = NULL')
    if (colset.has('passutruename')) setParts.push('passutruename = NULL')
    if (colset.has('passip')) setParts.push('passip = NULL')
    if (colset.has('edittime')) reqDb.input('edittime', sql.NVarChar(50), nowStr)

    const r = await reqDb.query(`
      UPDATE ${SYS_SUPPLIER_FROM}
      SET ${setParts.join(', ')}
      WHERE id = @id AND (ISNULL(del, N'') = N'' OR del = N'0') AND LTRIM(RTRIM(ISNULL(pass, N''))) = N'1'
    `)
    if ((r.rowsAffected?.[0] ?? 0) <= 0) {
      res.status(400).json({ code: 400, msg: '反审失败：请确认该记录在册且当前为已审核状态', data: null })
      return
    }
    res.json({ code: 200, msg: 'success', data: null })
  } catch (err) {
    console.error('PUT /api/supply-chain/suppliers/unaudit 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `反审供应商失败：${detail}`, data: null })
  }
})

app.put('/api/supply-chain/suppliers/restore', async (req, res) => {
  try {
    const id = Number(req.body?.id)
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ code: 400, msg: '参数错误：id 必须为正整数', data: null })
      return
    }
    const pool = await getPool()
    const colset = await getSystemSupplierColumnSet(pool)
    const nowStr = formatBomColorcodeTimestamp()
    const reqDb = pool.request().input('id', sql.Int, id)

    const setParts = ["del = N'0'"]
    if (colset.has('edittime')) setParts.push('edittime = @edittime')
    if (colset.has('deltime')) setParts.push('deltime = NULL')
    if (colset.has('edittime')) reqDb.input('edittime', sql.NVarChar(50), nowStr)

    const r = await reqDb.query(`
      UPDATE ${SYS_SUPPLIER_FROM}
      SET ${setParts.join(', ')}
      WHERE id = @id AND LTRIM(RTRIM(ISNULL(del, N''))) = N'1'
    `)
    if ((r.rowsAffected?.[0] ?? 0) <= 0) {
      res.status(400).json({ code: 400, msg: '恢复失败：请确认该记录当前在回收站（del=1）', data: null })
      return
    }
    res.json({ code: 200, msg: 'success', data: null })
  } catch (err) {
    console.error('PUT /api/supply-chain/suppliers/restore 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `恢复供应商失败：${detail}`, data: null })
  }
})

app.delete('/api/supply-chain/suppliers/:id', async (req, res) => {
  try {
    const id = Number(req.params?.id)
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ code: 400, msg: '参数错误：id 必须为正整数', data: null })
      return
    }
    const pool = await getPool()
    const colset = await getSystemSupplierColumnSet(pool)
    const nowStr = formatBomColorcodeTimestamp()
    const reqDb = pool.request().input('id', sql.Int, id)

    const setParts = ["del = N'1'"]
    if (colset.has('deltime')) setParts.push('deltime = @deltime')
    if (colset.has('deltime')) reqDb.input('deltime', sql.NVarChar(50), nowStr)

    const r = await reqDb.query(`
      UPDATE ${SYS_SUPPLIER_FROM}
      SET ${setParts.join(', ')}
      WHERE id = @id
        AND (ISNULL(del, N'') = N'' OR del = N'0')
        AND LTRIM(RTRIM(ISNULL(pass, N''))) <> N'1'
    `)
    if ((r.rowsAffected?.[0] ?? 0) <= 0) {
      res.status(400).json({ code: 400, msg: '删除失败：已审核记录不可删除，请先反审；或该记录已在回收站', data: null })
      return
    }
    res.json({ code: 200, msg: 'success', data: null })
  } catch (err) {
    console.error('DELETE /api/supply-chain/suppliers/:id 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `删除供应商失败：${detail}`, data: null })
  }
})

/**
 * 供应商资料：回收站彻底删除（物理删除，不可恢复）
 * DELETE /api/supply-chain/suppliers/:id/permanent
 * - 仅允许 del=1
 */
app.delete('/api/supply-chain/suppliers/:id/permanent', async (req, res) => {
  try {
    const id = Number(req.params?.id)
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ code: 400, msg: '参数错误：id 必须为正整数', data: null })
      return
    }
    const pool = await getPool()
    const r = await pool.request().input('id', sql.Int, id).query(`
      DELETE FROM ${SYS_SUPPLIER_FROM}
      WHERE id = @id AND LTRIM(RTRIM(ISNULL(del, N''))) = N'1'
    `)
    if ((r.rowsAffected?.[0] ?? 0) <= 0) {
      res.status(400).json({ code: 400, msg: '彻底删除失败：请确认该记录在回收站（del=1）', data: null })
      return
    }
    res.json({ code: 200, msg: 'success', data: null })
  } catch (err) {
    console.error('DELETE /api/supply-chain/suppliers/:id/permanent 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `彻底删除供应商失败：${detail}`, data: null })
  }
})

/**
 * 销售/采购/外协管理：销售客户分页列表（物理表 System_sales_customer；SQL Server 2008 R2：ROW_NUMBER 分页）
 * GET /api/supply-chain/customers/list
 * - 默认：只查已审核 pass=1 且在册 del=0（或空/NULL）
 * - 可切换：pass=0（显示未审核）；回收站 recycled=1（仅 del=1，不按 pass 过滤）
 */
app.get('/api/supply-chain/customers/list', async (req, res) => {
  try {
    const pool = await getPool()
    const page = Math.max(1, Number(req.query?.page ?? 1) || 1)
    const pageSizeRaw = Number(req.query?.pageSize ?? 20) || 20
    const pageSize = Math.min(100, Math.max(1, pageSizeRaw))

    const recycledRaw = String(req.query?.recycled ?? '').trim().toLowerCase()
    const recycled = recycledRaw === '1' || recycledRaw === 'true' || recycledRaw === 'yes'

    const passRaw = String(req.query?.pass ?? '1').trim()
    const pass = passRaw === '0' ? '0' : '1'

    const keywordRaw = String(req.query?.keyword ?? '').trim()
    const hasKeyword = keywordRaw.length > 0
    const kwPat = hasKeyword ? `%${escapeSqlLikePattern(keywordRaw)}%` : ''

    const whereBase = recycled
      ? `
        WHERE LTRIM(RTRIM(ISNULL(c.del, N''))) = N'1'
          ${hasKeyword ? ' AND (c.s_code LIKE @kw OR c.s_name LIKE @kw OR c.s_address LIKE @kw) ' : ''}
      `
      : `
        WHERE (ISNULL(c.del, N'') = N'' OR c.del = N'0')
          AND LTRIM(RTRIM(ISNULL(c.pass, N''))) = @pass
          ${hasKeyword ? ' AND (c.s_code LIKE @kw OR c.s_name LIKE @kw OR c.s_address LIKE @kw) ' : ''}
      `

    const countReq = pool.request()
    if (!recycled) countReq.input('pass', sql.NVarChar(10), pass)
    if (hasKeyword) countReq.input('kw', sql.NVarChar(200), kwPat)
    const totalRow = await countReq.query(`
      SELECT COUNT(1) AS total
      FROM ${SYS_SALES_CUSTOMER_FROM} AS c
      ${whereBase}
    `)
    const total = Number(totalRow.recordset?.[0]?.total ?? 0)

    const safeOffset = (page - 1) * pageSize
    const startRow = safeOffset + 1
    const endRow = safeOffset + pageSize

    const listReq = pool.request()
    if (!recycled) listReq.input('pass', sql.NVarChar(10), pass)
    listReq.input('startRow', sql.Int, startRow)
    listReq.input('endRow', sql.Int, endRow)
    if (hasKeyword) listReq.input('kw', sql.NVarChar(200), kwPat)

    const listResult = await listReq.query(`
      SELECT
        x.id,
        x.s_code,
        x.pass,
        x.del,
        x.s_name,
        x.s_address,
        x.s_lxr,
        x.s_tel,
        x.s_mobile,
        x.s_payfor,
        x.lxr,
        x.s_info,
        x.s_business,
        x.s_lb
      FROM (
        SELECT
          c.id AS id,
          LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(c.s_code, N'')))) AS s_code,
          LTRIM(RTRIM(CONVERT(nvarchar(10), ISNULL(c.pass, N'')))) AS pass,
          LTRIM(RTRIM(CONVERT(nvarchar(10), ISNULL(c.del, N'')))) AS del,
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.s_name, N'')))) AS s_name,
          LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(c.s_address, N'')))) AS s_address,
          LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(c.s_lxr, N'')))) AS s_lxr,
          LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(c.s_tel, N'')))) AS s_tel,
          LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(c.s_mobile, N'')))) AS s_mobile,
          LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(c.s_payfor, N'')))) AS s_payfor,
          LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(c.lxr, N'')))) AS lxr,
          LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(c.s_info, N'')))) AS s_info,
          LTRIM(RTRIM(CONVERT(nvarchar(1000), ISNULL(c.s_business, N'')))) AS s_business,
          LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(c.s_lb, N'')))) AS s_lb,
          ROW_NUMBER() OVER (ORDER BY c.id DESC) AS rn
        FROM ${SYS_SALES_CUSTOMER_FROM} AS c
        ${whereBase}
      ) AS x
      WHERE x.rn BETWEEN @startRow AND @endRow
      ORDER BY x.rn
    `)

    const list = (listResult.recordset ?? []).map((row) => ({
      id: row.id != null ? Number(row.id) : null,
      s_code: row.s_code ?? '',
      pass: row.pass ?? '',
      del: row.del ?? '',
      s_name: row.s_name ?? '',
      s_address: row.s_address ?? '',
      s_lxr: row.s_lxr ?? '',
      s_tel: row.s_tel ?? '',
      s_mobile: row.s_mobile ?? '',
      s_payfor: row.s_payfor ?? '',
      lxr: row.lxr ?? '',
      s_info: row.s_info ?? '',
      s_business: row.s_business ?? '',
      s_lb: row.s_lb ?? '',
    }))

    res.json({ code: 200, msg: 'success', data: { total, list, recycled } })
  } catch (err) {
    console.error('GET /api/supply-chain/customers/list 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库查询失败')
    res.status(500).json({ code: 500, msg: `读取销售客户失败：${detail}`, data: null })
  }
})

/**
 * 销售客户：详情（供“查看”弹窗/抽屉）
 * GET /api/supply-chain/customers/:id
 * - 不区分 pass/del（回收站也可查看）
 */
app.get('/api/supply-chain/customers/:id', async (req, res) => {
  try {
    const id = Number(req.params?.id)
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ code: 400, msg: '参数错误：id 必须为正整数', data: null })
      return
    }
    const pool = await getPool()
    const r = await pool.request().input('id', sql.Int, id).query(`
      SELECT TOP (1)
        c.id,
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(c.s_code, N'')))) AS s_code,
        LTRIM(RTRIM(CONVERT(nvarchar(10), ISNULL(c.pass, N'')))) AS pass,
        LTRIM(RTRIM(CONVERT(nvarchar(10), ISNULL(c.del, N'')))) AS del,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.s_name, N'')))) AS s_name,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(c.s_address, N'')))) AS s_address,
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(c.s_lxr, N'')))) AS s_lxr,
        LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(c.s_tel, N'')))) AS s_tel,
        LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(c.s_mobile, N'')))) AS s_mobile,
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(c.s_payfor, N'')))) AS s_payfor,
        LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(c.lxr, N'')))) AS lxr,
        LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(c.s_info, N'')))) AS s_info,
        LTRIM(RTRIM(CONVERT(nvarchar(1000), ISNULL(c.s_business, N'')))) AS s_business,
        LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(c.s_lb, N'')))) AS s_lb
      FROM ${SYS_SALES_CUSTOMER_FROM} AS c
      WHERE c.id = @id
    `)
    const row = r.recordset?.[0]
    if (!row) {
      res.status(404).json({ code: 404, msg: '未找到该客户', data: null })
      return
    }
    res.json({
      code: 200,
      msg: 'success',
      data: {
        id: row.id != null ? Number(row.id) : null,
        s_code: row.s_code ?? '',
        pass: row.pass ?? '',
        del: row.del ?? '',
        s_name: row.s_name ?? '',
        s_address: row.s_address ?? '',
        s_lxr: row.s_lxr ?? '',
        s_tel: row.s_tel ?? '',
        s_mobile: row.s_mobile ?? '',
        s_payfor: row.s_payfor ?? '',
        lxr: row.lxr ?? '',
        s_info: row.s_info ?? '',
        s_business: row.s_business ?? '',
        s_lb: row.s_lb ?? '',
      },
    })
  } catch (err) {
    console.error('GET /api/supply-chain/customers/:id 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库查询失败')
    res.status(500).json({ code: 500, msg: `读取客户详情失败：${detail}`, data: null })
  }
})

/**
 * 销售客户：新增（编码 s_code 手动填写）
 * POST /api/supply-chain/customers
 * - 默认：pass='0'，del='0'
 * - 审计字段：uid/uname/utruename/addtime（若列存在则写入；值来自 req.user）
 */
app.post('/api/supply-chain/customers', async (req, res) => {
  try {
    const body = req.body ?? {}
    const s_code = String(body.s_code ?? '').trim()
    const s_name = String(body.s_name ?? '').trim()
    if (!s_code) {
      res.status(400).json({ code: 400, msg: '新增失败：编码不能为空', data: null })
      return
    }
    if (!s_name) {
      res.status(400).json({ code: 400, msg: '新增失败：名称不能为空', data: null })
      return
    }

    const pool = await getPool()
    const colset = await getSystemSalesCustomerColumnSet(pool)

    // 编码唯一（仅在册）
    const dupReq = pool.request().input('s_code', sql.NVarChar(100), s_code)
    const dupRs = await dupReq.query(`
      SELECT COUNT(1) AS cnt
      FROM ${SYS_SALES_CUSTOMER_FROM} AS c
      WHERE (ISNULL(c.del, N'') = N'' OR c.del = N'0')
        AND LTRIM(RTRIM(ISNULL(c.s_code, N''))) = @s_code
    `)
    const dup = Number(dupRs.recordset?.[0]?.cnt ?? 0)
    if (dup > 0) {
      res.status(400).json({ code: 400, msg: `新增失败：编码「${s_code}」已存在`, data: null })
      return
    }

    const nowStr = formatBomColorcodeTimestamp()
    const actor = getActorAuditTripletFromReq(req)

    /** @type {Array<{ col: string, key: string, type: any, len?: number }>} */
    const fields = [
      { col: 's_code', key: 's_code', type: sql.NVarChar, len: 100 },
      { col: 's_name', key: 's_name', type: sql.NVarChar, len: 200 },
      { col: 's_address', key: 's_address', type: sql.NVarChar, len: 500 },
      { col: 's_lxr', key: 's_lxr', type: sql.NVarChar, len: 100 },
      { col: 's_tel', key: 's_tel', type: sql.NVarChar, len: 50 },
      { col: 's_mobile', key: 's_mobile', type: sql.NVarChar, len: 50 },
      { col: 's_payfor', key: 's_payfor', type: sql.NVarChar, len: 100 },
      { col: 'lxr', key: 'lxr', type: sql.NVarChar, len: 100 },
      { col: 's_info', key: 's_info', type: sql.NVarChar, len: 500 },
      { col: 's_business', key: 's_business', type: sql.NVarChar, len: 1000 },
      { col: 's_lb', key: 's_lb', type: sql.NVarChar, len: 50 },
    ]

    /** @type {string[]} */
    const cols = []
    /** @type {string[]} */
    const vals = []
    const insReq = pool.request()

    for (const f of fields) {
      if (!colset.has(f.col.toLowerCase())) continue
      cols.push(f.col)
      vals.push(`@${f.key}`)
      const v = String(body[f.key] ?? '').trim()
      insReq.input(f.key, f.type(f.len ?? 50), v)
    }

    if (colset.has('pass')) {
      cols.push('pass')
      vals.push("N'0'")
    }
    if (colset.has('del')) {
      cols.push('del')
      vals.push("N'0'")
    }

    if (colset.has('uid') && actor.uidInt != null) {
      cols.push('uid')
      vals.push('@uid')
      insReq.input('uid', sql.Int, actor.uidInt)
    }
    if (colset.has('uname') && actor.uname) {
      cols.push('uname')
      vals.push('@uname')
      insReq.input('uname', sql.NVarChar(50), actor.uname)
    }
    if (colset.has('utruename') && actor.utruename) {
      cols.push('utruename')
      vals.push('@utruename')
      insReq.input('utruename', sql.NVarChar(50), actor.utruename)
    }
    if (colset.has('addtime')) {
      cols.push('addtime')
      vals.push('@addtime')
      insReq.input('addtime', sql.NVarChar(50), nowStr)
    }

    if (!cols.length) {
      res.status(500).json({
        code: 500,
        msg: '新增失败：未探测到可写入的列（请检查 System_sales_customer 表结构）',
        data: null,
      })
      return
    }

    const r = await insReq.query(`
      INSERT INTO ${SYS_SALES_CUSTOMER_FROM} (${cols.join(', ')})
      VALUES (${vals.join(', ')})
    `)
    const ok = (r.rowsAffected?.[0] ?? 0) > 0
    if (!ok) {
      res.status(500).json({ code: 500, msg: '新增失败：数据库未写入记录', data: null })
      return
    }
    res.json({ code: 200, msg: 'success', data: null })
  } catch (err) {
    console.error('POST /api/supply-chain/customers 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库写入失败')
    res.status(500).json({ code: 500, msg: `新增客户失败：${detail}`, data: null })
  }
})

/**
 * 销售客户：编辑（仅未审核且在册可改）
 * PUT /api/supply-chain/customers
 */
app.put('/api/supply-chain/customers', async (req, res) => {
  try {
    const body = req.body ?? {}
    const id = Number(body.id)
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ code: 400, msg: '参数错误：id 必须为正整数', data: null })
      return
    }
    const s_code = String(body.s_code ?? '').trim()
    const s_name = String(body.s_name ?? '').trim()
    if (!s_code) {
      res.status(400).json({ code: 400, msg: '保存失败：编码不能为空', data: null })
      return
    }
    if (!s_name) {
      res.status(400).json({ code: 400, msg: '保存失败：名称不能为空', data: null })
      return
    }

    const pool = await getPool()
    const colset = await getSystemSalesCustomerColumnSet(pool)
    const nowStr = formatBomColorcodeTimestamp()
    const actor = getActorAuditTripletFromReq(req)

    // 编码唯一（仅在册，排除自己）
    const dupReq = pool.request().input('id', sql.Int, id).input('s_code', sql.NVarChar(100), s_code)
    const dupRs = await dupReq.query(`
      SELECT COUNT(1) AS cnt
      FROM ${SYS_SALES_CUSTOMER_FROM} AS c
      WHERE (ISNULL(c.del, N'') = N'' OR c.del = N'0')
        AND LTRIM(RTRIM(ISNULL(c.s_code, N''))) = @s_code
        AND c.id <> @id
    `)
    const dup = Number(dupRs.recordset?.[0]?.cnt ?? 0)
    if (dup > 0) {
      res.status(400).json({ code: 400, msg: `保存失败：编码「${s_code}」已存在`, data: null })
      return
    }

    /** @type {Array<{ col: string, key: string, type: any, len?: number }>} */
    const fields = [
      { col: 's_code', key: 's_code', type: sql.NVarChar, len: 100 },
      { col: 's_name', key: 's_name', type: sql.NVarChar, len: 200 },
      { col: 's_address', key: 's_address', type: sql.NVarChar, len: 500 },
      { col: 's_lxr', key: 's_lxr', type: sql.NVarChar, len: 100 },
      { col: 's_tel', key: 's_tel', type: sql.NVarChar, len: 50 },
      { col: 's_mobile', key: 's_mobile', type: sql.NVarChar, len: 50 },
      { col: 's_payfor', key: 's_payfor', type: sql.NVarChar, len: 100 },
      { col: 'lxr', key: 'lxr', type: sql.NVarChar, len: 100 },
      { col: 's_info', key: 's_info', type: sql.NVarChar, len: 500 },
      { col: 's_business', key: 's_business', type: sql.NVarChar, len: 1000 },
      { col: 's_lb', key: 's_lb', type: sql.NVarChar, len: 50 },
    ]

    /** @type {string[]} */
    const setParts = []
    const updReq = pool.request().input('id', sql.Int, id)
    for (const f of fields) {
      if (!colset.has(f.col.toLowerCase())) continue
      setParts.push(`${f.col} = @${f.key}`)
      const v = String(body[f.key] ?? '').trim()
      updReq.input(f.key, f.type(f.len ?? 50), v)
    }

    if (colset.has('uid') && actor.uidInt != null) {
      setParts.push('uid = @uid')
      updReq.input('uid', sql.Int, actor.uidInt)
    }
    if (colset.has('uname') && actor.uname) {
      setParts.push('uname = @uname')
      updReq.input('uname', sql.NVarChar(50), actor.uname)
    }
    if (colset.has('utruename') && actor.utruename) {
      setParts.push('utruename = @utruename')
      updReq.input('utruename', sql.NVarChar(50), actor.utruename)
    }
    if (colset.has('edittime')) {
      setParts.push('edittime = @edittime')
      updReq.input('edittime', sql.NVarChar(50), nowStr)
    }

    if (!setParts.length) {
      res.status(400).json({ code: 400, msg: '保存失败：无可更新字段', data: null })
      return
    }

    const r = await updReq.query(`
      UPDATE ${SYS_SALES_CUSTOMER_FROM}
      SET ${setParts.join(', ')}
      WHERE id = @id
        AND (ISNULL(del, N'') = N'' OR del = N'0')
        AND LTRIM(RTRIM(ISNULL(pass, N''))) <> N'1'
    `)
    if ((r.rowsAffected?.[0] ?? 0) <= 0) {
      res.status(400).json({ code: 400, msg: '保存失败：已审核记录不可修改，或该记录已删除', data: null })
      return
    }
    res.json({ code: 200, msg: 'success', data: null })
  } catch (err) {
    console.error('PUT /api/supply-chain/customers 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `保存客户失败：${detail}`, data: null })
  }
})

/**
 * 销售客户：审核 / 反审 / 恢复 / 软删 / 回收站彻底删除
 */
app.put('/api/supply-chain/customers/audit', async (req, res) => {
  try {
    const id = Number(req.body?.id)
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ code: 400, msg: '参数错误：id 必须为正整数', data: null })
      return
    }
    const pool = await getPool()
    const colset = await getSystemSalesCustomerColumnSet(pool)
    const nowStr = formatBomColorcodeTimestamp()
    const actor = getActorAuditTripletFromReq(req)
    const reqDb = pool.request().input('id', sql.Int, id)

    const setParts = ["pass = N'1'"]
    if (colset.has('edittime')) setParts.push('edittime = @edittime')
    if (colset.has('passtime')) setParts.push('passtime = @passtime')
    if (colset.has('passuid') && actor.uidInt != null) setParts.push('passuid = @passuid')
    if (colset.has('passuname') && actor.uname) setParts.push('passuname = @passuname')
    if (colset.has('passutruename') && actor.utruename) setParts.push('passutruename = @passutruename')
    if (colset.has('passip')) setParts.push('passip = @passip')

    if (colset.has('edittime')) reqDb.input('edittime', sql.NVarChar(50), nowStr)
    if (colset.has('passtime')) reqDb.input('passtime', sql.NVarChar(50), nowStr)
    if (colset.has('passuid') && actor.uidInt != null) reqDb.input('passuid', sql.Int, actor.uidInt)
    if (colset.has('passuname') && actor.uname) reqDb.input('passuname', sql.NVarChar(50), actor.uname)
    if (colset.has('passutruename') && actor.utruename) reqDb.input('passutruename', sql.NVarChar(50), actor.utruename)
    if (colset.has('passip')) reqDb.input('passip', sql.NVarChar(64), getRequestIp(req))

    const r = await reqDb.query(`
      UPDATE ${SYS_SALES_CUSTOMER_FROM}
      SET ${setParts.join(', ')}
      WHERE id = @id AND (ISNULL(del, N'') = N'' OR del = N'0') AND LTRIM(RTRIM(ISNULL(pass, N''))) <> N'1'
    `)
    if ((r.rowsAffected?.[0] ?? 0) <= 0) {
      res.status(400).json({ code: 400, msg: '审核失败：请确认该记录在册且当前为未审核状态', data: null })
      return
    }
    res.json({ code: 200, msg: 'success', data: null })
  } catch (err) {
    console.error('PUT /api/supply-chain/customers/audit 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `审核客户失败：${detail}`, data: null })
  }
})

app.put('/api/supply-chain/customers/unaudit', async (req, res) => {
  try {
    const id = Number(req.body?.id)
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ code: 400, msg: '参数错误：id 必须为正整数', data: null })
      return
    }
    const pool = await getPool()
    const colset = await getSystemSalesCustomerColumnSet(pool)
    const nowStr = formatBomColorcodeTimestamp()
    const reqDb = pool.request().input('id', sql.Int, id)

    const setParts = ["pass = N'0'"]
    if (colset.has('edittime')) setParts.push('edittime = @edittime')
    if (colset.has('passtime')) setParts.push('passtime = NULL')
    if (colset.has('passuid')) setParts.push('passuid = NULL')
    if (colset.has('passuname')) setParts.push('passuname = NULL')
    if (colset.has('passutruename')) setParts.push('passutruename = NULL')
    if (colset.has('passip')) setParts.push('passip = NULL')
    if (colset.has('edittime')) reqDb.input('edittime', sql.NVarChar(50), nowStr)

    const r = await reqDb.query(`
      UPDATE ${SYS_SALES_CUSTOMER_FROM}
      SET ${setParts.join(', ')}
      WHERE id = @id AND (ISNULL(del, N'') = N'' OR del = N'0') AND LTRIM(RTRIM(ISNULL(pass, N''))) = N'1'
    `)
    if ((r.rowsAffected?.[0] ?? 0) <= 0) {
      res.status(400).json({ code: 400, msg: '反审失败：请确认该记录在册且当前为已审核状态', data: null })
      return
    }
    res.json({ code: 200, msg: 'success', data: null })
  } catch (err) {
    console.error('PUT /api/supply-chain/customers/unaudit 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `反审客户失败：${detail}`, data: null })
  }
})

app.put('/api/supply-chain/customers/restore', async (req, res) => {
  try {
    const id = Number(req.body?.id)
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ code: 400, msg: '参数错误：id 必须为正整数', data: null })
      return
    }
    const pool = await getPool()
    const colset = await getSystemSalesCustomerColumnSet(pool)
    const nowStr = formatBomColorcodeTimestamp()
    const reqDb = pool.request().input('id', sql.Int, id)

    const setParts = ["del = N'0'"]
    if (colset.has('edittime')) setParts.push('edittime = @edittime')
    if (colset.has('deltime')) setParts.push('deltime = NULL')
    if (colset.has('edittime')) reqDb.input('edittime', sql.NVarChar(50), nowStr)

    const r = await reqDb.query(`
      UPDATE ${SYS_SALES_CUSTOMER_FROM}
      SET ${setParts.join(', ')}
      WHERE id = @id AND LTRIM(RTRIM(ISNULL(del, N''))) = N'1'
    `)
    if ((r.rowsAffected?.[0] ?? 0) <= 0) {
      res.status(400).json({ code: 400, msg: '恢复失败：请确认该记录当前在回收站（del=1）', data: null })
      return
    }
    res.json({ code: 200, msg: 'success', data: null })
  } catch (err) {
    console.error('PUT /api/supply-chain/customers/restore 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `恢复客户失败：${detail}`, data: null })
  }
})

app.delete('/api/supply-chain/customers/:id', async (req, res) => {
  try {
    const id = Number(req.params?.id)
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ code: 400, msg: '参数错误：id 必须为正整数', data: null })
      return
    }
    const pool = await getPool()
    const colset = await getSystemSalesCustomerColumnSet(pool)
    const nowStr = formatBomColorcodeTimestamp()
    const reqDb = pool.request().input('id', sql.Int, id)

    const setParts = ["del = N'1'"]
    if (colset.has('deltime')) setParts.push('deltime = @deltime')
    if (colset.has('deltime')) reqDb.input('deltime', sql.NVarChar(50), nowStr)

    const r = await reqDb.query(`
      UPDATE ${SYS_SALES_CUSTOMER_FROM}
      SET ${setParts.join(', ')}
      WHERE id = @id
        AND (ISNULL(del, N'') = N'' OR del = N'0')
        AND LTRIM(RTRIM(ISNULL(pass, N''))) <> N'1'
    `)
    if ((r.rowsAffected?.[0] ?? 0) <= 0) {
      res.status(400).json({ code: 400, msg: '删除失败：已审核记录不可删除，请先反审；或该记录已在回收站', data: null })
      return
    }
    res.json({ code: 200, msg: 'success', data: null })
  } catch (err) {
    console.error('DELETE /api/supply-chain/customers/:id 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `删除客户失败：${detail}`, data: null })
  }
})

/**
 * 销售客户：回收站彻底删除（物理删除，不可恢复）
 * DELETE /api/supply-chain/customers/:id/permanent
 * - 仅允许 del=1
 */
app.delete('/api/supply-chain/customers/:id/permanent', async (req, res) => {
  try {
    const id = Number(req.params?.id)
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ code: 400, msg: '参数错误：id 必须为正整数', data: null })
      return
    }
    const pool = await getPool()
    const r = await pool.request().input('id', sql.Int, id).query(`
      DELETE FROM ${SYS_SALES_CUSTOMER_FROM}
      WHERE id = @id AND LTRIM(RTRIM(ISNULL(del, N''))) = N'1'
    `)
    if ((r.rowsAffected?.[0] ?? 0) <= 0) {
      res.status(400).json({ code: 400, msg: '彻底删除失败：请确认该记录在回收站（del=1）', data: null })
      return
    }
    res.json({ code: 200, msg: 'success', data: null })
  } catch (err) {
    console.error('DELETE /api/supply-chain/customers/:id/permanent 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `彻底删除客户失败：${detail}`, data: null })
  }
})

/**
 * 销售/采购/外协管理：结算方式分页列表（物理表 System_settlement_method；SQL Server 2008 R2：ROW_NUMBER 分页）
 * GET /api/supply-chain/settlement-methods/list
 * - 默认：只查已审核 pass=1 且在册 del=0（或空/NULL）
 * - 可切换：pass=0（显示未审核）；回收站 recycled=1（仅 del=1，不按 pass 过滤）
 */
app.get('/api/supply-chain/settlement-methods/list', async (req, res) => {
  try {
    const pool = await getPool()
    const page = Math.max(1, Number(req.query?.page ?? 1) || 1)
    const pageSizeRaw = Number(req.query?.pageSize ?? 20) || 20
    const pageSize = Math.min(100, Math.max(1, pageSizeRaw))

    const recycledRaw = String(req.query?.recycled ?? '').trim().toLowerCase()
    const recycled = recycledRaw === '1' || recycledRaw === 'true' || recycledRaw === 'yes'

    const passRaw = String(req.query?.pass ?? '1').trim()
    const pass = passRaw === '0' ? '0' : '1'

    const keywordRaw = String(req.query?.keyword ?? '').trim()
    const hasKeyword = keywordRaw.length > 0
    const kwPat = hasKeyword ? `%${escapeSqlLikePattern(keywordRaw)}%` : ''

    const whereBase = recycled
      ? `
        WHERE LTRIM(RTRIM(ISNULL(m.del, N''))) = N'1'
          ${hasKeyword ? ' AND (m.code LIKE @kw OR m.name LIKE @kw OR m.info LIKE @kw) ' : ''}
      `
      : `
        WHERE (ISNULL(m.del, N'') = N'' OR m.del = N'0')
          AND LTRIM(RTRIM(ISNULL(m.pass, N''))) = @pass
          ${hasKeyword ? ' AND (m.code LIKE @kw OR m.name LIKE @kw OR m.info LIKE @kw) ' : ''}
      `

    const countReq = pool.request()
    if (!recycled) countReq.input('pass', sql.NVarChar(10), pass)
    if (hasKeyword) countReq.input('kw', sql.NVarChar(200), kwPat)
    const totalRow = await countReq.query(`
      SELECT COUNT(1) AS total
      FROM ${SYS_SETTLEMENT_METHOD_FROM} AS m
      ${whereBase}
    `)
    const total = Number(totalRow.recordset?.[0]?.total ?? 0)

    const safeOffset = (page - 1) * pageSize
    const startRow = safeOffset + 1
    const endRow = safeOffset + pageSize

    const listReq = pool.request()
    if (!recycled) listReq.input('pass', sql.NVarChar(10), pass)
    listReq.input('startRow', sql.Int, startRow)
    listReq.input('endRow', sql.Int, endRow)
    if (hasKeyword) listReq.input('kw', sql.NVarChar(200), kwPat)

    const listResult = await listReq.query(`
      SELECT
        x.id,
        x.code,
        x.name,
        x.payfor,
        x.info,
        x.pass,
        x.del
      FROM (
        SELECT
          m.id AS id,
          LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(m.code, N'')))) AS code,
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(m.name, N'')))) AS name,
          LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(m.payfor, N'')))) AS payfor,
          LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(m.info, N'')))) AS info,
          LTRIM(RTRIM(CONVERT(nvarchar(10), ISNULL(m.pass, N'')))) AS pass,
          LTRIM(RTRIM(CONVERT(nvarchar(10), ISNULL(m.del, N'')))) AS del,
          ROW_NUMBER() OVER (ORDER BY m.id DESC) AS rn
        FROM ${SYS_SETTLEMENT_METHOD_FROM} AS m
        ${whereBase}
      ) AS x
      WHERE x.rn BETWEEN @startRow AND @endRow
      ORDER BY x.rn
    `)

    const list = (listResult.recordset ?? []).map((row) => ({
      id: row.id != null ? Number(row.id) : null,
      code: row.code ?? '',
      name: row.name ?? '',
      payfor: row.payfor ?? '',
      info: row.info ?? '',
      pass: row.pass ?? '',
      del: row.del ?? '',
    }))

    res.json({ code: 200, msg: 'success', data: { total, list, recycled } })
  } catch (err) {
    console.error('GET /api/supply-chain/settlement-methods/list 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库查询失败')
    res.status(500).json({ code: 500, msg: `读取结算方式失败：${detail}`, data: null })
  }
})

/**
 * 结算方式：建议编码（用于新增默认值）
 * GET /api/supply-chain/settlement-methods/suggest-code
 * 规则：
 * - 优先：从 code 中挑选“纯数字”的最大值 + 1
 * - 兜底：MAX(id) + 1
 */
app.get('/api/supply-chain/settlement-methods/suggest-code', async (req, res) => {
  try {
    const pool = await getPool()
    const r = await pool.request().query(`
      SELECT
        ISNULL(
          MAX(
            CASE
              WHEN UPPER(LTRIM(RTRIM(ISNULL(m.code, N'')))) LIKE N'PT%'
                AND PATINDEX('%[^0-9]%', SUBSTRING(UPPER(LTRIM(RTRIM(ISNULL(m.code, N'')))), 3, 50)) = 0
                AND ISNUMERIC(SUBSTRING(UPPER(LTRIM(RTRIM(ISNULL(m.code, N'')))), 3, 50)) = 1
              THEN CAST(SUBSTRING(UPPER(LTRIM(RTRIM(ISNULL(m.code, N'0')))), 3, 50) AS INT)
              ELSE NULL
            END
          ),
          0
        ) AS max_pt_suffix,
        ISNULL(MAX(CASE WHEN m.id IS NULL THEN 0 ELSE m.id END), 0) AS max_id
      FROM ${SYS_SETTLEMENT_METHOD_FROM} AS m
    `)
    const maxPtSuffix = Number(r.recordset?.[0]?.max_pt_suffix ?? 0)
    const maxId = Number(r.recordset?.[0]?.max_id ?? 0)
    const next = Number.isFinite(maxPtSuffix) && maxPtSuffix > 0 ? maxPtSuffix + 1 : maxId + 1
    res.json({ code: 200, msg: 'success', data: { suggestedCode: `PT${String(next)}` } })
  } catch (err) {
    console.error('GET /api/supply-chain/settlement-methods/suggest-code 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库查询失败')
    res.status(500).json({ code: 500, msg: `获取建议编码失败：${detail}`, data: null })
  }
})

/**
 * 结算方式：新增
 * POST /api/supply-chain/settlement-methods
 * body: { code?, name, payfor, info? } —— code 为空则后端自动取 max(code)+1
 */
app.post('/api/supply-chain/settlement-methods', async (req, res) => {
  try {
    const body = req.body ?? {}
    let code = String(body.code ?? '').trim()
    const name = String(body.name ?? '').trim()
    const payfor = String(body.payfor ?? '').trim()
    const info = String(body.info ?? '').trim()
    if (!name) {
      res.status(400).json({ code: 400, msg: '新增失败：名称不能为空', data: null })
      return
    }
    if (!payfor) {
      res.status(400).json({ code: 400, msg: '新增失败：天数不能为空', data: null })
      return
    }

    const pool = await getPool()
    const colset = await getSystemSettlementMethodColumnSet(pool)

    // code 为空则自动生成
    if (!code) {
      const r = await pool.request().query(`
        SELECT
          ISNULL(
            MAX(
              CASE
                WHEN UPPER(LTRIM(RTRIM(ISNULL(m.code, N'')))) LIKE N'PT%'
                  AND PATINDEX('%[^0-9]%', SUBSTRING(UPPER(LTRIM(RTRIM(ISNULL(m.code, N'')))), 3, 50)) = 0
                  AND ISNUMERIC(SUBSTRING(UPPER(LTRIM(RTRIM(ISNULL(m.code, N'')))), 3, 50)) = 1
                THEN CAST(SUBSTRING(UPPER(LTRIM(RTRIM(ISNULL(m.code, N'0')))), 3, 50) AS INT)
                ELSE NULL
              END
            ),
            0
          ) AS max_pt_suffix,
          ISNULL(MAX(CASE WHEN m.id IS NULL THEN 0 ELSE m.id END), 0) AS max_id
        FROM ${SYS_SETTLEMENT_METHOD_FROM} AS m
      `)
      const maxPtSuffix = Number(r.recordset?.[0]?.max_pt_suffix ?? 0)
      const maxId = Number(r.recordset?.[0]?.max_id ?? 0)
      const next = Number.isFinite(maxPtSuffix) && maxPtSuffix > 0 ? maxPtSuffix + 1 : maxId + 1
      code = `PT${String(next)}`
    }

    if (!code) {
      res.status(400).json({ code: 400, msg: '新增失败：编码不能为空', data: null })
      return
    }

    // 编码唯一（仅在册）
    const dupReq = pool.request().input('code', sql.NVarChar(50), code)
    const dupRs = await dupReq.query(`
      SELECT COUNT(1) AS cnt
      FROM ${SYS_SETTLEMENT_METHOD_FROM} AS m
      WHERE (ISNULL(m.del, N'') = N'' OR m.del = N'0')
        AND LTRIM(RTRIM(ISNULL(m.code, N''))) = @code
    `)
    const dup = Number(dupRs.recordset?.[0]?.cnt ?? 0)
    if (dup > 0) {
      res.status(400).json({ code: 400, msg: `新增失败：编码「${code}」已存在`, data: null })
      return
    }

    const nowStr = formatBomColorcodeTimestamp()
    const actor = getActorAuditTripletFromReq(req)

    /** @type {Array<{ col: string, key: string, type: any, len?: number, value: any }>} */
    const fields = [
      { col: 'code', key: 'code', type: sql.NVarChar, len: 50, value: code },
      { col: 'name', key: 'name', type: sql.NVarChar, len: 200, value: name },
      { col: 'payfor', key: 'payfor', type: sql.NVarChar, len: 50, value: payfor },
      { col: 'info', key: 'info', type: sql.NVarChar, len: 500, value: info },
    ]

    /** @type {string[]} */
    const cols = []
    /** @type {string[]} */
    const vals = []
    const insReq = pool.request()

    for (const f of fields) {
      if (!colset.has(f.col.toLowerCase())) continue
      cols.push(f.col)
      vals.push(`@${f.key}`)
      insReq.input(f.key, f.type(f.len ?? 50), String(f.value ?? '').trim())
    }

    // 默认状态位
    if (colset.has('pass')) {
      cols.push('pass')
      vals.push("N'0'")
    }
    if (colset.has('del')) {
      cols.push('del')
      vals.push("N'0'")
    }

    // 审计字段（列存在才写）
    if (colset.has('uid') && actor.uidInt != null) {
      cols.push('uid')
      vals.push('@uid')
      insReq.input('uid', sql.Int, actor.uidInt)
    }
    if (colset.has('uname') && actor.uname) {
      cols.push('uname')
      vals.push('@uname')
      insReq.input('uname', sql.NVarChar(50), actor.uname)
    }
    if (colset.has('utruename') && actor.utruename) {
      cols.push('utruename')
      vals.push('@utruename')
      insReq.input('utruename', sql.NVarChar(50), actor.utruename)
    }
    if (colset.has('addtime')) {
      cols.push('addtime')
      vals.push('@addtime')
      insReq.input('addtime', sql.NVarChar(50), nowStr)
    }

    if (!cols.length) {
      res.status(500).json({ code: 500, msg: '新增失败：未探测到可写入的列（请检查 System_settlement_method 表结构）', data: null })
      return
    }

    const r = await insReq.query(`
      INSERT INTO ${SYS_SETTLEMENT_METHOD_FROM} (${cols.join(', ')})
      VALUES (${vals.join(', ')})
    `)
    const ok = (r.rowsAffected?.[0] ?? 0) > 0
    if (!ok) {
      res.status(500).json({ code: 500, msg: '新增失败：数据库未写入记录', data: null })
      return
    }
    res.json({ code: 200, msg: 'success', data: null })
  } catch (err) {
    console.error('POST /api/supply-chain/settlement-methods 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库写入失败')
    res.status(500).json({ code: 500, msg: `新增结算方式失败：${detail}`, data: null })
  }
})

/**
 * 结算方式：编辑（仅未审核且在册可改）
 * PUT /api/supply-chain/settlement-methods
 * body: { id, code, name, payfor, info? } —— code 只读，不允许修改
 */
app.put('/api/supply-chain/settlement-methods', async (req, res) => {
  try {
    const body = req.body ?? {}
    const id = Number(body.id)
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ code: 400, msg: '参数错误：id 必须为正整数', data: null })
      return
    }
    const code = String(body.code ?? '').trim()
    const name = String(body.name ?? '').trim()
    const payfor = String(body.payfor ?? '').trim()
    const info = String(body.info ?? '').trim()
    if (!code) {
      res.status(400).json({ code: 400, msg: '保存失败：编码不能为空', data: null })
      return
    }
    if (!name) {
      res.status(400).json({ code: 400, msg: '保存失败：名称不能为空', data: null })
      return
    }
    if (!payfor) {
      res.status(400).json({ code: 400, msg: '保存失败：天数不能为空', data: null })
      return
    }

    const pool = await getPool()
    const colset = await getSystemSettlementMethodColumnSet(pool)
    const nowStr = formatBomColorcodeTimestamp()
    const actor = getActorAuditTripletFromReq(req)

    // 编码唯一（仅在册，排除自己）
    const dupReq = pool
      .request()
      .input('id', sql.Int, id)
      .input('code', sql.NVarChar(50), code)
    const dupRs = await dupReq.query(`
      SELECT COUNT(1) AS cnt
      FROM ${SYS_SETTLEMENT_METHOD_FROM} AS m
      WHERE (ISNULL(m.del, N'') = N'' OR m.del = N'0')
        AND LTRIM(RTRIM(ISNULL(m.code, N''))) = @code
        AND m.id <> @id
    `)
    const dup = Number(dupRs.recordset?.[0]?.cnt ?? 0)
    if (dup > 0) {
      res.status(400).json({ code: 400, msg: `保存失败：编码「${code}」已存在`, data: null })
      return
    }

    /** @type {Array<{ col: string, key: string, type: any, len?: number, value: any }>} */
    const fields = [
      { col: 'name', key: 'name', type: sql.NVarChar, len: 200, value: name },
      { col: 'payfor', key: 'payfor', type: sql.NVarChar, len: 50, value: payfor },
      { col: 'info', key: 'info', type: sql.NVarChar, len: 500, value: info },
    ]

    /** @type {string[]} */
    const setParts = []
    const updReq = pool.request().input('id', sql.Int, id)
    for (const f of fields) {
      if (!colset.has(f.col.toLowerCase())) continue
      setParts.push(`${f.col} = @${f.key}`)
      updReq.input(f.key, f.type(f.len ?? 50), String(f.value ?? '').trim())
    }

    if (colset.has('uid') && actor.uidInt != null) {
      setParts.push('uid = @uid')
      updReq.input('uid', sql.Int, actor.uidInt)
    }
    if (colset.has('uname') && actor.uname) {
      setParts.push('uname = @uname')
      updReq.input('uname', sql.NVarChar(50), actor.uname)
    }
    if (colset.has('utruename') && actor.utruename) {
      setParts.push('utruename = @utruename')
      updReq.input('utruename', sql.NVarChar(50), actor.utruename)
    }
    if (colset.has('edittime')) {
      setParts.push('edittime = @edittime')
      updReq.input('edittime', sql.NVarChar(50), nowStr)
    }

    if (!setParts.length) {
      res.status(400).json({ code: 400, msg: '保存失败：无可更新字段', data: null })
      return
    }

    const r = await updReq.query(`
      UPDATE ${SYS_SETTLEMENT_METHOD_FROM}
      SET ${setParts.join(', ')}
      WHERE id = @id
        AND (ISNULL(del, N'') = N'' OR del = N'0')
        AND LTRIM(RTRIM(ISNULL(pass, N''))) <> N'1'
    `)
    if ((r.rowsAffected?.[0] ?? 0) <= 0) {
      res.status(400).json({ code: 400, msg: '保存失败：已审核记录不可修改，或该记录已删除', data: null })
      return
    }
    res.json({ code: 200, msg: 'success', data: null })
  } catch (err) {
    console.error('PUT /api/supply-chain/settlement-methods 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `保存结算方式失败：${detail}`, data: null })
  }
})

/**
 * 结算方式：审核 / 反审 / 恢复 / 软删 / 彻底删除
 */
app.put('/api/supply-chain/settlement-methods/audit', async (req, res) => {
  try {
    const id = Number(req.body?.id)
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ code: 400, msg: '参数错误：id 必须为正整数', data: null })
      return
    }
    const pool = await getPool()
    const colset = await getSystemSettlementMethodColumnSet(pool)
    const nowStr = formatBomColorcodeTimestamp()
    const actor = getActorAuditTripletFromReq(req)
    const reqDb = pool.request().input('id', sql.Int, id)

    const setParts = ["pass = N'1'"]
    if (colset.has('edittime')) setParts.push('edittime = @edittime')
    if (colset.has('passtime')) setParts.push('passtime = @passtime')
    if (colset.has('passuid') && actor.uidInt != null) setParts.push('passuid = @passuid')
    if (colset.has('passuname') && actor.uname) setParts.push('passuname = @passuname')
    if (colset.has('passutruename') && actor.utruename) setParts.push('passutruename = @passutruename')
    if (colset.has('passip')) setParts.push('passip = @passip')

    if (colset.has('edittime')) reqDb.input('edittime', sql.NVarChar(50), nowStr)
    if (colset.has('passtime')) reqDb.input('passtime', sql.NVarChar(50), nowStr)
    if (colset.has('passuid') && actor.uidInt != null) reqDb.input('passuid', sql.Int, actor.uidInt)
    if (colset.has('passuname') && actor.uname) reqDb.input('passuname', sql.NVarChar(50), actor.uname)
    if (colset.has('passutruename') && actor.utruename) reqDb.input('passutruename', sql.NVarChar(50), actor.utruename)
    if (colset.has('passip')) reqDb.input('passip', sql.NVarChar(64), getRequestIp(req))

    const r = await reqDb.query(`
      UPDATE ${SYS_SETTLEMENT_METHOD_FROM}
      SET ${setParts.join(', ')}
      WHERE id = @id AND (ISNULL(del, N'') = N'' OR del = N'0') AND LTRIM(RTRIM(ISNULL(pass, N''))) <> N'1'
    `)
    if ((r.rowsAffected?.[0] ?? 0) <= 0) {
      res.status(400).json({ code: 400, msg: '审核失败：请确认该记录在册且当前为未审核状态', data: null })
      return
    }
    res.json({ code: 200, msg: 'success', data: null })
  } catch (err) {
    console.error('PUT /api/supply-chain/settlement-methods/audit 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `审核结算方式失败：${detail}`, data: null })
  }
})

app.put('/api/supply-chain/settlement-methods/unaudit', async (req, res) => {
  try {
    const id = Number(req.body?.id)
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ code: 400, msg: '参数错误：id 必须为正整数', data: null })
      return
    }
    const pool = await getPool()
    const colset = await getSystemSettlementMethodColumnSet(pool)
    const nowStr = formatBomColorcodeTimestamp()
    const reqDb = pool.request().input('id', sql.Int, id)

    const setParts = ["pass = N'0'"]
    if (colset.has('edittime')) setParts.push('edittime = @edittime')
    if (colset.has('passtime')) setParts.push('passtime = NULL')
    if (colset.has('passuid')) setParts.push('passuid = NULL')
    if (colset.has('passuname')) setParts.push('passuname = NULL')
    if (colset.has('passutruename')) setParts.push('passutruename = NULL')
    if (colset.has('passip')) setParts.push('passip = NULL')
    if (colset.has('edittime')) reqDb.input('edittime', sql.NVarChar(50), nowStr)

    const r = await reqDb.query(`
      UPDATE ${SYS_SETTLEMENT_METHOD_FROM}
      SET ${setParts.join(', ')}
      WHERE id = @id AND (ISNULL(del, N'') = N'' OR del = N'0') AND LTRIM(RTRIM(ISNULL(pass, N''))) = N'1'
    `)
    if ((r.rowsAffected?.[0] ?? 0) <= 0) {
      res.status(400).json({ code: 400, msg: '反审失败：请确认该记录在册且当前为已审核状态', data: null })
      return
    }
    res.json({ code: 200, msg: 'success', data: null })
  } catch (err) {
    console.error('PUT /api/supply-chain/settlement-methods/unaudit 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `反审结算方式失败：${detail}`, data: null })
  }
})

app.put('/api/supply-chain/settlement-methods/restore', async (req, res) => {
  try {
    const id = Number(req.body?.id)
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ code: 400, msg: '参数错误：id 必须为正整数', data: null })
      return
    }
    const pool = await getPool()
    const colset = await getSystemSettlementMethodColumnSet(pool)
    const nowStr = formatBomColorcodeTimestamp()
    const reqDb = pool.request().input('id', sql.Int, id)

    const setParts = ["del = N'0'"]
    if (colset.has('edittime')) setParts.push('edittime = @edittime')
    if (colset.has('deltime')) setParts.push('deltime = NULL')
    if (colset.has('edittime')) reqDb.input('edittime', sql.NVarChar(50), nowStr)

    const r = await reqDb.query(`
      UPDATE ${SYS_SETTLEMENT_METHOD_FROM}
      SET ${setParts.join(', ')}
      WHERE id = @id AND LTRIM(RTRIM(ISNULL(del, N''))) = N'1'
    `)
    if ((r.rowsAffected?.[0] ?? 0) <= 0) {
      res.status(400).json({ code: 400, msg: '恢复失败：请确认该记录当前在回收站（del=1）', data: null })
      return
    }
    res.json({ code: 200, msg: 'success', data: null })
  } catch (err) {
    console.error('PUT /api/supply-chain/settlement-methods/restore 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `恢复结算方式失败：${detail}`, data: null })
  }
})

app.delete('/api/supply-chain/settlement-methods/:id', async (req, res) => {
  try {
    const id = Number(req.params?.id)
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ code: 400, msg: '参数错误：id 必须为正整数', data: null })
      return
    }
    const pool = await getPool()
    const colset = await getSystemSettlementMethodColumnSet(pool)
    const nowStr = formatBomColorcodeTimestamp()
    const reqDb = pool.request().input('id', sql.Int, id)

    const setParts = ["del = N'1'"]
    if (colset.has('deltime')) setParts.push('deltime = @deltime')
    if (colset.has('deltime')) reqDb.input('deltime', sql.NVarChar(50), nowStr)

    const r = await reqDb.query(`
      UPDATE ${SYS_SETTLEMENT_METHOD_FROM}
      SET ${setParts.join(', ')}
      WHERE id = @id
        AND (ISNULL(del, N'') = N'' OR del = N'0')
        AND LTRIM(RTRIM(ISNULL(pass, N''))) <> N'1'
    `)
    if ((r.rowsAffected?.[0] ?? 0) <= 0) {
      res.status(400).json({ code: 400, msg: '删除失败：已审核记录不可删除，请先反审；或该记录已在回收站', data: null })
      return
    }
    res.json({ code: 200, msg: 'success', data: null })
  } catch (err) {
    console.error('DELETE /api/supply-chain/settlement-methods/:id 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `删除结算方式失败：${detail}`, data: null })
  }
})

/**
 * 结算方式：回收站彻底删除（物理删除，不可恢复）
 * DELETE /api/supply-chain/settlement-methods/:id/permanent
 * - 仅允许 del=1
 */
app.delete('/api/supply-chain/settlement-methods/:id/permanent', async (req, res) => {
  try {
    const id = Number(req.params?.id)
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ code: 400, msg: '参数错误：id 必须为正整数', data: null })
      return
    }
    const pool = await getPool()
    const r = await pool.request().input('id', sql.Int, id).query(`
      DELETE FROM ${SYS_SETTLEMENT_METHOD_FROM}
      WHERE id = @id AND LTRIM(RTRIM(ISNULL(del, N''))) = N'1'
    `)
    if ((r.rowsAffected?.[0] ?? 0) <= 0) {
      res.status(400).json({ code: 400, msg: '彻底删除失败：请确认该记录在回收站（del=1）', data: null })
      return
    }
    res.json({ code: 200, msg: 'success', data: null })
  } catch (err) {
    console.error('DELETE /api/supply-chain/settlement-methods/:id/permanent 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `彻底删除结算方式失败：${detail}`, data: null })
  }
})

/**
 * 库存基本资料：颜色编码分页列表（物理表 Bom_colorcode；SQL Server 2008 R2：ROW_NUMBER 分页）
 * GET /api/inventory/color-code/list
 * - 默认排序：物理列 `intime` DESC；列表 `in_time` 为 yyyy/M/d（月日不补零，如 2017/9/1）；keyword 对 code/name 参数化模糊（防注入）
 * - 过滤：在册 del + pass（与项目列表约定一致；若旧表无列需在库端补齐）
 * - 回收站：`recycled=1` 时仅查 `del=1`，不按 pass 过滤（仍支持 keyword）
 */
app.get('/api/inventory/color-code/list', async (req, res) => {
  try {
    const pool = await getPool()
    const page = Math.max(1, Number(req.query?.page ?? 1) || 1)
    const pageSizeRaw = Number(req.query?.pageSize ?? 20) || 20
    const pageSize = Math.min(100, Math.max(1, pageSizeRaw))

    const recycledRaw = String(req.query?.recycled ?? '').trim().toLowerCase()
    const recycled = recycledRaw === '1' || recycledRaw === 'true' || recycledRaw === 'yes'

    const passRaw = String(req.query?.pass ?? '1').trim()
    const pass = passRaw === '0' ? '0' : '1'

    const keywordRaw = String(req.query?.keyword ?? '').trim()
    const hasKeyword = keywordRaw.length > 0
    const kwPat = hasKeyword ? `%${escapeSqlLikePattern(keywordRaw)}%` : ''

    const whereBase = recycled
      ? `
      WHERE LTRIM(RTRIM(ISNULL(b.del, N''))) = N'1'
      ${hasKeyword ? ' AND (b.code LIKE @kw OR b.name LIKE @kw) ' : ''}
    `
      : `
      WHERE (ISNULL(b.del, N'') = N'' OR b.del = N'0')
        AND LTRIM(RTRIM(ISNULL(b.pass, N''))) = @pass
      ${hasKeyword ? ' AND (b.code LIKE @kw OR b.name LIKE @kw) ' : ''}
    `

    const countReq = pool.request()
    if (!recycled) countReq.input('pass', sql.NVarChar(10), pass)
    if (hasKeyword) countReq.input('kw', sql.NVarChar(200), kwPat)
    const totalRow = await countReq.query(`
      SELECT COUNT(1) AS total
      FROM ${BOM_COLORCODE_FROM} AS b
      ${whereBase}
    `)
    const total = Number(totalRow.recordset?.[0]?.total ?? 0)

    const safeOffset = (page - 1) * pageSize
    const startRow = safeOffset + 1
    const endRow = safeOffset + pageSize

    const listReq = pool.request()
    if (!recycled) listReq.input('pass', sql.NVarChar(10), pass)
    listReq.input('startRow', sql.Int, startRow)
    listReq.input('endRow', sql.Int, endRow)
    if (hasKeyword) listReq.input('kw', sql.NVarChar(200), kwPat)

    const listResult = await listReq.query(`
      SELECT
        x.code,
        x.name,
        x.ename,
        x.info,
        x.pass,
        x.del,
        x.in_time
      FROM (
        SELECT
          LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.code, N'')))) AS code,
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(b.name, N'')))) AS name,
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(b.ename, N'')))) AS ename,
          LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(b.info, N'')))) AS info,
          LTRIM(RTRIM(CONVERT(nvarchar(10), ISNULL(b.pass, N'')))) AS pass,
          LTRIM(RTRIM(CONVERT(nvarchar(10), ISNULL(b.del, N'')))) AS del,
          CASE
            WHEN b.intime IS NULL THEN N''
            ELSE
              CAST(YEAR(b.intime) AS nvarchar(4)) + N'/'
              + CAST(MONTH(b.intime) AS nvarchar(2)) + N'/'
              + CAST(DAY(b.intime) AS nvarchar(2))
          END AS in_time,
          ROW_NUMBER() OVER (ORDER BY b.intime DESC, b.code ASC) AS rn
        FROM ${BOM_COLORCODE_FROM} AS b
        ${whereBase}
      ) AS x
      WHERE x.rn BETWEEN @startRow AND @endRow
    `)

    const list = (listResult.recordset ?? []).map((row) => ({
      code: row.code != null ? String(row.code) : '',
      name: row.name != null ? String(row.name) : '',
      ename: row.ename != null ? String(row.ename) : '',
      info: row.info != null ? String(row.info) : '',
      pass: row.pass != null ? String(row.pass) : '',
      del: row.del != null ? String(row.del) : '',
      in_time: row.in_time != null ? String(row.in_time) : '',
    }))

    res.json({ code: 200, msg: 'success', data: { total, list, recycled } })
  } catch (err) {
    console.error('GET /api/inventory/color-code/list 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库查询失败')
    res.status(500).json({ code: 500, msg: `读取颜色编码列表失败：${detail}`, data: null })
  }
})

/**
 * 颜色编码新增：POST /api/inventory/color-code
 * body: { code, name, ename?, info? } — intime 为当天 00:00:00（datetime），与展示格式 yyyy/M/d（如 2017/9/1）一致；pass=0、del=0；在册唯一 code 校验
 * 审计字段 uid/uname/utruename 从登录态（req.user / token）自动填充，禁止前端传参覆盖（规则 16）
 */
app.post('/api/inventory/color-code', async (req, res) => {
  try {
    const body = req.body ?? {}
    const code = String(body.code ?? '').trim()
    const name = String(body.name ?? '').trim()
    const ename = String(body.ename ?? '').trim()
    const info = String(body.info ?? '').trim()

    if (!code) {
      res.status(400).json({ code: 400, msg: '颜色编码不能为空', data: null })
      return
    }
    if (!name) {
      res.status(400).json({ code: 400, msg: '编码名称（中文）不能为空', data: null })
      return
    }

    // 规则 16：uid/uname/utruename 由 businessAuditFields 从 req.user 统一取，禁止前端传参
    const { uidInt, uname: unameVal, utruename: utruenameVal } = getActorAuditTripletFromReq(req)
    if (uidInt == null) {
      res.status(401).json({ code: 401, msg: '无法识别当前操作员，请重新登录后再试', data: null })
      return
    }

    const pool = await getPool()

    const dupReq = pool.request()
    dupReq.input('code', sql.NVarChar(100), code)
    const dupRow = await dupReq.query(`
      SELECT COUNT(1) AS n
      FROM ${BOM_COLORCODE_FROM} AS b
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.code, N'')))) = @code
        AND (ISNULL(b.del, N'') = N'' OR b.del = N'0')
    `)
    const dupN = Number(dupRow.recordset?.[0]?.n ?? 0)
    if (dupN > 0) {
      res.status(400).json({ code: 400, msg: '颜色编码已存在，请勿重复添加', data: null })
      return
    }

    const ins = pool.request()
    ins.input('code', sql.NVarChar(100), code)
    ins.input('name', sql.NVarChar(200), name)
    ins.input('ename', sql.NVarChar(200), ename || null)
    ins.input('info', sql.NVarChar(500), info || null)
    ins.input('uid', sql.Int, uidInt)
    ins.input('uname', sql.NVarChar(50), unameVal)
    ins.input('utruename', sql.NVarChar(50), utruenameVal)
    const addtimeStr = formatBomColorcodeTimestamp()
    ins.input('addtime', sql.NVarChar(50), addtimeStr)
    ins.input('intime', sql.DateTime, bomColorcodeIntimeEntryDateTime())

    await ins.query(`
      INSERT INTO ${BOM_COLORCODE_FROM} (code, name, ename, info, intime, pass, del, uid, uname, utruename, addtime)
      VALUES (@code, @name, @ename, @info, @intime, N'0', N'0', @uid, @uname, @utruename, @addtime)
    `)

    const row = await fetchBomColorcodeByCode(pool, code)
    res.json({ code: 200, msg: 'success', data: row })
  } catch (err) {
    console.error('POST /api/inventory/color-code 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库写入失败')
    res.status(500).json({ code: 500, msg: `新增颜色编码失败：${detail}`, data: null })
  }
})

/**
 * 颜色编码保存（未审在册可改）：PUT /api/inventory/color-code
 * body: { code, name, ename?, info? } — 写入 edittime（格式同 addtime）；已审或已删禁止
 */
app.put('/api/inventory/color-code', async (req, res) => {
  try {
    const body = req.body ?? {}
    const code = String(body.code ?? '').trim()
    const name = String(body.name ?? '').trim()
    const ename = String(body.ename ?? '').trim()
    const info = String(body.info ?? '').trim()

    if (!code) {
      res.status(400).json({ code: 400, msg: '颜色编码不能为空', data: null })
      return
    }
    if (!name) {
      res.status(400).json({ code: 400, msg: '编码名称（中文）不能为空', data: null })
      return
    }

    const pool = await getPool()
    const existing = await fetchBomColorcodeByCode(pool, code)
    if (!existing || !legacyDeptRowIsActive(existing)) {
      res.status(404).json({ code: 404, msg: '未找到该颜色编码或已删除', data: null })
      return
    }
    if (legacyDeptPassIsAudited(existing.pass)) {
      res.status(400).json({ code: 400, msg: '已审核记录不可编辑，请先反审', data: null })
      return
    }

    const edittimeStr = formatBomColorcodeTimestamp()
    const q = pool.request()
    q.input('code', sql.NVarChar(100), code)
    q.input('name', sql.NVarChar(200), name)
    q.input('ename', sql.NVarChar(200), ename || null)
    q.input('info', sql.NVarChar(500), info || null)
    q.input('edittime', sql.NVarChar(50), edittimeStr)
    await q.query(`
      UPDATE b
      SET
        b.name = @name,
        b.ename = @ename,
        b.info = @info,
        b.edittime = @edittime
      FROM ${BOM_COLORCODE_FROM} AS b
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.code, N'')))) = @code
        AND (ISNULL(b.del, N'') = N'' OR b.del = N'0')
        AND LTRIM(RTRIM(ISNULL(b.pass, N''))) = N'0'
    `)

    const row = await fetchBomColorcodeByCode(pool, code)
    res.json({ code: 200, msg: 'success', data: row })
  } catch (err) {
    console.error('PUT /api/inventory/color-code 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `保存颜色编码失败：${detail}`, data: null })
  }
})

/**
 * 颜色编码审核：PUT /api/inventory/color-code/audit
 * body: { code } — 仅未审且在册可审；更新 pass + edittime（规则 16）
 */
app.put('/api/inventory/color-code/audit', async (req, res) => {
  try {
    const body = req.body ?? {}
    const code = String(body.code ?? '').trim()
    if (!code) {
      res.status(400).json({ code: 400, msg: 'code 不能为空', data: null })
      return
    }

    const pool = await getPool()
    const existing = await fetchBomColorcodeByCode(pool, code)
    if (!existing || !legacyDeptRowIsActive(existing)) {
      res.status(404).json({ code: 404, msg: '未找到该颜色编码或已删除', data: null })
      return
    }
    if (legacyDeptPassIsAudited(existing.pass)) {
      res.status(400).json({ code: 400, msg: '当前已是已审核状态', data: null })
      return
    }

    const edittimeStr = formatBomColorcodeTimestamp()
    const q = pool.request()
    q.input('code', sql.NVarChar(100), code)
    q.input('edittime', sql.NVarChar(50), edittimeStr)
    await q.query(`
      UPDATE b
      SET b.pass = N'1', b.edittime = @edittime
      FROM ${BOM_COLORCODE_FROM} AS b
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.code, N'')))) = @code
        AND (ISNULL(b.del, N'') = N'' OR b.del = N'0')
    `)

    const row = await fetchBomColorcodeByCode(pool, code)
    res.json({ code: 200, msg: 'success', data: row })
  } catch (err) {
    console.error('PUT /api/inventory/color-code/audit 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `审核失败：${detail}`, data: null })
  }
})

/**
 * 颜色编码反审：PUT /api/inventory/color-code/unaudit
 * body: { code }
 */
app.put('/api/inventory/color-code/unaudit', async (req, res) => {
  try {
    const body = req.body ?? {}
    const code = String(body.code ?? '').trim()
    if (!code) {
      res.status(400).json({ code: 400, msg: 'code 不能为空', data: null })
      return
    }

    const pool = await getPool()
    const existing = await fetchBomColorcodeByCode(pool, code)
    if (!existing || !legacyDeptRowIsActive(existing)) {
      res.status(404).json({ code: 404, msg: '未找到该颜色编码或已删除', data: null })
      return
    }
    if (!legacyDeptPassIsAudited(existing.pass)) {
      res.status(400).json({ code: 400, msg: '当前为未审核状态，无需反审', data: null })
      return
    }

    const edittimeStr = formatBomColorcodeTimestamp()
    const q = pool.request()
    q.input('code', sql.NVarChar(100), code)
    q.input('edittime', sql.NVarChar(50), edittimeStr)
    await q.query(`
      UPDATE b
      SET b.pass = N'0', b.edittime = @edittime
      FROM ${BOM_COLORCODE_FROM} AS b
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.code, N'')))) = @code
        AND (ISNULL(b.del, N'') = N'' OR b.del = N'0')
    `)

    const row = await fetchBomColorcodeByCode(pool, code)
    res.json({ code: 200, msg: 'success', data: row })
  } catch (err) {
    console.error('PUT /api/inventory/color-code/unaudit 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `反审失败：${detail}`, data: null })
  }
})

/**
 * 颜色编码恢复（取消逻辑删除）：PUT /api/inventory/color-code/restore
 * body: { code }
 */
app.put('/api/inventory/color-code/restore', async (req, res) => {
  try {
    const body = req.body ?? {}
    const code = String(body.code ?? '').trim()
    if (!code) {
      res.status(400).json({ code: 400, msg: 'code 不能为空', data: null })
      return
    }

    const pool = await getPool()
    const existing = await fetchBomColorcodeByCode(pool, code)
    if (!existing) {
      res.status(404).json({ code: 404, msg: '未找到该颜色编码', data: null })
      return
    }
    const delTrim = String(existing.del ?? '').trim()
    if (delTrim !== '1') {
      res.status(400).json({ code: 400, msg: '当前记录未处于已删除状态，无需恢复', data: null })
      return
    }

    const edittimeStr = formatBomColorcodeTimestamp()
    const q = pool.request()
    q.input('code', sql.NVarChar(100), code)
    q.input('edittime', sql.NVarChar(50), edittimeStr)
    await q.query(`
      UPDATE b
      SET b.del = N'0', b.edittime = @edittime
      FROM ${BOM_COLORCODE_FROM} AS b
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.code, N'')))) = @code
        AND LTRIM(RTRIM(ISNULL(b.del, N''))) = N'1'
    `)

    const row = await fetchBomColorcodeByCode(pool, code)
    res.json({ code: 200, msg: 'success', data: row })
  } catch (err) {
    console.error('PUT /api/inventory/color-code/restore 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `恢复失败：${detail}`, data: null })
  }
})

/**
 * 颜色编码彻底删除（物理删除，仅回收站 del=1）：DELETE /api/inventory/color-code/:code/permanent
 * - 必须晚于逻辑删除：仅当记录已在回收站方可执行，防止误删在册数据
 */
app.delete('/api/inventory/color-code/:code/permanent', async (req, res) => {
  try {
    const code = String(req.params.code ?? '').trim()
    if (!code) {
      res.status(400).json({ code: 400, msg: 'code 不合法', data: null })
      return
    }

    const pool = await getPool()
    const existing = await fetchBomColorcodeByCode(pool, code)
    if (!existing) {
      res.status(404).json({ code: 404, msg: '未找到该颜色编码', data: null })
      return
    }
    const delTrim = String(existing.del ?? '').trim()
    if (delTrim !== '1') {
      res.status(400).json({ code: 400, msg: '仅回收站中的记录可彻底删除，请先将记录移入回收站', data: null })
      return
    }

    const q = pool.request()
    q.input('code', sql.NVarChar(100), code)
    const delResult = await q.query(`
      DELETE FROM b
      FROM ${BOM_COLORCODE_FROM} AS b
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.code, N'')))) = @code
        AND LTRIM(RTRIM(ISNULL(b.del, N''))) = N'1'
    `)

    const affected = Array.isArray(delResult.rowsAffected)
      ? Number(delResult.rowsAffected[0] ?? 0)
      : Number(delResult.rowsAffected ?? 0)
    if (!Number.isFinite(affected) || affected < 1) {
      res.status(404).json({ code: 404, msg: '未找到可彻底删除的回收站记录', data: null })
      return
    }

    res.json({ code: 200, msg: 'success', data: { code } })
  } catch (err) {
    console.error('DELETE /api/inventory/color-code/:code/permanent 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库删除失败')
    res.status(500).json({ code: 500, msg: `彻底删除失败：${detail}`, data: null })
  }
})

/**
 * 颜色编码逻辑删除：DELETE /api/inventory/color-code/:code
 * - 已审核禁止（与部门资料一致）
 */
app.delete('/api/inventory/color-code/:code', async (req, res) => {
  try {
    const code = String(req.params.code ?? '').trim()
    if (!code) {
      res.status(400).json({ code: 400, msg: 'code 不合法', data: null })
      return
    }
    if (code.toLowerCase() === 'list') {
      res.status(400).json({ code: 400, msg: '非法的颜色编码（保留字 list）', data: null })
      return
    }

    const pool = await getPool()
    const existing = await fetchBomColorcodeByCode(pool, code)
    if (!existing || !legacyDeptRowIsActive(existing)) {
      res.status(404).json({ code: 404, msg: '未找到该颜色编码或已删除', data: null })
      return
    }
    if (legacyDeptPassIsAudited(existing.pass)) {
      res.status(400).json({ code: 400, msg: HR_STAFF_AUDIT_LOCK_MSG, data: null })
      return
    }

    const deltimeStr = formatBomColorcodeTimestamp()
    const q = pool.request()
    q.input('code', sql.NVarChar(100), code)
    q.input('deltime', sql.NVarChar(50), deltimeStr)
    await q.query(`
      UPDATE b
      SET b.del = N'1', b.deltime = @deltime
      FROM ${BOM_COLORCODE_FROM} AS b
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(b.code, N'')))) = @code
        AND (ISNULL(b.del, N'') = N'' OR b.del = N'0')
    `)

    res.json({ code: 200, msg: 'success', data: { code } })
  } catch (err) {
    console.error('DELETE /api/inventory/color-code/:code 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `删除失败：${detail}`, data: null })
  }
})

/**
 * 库存基本资料：使用单位分页列表（物理表 Bom_unit；SQL Server 2008 R2：ROW_NUMBER）
 * GET /api/inventory/units/list
 * - 在册：`del` 在册 + `pass`；回收站 `recycled=1` 仅 `del=1`；keyword 对 name/info 参数化 LIKE
 * - 排序：`id DESC`
 */
app.get('/api/inventory/units/list', async (req, res) => {
  try {
    const pool = await getPool()
    const page = Math.max(1, Number(req.query?.page ?? 1) || 1)
    const pageSizeRaw = Number(req.query?.pageSize ?? 20) || 20
    const pageSize = Math.min(100, Math.max(1, pageSizeRaw))

    const recycledRaw = String(req.query?.recycled ?? '').trim().toLowerCase()
    const recycled = recycledRaw === '1' || recycledRaw === 'true' || recycledRaw === 'yes'

    const passRaw = String(req.query?.pass ?? '1').trim()
    const pass = passRaw === '0' ? '0' : '1'

    const keywordRaw = String(req.query?.keyword ?? '').trim()
    const hasKeyword = keywordRaw.length > 0
    const kwPat = hasKeyword ? `%${escapeSqlLikePattern(keywordRaw)}%` : ''

    const whereBase = recycled
      ? `
      WHERE LTRIM(RTRIM(ISNULL(u.del, N''))) = N'1'
      ${hasKeyword ? ' AND (u.name LIKE @kw OR u.info LIKE @kw) ' : ''}
    `
      : `
      WHERE (ISNULL(u.del, N'') = N'' OR u.del = N'0')
        AND LTRIM(RTRIM(ISNULL(u.pass, N''))) = @pass
      ${hasKeyword ? ' AND (u.name LIKE @kw OR u.info LIKE @kw) ' : ''}
    `

    const countReq = pool.request()
    if (!recycled) countReq.input('pass', sql.NVarChar(10), pass)
    if (hasKeyword) countReq.input('kw', sql.NVarChar(200), kwPat)
    const totalRow = await countReq.query(`
      SELECT COUNT(1) AS total
      FROM ${BOM_UNIT_FROM} AS u
      ${whereBase}
    `)
    const total = Number(totalRow.recordset?.[0]?.total ?? 0)

    const safeOffset = (page - 1) * pageSize
    const startRow = safeOffset + 1
    const endRow = safeOffset + pageSize

    const listReq = pool.request()
    if (!recycled) listReq.input('pass', sql.NVarChar(10), pass)
    listReq.input('startRow', sql.Int, startRow)
    listReq.input('endRow', sql.Int, endRow)
    if (hasKeyword) listReq.input('kw', sql.NVarChar(200), kwPat)

    const listResult = await listReq.query(`
      SELECT x.id, x.name, x.info, x.pass, x.del
      FROM (
        SELECT
          u.id,
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(u.name, N'')))) AS name,
          LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(u.info, N'')))) AS info,
          LTRIM(RTRIM(CONVERT(nvarchar(10), ISNULL(u.pass, N'')))) AS pass,
          LTRIM(RTRIM(CONVERT(nvarchar(10), ISNULL(u.del, N'')))) AS del,
          ROW_NUMBER() OVER (ORDER BY u.id DESC) AS rn
        FROM ${BOM_UNIT_FROM} AS u
        ${whereBase}
      ) AS x
      WHERE x.rn BETWEEN @startRow AND @endRow
    `)

    const list = (listResult.recordset ?? []).map((row) => ({
      id: row.id != null ? Number(row.id) : 0,
      name: row.name != null ? String(row.name) : '',
      info: row.info != null ? String(row.info) : '',
      pass: row.pass != null ? String(row.pass) : '',
      del: row.del != null ? String(row.del) : '',
    }))

    res.json({ code: 200, msg: 'success', data: { total, list, recycled } })
  } catch (err) {
    console.error('GET /api/inventory/units/list 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库查询失败')
    res.status(500).json({ code: 500, msg: `读取使用单位列表失败：${detail}`, data: null })
  }
})

/**
 * 使用单位新增：POST /api/inventory/units
 * body: { name, info? } — pass=0、del=0（id 由库端自增）；规则 16：uid/uname/utruename、addtime
 */
app.post('/api/inventory/units', async (req, res) => {
  try {
    const body = req.body ?? {}
    const name = String(body.name ?? '').trim()
    const info = String(body.info ?? '').trim()

    if (!name) {
      res.status(400).json({ code: 400, msg: '名称不能为空', data: null })
      return
    }

    const { uidInt, uname, utruename } = getActorAuditTripletFromReq(req)
    if (uidInt == null) {
      res.status(401).json({ code: 401, msg: '无法识别当前操作员，请重新登录后再试', data: null })
      return
    }

    const pool = await getPool()
    const ins = pool.request()
    ins.input('name', sql.NVarChar(200), name)
    ins.input('info', sql.NVarChar(500), info || null)
    ins.input('uid', sql.Int, uidInt)
    ins.input('uname', sql.NVarChar(50), uname)
    ins.input('utruename', sql.NVarChar(50), utruename)
    const addtimeStr = formatBomColorcodeTimestamp()
    ins.input('addtime', sql.NVarChar(50), addtimeStr)

    const out = await ins.query(`
      INSERT INTO ${BOM_UNIT_FROM} (name, info, pass, del, uid, uname, utruename, addtime)
      OUTPUT INSERTED.id AS id
      VALUES (@name, @info, N'0', N'0', @uid, @uname, @utruename, @addtime)
    `)

    const newId = Number(out.recordset?.[0]?.id ?? 0)
    if (!Number.isFinite(newId) || newId <= 0) {
      res.status(500).json({ code: 500, msg: '新增成功但未返回主键 id', data: null })
      return
    }

    const row = await fetchBomUnitById(pool, newId)
    res.json({ code: 200, msg: 'success', data: row })
  } catch (err) {
    console.error('POST /api/inventory/units 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库写入失败')
    res.status(500).json({ code: 500, msg: `新增使用单位失败：${detail}`, data: null })
  }
})

/**
 * 使用单位审核：PUT /api/inventory/units/audit
 * body: { id }
 */
app.put('/api/inventory/units/audit', async (req, res) => {
  try {
    const body = req.body ?? {}
    const id = Number(body.id)
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ code: 400, msg: 'id 不合法', data: null })
      return
    }

    const pool = await getPool()
    const existing = await fetchBomUnitById(pool, id)
    if (!existing || !legacyDeptRowIsActive(existing)) {
      res.status(404).json({ code: 404, msg: '未找到该使用单位或已删除', data: null })
      return
    }
    if (legacyDeptPassIsAudited(existing.pass)) {
      res.status(400).json({ code: 400, msg: '当前已是已审核状态', data: null })
      return
    }

    const edittimeStr = formatBomColorcodeTimestamp()
    const q = pool.request()
    q.input('id', sql.Int, id)
    q.input('edittime', sql.NVarChar(50), edittimeStr)
    await q.query(`
      UPDATE u
      SET u.pass = N'1', u.edittime = @edittime
      FROM ${BOM_UNIT_FROM} AS u
      WHERE u.id = @id
        AND (ISNULL(u.del, N'') = N'' OR u.del = N'0')
    `)

    const row = await fetchBomUnitById(pool, id)
    res.json({ code: 200, msg: 'success', data: row })
  } catch (err) {
    console.error('PUT /api/inventory/units/audit 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `审核失败：${detail}`, data: null })
  }
})

/**
 * 使用单位反审：PUT /api/inventory/units/unaudit
 * body: { id }
 */
app.put('/api/inventory/units/unaudit', async (req, res) => {
  try {
    const body = req.body ?? {}
    const id = Number(body.id)
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ code: 400, msg: 'id 不合法', data: null })
      return
    }

    const pool = await getPool()
    const existing = await fetchBomUnitById(pool, id)
    if (!existing || !legacyDeptRowIsActive(existing)) {
      res.status(404).json({ code: 404, msg: '未找到该使用单位或已删除', data: null })
      return
    }
    if (!legacyDeptPassIsAudited(existing.pass)) {
      res.status(400).json({ code: 400, msg: '当前为未审核状态，无需反审', data: null })
      return
    }

    const edittimeStr = formatBomColorcodeTimestamp()
    const q = pool.request()
    q.input('id', sql.Int, id)
    q.input('edittime', sql.NVarChar(50), edittimeStr)
    await q.query(`
      UPDATE u
      SET u.pass = N'0', u.edittime = @edittime
      FROM ${BOM_UNIT_FROM} AS u
      WHERE u.id = @id
        AND (ISNULL(u.del, N'') = N'' OR u.del = N'0')
    `)

    const row = await fetchBomUnitById(pool, id)
    res.json({ code: 200, msg: 'success', data: row })
  } catch (err) {
    console.error('PUT /api/inventory/units/unaudit 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `反审失败：${detail}`, data: null })
  }
})

/**
 * 使用单位恢复：PUT /api/inventory/units/restore
 * body: { id }
 */
app.put('/api/inventory/units/restore', async (req, res) => {
  try {
    const body = req.body ?? {}
    const id = Number(body.id)
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ code: 400, msg: 'id 不合法', data: null })
      return
    }

    const pool = await getPool()
    const existing = await fetchBomUnitById(pool, id)
    if (!existing) {
      res.status(404).json({ code: 404, msg: '未找到该使用单位', data: null })
      return
    }
    const delTrim = String(existing.del ?? '').trim()
    if (delTrim !== '1') {
      res.status(400).json({ code: 400, msg: '当前记录未处于已删除状态，无需恢复', data: null })
      return
    }

    const edittimeStr = formatBomColorcodeTimestamp()
    const q = pool.request()
    q.input('id', sql.Int, id)
    q.input('edittime', sql.NVarChar(50), edittimeStr)
    await q.query(`
      UPDATE u
      SET u.del = N'0', u.edittime = @edittime
      FROM ${BOM_UNIT_FROM} AS u
      WHERE u.id = @id
        AND LTRIM(RTRIM(ISNULL(u.del, N''))) = N'1'
    `)

    const row = await fetchBomUnitById(pool, id)
    res.json({ code: 200, msg: 'success', data: row })
  } catch (err) {
    console.error('PUT /api/inventory/units/restore 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `恢复失败：${detail}`, data: null })
  }
})

/**
 * 使用单位逻辑删除：DELETE /api/inventory/units/:id
 * - 已审核禁止（与颜色编码一致）
 */
app.delete('/api/inventory/units/:id', async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ code: 400, msg: 'id 不合法', data: null })
      return
    }

    const pool = await getPool()
    const existing = await fetchBomUnitById(pool, id)
    if (!existing || !legacyDeptRowIsActive(existing)) {
      res.status(404).json({ code: 404, msg: '未找到该使用单位或已删除', data: null })
      return
    }
    if (legacyDeptPassIsAudited(existing.pass)) {
      res.status(400).json({ code: 400, msg: HR_STAFF_AUDIT_LOCK_MSG, data: null })
      return
    }

    const deltimeStr = formatBomColorcodeTimestamp()
    const q = pool.request()
    q.input('id', sql.Int, id)
    q.input('deltime', sql.NVarChar(50), deltimeStr)
    await q.query(`
      UPDATE u
      SET u.del = N'1', u.deltime = @deltime
      FROM ${BOM_UNIT_FROM} AS u
      WHERE u.id = @id
        AND (ISNULL(u.del, N'') = N'' OR u.del = N'0')
    `)

    res.json({ code: 200, msg: 'success', data: { id } })
  } catch (err) {
    console.error('DELETE /api/inventory/units/:id 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `删除失败：${detail}`, data: null })
  }
})

/**
 * 使用单位彻底删除（物理删除，仅回收站 del=1）：DELETE /api/inventory/units/:id/permanent
 */
app.delete('/api/inventory/units/:id/permanent', async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ code: 400, msg: 'id 不合法', data: null })
      return
    }

    const pool = await getPool()
    const existing = await fetchBomUnitById(pool, id)
    if (!existing) {
      res.status(404).json({ code: 404, msg: '未找到该使用单位', data: null })
      return
    }
    const delTrim = String(existing.del ?? '').trim()
    if (delTrim !== '1') {
      res.status(400).json({ code: 400, msg: '仅回收站中的记录可彻底删除，请先将记录移入回收站', data: null })
      return
    }

    const q = pool.request()
    q.input('id', sql.Int, id)
    const r = await q.query(`
      DELETE FROM u
      FROM ${BOM_UNIT_FROM} AS u
      WHERE u.id = @id
        AND LTRIM(RTRIM(ISNULL(u.del, N''))) = N'1'
    `)
    const affected = Array.isArray(r.rowsAffected) ? Number(r.rowsAffected[0] ?? 0) : 0
    if (!Number.isFinite(affected) || affected < 1) {
      res.status(404).json({ code: 404, msg: '未找到可彻底删除的回收站记录', data: null })
      return
    }

    res.json({ code: 200, msg: 'success', data: { id } })
  } catch (err) {
    console.error('DELETE /api/inventory/units/:id/permanent 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库删除失败')
    res.status(500).json({ code: 500, msg: `彻底删除失败：${detail}`, data: null })
  }
})

/**
 * 库存基本资料：单位转换率分页列表（物理表 Bom_unit_change；SQL Server 2008 R2：ROW_NUMBER）
 * GET /api/inventory/unit-conversion/list
 * - 在册：`del` 在册 + `pass`；回收站 `recycled=1` 仅 `del=1`；keyword 对 unit_name/unit_name_tow 参数化 LIKE
 * - 排序：`id DESC`
 */
app.get('/api/inventory/unit-conversion/list', async (req, res) => {
  try {
    const pool = await getPool()
    const page = Math.max(1, Number(req.query?.page ?? 1) || 1)
    const pageSizeRaw = Number(req.query?.pageSize ?? 20) || 20
    const pageSize = Math.min(100, Math.max(1, pageSizeRaw))

    const recycledRaw = String(req.query?.recycled ?? '').trim().toLowerCase()
    const recycled = recycledRaw === '1' || recycledRaw === 'true' || recycledRaw === 'yes'

    const passRaw = String(req.query?.pass ?? '1').trim()
    const pass = passRaw === '0' ? '0' : '1'

    const keywordRaw = String(req.query?.keyword ?? '').trim()
    const hasKeyword = keywordRaw.length > 0
    const kwPat = hasKeyword ? `%${escapeSqlLikePattern(keywordRaw)}%` : ''

    const whereBase = recycled
      ? `
      WHERE LTRIM(RTRIM(ISNULL(c.del, N''))) = N'1'
      ${hasKeyword ? ' AND (c.unit_name LIKE @kw OR c.unit_name_tow LIKE @kw) ' : ''}
    `
      : `
      WHERE (ISNULL(c.del, N'') = N'' OR c.del = N'0')
        AND LTRIM(RTRIM(ISNULL(c.pass, N''))) = @pass
      ${hasKeyword ? ' AND (c.unit_name LIKE @kw OR c.unit_name_tow LIKE @kw) ' : ''}
    `

    const countReq = pool.request()
    if (!recycled) countReq.input('pass', sql.NVarChar(10), pass)
    if (hasKeyword) countReq.input('kw', sql.NVarChar(200), kwPat)
    const totalRow = await countReq.query(`
      SELECT COUNT(1) AS total
      FROM ${BOM_UNIT_CHANGE_FROM} AS c
      ${whereBase}
    `)
    const total = Number(totalRow.recordset?.[0]?.total ?? 0)

    const safeOffset = (page - 1) * pageSize
    const startRow = safeOffset + 1
    const endRow = safeOffset + pageSize

    const listReq = pool.request()
    if (!recycled) listReq.input('pass', sql.NVarChar(10), pass)
    listReq.input('startRow', sql.Int, startRow)
    listReq.input('endRow', sql.Int, endRow)
    if (hasKeyword) listReq.input('kw', sql.NVarChar(200), kwPat)

    const listResult = await listReq.query(`
      SELECT
        x.id,
        x.unit_name,
        x.unit_name_tow,
        x.change_bl,
        x.pass,
        x.del
      FROM (
        SELECT
          c.id,
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.unit_name, N'')))) AS unit_name,
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(c.unit_name_tow, N'')))) AS unit_name_tow,
          LTRIM(RTRIM(CONVERT(nvarchar(50), ISNULL(c.change_bl, N'')))) AS change_bl,
          LTRIM(RTRIM(CONVERT(nvarchar(10), ISNULL(c.pass, N'')))) AS pass,
          LTRIM(RTRIM(CONVERT(nvarchar(10), ISNULL(c.del, N'')))) AS del,
          ROW_NUMBER() OVER (ORDER BY c.id DESC) AS rn
        FROM ${BOM_UNIT_CHANGE_FROM} AS c
        ${whereBase}
      ) AS x
      WHERE x.rn BETWEEN @startRow AND @endRow
    `)

    const list = (listResult.recordset ?? []).map((row) => ({
      id: row.id != null ? Number(row.id) : 0,
      unit_name: row.unit_name != null ? String(row.unit_name) : '',
      unit_name_tow: row.unit_name_tow != null ? String(row.unit_name_tow) : '',
      change_bl: row.change_bl != null ? String(row.change_bl) : '',
      pass: row.pass != null ? String(row.pass) : '',
      del: row.del != null ? String(row.del) : '',
    }))

    res.json({ code: 200, msg: 'success', data: { total, list, recycled } })
  } catch (err) {
    console.error('GET /api/inventory/unit-conversion/list 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库查询失败')
    res.status(500).json({ code: 500, msg: `读取单位转换率列表失败：${detail}`, data: null })
  }
})

/**
 * 单位转换率新增：POST /api/inventory/unit-conversion
 * body: { unit_name, unit_name_tow, change_bl } — pass=0、del=0（id 由库端自增）；规则 16：uid/uname/utruename、addtime
 */
app.post('/api/inventory/unit-conversion', async (req, res) => {
  try {
    const body = req.body ?? {}
    const unitName = String(body.unit_name ?? '').trim()
    const unitNameTow = String(body.unit_name_tow ?? '').trim()
    const changeBl = String(body.change_bl ?? '').trim()

    if (!unitName) {
      res.status(400).json({ code: 400, msg: '使用单位不能为空', data: null })
      return
    }
    if (!unitNameTow) {
      res.status(400).json({ code: 400, msg: '转换单位不能为空', data: null })
      return
    }
    if (!changeBl) {
      res.status(400).json({ code: 400, msg: '转换率不能为空', data: null })
      return
    }
    const changeBlNum = Number(changeBl)
    if (!Number.isFinite(changeBlNum) || changeBlNum <= 0) {
      res.status(400).json({ code: 400, msg: '转换率必须是大于 0 的数字（例如 0.99 / 1.25）', data: null })
      return
    }

    const { uidInt, uname, utruename } = getActorAuditTripletFromReq(req)
    if (uidInt == null) {
      res.status(401).json({ code: 401, msg: '无法识别当前操作员，请重新登录后再试', data: null })
      return
    }

    const pool = await getPool()
    const ins = pool.request()
    ins.input('unit_name', sql.NVarChar(200), unitName)
    ins.input('unit_name_tow', sql.NVarChar(200), unitNameTow)
    // 若库列为 numeric/decimal，必须用数值参数避免 nvarchar→numeric 转换报错
    ins.input('change_bl', sql.Decimal(18, 6), changeBlNum)
    ins.input('uid', sql.Int, uidInt)
    ins.input('uname', sql.NVarChar(50), uname)
    ins.input('utruename', sql.NVarChar(50), utruename)
    const addtimeStr = formatBomColorcodeTimestamp()
    ins.input('addtime', sql.NVarChar(50), addtimeStr)

    const out = await ins.query(`
      INSERT INTO ${BOM_UNIT_CHANGE_FROM} (
        unit_name, unit_name_tow, change_bl,
        pass, del,
        uid, uname, utruename, addtime
      )
      OUTPUT INSERTED.id AS id
      VALUES (
        @unit_name, @unit_name_tow, @change_bl,
        N'0', N'0',
        @uid, @uname, @utruename, @addtime
      )
    `)

    const newId = Number(out.recordset?.[0]?.id ?? 0)
    if (!Number.isFinite(newId) || newId <= 0) {
      res.status(500).json({ code: 500, msg: '新增成功但未返回主键 id', data: null })
      return
    }

    const row = await fetchBomUnitChangeById(pool, newId)
    res.json({ code: 200, msg: 'success', data: row })
  } catch (err) {
    console.error('POST /api/inventory/unit-conversion 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库写入失败')
    res.status(500).json({ code: 500, msg: `新增单位转换率失败：${detail}`, data: null })
  }
})

/**
 * 单位转换率审核：PUT /api/inventory/unit-conversion/audit
 * body: { id } — 更新 pass + edittime（规则 16）
 */
app.put('/api/inventory/unit-conversion/audit', async (req, res) => {
  try {
    const id = Number(req.body?.id)
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ code: 400, msg: 'id 不合法', data: null })
      return
    }

    const pool = await getPool()
    const existing = await fetchBomUnitChangeById(pool, id)
    if (!existing || !legacyDeptRowIsActive(existing)) {
      res.status(404).json({ code: 404, msg: '未找到该转换率或已删除', data: null })
      return
    }
    if (legacyDeptPassIsAudited(existing.pass)) {
      res.status(400).json({ code: 400, msg: '当前已是已审核状态', data: null })
      return
    }

    const edittimeStr = formatBomColorcodeTimestamp()
    const q = pool.request()
    q.input('id', sql.Int, id)
    q.input('edittime', sql.NVarChar(50), edittimeStr)
    await q.query(`
      UPDATE c
      SET c.pass = N'1', c.edittime = @edittime
      FROM ${BOM_UNIT_CHANGE_FROM} AS c
      WHERE c.id = @id
        AND (ISNULL(c.del, N'') = N'' OR c.del = N'0')
    `)

    const row = await fetchBomUnitChangeById(pool, id)
    res.json({ code: 200, msg: 'success', data: row })
  } catch (err) {
    console.error('PUT /api/inventory/unit-conversion/audit 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `审核失败：${detail}`, data: null })
  }
})

/**
 * 单位转换率反审：PUT /api/inventory/unit-conversion/unaudit
 * body: { id } — 更新 pass + edittime（规则 16）
 */
app.put('/api/inventory/unit-conversion/unaudit', async (req, res) => {
  try {
    const id = Number(req.body?.id)
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ code: 400, msg: 'id 不合法', data: null })
      return
    }

    const pool = await getPool()
    const existing = await fetchBomUnitChangeById(pool, id)
    if (!existing || !legacyDeptRowIsActive(existing)) {
      res.status(404).json({ code: 404, msg: '未找到该转换率或已删除', data: null })
      return
    }
    if (!legacyDeptPassIsAudited(existing.pass)) {
      res.status(400).json({ code: 400, msg: '当前为未审核状态，无需反审', data: null })
      return
    }

    const edittimeStr = formatBomColorcodeTimestamp()
    const q = pool.request()
    q.input('id', sql.Int, id)
    q.input('edittime', sql.NVarChar(50), edittimeStr)
    await q.query(`
      UPDATE c
      SET c.pass = N'0', c.edittime = @edittime
      FROM ${BOM_UNIT_CHANGE_FROM} AS c
      WHERE c.id = @id
        AND (ISNULL(c.del, N'') = N'' OR c.del = N'0')
    `)

    const row = await fetchBomUnitChangeById(pool, id)
    res.json({ code: 200, msg: 'success', data: row })
  } catch (err) {
    console.error('PUT /api/inventory/unit-conversion/unaudit 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `反审失败：${detail}`, data: null })
  }
})

/**
 * 单位转换率恢复：PUT /api/inventory/unit-conversion/restore
 * body: { id } — del=0 + edittime（规则 16）
 */
app.put('/api/inventory/unit-conversion/restore', async (req, res) => {
  try {
    const id = Number(req.body?.id)
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ code: 400, msg: 'id 不合法', data: null })
      return
    }

    const pool = await getPool()
    const existing = await fetchBomUnitChangeById(pool, id)
    if (!existing) {
      res.status(404).json({ code: 404, msg: '未找到该转换率', data: null })
      return
    }
    const delTrim = String(existing.del ?? '').trim()
    if (delTrim !== '1') {
      res.status(400).json({ code: 400, msg: '当前记录未处于已删除状态，无需恢复', data: null })
      return
    }

    const edittimeStr = formatBomColorcodeTimestamp()
    const q = pool.request()
    q.input('id', sql.Int, id)
    q.input('edittime', sql.NVarChar(50), edittimeStr)
    await q.query(`
      UPDATE c
      SET c.del = N'0', c.edittime = @edittime
      FROM ${BOM_UNIT_CHANGE_FROM} AS c
      WHERE c.id = @id
        AND LTRIM(RTRIM(ISNULL(c.del, N''))) = N'1'
    `)

    const row = await fetchBomUnitChangeById(pool, id)
    res.json({ code: 200, msg: 'success', data: row })
  } catch (err) {
    console.error('PUT /api/inventory/unit-conversion/restore 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `恢复失败：${detail}`, data: null })
  }
})

/**
 * 单位转换率逻辑删除：DELETE /api/inventory/unit-conversion/:id
 * - 已审核禁止（文案同员工档案锁定）；规则 16：deltime
 */
app.delete('/api/inventory/unit-conversion/:id', async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ code: 400, msg: 'id 不合法', data: null })
      return
    }

    const pool = await getPool()
    const existing = await fetchBomUnitChangeById(pool, id)
    if (!existing || !legacyDeptRowIsActive(existing)) {
      res.status(404).json({ code: 404, msg: '未找到该转换率或已删除', data: null })
      return
    }
    if (legacyDeptPassIsAudited(existing.pass)) {
      res.status(400).json({ code: 400, msg: HR_STAFF_AUDIT_LOCK_MSG, data: null })
      return
    }

    const deltimeStr = formatBomColorcodeTimestamp()
    const q = pool.request()
    q.input('id', sql.Int, id)
    q.input('deltime', sql.NVarChar(50), deltimeStr)
    await q.query(`
      UPDATE c
      SET c.del = N'1', c.deltime = @deltime
      FROM ${BOM_UNIT_CHANGE_FROM} AS c
      WHERE c.id = @id
        AND (ISNULL(c.del, N'') = N'' OR c.del = N'0')
    `)

    res.json({ code: 200, msg: 'success', data: { id } })
  } catch (err) {
    console.error('DELETE /api/inventory/unit-conversion/:id 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `删除失败：${detail}`, data: null })
  }
})

/**
 * 单位转换率彻底删除（物理删除，仅回收站 del=1）：DELETE /api/inventory/unit-conversion/:id/permanent
 */
app.delete('/api/inventory/unit-conversion/:id/permanent', async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ code: 400, msg: 'id 不合法', data: null })
      return
    }

    const pool = await getPool()
    const existing = await fetchBomUnitChangeById(pool, id)
    if (!existing) {
      res.status(404).json({ code: 404, msg: '未找到该单位转换率', data: null })
      return
    }
    const delTrim = String(existing.del ?? '').trim()
    if (delTrim !== '1') {
      res.status(400).json({ code: 400, msg: '仅回收站中的记录可彻底删除，请先将记录移入回收站', data: null })
      return
    }

    const q = pool.request()
    q.input('id', sql.Int, id)
    const r = await q.query(`
      DELETE FROM c
      FROM ${BOM_UNIT_CHANGE_FROM} AS c
      WHERE c.id = @id
        AND LTRIM(RTRIM(ISNULL(c.del, N''))) = N'1'
    `)
    const affected = Array.isArray(r.rowsAffected) ? Number(r.rowsAffected[0] ?? 0) : 0
    if (!Number.isFinite(affected) || affected < 1) {
      res.status(404).json({ code: 404, msg: '未找到可彻底删除的回收站记录', data: null })
      return
    }

    res.json({ code: 200, msg: 'success', data: { id } })
  } catch (err) {
    console.error('DELETE /api/inventory/unit-conversion/:id/permanent 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库删除失败')
    res.status(500).json({ code: 500, msg: `彻底删除失败：${detail}`, data: null })
  }
})

/**
 * 库存基本资料：材料分类分页列表（物理表 Bom_material；SQL Server 2008 R2：ROW_NUMBER）
 * GET /api/inventory/material-category/list
 * - 在册：`del` 在册 + `pass`；回收站 `recycled=1` 仅 `del=1`；keyword 对 code/name/customs_code 参数化 LIKE
 * - 排序：`id DESC`
 */
app.get('/api/inventory/material-category/list', async (req, res) => {
  try {
    const pool = await getPool()
    const page = Math.max(1, Number(req.query?.page ?? 1) || 1)
    const pageSizeRaw = Number(req.query?.pageSize ?? 20) || 20
    const pageSize = Math.min(100, Math.max(1, pageSizeRaw))

    const recycledRaw = String(req.query?.recycled ?? '').trim().toLowerCase()
    const recycled = recycledRaw === '1' || recycledRaw === 'true' || recycledRaw === 'yes'

    const passRaw = String(req.query?.pass ?? '1').trim()
    const pass = passRaw === '0' ? '0' : '1'

    const keywordRaw = String(req.query?.keyword ?? '').trim()
    const hasKeyword = keywordRaw.length > 0
    const kwPat = hasKeyword ? `%${escapeSqlLikePattern(keywordRaw)}%` : ''

    // 注意：customs_code 可能是 numeric（老库常见），直接 LIKE 会触发 nvarchar→numeric 隐式转换并报错
    const whereBase = recycled
      ? `
      WHERE LTRIM(RTRIM(ISNULL(m.del, N''))) = N'1'
      ${
        hasKeyword
          ? " AND (CONVERT(nvarchar(100), m.code) LIKE @kw OR CONVERT(nvarchar(200), m.name) LIKE @kw OR CONVERT(nvarchar(100), m.customs_code) LIKE @kw) "
          : ''
      }
    `
      : `
      WHERE (ISNULL(m.del, N'') = N'' OR m.del = N'0')
        AND LTRIM(RTRIM(ISNULL(m.pass, N''))) = @pass
      ${
        hasKeyword
          ? " AND (CONVERT(nvarchar(100), m.code) LIKE @kw OR CONVERT(nvarchar(200), m.name) LIKE @kw OR CONVERT(nvarchar(100), m.customs_code) LIKE @kw) "
          : ''
      }
    `

    const countReq = pool.request()
    if (!recycled) countReq.input('pass', sql.NVarChar(10), pass)
    if (hasKeyword) countReq.input('kw', sql.NVarChar(200), kwPat)
    const totalRow = await countReq.query(`
      SELECT COUNT(1) AS total
      FROM ${BOM_MATERIAL_FROM} AS m
      ${whereBase}
    `)
    const total = Number(totalRow.recordset?.[0]?.total ?? 0)

    const safeOffset = (page - 1) * pageSize
    const startRow = safeOffset + 1
    const endRow = safeOffset + pageSize

    const listReq = pool.request()
    if (!recycled) listReq.input('pass', sql.NVarChar(10), pass)
    listReq.input('startRow', sql.Int, startRow)
    listReq.input('endRow', sql.Int, endRow)
    if (hasKeyword) listReq.input('kw', sql.NVarChar(200), kwPat)

    const listResult = await listReq.query(`
      SELECT
        x.id,
        x.code,
        x.name,
        x.customs_code,
        x.stocks_in,
        x.stocks_out,
        x.pass,
        x.del
      FROM (
        SELECT
          m.id,
          LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(CONVERT(nvarchar(100), m.code), N'')))) AS code,
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(CONVERT(nvarchar(200), m.name), N'')))) AS name,
          CASE
            WHEN m.customs_code IS NULL THEN N''
            ELSE LTRIM(RTRIM(CONVERT(nvarchar(100), m.customs_code)))
          END AS customs_code,
          CASE
            WHEN m.stocks_in IS NULL THEN N''
            ELSE LTRIM(RTRIM(CONVERT(nvarchar(50), m.stocks_in)))
          END AS stocks_in,
          CASE
            WHEN m.stocks_out IS NULL THEN N''
            ELSE LTRIM(RTRIM(CONVERT(nvarchar(50), m.stocks_out)))
          END AS stocks_out,
          LTRIM(RTRIM(CONVERT(nvarchar(10), ISNULL(m.pass, N'')))) AS pass,
          LTRIM(RTRIM(CONVERT(nvarchar(10), ISNULL(m.del, N'')))) AS del,
          ROW_NUMBER() OVER (ORDER BY m.id DESC) AS rn
        FROM ${BOM_MATERIAL_FROM} AS m
        ${whereBase}
      ) AS x
      WHERE x.rn BETWEEN @startRow AND @endRow
    `)

    const list = (listResult.recordset ?? []).map((row) => ({
      id: row.id != null ? Number(row.id) : 0,
      code: row.code != null ? String(row.code) : '',
      name: row.name != null ? String(row.name) : '',
      customs_code: row.customs_code != null ? String(row.customs_code) : '',
      stocks_in: row.stocks_in != null ? String(row.stocks_in) : '',
      stocks_out: row.stocks_out != null ? String(row.stocks_out) : '',
      pass: row.pass != null ? String(row.pass) : '',
      del: row.del != null ? String(row.del) : '',
    }))

    res.json({ code: 200, msg: 'success', data: { total, list, recycled } })
  } catch (err) {
    console.error('GET /api/inventory/material-category/list 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库查询失败')
    res.status(500).json({ code: 500, msg: `读取材料分类列表失败：${detail}`, data: null })
  }
})

/**
 * 材料分类新增：POST /api/inventory/material-category
 * body: { code, name, customs_code?, stocks_in?, stocks_out? } — pass=0、del=0（id 由库端自增）；规则 16：uid/uname/utruename、addtime
 */
app.post('/api/inventory/material-category', async (req, res) => {
  try {
    const body = req.body ?? {}
    const code = String(body.code ?? '').trim()
    const name = String(body.name ?? '').trim()
    const customsCode = String(body.customs_code ?? '').trim()
    const stocksIn = String(body.stocks_in ?? '').trim()
    const stocksOut = String(body.stocks_out ?? '').trim()

    if (!code) {
      res.status(400).json({ code: 400, msg: '分类编码不能为空', data: null })
      return
    }
    if (!name) {
      res.status(400).json({ code: 400, msg: '分类名称不能为空', data: null })
      return
    }

    const stocksInNum = stocksIn ? Number(stocksIn) : null
    if (stocksIn && (!Number.isFinite(stocksInNum) || stocksInNum < 0)) {
      res.status(400).json({ code: 400, msg: '入库浮动率必须是数字（例如 0.05），且不能为负数', data: null })
      return
    }
    const stocksOutNum = stocksOut ? Number(stocksOut) : null
    if (stocksOut && (!Number.isFinite(stocksOutNum) || stocksOutNum < 0)) {
      res.status(400).json({ code: 400, msg: '出库浮动率必须是数字（例如 0.05），且不能为负数', data: null })
      return
    }

    const { uidInt, uname, utruename } = getActorAuditTripletFromReq(req)
    if (uidInt == null) {
      res.status(401).json({ code: 401, msg: '无法识别当前操作员，请重新登录后再试', data: null })
      return
    }

    const pool = await getPool()
    const ins = pool.request()
    ins.input('code', sql.NVarChar(100), code)
    ins.input('name', sql.NVarChar(200), name)
    ins.input('customs_code', sql.NVarChar(100), customsCode || null)
    // 若库列为 numeric/decimal，这里用数值参数避免 nvarchar→numeric 转换报错；若库列为 nvarchar 也可正常写入
    ins.input('stocks_in', sql.Decimal(18, 6), stocksInNum)
    ins.input('stocks_out', sql.Decimal(18, 6), stocksOutNum)
    ins.input('uid', sql.Int, uidInt)
    ins.input('uname', sql.NVarChar(50), uname)
    ins.input('utruename', sql.NVarChar(50), utruename)
    const addtimeStr = formatBomColorcodeTimestamp()
    ins.input('addtime', sql.NVarChar(50), addtimeStr)

    const out = await ins.query(`
      INSERT INTO ${BOM_MATERIAL_FROM} (
        code, name, customs_code, stocks_in, stocks_out,
        pass, del,
        uid, uname, utruename, addtime
      )
      OUTPUT INSERTED.id AS id
      VALUES (
        @code, @name, @customs_code, @stocks_in, @stocks_out,
        N'0', N'0',
        @uid, @uname, @utruename, @addtime
      )
    `)

    const newId = Number(out.recordset?.[0]?.id ?? 0)
    if (!Number.isFinite(newId) || newId <= 0) {
      res.status(500).json({ code: 500, msg: '新增成功但未返回主键 id', data: null })
      return
    }

    const row = await fetchBomMaterialById(pool, newId)
    res.json({ code: 200, msg: 'success', data: row })
  } catch (err) {
    console.error('POST /api/inventory/material-category 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库写入失败')
    res.status(500).json({ code: 500, msg: `新增材料分类失败：${detail}`, data: null })
  }
})

/**
 * 材料分类审核：PUT /api/inventory/material-category/audit
 * body: { id } — pass + edittime（规则 16）
 */
app.put('/api/inventory/material-category/audit', async (req, res) => {
  try {
    const id = Number(req.body?.id)
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ code: 400, msg: 'id 不合法', data: null })
      return
    }

    const pool = await getPool()
    const existing = await fetchBomMaterialById(pool, id)
    if (!existing || !legacyDeptRowIsActive(existing)) {
      res.status(404).json({ code: 404, msg: '未找到该材料分类或已删除', data: null })
      return
    }
    if (legacyDeptPassIsAudited(existing.pass)) {
      res.status(400).json({ code: 400, msg: '当前已是已审核状态', data: null })
      return
    }

    const edittimeStr = formatBomColorcodeTimestamp()
    const q = pool.request()
    q.input('id', sql.Int, id)
    q.input('edittime', sql.NVarChar(50), edittimeStr)
    await q.query(`
      UPDATE m
      SET m.pass = N'1', m.edittime = @edittime
      FROM ${BOM_MATERIAL_FROM} AS m
      WHERE m.id = @id
        AND (ISNULL(m.del, N'') = N'' OR m.del = N'0')
    `)

    const row = await fetchBomMaterialById(pool, id)
    res.json({ code: 200, msg: 'success', data: row })
  } catch (err) {
    console.error('PUT /api/inventory/material-category/audit 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `审核失败：${detail}`, data: null })
  }
})

/**
 * 材料分类反审：PUT /api/inventory/material-category/unaudit
 * body: { id } — pass + edittime（规则 16）
 */
app.put('/api/inventory/material-category/unaudit', async (req, res) => {
  try {
    const id = Number(req.body?.id)
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ code: 400, msg: 'id 不合法', data: null })
      return
    }

    const pool = await getPool()
    const existing = await fetchBomMaterialById(pool, id)
    if (!existing || !legacyDeptRowIsActive(existing)) {
      res.status(404).json({ code: 404, msg: '未找到该材料分类或已删除', data: null })
      return
    }
    if (!legacyDeptPassIsAudited(existing.pass)) {
      res.status(400).json({ code: 400, msg: '当前为未审核状态，无需反审', data: null })
      return
    }

    const edittimeStr = formatBomColorcodeTimestamp()
    const q = pool.request()
    q.input('id', sql.Int, id)
    q.input('edittime', sql.NVarChar(50), edittimeStr)
    await q.query(`
      UPDATE m
      SET m.pass = N'0', m.edittime = @edittime
      FROM ${BOM_MATERIAL_FROM} AS m
      WHERE m.id = @id
        AND (ISNULL(m.del, N'') = N'' OR m.del = N'0')
    `)

    const row = await fetchBomMaterialById(pool, id)
    res.json({ code: 200, msg: 'success', data: row })
  } catch (err) {
    console.error('PUT /api/inventory/material-category/unaudit 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `反审失败：${detail}`, data: null })
  }
})

/**
 * 材料分类恢复：PUT /api/inventory/material-category/restore
 * body: { id } — del=0 + edittime（规则 16）
 */
app.put('/api/inventory/material-category/restore', async (req, res) => {
  try {
    const id = Number(req.body?.id)
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ code: 400, msg: 'id 不合法', data: null })
      return
    }

    const pool = await getPool()
    const existing = await fetchBomMaterialById(pool, id)
    if (!existing) {
      res.status(404).json({ code: 404, msg: '未找到该材料分类', data: null })
      return
    }
    const delTrim = String(existing.del ?? '').trim()
    if (delTrim !== '1') {
      res.status(400).json({ code: 400, msg: '当前记录未处于已删除状态，无需恢复', data: null })
      return
    }

    const edittimeStr = formatBomColorcodeTimestamp()
    const q = pool.request()
    q.input('id', sql.Int, id)
    q.input('edittime', sql.NVarChar(50), edittimeStr)
    await q.query(`
      UPDATE m
      SET m.del = N'0', m.edittime = @edittime
      FROM ${BOM_MATERIAL_FROM} AS m
      WHERE m.id = @id
        AND LTRIM(RTRIM(ISNULL(m.del, N''))) = N'1'
    `)

    const row = await fetchBomMaterialById(pool, id)
    res.json({ code: 200, msg: 'success', data: row })
  } catch (err) {
    console.error('PUT /api/inventory/material-category/restore 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `恢复失败：${detail}`, data: null })
  }
})

/**
 * 材料分类逻辑删除：DELETE /api/inventory/material-category/:id
 * - 已审核禁止；规则 16：deltime
 */
app.delete('/api/inventory/material-category/:id', async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ code: 400, msg: 'id 不合法', data: null })
      return
    }

    const pool = await getPool()
    const existing = await fetchBomMaterialById(pool, id)
    if (!existing || !legacyDeptRowIsActive(existing)) {
      res.status(404).json({ code: 404, msg: '未找到该材料分类或已删除', data: null })
      return
    }
    if (legacyDeptPassIsAudited(existing.pass)) {
      res.status(400).json({ code: 400, msg: HR_STAFF_AUDIT_LOCK_MSG, data: null })
      return
    }

    const deltimeStr = formatBomColorcodeTimestamp()
    const q = pool.request()
    q.input('id', sql.Int, id)
    q.input('deltime', sql.NVarChar(50), deltimeStr)
    await q.query(`
      UPDATE m
      SET m.del = N'1', m.deltime = @deltime
      FROM ${BOM_MATERIAL_FROM} AS m
      WHERE m.id = @id
        AND (ISNULL(m.del, N'') = N'' OR m.del = N'0')
    `)

    res.json({ code: 200, msg: 'success', data: { id } })
  } catch (err) {
    console.error('DELETE /api/inventory/material-category/:id 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `删除失败：${detail}`, data: null })
  }
})

/**
 * 材料分类彻底删除（物理删除，仅回收站 del=1）：DELETE /api/inventory/material-category/:id/permanent
 */
app.delete('/api/inventory/material-category/:id/permanent', async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ code: 400, msg: 'id 不合法', data: null })
      return
    }

    const pool = await getPool()
    const existing = await fetchBomMaterialById(pool, id)
    if (!existing) {
      res.status(404).json({ code: 404, msg: '未找到该材料分类', data: null })
      return
    }
    const delTrim = String(existing.del ?? '').trim()
    if (delTrim !== '1') {
      res.status(400).json({ code: 400, msg: '仅回收站中的记录可彻底删除，请先将记录移入回收站', data: null })
      return
    }

    const q = pool.request()
    q.input('id', sql.Int, id)
    const r = await q.query(`
      DELETE FROM m
      FROM ${BOM_MATERIAL_FROM} AS m
      WHERE m.id = @id
        AND LTRIM(RTRIM(ISNULL(m.del, N''))) = N'1'
    `)
    const affected = Array.isArray(r.rowsAffected) ? Number(r.rowsAffected[0] ?? 0) : 0
    if (!Number.isFinite(affected) || affected < 1) {
      res.status(404).json({ code: 404, msg: '未找到可彻底删除的回收站记录', data: null })
      return
    }

    res.json({ code: 200, msg: 'success', data: { id } })
  } catch (err) {
    console.error('DELETE /api/inventory/material-category/:id/permanent 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库删除失败')
    res.status(500).json({ code: 500, msg: `彻底删除失败：${detail}`, data: null })
  }
})

/**
 * 库存基本资料：车间与部门编码分页列表（物理表 Bom_Stocks_workshop；SQL Server 2008 R2：ROW_NUMBER）
 * GET /api/inventory/workshop-dept/list
 * - 在册：`del` 在册 + `pass`；回收站 `recycled=1` 仅 `del=1`；keyword 对 code/name/info 参数化 LIKE
 * - 排序：`id DESC`
 */
app.get('/api/inventory/workshop-dept/list', async (req, res) => {
  try {
    const pool = await getPool()
    const page = Math.max(1, Number(req.query?.page ?? 1) || 1)
    const pageSizeRaw = Number(req.query?.pageSize ?? 20) || 20
    const pageSize = Math.min(100, Math.max(1, pageSizeRaw))

    const recycledRaw = String(req.query?.recycled ?? '').trim().toLowerCase()
    const recycled = recycledRaw === '1' || recycledRaw === 'true' || recycledRaw === 'yes'

    const passRaw = String(req.query?.pass ?? '1').trim()
    const pass = passRaw === '0' ? '0' : '1'

    const keywordRaw = String(req.query?.keyword ?? '').trim()
    const hasKeyword = keywordRaw.length > 0
    const kwPat = hasKeyword ? `%${escapeSqlLikePattern(keywordRaw)}%` : ''

    const whereBase = recycled
      ? `
      WHERE LTRIM(RTRIM(ISNULL(w.del, N''))) = N'1'
      ${hasKeyword ? ' AND (w.code LIKE @kw OR w.name LIKE @kw OR w.info LIKE @kw) ' : ''}
    `
      : `
      WHERE (ISNULL(w.del, N'') = N'' OR w.del = N'0')
        AND LTRIM(RTRIM(ISNULL(w.pass, N''))) = @pass
      ${hasKeyword ? ' AND (w.code LIKE @kw OR w.name LIKE @kw OR w.info LIKE @kw) ' : ''}
    `

    const countReq = pool.request()
    if (!recycled) countReq.input('pass', sql.NVarChar(10), pass)
    if (hasKeyword) countReq.input('kw', sql.NVarChar(200), kwPat)
    const totalRow = await countReq.query(`
      SELECT COUNT(1) AS total
      FROM ${BOM_STOCKS_WORKSHOP_FROM} AS w
      ${whereBase}
    `)
    const total = Number(totalRow.recordset?.[0]?.total ?? 0)

    const safeOffset = (page - 1) * pageSize
    const startRow = safeOffset + 1
    const endRow = safeOffset + pageSize

    const listReq = pool.request()
    if (!recycled) listReq.input('pass', sql.NVarChar(10), pass)
    listReq.input('startRow', sql.Int, startRow)
    listReq.input('endRow', sql.Int, endRow)
    if (hasKeyword) listReq.input('kw', sql.NVarChar(200), kwPat)

    const listResult = await listReq.query(`
      SELECT
        x.id,
        x.code,
        x.name,
        x.info,
        x.pass,
        x.del
      FROM (
        SELECT
          w.id,
          LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(w.code, N'')))) AS code,
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(w.name, N'')))) AS name,
          LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(w.info, N'')))) AS info,
          LTRIM(RTRIM(CONVERT(nvarchar(10), ISNULL(w.pass, N'')))) AS pass,
          LTRIM(RTRIM(CONVERT(nvarchar(10), ISNULL(w.del, N'')))) AS del,
          ROW_NUMBER() OVER (ORDER BY w.id DESC) AS rn
        FROM ${BOM_STOCKS_WORKSHOP_FROM} AS w
        ${whereBase}
      ) AS x
      WHERE x.rn BETWEEN @startRow AND @endRow
    `)

    const list = (listResult.recordset ?? []).map((row) => ({
      id: row.id != null ? Number(row.id) : 0,
      code: row.code != null ? String(row.code) : '',
      name: row.name != null ? String(row.name) : '',
      info: row.info != null ? String(row.info) : '',
      pass: row.pass != null ? String(row.pass) : '',
      del: row.del != null ? String(row.del) : '',
    }))

    res.json({ code: 200, msg: 'success', data: { total, list, recycled } })
  } catch (err) {
    console.error('GET /api/inventory/workshop-dept/list 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库查询失败')
    res.status(500).json({ code: 500, msg: `读取车间与部门编码列表失败：${detail}`, data: null })
  }
})

/**
 * 车间与部门编码新增：POST /api/inventory/workshop-dept
 * body: { code, name, info } — pass=0、del=0；规则 16：uid/uname/utruename、addtime
 */
app.post('/api/inventory/workshop-dept', async (req, res) => {
  try {
    const body = req.body ?? {}
    const code = String(body.code ?? '').trim()
    const name = String(body.name ?? '').trim()
    const info = String(body.info ?? '').trim()

    if (!code) {
      res.status(400).json({ code: 400, msg: '编码不能为空', data: null })
      return
    }
    if (!name) {
      res.status(400).json({ code: 400, msg: '名称不能为空', data: null })
      return
    }

    const { uidInt, uname, utruename } = getActorAuditTripletFromReq(req)
    if (uidInt == null) {
      res.status(401).json({ code: 401, msg: '无法识别当前操作员，请重新登录后再试', data: null })
      return
    }

    const pool = await getPool()

    // 唯一性校验：code 在 del=0 下不允许重复
    const ck = pool.request()
    ck.input('code', sql.NVarChar(100), code)
    const ex = await ck.query(`
      SELECT TOP (1) w.id
      FROM ${BOM_STOCKS_WORKSHOP_FROM} AS w
      WHERE LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(w.code, N'')))) = @code
        AND (ISNULL(w.del, N'') = N'' OR w.del = N'0')
    `)
    if (ex.recordset?.length) {
      res.status(400).json({ code: 400, msg: '车间与部门编码已存在，请勿重复添加', data: null })
      return
    }

    const ins = pool.request()
    ins.input('code', sql.NVarChar(100), code)
    ins.input('name', sql.NVarChar(200), name)
    ins.input('info', sql.NVarChar(500), info)
    ins.input('uid', sql.Int, uidInt)
    ins.input('uname', sql.NVarChar(50), uname)
    ins.input('utruename', sql.NVarChar(50), utruename)
    const addtimeStr = formatBomColorcodeTimestamp()
    ins.input('addtime', sql.NVarChar(50), addtimeStr)

    const out = await ins.query(`
      INSERT INTO ${BOM_STOCKS_WORKSHOP_FROM} (code, name, info, pass, del, uid, uname, utruename, addtime)
      OUTPUT INSERTED.id AS id
      VALUES (@code, @name, @info, N'0', N'0', @uid, @uname, @utruename, @addtime)
    `)
    const id = Number(out.recordset?.[0]?.id ?? 0) || 0
    const row = id ? await fetchBomStocksWorkshopById(pool, id) : null
    res.json({ code: 200, msg: 'success', data: row ?? { id } })
  } catch (err) {
    console.error('POST /api/inventory/workshop-dept 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库写入失败')
    res.status(500).json({ code: 500, msg: `新增失败：${detail}`, data: null })
  }
})

/** 车间与部门编码审核：PUT /api/inventory/workshop-dept/audit body:{id} — pass=1 + edittime */
app.put('/api/inventory/workshop-dept/audit', async (req, res) => {
  try {
    const id = Number(req.body?.id)
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ code: 400, msg: 'id 不合法', data: null })
      return
    }

    const pool = await getPool()
    const existing = await fetchBomStocksWorkshopById(pool, id)
    if (!existing || !legacyDeptRowIsActive(existing)) {
      res.status(404).json({ code: 404, msg: '未找到该记录或已删除', data: null })
      return
    }
    if (legacyDeptPassIsAudited(existing.pass)) {
      res.status(400).json({ code: 400, msg: '当前记录已审核，无需重复审核', data: null })
      return
    }

    const edittimeStr = formatBomColorcodeTimestamp()
    const q = pool.request()
    q.input('id', sql.Int, id)
    q.input('edittime', sql.NVarChar(50), edittimeStr)
    await q.query(`
      UPDATE w
      SET w.pass = N'1', w.edittime = @edittime
      FROM ${BOM_STOCKS_WORKSHOP_FROM} AS w
      WHERE w.id = @id
        AND (ISNULL(w.del, N'') = N'' OR w.del = N'0')
        AND LTRIM(RTRIM(ISNULL(w.pass, N''))) = N'0'
    `)

    const row = await fetchBomStocksWorkshopById(pool, id)
    res.json({ code: 200, msg: 'success', data: row })
  } catch (err) {
    console.error('PUT /api/inventory/workshop-dept/audit 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `审核失败：${detail}`, data: null })
  }
})

/** 车间与部门编码反审：PUT /api/inventory/workshop-dept/unaudit body:{id} — pass=0 + edittime */
app.put('/api/inventory/workshop-dept/unaudit', async (req, res) => {
  try {
    const id = Number(req.body?.id)
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ code: 400, msg: 'id 不合法', data: null })
      return
    }

    const pool = await getPool()
    const existing = await fetchBomStocksWorkshopById(pool, id)
    if (!existing || !legacyDeptRowIsActive(existing)) {
      res.status(404).json({ code: 404, msg: '未找到该记录或已删除', data: null })
      return
    }
    if (!legacyDeptPassIsAudited(existing.pass)) {
      res.status(400).json({ code: 400, msg: '当前记录未审核，无需反审', data: null })
      return
    }

    const edittimeStr = formatBomColorcodeTimestamp()
    const q = pool.request()
    q.input('id', sql.Int, id)
    q.input('edittime', sql.NVarChar(50), edittimeStr)
    await q.query(`
      UPDATE w
      SET w.pass = N'0', w.edittime = @edittime
      FROM ${BOM_STOCKS_WORKSHOP_FROM} AS w
      WHERE w.id = @id
        AND (ISNULL(w.del, N'') = N'' OR w.del = N'0')
        AND LTRIM(RTRIM(ISNULL(w.pass, N''))) = N'1'
    `)

    const row = await fetchBomStocksWorkshopById(pool, id)
    res.json({ code: 200, msg: 'success', data: row })
  } catch (err) {
    console.error('PUT /api/inventory/workshop-dept/unaudit 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `反审失败：${detail}`, data: null })
  }
})

/** 车间与部门编码恢复：PUT /api/inventory/workshop-dept/restore body:{id} — del=0 + edittime */
app.put('/api/inventory/workshop-dept/restore', async (req, res) => {
  try {
    const id = Number(req.body?.id)
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ code: 400, msg: 'id 不合法', data: null })
      return
    }

    const pool = await getPool()
    const existing = await fetchBomStocksWorkshopById(pool, id)
    if (!existing) {
      res.status(404).json({ code: 404, msg: '未找到该记录', data: null })
      return
    }
    const delTrim = String(existing.del ?? '').trim()
    if (delTrim !== '1') {
      res.status(400).json({ code: 400, msg: '当前记录未处于已删除状态，无需恢复', data: null })
      return
    }

    const edittimeStr = formatBomColorcodeTimestamp()
    const q = pool.request()
    q.input('id', sql.Int, id)
    q.input('edittime', sql.NVarChar(50), edittimeStr)
    await q.query(`
      UPDATE w
      SET w.del = N'0', w.edittime = @edittime
      FROM ${BOM_STOCKS_WORKSHOP_FROM} AS w
      WHERE w.id = @id
        AND LTRIM(RTRIM(ISNULL(w.del, N''))) = N'1'
    `)

    const row = await fetchBomStocksWorkshopById(pool, id)
    res.json({ code: 200, msg: 'success', data: row })
  } catch (err) {
    console.error('PUT /api/inventory/workshop-dept/restore 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `恢复失败：${detail}`, data: null })
  }
})

/**
 * 车间与部门编码逻辑删除：DELETE /api/inventory/workshop-dept/:id
 * - 已审核禁止；规则 16：deltime
 */
app.delete('/api/inventory/workshop-dept/:id', async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ code: 400, msg: 'id 不合法', data: null })
      return
    }

    const pool = await getPool()
    const existing = await fetchBomStocksWorkshopById(pool, id)
    if (!existing || !legacyDeptRowIsActive(existing)) {
      res.status(404).json({ code: 404, msg: '未找到该记录或已删除', data: null })
      return
    }
    if (legacyDeptPassIsAudited(existing.pass)) {
      res.status(400).json({ code: 400, msg: HR_STAFF_AUDIT_LOCK_MSG, data: null })
      return
    }

    const deltimeStr = formatBomColorcodeTimestamp()
    const q = pool.request()
    q.input('id', sql.Int, id)
    q.input('deltime', sql.NVarChar(50), deltimeStr)
    await q.query(`
      UPDATE w
      SET w.del = N'1', w.deltime = @deltime
      FROM ${BOM_STOCKS_WORKSHOP_FROM} AS w
      WHERE w.id = @id
        AND (ISNULL(w.del, N'') = N'' OR w.del = N'0')
    `)

    res.json({ code: 200, msg: 'success', data: { id } })
  } catch (err) {
    console.error('DELETE /api/inventory/workshop-dept/:id 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库更新失败')
    res.status(500).json({ code: 500, msg: `删除失败：${detail}`, data: null })
  }
})

/**
 * 车间与部门编码彻底删除（物理删除，仅回收站 del=1）：DELETE /api/inventory/workshop-dept/:id/permanent
 */
app.delete('/api/inventory/workshop-dept/:id/permanent', async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ code: 400, msg: 'id 不合法', data: null })
      return
    }

    const pool = await getPool()
    const existing = await fetchBomStocksWorkshopById(pool, id)
    if (!existing) {
      res.status(404).json({ code: 404, msg: '未找到该记录', data: null })
      return
    }
    const delTrim = String(existing.del ?? '').trim()
    if (delTrim !== '1') {
      res.status(400).json({ code: 400, msg: '仅回收站中的记录可彻底删除，请先将记录移入回收站', data: null })
      return
    }

    const q = pool.request()
    q.input('id', sql.Int, id)
    const r = await q.query(`
      DELETE FROM w
      FROM ${BOM_STOCKS_WORKSHOP_FROM} AS w
      WHERE w.id = @id
        AND LTRIM(RTRIM(ISNULL(w.del, N''))) = N'1'
    `)
    const affected = Array.isArray(r.rowsAffected) ? Number(r.rowsAffected[0] ?? 0) : 0
    if (!Number.isFinite(affected) || affected < 1) {
      res.status(404).json({ code: 404, msg: '未找到可彻底删除的回收站记录', data: null })
      return
    }

    res.json({ code: 200, msg: 'success', data: { id } })
  } catch (err) {
    console.error('DELETE /api/inventory/workshop-dept/:id/permanent 失败：', err)
    const detail = String(err?.message ?? err?.originalError?.message ?? '数据库删除失败')
    res.status(500).json({ code: 500, msg: `彻底删除失败：${detail}`, data: null })
  }
})

/**
 * v1.1.6：电费数据回滚（删除）
 * POST /api/dorm/delete-electric
 * body: { room_code, tj_date }
 */
app.post('/api/dorm/delete-electric', async (req, res) => {
  res.setHeader('X-ERP-Dormitory-Delete-Electric', 'v1.1.6')
  try {
    const body = req.body ?? {}
    const roomCode = String(body.room_code ?? '').trim()
    const tjDate = String(body.tj_date ?? '').trim()
    if (!roomCode) {
      res.status(400).json({ code: 400, msg: 'room_code（房间号）不能为空', data: null })
      return
    }
    if (!tjDate) {
      res.status(400).json({ code: 400, msg: 'tj_date（统计月份）不能为空', data: null })
      return
    }

    const pool = await getPool()
    const q = pool.request()
    q.input('room_code', sql.NVarChar(50), roomCode)
    q.input('tj_date', sql.NVarChar(50), tjDate)
    const r = await q.query(`
      DELETE FROM ${HR_ROOM_USE_FROM}
      WHERE LTRIM(RTRIM(ISNULL(room_code, N''))) = @room_code
        AND LTRIM(RTRIM(ISNULL(tj_date, N''))) = @tj_date
    `)
    const deleted = Array.isArray(r.rowsAffected) ? Number(r.rowsAffected[0] ?? 0) : 0

    const me = getCurrentUserFromReq(req)
    const uname = String(me?.userCode ?? me?.userName ?? '').trim() || '未知'
    await writeLog(req, '删除电费记录', `管理员 [${uname}] 删除了 [${roomCode}] [${tjDate}] 的电费记录`, {
      targetTable: 'Hr_room_use',
      pool,
    })

    res.json({ code: 200, msg: 'success', data: { deleted } })
  } catch (err) {
    console.error('POST /api/dorm/delete-electric 失败：', err)
    const detail = String(err?.message ?? '数据库删除失败')
    res.status(500).json({ code: 500, msg: `删除电费失败：${detail}`, data: null })
  }
})

/**
 * v1.1.5：电费管理中心 - 核算并落库 Hr_room_use
 * POST /api/hr/dormitory/electric/settle
 * body: { room_code, tj_date, c_this, price, change?, manual_electric? }
 */
app.post('/api/hr/dormitory/electric/settle', async (req, res) => {
  res.setHeader('X-ERP-Dormitory-Electric-Settle', 'v1.1.5')
  try {
    const body = req.body ?? {}
    const roomCode = String(body.room_code ?? '').trim()
    const tjDate = String(body.tj_date ?? '').trim()
    const cStarRaw = body.c_star
    const cOldEndRaw = body.c_old_end
    const cNewStarRaw = body.c_new_star
    const cThisRaw = body.c_this
    const changeFlag = String(body.change ?? '').trim() === '1' || body.change === true

    if (!roomCode) {
      res.status(400).json({ code: 400, msg: 'room_code（房号）不能为空', data: null })
      return
    }
    if (!tjDate) {
      res.status(400).json({ code: 400, msg: 'tj_date（统计月份）不能为空，例如 2026-4', data: null })
      return
    }

    const cThisNum = Number(cThisRaw)
    const cThis = Number.isFinite(cThisNum) && cThisNum >= 0 ? cThisNum : NaN
    if (!Number.isFinite(cThis)) {
      res.status(400).json({ code: 400, msg: 'c_this（本期读数）必须为非负数字', data: null })
      return
    }

    const pool = await getPool()

    // 上期读数（最近一条记录的 c_this）
    const lastReq = pool.request().input('roomCode', sql.NVarChar(50), roomCode)
    const lastRs = await lastReq.query(`
      SELECT TOP 1
        u.id,
        LTRIM(RTRIM(ISNULL(u.c_this, N''))) AS c_this
      FROM ${HR_ROOM_USE_FROM} AS u
      WHERE LTRIM(RTRIM(ISNULL(u.del, N'0'))) = N'0'
        AND LTRIM(RTRIM(ISNULL(u.room_code, N''))) = @roomCode
      ORDER BY u.id DESC
    `)
    const lastRow = lastRs.recordset?.[0] ?? null
    const lastReading = Number(String(lastRow?.c_this ?? '').trim() || '0')
    const lastReadingSafe = Number.isFinite(lastReading) ? lastReading : 0

    // 上期读数优先使用前端回填的 c_star；未传则回退最近一条 c_this
    const cStarNum = Number(cStarRaw)
    const cStar = Number.isFinite(cStarNum) && cStarNum >= 0 ? cStarNum : lastReadingSafe

    let usedElectric = 0
    if (changeFlag) {
      const cOldEndNum = Number(cOldEndRaw)
      const cOldEnd = Number.isFinite(cOldEndNum) && cOldEndNum >= 0 ? cOldEndNum : NaN
      if (!Number.isFinite(cOldEnd)) {
        res.status(400).json({ code: 400, msg: '已勾选“换表”时，c_old_end（旧表结束数）必须为非负数字', data: null })
        return
      }
      const cNewStarNum = Number(cNewStarRaw)
      const cNewStar = Number.isFinite(cNewStarNum) && cNewStarNum >= 0 ? cNewStarNum : NaN
      if (!Number.isFinite(cNewStar)) {
        res.status(400).json({ code: 400, msg: '已勾选“换表”时，c_new_star（新表开始数）必须为非负数字', data: null })
        return
      }
      usedElectric = (cOldEnd - cStar) + (cThis - cNewStar)
    } else {
      usedElectric = cThis - cStar
    }
    if (!Number.isFinite(usedElectric) || usedElectric < 0) {
      res.status(400).json({ code: 400, msg: '用电量计算结果不合法（本期读数不得小于上期读数）', data: null })
      return
    }

    const price = 0.93
    const totalMoney = usedElectric * price

    // 当前在住人员（分摊用）
    const occReq = pool.request().input('roomCode', sql.NVarChar(50), roomCode)
    const occRs = await occReq.query(`
      SELECT
        i.id,
        LTRIM(RTRIM(ISNULL(i.staff_code, N''))) AS staff_code,
        LTRIM(RTRIM(ISNULL(i.staff_truename, N''))) AS staff_truename,
        LTRIM(RTRIM(ISNULL(d.name, ISNULL(s.join_department, i.staff_bm_name)))) AS dept_name,
        LTRIM(RTRIM(ISNULL(i.electric, N''))) AS electric
      FROM ${HR_ROOM_IN_FROM} AS i
      INNER JOIN ${HR_STAFF_FROM} AS s
        ON LTRIM(RTRIM(ISNULL(s.new_code, N''))) = LTRIM(RTRIM(ISNULL(i.staff_code, N'')))
        AND LTRIM(RTRIM(ISNULL(s.del, N'0'))) = N'0'
        AND LTRIM(RTRIM(ISNULL(s.pass, N'0'))) = N'1'
      LEFT JOIN ${HR_LEGACY_DEPT_FROM} AS d
        ON LTRIM(RTRIM(ISNULL(d.code, N''))) = LTRIM(RTRIM(ISNULL(s.join_department, N'')))
      WHERE LTRIM(RTRIM(ISNULL(i.del, N'0'))) = N'0'
        AND LTRIM(RTRIM(ISNULL(i.out_room, N'0'))) = N'0'
        AND LTRIM(RTRIM(ISNULL(i.room_code, N''))) = @roomCode
      ORDER BY i.id DESC
    `)

    const occupants = (occRs.recordset ?? []).map((r) => {
      const disc = Number(String(r?.electric ?? '').trim() || '0')
      const discount = Number.isFinite(disc) && disc > 0 ? disc : 0
      return { ...r, electric_discount: discount }
    })
    if (!occupants.length) {
      res.status(400).json({ code: 400, msg: '该房间当前无在住人员，无法核算', data: null })
      return
    }

    const baseShare = occupants.length > 0 ? totalMoney / occupants.length : 0
    const avgEle = occupants.length > 0 ? usedElectric / occupants.length : 0
    const shares = occupants.map((p) => {
      const disc = Number(p.electric_discount ?? 0)
      const discount = Number.isFinite(disc) && disc >= 0 ? disc : 0
      const billedEle = Math.max(0, avgEle - discount)
      const money = billedEle * 0.93
      const safeMoney = Number.isFinite(money) && money >= 0 ? money : 0
      const floored = Math.floor(safeMoney * 100) / 100
      return { ...p, share_money: floored }
    })

    const discountTotal = shares.reduce((sum, r) => sum + Number(r?.electric_discount ?? 0), 0)

    const { UID, uname: auditUname } = getActorAuditFromReq(req)
    const me = getCurrentUserFromReq(req)
    const uidStr = UID != null ? String(UID) : ''
    const unameLegacy = String(me?.userCode ?? '').trim() || (auditUname != null ? String(auditUname).trim() : '')
    const nowStr = legacyDeptNowString()
    const ipStr = getRequestIp(req) || null

    const ins = pool.request()
    ins.input('room_code', sql.NVarChar(50), roomCode)
    ins.input('tj_date', sql.NVarChar(50), tjDate)
    ins.input('c_star', sql.NVarChar(50), String(cStar))
    ins.input('c_old_end', sql.NVarChar(50), changeFlag ? String(Number(cOldEndRaw ?? 0)) : null)
    ins.input('c_new_star', sql.NVarChar(50), changeFlag ? String(Number(cNewStarRaw ?? 0)) : null)
    ins.input('c_this', sql.NVarChar(50), String(cThis))
    ins.input('c_change', sql.NVarChar(50), changeFlag ? '1' : '0')
    ins.input('c_electric', sql.NVarChar(50), String(usedElectric))
    ins.input('c_money', sql.NVarChar(50), String(price))
    ins.input('c_yh_electric', sql.NVarChar(50), String(discountTotal))
    ins.input('c_sum_money', sql.NVarChar(50), String(Math.round(totalMoney * 100) / 100))
    ins.input('c_date', sql.NVarChar(50), nowStr)
    ins.input('uid', sql.NVarChar(50), uidStr || null)
    ins.input('uname', sql.NVarChar(50), unameLegacy || null)
    ins.input('addtime', sql.NVarChar(50), nowStr)
    ins.input('ip', sql.NVarChar(50), ipStr)

    const insRs = await ins.query(`
      INSERT INTO ${HR_ROOM_USE_FROM} (
        room_code, tj_date,
        c_star, c_old_end, c_new_star, c_this, c_change, c_electric, c_money, c_yh_electric, c_sum_money, c_date,
        uid, uname, addtime, ip,
        del, pass
      )
      VALUES (
        @room_code, @tj_date,
        @c_star, @c_old_end, @c_new_star, @c_this, @c_change, @c_electric, @c_money, @c_yh_electric, @c_sum_money, @c_date,
        @uid, @uname, @addtime, @ip,
        N'0', N'1'
      );
      SELECT SCOPE_IDENTITY() AS id;
    `)
    const newId = Number(insRs.recordset?.[0]?.id ?? 0)

    await writeLog(req, '电费核算', `管理员 [${unameLegacy || '未知'}] 完成了 [${roomCode}] 的电费核算`, {
      targetTable: 'Hr_room_use',
      pool,
    })

    res.json({
      code: 200,
      msg: 'success',
      data: {
        id: newId,
        room_code: roomCode,
        tj_date: tjDate,
        c_star: cStar,
        c_this: cThis,
        used_electric: usedElectric,
        price,
        total_money: Math.round(totalMoney * 100) / 100,
        discount_total: discountTotal,
        shares,
      },
    })
  } catch (err) {
    console.error('POST /api/hr/dormitory/electric/settle 失败：', err)
    const detail = String(err?.message ?? '数据库写入失败')
    res.status(500).json({ code: 500, msg: `电费核算失败：${detail}`, data: null })
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

    // 本月区间参数：用于“跨月在住”重叠判定（SQL Server 2008 R2 兼容）
    const mStart = range.mStart
    const mEnd = range.mEnd

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
              AND ${hrRoomDateTimeExprNullableSql('si.in_time')} < @mEnd
              AND (
                ${hrRoomDateTimeExprNullableSql("COALESCE(si.out_time2, si.out_time)")} IS NULL
                OR ${hrRoomDateTimeExprNullableSql("COALESCE(si.out_time2, si.out_time)")} >= @mStart
              )
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
    totalReq.input('mStart', sql.DateTime, mStart)
    totalReq.input('mEnd', sql.DateTime, mEnd)
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
    listReq.input('mStart', sql.DateTime, mStart)
    listReq.input('mEnd', sql.DateTime, mEnd)
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
                AND ${hrRoomDateTimeExprNullableSql('x.in_time')} < @mEnd
                AND (
                  ${hrRoomDateTimeExprNullableSql("COALESCE(x.out_time2, x.out_time)")} IS NULL
                  OR ${hrRoomDateTimeExprNullableSql("COALESCE(x.out_time2, x.out_time)")} >= @mStart
                )
                AND (
                  LTRIM(RTRIM(ISNULL(x.staff_code, N''))) <> N''
                  OR LTRIM(RTRIM(CONVERT(nvarchar(400), ISNULL(x.staff_truename, N'')))) <> N''
                )
              ORDER BY x.staff_code
              FOR XML PATH('')
            ), 1, 2, N'') AS names
          FROM ${HR_ROOM_IN_FROM} AS i
          WHERE LTRIM(RTRIM(ISNULL(i.del, N'0'))) = N'0'
            AND ${hrRoomDateTimeExprNullableSql('i.in_time')} < @mEnd
            AND (
              ${hrRoomDateTimeExprNullableSql("COALESCE(i.out_time2, i.out_time)")} IS NULL
              OR ${hrRoomDateTimeExprNullableSql("COALESCE(i.out_time2, i.out_time)")} >= @mStart
            )
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

/** 纸格资料导入：临时目录（不写 Bom_000 等业务表） */
ensurePaperPatternImportTmpDir()

const paperPatternImportUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, ensurePaperPatternImportTmpDir())
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(String(file.originalname || '')).toLowerCase()
      const fileId = crypto.randomUUID()
      cb(null, `${fileId}${ext}`)
    },
  }),
  limits: { files: 1, fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(String(file.originalname || '')).toLowerCase()
    if (ext === '.xls' || ext === '.xlsx') {
      cb(null, true)
    } else {
      cb(new Error('仅支持 Excel 文件'))
    }
  },
})

/**
 * POST /api/paper-pattern/import/upload
 * 与需求文档路径对应：工程内统一加 /api 前缀；multipart 字段名 file。
 */
app.post('/api/paper-pattern/import/upload', (req, res) => {
  paperPatternImportUpload.single('file')(req, res, (err) => {
    if (err) {
      const msg = String(err?.message ?? '')
      const excelOnly = msg.includes('仅支持 Excel')
      res.status(400).json({
        success: false,
        message: excelOnly ? '仅支持 Excel 文件' : msg || '上传失败',
      })
      return
    }
    if (!req.file) {
      res.json({ success: false, message: '请选择文件' })
      return
    }
    const storedName = req.file.filename
    const fileId = path.basename(storedName, path.extname(storedName))
    const fileName = decodePaperPatternUploadFileName(req.file.originalname || storedName)
    res.json({
      success: true,
      fileId,
      fileName,
    })
  })
})

/** 纸格导入：.xlsx / .xls，内存解析，返回临时 BOM 树（不写业务表） */
const paperPatternExcelMemoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(String(file.originalname || '')).toLowerCase()
    if (ext === '.xlsx' || ext === '.xls') {
      cb(null, true)
    } else {
      cb(new Error('仅允许上传 .xlsx 或 .xls 文件'))
    }
  },
})

/**
 * GET /api/paper-pattern/import-types
 * 纸格导入「导入类型」下拉：Bom_code（排除 id=1），展示 flag1(flag5)，取值为 flag5。
 */
app.get('/api/paper-pattern/import-types', async (req, res) => {
  try {
    const pool = await getPool()
    const r = await pool.request().query(`
      SELECT
        bc.id,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(bc.flag1, N'')))) AS flag1,
        LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(bc.flag5, N'')))) AS flag5
      FROM ${INV_BOM_CODE_FROM} AS bc
      WHERE bc.id <> 1
        AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(bc.flag5, N'')))) <> N''
      ORDER BY bc.id
    `)
    res.json({ success: true, items: r.recordset ?? [] })
  } catch (e) {
    console.error('GET /api/paper-pattern/import-types 失败：', e)
    res.status(500).json({ success: false, message: '读取导入类型失败' })
  }
})

/**
 * POST /api/paper-pattern/upload
 * multipart：file；importTypeFlag5（Bom_code.flag5）可选，未传时解析仍进行但 BOM 前缀为空，由前端「基础资料确认区」补选后实时生成编码。
 */
app.post('/api/paper-pattern/upload', (req, res) => {
  paperPatternExcelMemoryUpload.single('file')(req, res, async (err) => {
    if (err) {
      const msg = String(err?.message ?? '')
      const excelTypeReject = msg.includes('仅允许上传 .xlsx 或 .xls') || msg.includes('仅允许上传 .xlsx 文件')
      res.status(400).json({
        success: false,
        message: excelTypeReject ? '仅允许上传 .xlsx 或 .xls 文件' : msg || '上传失败',
      })
      return
    }
    if (!req.file?.buffer) {
      res.status(400).json({ success: false, message: '请选择文件' })
      return
    }
    const importTypeFlag5Raw = String(req.body?.importTypeFlag5 ?? '').trim()
    try {
      const pool = await getPool()
      let flag1 = ''
      let flag5 = ''
      if (importTypeFlag5Raw) {
        const vreq = pool.request()
        vreq.input('flag5', sql.NVarChar(200), importTypeFlag5Raw)
        const vr = await vreq.query(`
        SELECT TOP (1)
          bc.id,
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(bc.flag1, N'')))) AS flag1,
          LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(bc.flag5, N'')))) AS flag5
        FROM ${INV_BOM_CODE_FROM} AS bc
        WHERE bc.id <> 1
          AND LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(bc.flag5, N'')))) = @flag5
      `)
        const codeRow = vr.recordset?.[0]
        if (!codeRow) {
          res.status(400).json({ success: false, message: '导入类型无效或不可用' })
          return
        }
        flag1 = String(codeRow.flag1 ?? '').trim()
        flag5 = String(codeRow.flag5 ?? '').trim()
      }
      const tree = parsePaperPatternImportTreeFromBuffer(req.file.buffer, {
        importTypeFlag5: flag5,
        importTypeFlag1: flag1,
      })
      res.json({
        success: true,
        mainBom: tree.mainBom,
        cuts: tree.cuts,
        materials: tree.materials,
        accessories: tree.accessories,
        warnings: tree.warnings,
      })
    } catch (e) {
      console.error('POST /api/paper-pattern/upload 解析失败：', e)
      res.status(500).json({ success: false, message: 'Excel 解析失败' })
    }
  })
})

app.get('/api/paper-pattern/import/preview', handlePaperPatternImportPreviewGet)
app.get('/api/paper-pattern/import/mapping', handleGetPaperPatternMapping)
app.post('/api/paper-pattern/import/save-mapping', handleSavePaperPatternMapping)
app.get('/api/paper-pattern/import/validate', handlePaperPatternImportValidateGet)
app.post('/api/paper-pattern/check-material', handlePostPaperPatternCheckMaterial)
app.post('/api/paper-pattern/material-bom-fields', handlePostPaperPatternMaterialBomFields)
app.get('/api/paper-pattern/import/parse-tree', handleGetPaperPatternImportParseTree)
app.get('/api/paper-pattern/import/files/list', handleGetPaperPatternImportFilesList)
app.get('/api/paper-pattern/import/files/download', handleGetPaperPatternImportFileDownload)
app.post('/api/paper-pattern/import/commit-bom000', handlePostPaperPatternImportCommitBom000)
app.post('/api/paper-pattern/import/delete-bom-tree', handlePostPaperPatternImportDeleteBomTree)

registerPurchaseQuotationRoutes(app, {
  getPool,
  formatBomColorcodeTimestamp,
  getActorAuditTripletFromReq,
})
registerOutsourcingQuotationRoutes(app, {
  getPool,
  formatBomColorcodeTimestamp,
  getActorAuditTripletFromReq,
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
  console.log(`User-Add-AuditStandard-v1.1.9 ${bootAt}`)
  console.log(`[启动指纹] bootAt=${bootAt}`)
  console.log(`Dorm-Electric-FlatUI-v1.1.5-Active ${bootAt}`)
  console.log(`Electric-History-Linkage-v1.1.5-Active ${bootAt}`)
  console.log(`Electric-MeterChange-Logic-v1.1.5-Active ${bootAt}`)
  console.log(`Electric-Split-Logic-Fixed-v1.1.5-Active ${bootAt}`)
  console.log(`Dorm-TimeFilter-Fixed-v1.1.7 ${bootAt}`)
  console.log(`Electric-Report-Module-v1.1.6-Active ${bootAt}`)
  console.log(`Electric-Report-Tabs-v1.1.6-Ready ${bootAt}`)
  console.log(`Report-Dept-Name-Mapping-v1.1.6 ${bootAt}`)
  console.log(`Dorm-Electric-Context-MonthFilter-Fixed-v1.1.7 ${bootAt}`)
    console.log(`BOM-List-Initial-v1.3.0-BomCostBatchAgg ${bootAt} table=${INV_BOM_MASTER_TABLE} code=${INV_BOM_CODE_TABLE} cost=${BOM_COST_TABLE}`)
  console.log(`BOM-SaveMain-Route-Active ${bootAt} POST /api/inventory/bom/save-main`)
  console.log(`BOM-SUM-Statistical-Column-v1.1.7 ${bootAt}`)
  console.log(`BOM-Dynamic-Rules-From-BomCode-v1.1.7 ${bootAt}`)
  console.log(`BOM-UI-Optimization-v1.1.7-Final ${bootAt}`)
  console.log(`BOM-Search-Filter-DefaultExcludeCUT-v1.1.7 ${bootAt}`)
  console.log(`BOM-Search-Core-Link-v1.1.7 ${bootAt}`)
  console.log(`BOM-Search-CUT-Suffix-Link-v1.1.7 ${bootAt}`)
  console.log(`BOM-Parts-Seq-Persist ${bootAt} GET/PUT Bom_parts.[Seq]`)
  console.log(
    `BOM-Parts-Kcac06-JoinBom000-v1.2.5 ${bootAt} GET parts CTE+JOIN bom_000（同 TOP1 id）; PUT kcac04/05/06; audit usage`,
  )
  console.log(
    `BOM-Parts-Save-Sync-Kcaa01-35-v1.2.6 ${bootAt} PUT parts: id+kcac01 lock; sync kcaa01-35/kcac02/systemcode from bom_000; audit [同步]`,
  )
  console.log(
    `BOM-Tree-v1.2.8-BatchPrefetch ${bootAt} GET/POST 用量树：bom_cost 命中直读；否则 Bom_parts 批量预取建树`,
  )
  console.log(
    `BOM-Usage-Calc-bom_cost ${bootAt} POST /api/bom/usage-calc → bom_cost(tx DELETE+bom_000补全+binfo/GUID/审计+isok；Bom_consumption 已停用)`,
  )
  console.log(
    `BOM-Propagate-Master-v1.0.0 ${bootAt} POST /api/inventory/bom/propagate-master → Bom_parts+bom_cost kcaa 同步（不改用量）`,
  )
  console.log(`ColorCode-Module-Initial-v1.0.0 ${bootAt}`)
  console.log(`ColorCode-Add-DirectMode-v1.1.0 ${bootAt}`)
  console.log(`ColorCode-Audit-Fields-Correction-v1.1.1 ${bootAt}`)
  console.log(`WorkshopDept-Module-v1.2.0 ${bootAt}`)
  console.log(`Electric-Days-Weight-v1.1.9-Active ${bootAt}`)
  console.log(`Electric-Report-Force-Display-Fixed-v1.1.6 ${bootAt}`)
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
  console.log(
    `PaperPattern-Import-Upload-Tmp ${bootAt} POST /api/paper-pattern/import/upload uploadDir=${getPaperPatternUploadDir()} downloadRoot=${getPaperPatternDownloadRoot()}`,
  )
  console.log(
    `PaperPattern-Import-Files-List ${bootAt} GET /api/paper-pattern/import/files/list；GET /api/paper-pattern/import/files/download`,
  )
  console.log(
    `PaperPattern-Import-Types-List ${bootAt} GET /api/paper-pattern/import-types（Bom_code，排除 id=1）`,
  )
  console.log(
    `PaperPattern-Upload-Parse-Tree ${bootAt} POST /api/paper-pattern/upload（.xlsx/.xls；importTypeFlag5 可选，有则校验 Bom_code）`,
  )
  console.log(`PaperPattern-Import-Preview-Read ${bootAt} GET /api/paper-pattern/import/preview`)
  console.log(`PaperPattern-Import-Mapping-DB ${bootAt} GET/POST /api/paper-pattern/import/mapping|save-mapping`)
  console.log(`PaperPattern-Import-Validate ${bootAt} GET /api/paper-pattern/import/validate`)
  console.log(
    `PaperPattern-ErpCheck-Material ${bootAt} POST /api/paper-pattern/check-material；GET /api/paper-pattern/import/parse-tree；POST /api/paper-pattern/material-bom-fields；POST /api/paper-pattern/import/commit-bom000；POST /api/paper-pattern/import/delete-bom-tree`,
  )
})

