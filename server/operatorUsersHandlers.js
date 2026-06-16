/**
 * 操作员管理（旧版 UB_ERP_User + del/pass）：姓名取本表 truename；JOIN dbo.[UB_ERP_System_role]；编辑/反审/软删与规则 16 日志
 */
import { sql } from './db.js'
import { getActorAuditTripletFromReq } from './businessAuditFields.js'
import { writeLog } from './operationLogWriter.js'
import {
  clipNvarcharForColumn,
  getSysUsersColumnMaxLen,
  getSysUsersAuditUidQb,
  getSysUsersEntityPkQb,
  resolveSysUsersPasswordForStorage,
} from './sysUsersDb.js'
import { mapSqlServerWriteError } from './sqlServerWriteErrors.js'

/** 旧版 uid+username+usercode 且同时具备 del、pass 时走本模块 v2 */
export function isOperatorUsersV2(meta) {
  if (!meta?.legacyLayout) return false
  return meta.set.has('del') && meta.set.has('pass')
}

function nowAuditString() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function passAsIntExpr(qPass) {
  return `CASE
    WHEN LTRIM(RTRIM(CAST(ISNULL(u.${qPass}, N'') AS NVARCHAR(20)))) IN (N'1', N'true', N'True') THEN 1
    WHEN CAST(ISNULL(u.${qPass}, 0) AS INT) = 1 THEN 1
    ELSE 0
  END`
}

/** 列表/日志展示用姓名：UB_ERP_User.truename（列不存在时为空串） */
function truenameSelectExpr(qTruename) {
  return qTruename
    ? `CAST(ISNULL(u.${qTruename}, N'') AS NVARCHAR(100)) AS truename`
    : `CAST(N'' AS NVARCHAR(100)) AS truename`
}

/**
 * 读取一行用于日志与回显：登录账号、员工编码、truename（姓名）
 * @param {import('mssql').ConnectionPool} pool
 * @param {import('./sysUsersDb.js').SysUsersColumnsMeta} meta
 * @param {number} userId
 */
export async function fetchOperatorRowContext(pool, meta, userId) {
  const qPk = getSysUsersEntityPkQb(meta)
  const qUsercode = meta.qb('usercode')
  const qUsername = meta.qb('username')
  const qTruename = meta.qb('truename')
  if (!qPk || !qUsercode || !qUsername) return null
  const r = await pool
    .request()
    .input('id', sql.Int, userId)
    .query(`
      SELECT TOP (1)
        u.${qUsername} AS LoginName,
        u.${qUsercode} AS UsercodeVal,
        ${truenameSelectExpr(qTruename)}
      FROM dbo.[UB_ERP_User] AS u
      WHERE u.${qPk} = @id
    `)
  const row = r.recordset?.[0]
  if (!row) return null
  const tn = row.truename ?? row.Truename ?? ''
  return {
    loginName: String(row.LoginName ?? '').trim(),
    usercodeVal: String(row.UsercodeVal ?? '').trim(),
    truename: String(tn ?? '').trim(),
  }
}

function buildOperatorSelectCols(meta, qPk, qUsercode, qUsername, qPass, qRoleId, qTruename) {
  const roleNameExpr = qRoleId ? `CAST(ISNULL(r.RoleName, N'') AS NVARCHAR(100))` : `CAST(N'' AS NVARCHAR(100))`
  const roleIdExpr = qRoleId ? `u.${qRoleId}` : `CAST(NULL AS INT)`
  const passExpr = passAsIntExpr(qPass)
  return `
    u.${qPk} AS UserID,
    u.${qUsercode} AS Usercode,
    u.${qUsername} AS Username,
    ${truenameSelectExpr(qTruename)},
    ${roleNameExpr} AS RoleName,
    ${roleIdExpr} AS RoleID,
    CAST(${passExpr} AS INT) AS Pass
  `
}

function buildOperatorFromJoin(meta, qRoleId) {
  return qRoleId
    ? `
    FROM dbo.[UB_ERP_User] AS u
    LEFT JOIN dbo.[UB_ERP_System_role] AS r ON u.${qRoleId} = r.RoleID
  `
    : `
    FROM dbo.[UB_ERP_User] AS u
    LEFT JOIN dbo.[UB_ERP_System_role] AS r ON 1=0
  `
}

/**
 * 分页列表（仅 ROW_NUMBER，兼容 SQL Server 2008 R2）
 * @param {import('mssql').ConnectionPool} pool
 * @param {import('./sysUsersDb.js').SysUsersColumnsMeta} meta
 * @param {{ offset: number, safePageSize: number, safeStatus: 0|1, passFilter?: '0'|'1', keywordRaw: string }} opts
 */
export async function queryOperatorUsersPage(pool, meta, opts) {
  const { offset, safePageSize, safeStatus, passFilter, keywordRaw } = opts
  const qPk = getSysUsersEntityPkQb(meta)
  const qUsercode = meta.qb('usercode')
  const qUsername = meta.qb('username')
  const qDel = meta.qb('del')
  const qPass = meta.qb('pass')
  const qRoleId = meta.qb('roleid')
  const qTruename = meta.qb('truename')
  if (!qPk || !qUsercode || !qUsername || !qDel || !qPass) {
    throw new Error('operatorUsersV2: 缺少必要列（UserID 或 uid 主键 / usercode / username / del / pass）')
  }

  const delActive = `(LTRIM(RTRIM(ISNULL(u.${qDel}, N''))) = N'' OR LTRIM(RTRIM(ISNULL(u.${qDel}, N''))) = N'0')`
  const delRecycle = `(LTRIM(RTRIM(ISNULL(u.${qDel}, N''))) = N'1')`
  const delPart = safeStatus === 1 ? delActive : delRecycle

  const keywordRawTrim = String(keywordRaw ?? '').trim()
  const hasKeyword = keywordRawTrim.length > 0
  const likeKey = `%${keywordRawTrim.replace(/%/g, '[%]').replace(/_/g, '[_]')}%`
  const kwTruename = qTruename ? ` OR u.${qTruename} LIKE @key ESCAPE N'\\'` : ''
  const kwSql = hasKeyword
    ? ` AND (u.${qUsercode} LIKE @key ESCAPE N'\\' OR u.${qUsername} LIKE @key ESCAPE N'\\'${kwTruename})`
    : ''

  const passSql =
    safeStatus === 1 && (passFilter === '0' || passFilter === '1')
      ? ` AND LTRIM(RTRIM(CAST(ISNULL(u.${qPass}, N'') AS NVARCHAR(20)))) = @pass`
      : ''

  const whereSql = `WHERE ${delPart}${passSql}${kwSql}`
  const fromJoin = buildOperatorFromJoin(meta, qRoleId)
  const selCols = buildOperatorSelectCols(meta, qPk, qUsercode, qUsername, qPass, qRoleId, qTruename)
  const orderExpr = `u.${qPk} DESC`

  const totalReq = pool.request()
  if (passSql) totalReq.input('pass', sql.NVarChar(1), passFilter)
  if (hasKeyword) totalReq.input('key', sql.NVarChar(120), likeKey)
  const totalR = await totalReq.query(`
    SELECT COUNT(1) AS total
    ${fromJoin}
    ${whereSql}
  `)
  const total = Number(totalR.recordset?.[0]?.total ?? 0)

  const startRow = offset + 1
  const endRow = offset + safePageSize
  const listReq = pool.request()
  listReq.input('startRow', sql.Int, startRow)
  listReq.input('endRow', sql.Int, endRow)
  if (passSql) listReq.input('pass', sql.NVarChar(1), passFilter)
  if (hasKeyword) listReq.input('key', sql.NVarChar(120), likeKey)

  const result = await listReq.query(`
    SELECT UserID, Usercode, Username, truename, RoleName, RoleID, Pass
    FROM (
      SELECT
        ${selCols},
        ROW_NUMBER() OVER (ORDER BY ${orderExpr}) AS rn
      ${fromJoin}
      ${whereSql}
    ) t
    WHERE t.rn BETWEEN @startRow AND @endRow
    ORDER BY t.rn
  `)

  return { list: result.recordset ?? [], total }
}

/**
 * 单条详情（查看）
 */
export async function getOperatorUserDetail(pool, meta, userId) {
  const qPk = getSysUsersEntityPkQb(meta)
  const qUsercode = meta.qb('usercode')
  const qUsername = meta.qb('username')
  const qDel = meta.qb('del')
  const qPass = meta.qb('pass')
  const qRoleId = meta.qb('roleid')
  const qTruename = meta.qb('truename')
  if (!qPk || !qUsercode || !qUsername || !qDel || !qPass) return null

  const fromJoin = buildOperatorFromJoin(meta, qRoleId)
  const selCols = buildOperatorSelectCols(meta, qPk, qUsercode, qUsername, qPass, qRoleId, qTruename)

  const r = await pool.request().input('id', sql.Int, userId).query(`
    SELECT TOP (1) ${selCols}
    ${fromJoin}
    WHERE u.${qPk} = @id
  `)
  return r.recordset?.[0] ?? null
}

async function assertWritableRoleIdLocal(pool, roleIdRaw) {
  const roleId = Number(roleIdRaw)
  if (!Number.isFinite(roleId) || roleId <= 0) {
    return { ok: false, msg: 'RoleID 不合法（必须是正整数）' }
  }
  const chk = await pool.request().input('RoleID', sql.Int, roleId).query(`
    SELECT TOP (1) RoleID FROM dbo.[UB_ERP_System_role] WHERE RoleID = @RoleID AND Status = 1
  `)
  if (!chk.recordset?.[0]) return { ok: false, msg: '角色不存在或已禁用' }
  return { ok: true, roleId }
}

function bareIdent(qbCol) {
  return String(qbCol ?? '').trim()
}

/** 登录账号冲突提示（全表 usercode 唯一） */
function usercodeDuplicateMsg(usercode) {
  return `登录账号「${usercode}」已存在，请更换`
}

/**
 * 校验 UB_ERP_User.usercode 全表唯一（编辑时排除当前主键）
 * @param {import('mssql').ConnectionPool} pool
 * @param {import('./sysUsersDb.js').SysUsersColumnsMeta} meta
 * @param {string} usercode
 * @param {number} [excludeUserId]
 */
async function assertOperatorUsercodeUnique(pool, meta, usercode, excludeUserId = 0) {
  const qPk = getSysUsersEntityPkQb(meta)
  const qUsercode = meta.qb('usercode')
  if (!qPk || !qUsercode) return { ok: true }
  const code = String(usercode ?? '').trim()
  if (!code) return { ok: false, msg: '登录账号不能为空' }

  const req = pool.request()
  req.input('usercode', sql.NVarChar(80), code)
  let excludeSql = ''
  if (Number.isFinite(excludeUserId) && excludeUserId > 0) {
    req.input('excludeId', sql.Int, excludeUserId)
    excludeSql = ` AND u.${qPk} <> @excludeId`
  }

  const r = await req.query(`
    SELECT TOP (1) u.${qPk} AS UserID
    FROM dbo.[UB_ERP_User] AS u
    WHERE LTRIM(RTRIM(CAST(ISNULL(u.${qUsercode}, N'') AS NVARCHAR(100)))) = @usercode
    ${excludeSql}
  `)
  if (r.recordset?.[0]) {
    return { ok: false, msg: usercodeDuplicateMsg(code) }
  }
  return { ok: true }
}

/**
 * 新增（旧版 UB_ERP_User 动态列）
 */
export async function insertOperatorUserLegacy(pool, meta, req, body, hashPassword) {
  const qPk = getSysUsersEntityPkQb(meta)
  const qAuditUid = getSysUsersAuditUidQb(meta)
  const qUsercode = meta.qb('usercode')
  const qUsername = meta.qb('username')
  const qPwd = meta.qb('password')
  const qDel = meta.qb('del')
  const qPass = meta.qb('pass')
  const qRoleId = meta.qb('roleid')
  const qTruename = meta.qb('truename')
  const qFirstLogin = meta.qb('is_first_login')
  if (!qPk || !qUsercode || !qUsername || !qPwd || !qDel || !qPass) {
    return { error: { status: 500, json: { code: 500, msg: '表结构缺少主键(UserID/uid)/usercode/username/password/del/pass', data: null } } }
  }

  // 登录账号 → usercode（唯一）；username 与 usercode 同步以便登录匹配
  let usercode = String(body.UserCode ?? body.Usercode ?? body.UserName ?? body.Username ?? '').trim()
  let truenameRaw = String(body.Truename ?? body.truename ?? '').trim()
  usercode = clipNvarcharForColumn(usercode, getSysUsersColumnMaxLen(meta, 'usercode'))
  let username = clipNvarcharForColumn(usercode, getSysUsersColumnMaxLen(meta, 'username'))
  truenameRaw = clipNvarcharForColumn(truenameRaw, getSysUsersColumnMaxLen(meta, 'truename'))
  if (!usercode) return { error: { status: 400, json: { code: 400, msg: '登录账号不能为空', data: null } } }

  const uniq = await assertOperatorUsercodeUnique(pool, meta, usercode)
  if (!uniq.ok) return { error: { status: 400, json: { code: 400, msg: uniq.msg, data: null } } }
  if (qTruename && !truenameRaw) {
    return { error: { status: 400, json: { code: 400, msg: '姓名（truename）不能为空', data: null } } }
  }

  let roleIdVal = null
  if (qRoleId) {
    const roleCheck = await assertWritableRoleIdLocal(pool, body.RoleID)
    if (!roleCheck.ok) return { error: { status: 400, json: { code: 400, msg: roleCheck.msg, data: null } } }
    roleIdVal = roleCheck.roleId
  }

  const tri = getActorAuditTripletFromReq(req)
  const pwdResolved = await resolveSysUsersPasswordForStorage('123', meta, hashPassword, pool)
  if (pwdResolved.error) {
    return { error: { status: 400, json: { code: 400, msg: pwdResolved.error, data: null } } }
  }
  const pwdHash = pwdResolved.stored
  const now = nowAuditString()

  const insertColList = [bareIdent(qUsercode), bareIdent(qUsername), bareIdent(qPwd), bareIdent(qDel), bareIdent(qPass)]
  // del=0 正常；pass=1 已审核（按需求）
  const insertValList = ['@usercode', '@username', '@pwd', "N'0'", "N'1'"]
  if (qTruename) {
    insertColList.push(bareIdent(qTruename))
    insertValList.push('@truename')
  }
  if (qFirstLogin) {
    insertColList.push(bareIdent(qFirstLogin))
    insertValList.push('@isFirstLogin')
  }
  if (qRoleId) {
    insertColList.push(bareIdent(qRoleId))
    insertValList.push('@roleId')
  }
  if (meta.set.has('addtime')) {
    insertColList.push(bareIdent(meta.qb('addtime')))
    insertValList.push('@addtime')
  }
  if (qAuditUid && tri.uidInt != null) {
    insertColList.push(bareIdent(qAuditUid))
    insertValList.push('@actorUid')
  }
  if (meta.set.has('uname') && tri.uname) {
    insertColList.push(bareIdent(meta.qb('uname')))
    insertValList.push('@actorUname')
  }
  if (meta.set.has('utruename') && tri.utruename) {
    insertColList.push(bareIdent(meta.qb('utruename')))
    insertValList.push('@actorUtruename')
  }

  const sqlText = `
    INSERT INTO dbo.[UB_ERP_User] (${insertColList.join(', ')})
    OUTPUT INSERTED.${bareIdent(qPk)} AS UserID
    VALUES (${insertValList.join(', ')})
  `

  try {
    const ins = pool.request()
    ins.input('usercode', sql.NVarChar(80), usercode)
    ins.input('username', sql.NVarChar(80), username)
    ins.input('pwd', sql.NVarChar(200), pwdHash)
    if (qTruename) ins.input('truename', sql.NVarChar(100), truenameRaw)
    if (qFirstLogin) ins.input('isFirstLogin', sql.Int, 1)
    if (qRoleId) ins.input('roleId', sql.Int, roleIdVal)
    if (meta.set.has('addtime')) ins.input('addtime', sql.NVarChar(50), now)
    if (qAuditUid && tri.uidInt != null) ins.input('actorUid', sql.Int, tri.uidInt)
    if (meta.set.has('uname') && tri.uname) ins.input('actorUname', sql.NVarChar(80), tri.uname)
    if (meta.set.has('utruename') && tri.utruename) ins.input('actorUtruename', sql.NVarChar(80), tri.utruename)
    const result = await ins.query(sqlText)
    const newId = result.recordset?.[0]?.UserID
    const ctx = await fetchOperatorRowContext(pool, meta, Number(newId))
    const displayName = ctx?.truename ?? truenameRaw
    const content = `录入成功,等待审核！操作员账号：${username}，姓名：${displayName}`
    await writeLog(req, '新增操作员', content, { targetTable: 'UB_ERP_User' })
    return { data: { UserID: newId, Usercode: usercode, Username: username } }
  } catch (dbErr) {
    const mapped = mapSqlServerWriteError(dbErr, { hint: '新增操作员' })
    if (mapped) return { error: { status: mapped.status, json: { code: mapped.status, msg: mapped.msg, data: null } } }
    const errNumber = dbErr?.number ?? dbErr?.originalError?.number
    const errMessage = String(dbErr?.message ?? '')
    if (Number(errNumber) === 2627 || errMessage.includes('Violation of UNIQUE KEY')) {
      return { error: { status: 400, json: { code: 400, msg: usercodeDuplicateMsg(usercode), data: null } } }
    }
    throw dbErr
  }
}

function stateChangeLogContent(ctx) {
  return `操作员状态变更！账号：${ctx?.loginName ?? ''}，姓名：${ctx?.truename ?? ''}`
}

/**
 * PUT：编辑 / op=disable（del=1）/ 兼容 unpass、soft_delete
 */
export async function putOperatorUser(pool, meta, req, body, hashPassword) {
  const qPk = getSysUsersEntityPkQb(meta)
  const qAuditUid = getSysUsersAuditUidQb(meta)
  const qUsercode = meta.qb('usercode')
  const qUsername = meta.qb('username')
  const qPwd = meta.qb('password')
  const qDel = meta.qb('del')
  const qPass = meta.qb('pass')
  const qRoleId = meta.qb('roleid')
  const qTruename = meta.qb('truename')
  if (!qPk || !qUsercode || !qUsername || !qDel || !qPass) {
    return { error: { status: 500, json: { code: 500, msg: '表结构不完整', data: null } } }
  }

  const userId = Number(body.UserID)
  if (!Number.isFinite(userId) || userId <= 0) {
    return { error: { status: 400, json: { code: 400, msg: 'UserID 不合法', data: null } } }
  }

  const ctx0 = await fetchOperatorRowContext(pool, meta, userId)
  if (!ctx0) return { error: { status: 404, json: { code: 404, msg: '未找到该用户', data: null } } }

  // 兼容旧前端：仅传 Status=0 时视为反审核
  const op = body.op ?? (body.Status !== undefined && Number(body.Status) === 0 ? 'unpass' : undefined)

  const delActiveWhere = `(LTRIM(RTRIM(ISNULL(u.${qDel}, N''))) = N'' OR LTRIM(RTRIM(ISNULL(u.${qDel}, N''))) = N'0')`
  const passIsOneWhere = `LTRIM(RTRIM(CAST(ISNULL(u.${qPass}, N'') AS NVARCHAR(20)))) = N'1'`
  const passNotOneWhere = `LTRIM(RTRIM(CAST(ISNULL(u.${qPass}, N'') AS NVARCHAR(20)))) <> N'1'`

  if (op === 'audit') {
    const tri = getActorAuditTripletFromReq(req)
    const now = nowAuditString()
    const sets = [`u.${qPass} = N'1'`]
    if (meta.set.has('edittime')) sets.push(`u.${meta.qb('edittime')} = @now`)
    if (qAuditUid && tri.uidInt != null) sets.push(`u.${qAuditUid} = @actorUid`)
    if (meta.set.has('uname') && tri.uname) sets.push(`u.${meta.qb('uname')} = @actorUname`)
    if (meta.set.has('utruename') && tri.utruename) sets.push(`u.${meta.qb('utruename')} = @actorUtruename`)
    const upd = pool.request()
    upd.input('id', sql.Int, userId)
    upd.input('now', sql.NVarChar(50), now)
    if (tri.uidInt != null) upd.input('actorUid', sql.Int, tri.uidInt)
    if (tri.uname) upd.input('actorUname', sql.NVarChar(80), tri.uname)
    if (tri.utruename) upd.input('actorUtruename', sql.NVarChar(80), tri.utruename)
    const r = await upd.query(`
      UPDATE u
      SET ${sets.join(', ')}
      FROM dbo.[UB_ERP_User] AS u
      WHERE u.${qPk} = @id AND ${delActiveWhere} AND ${passNotOneWhere}
    `)
    const n = Number(r.rowsAffected?.[0] ?? 0)
    if (n === 0) {
      return { error: { status: 400, json: { code: 400, msg: '审核失败：记录不存在、已禁用或已是已审核状态', data: null } } }
    }
    const ctx = await fetchOperatorRowContext(pool, meta, userId)
    await writeLog(req, '修改操作员', stateChangeLogContent(ctx), { targetTable: 'UB_ERP_User' })
    return { data: await getOperatorUserDetail(pool, meta, userId) }
  }

  if (op === 'unpass') {
    const tri = getActorAuditTripletFromReq(req)
    const now = nowAuditString()
    const sets = [`u.${qPass} = N'0'`]
    if (meta.set.has('edittime')) sets.push(`u.${meta.qb('edittime')} = @now`)
    if (qAuditUid && tri.uidInt != null) sets.push(`u.${qAuditUid} = @actorUid`)
    if (meta.set.has('uname') && tri.uname) sets.push(`u.${meta.qb('uname')} = @actorUname`)
    if (meta.set.has('utruename') && tri.utruename) sets.push(`u.${meta.qb('utruename')} = @actorUtruename`)
    const upd = pool.request()
    upd.input('id', sql.Int, userId)
    upd.input('now', sql.NVarChar(50), now)
    if (tri.uidInt != null) upd.input('actorUid', sql.Int, tri.uidInt)
    if (tri.uname) upd.input('actorUname', sql.NVarChar(80), tri.uname)
    if (tri.utruename) upd.input('actorUtruename', sql.NVarChar(80), tri.utruename)
    const r = await upd.query(`
      UPDATE u
      SET ${sets.join(', ')}
      FROM dbo.[UB_ERP_User] AS u
      WHERE u.${qPk} = @id AND ${delActiveWhere} AND ${passIsOneWhere}
    `)
    const n = Number(r.rowsAffected?.[0] ?? 0)
    if (n === 0) {
      return { error: { status: 400, json: { code: 400, msg: '反审失败：记录不存在、已禁用或未审核状态', data: null } } }
    }
    const ctx = await fetchOperatorRowContext(pool, meta, userId)
    await writeLog(req, '修改操作员', stateChangeLogContent(ctx), { targetTable: 'UB_ERP_User' })
    return { data: await getOperatorUserDetail(pool, meta, userId) }
  }

  if (op === 'disable' || op === 'soft_delete') {
    const tri = getActorAuditTripletFromReq(req)
    const now = nowAuditString()
    const sets = [`u.${qDel} = N'1'`]
    if (meta.set.has('deltime')) sets.push(`u.${meta.qb('deltime')} = @now`)
    if (meta.set.has('edittime')) sets.push(`u.${meta.qb('edittime')} = @now`)
    if (qAuditUid && tri.uidInt != null) sets.push(`u.${qAuditUid} = @actorUid`)
    if (meta.set.has('uname') && tri.uname) sets.push(`u.${meta.qb('uname')} = @actorUname`)
    if (meta.set.has('utruename') && tri.utruename) sets.push(`u.${meta.qb('utruename')} = @actorUtruename`)
    const upd = pool.request()
    upd.input('id', sql.Int, userId)
    upd.input('now', sql.NVarChar(50), now)
    if (tri.uidInt != null) upd.input('actorUid', sql.Int, tri.uidInt)
    if (tri.uname) upd.input('actorUname', sql.NVarChar(80), tri.uname)
    if (tri.utruename) upd.input('actorUtruename', sql.NVarChar(80), tri.utruename)
    const r = await upd.query(`
      UPDATE u
      SET ${sets.join(', ')}
      FROM dbo.[UB_ERP_User] AS u
      WHERE u.${qPk} = @id AND (LTRIM(RTRIM(ISNULL(u.${qDel}, N''))) = N'' OR LTRIM(RTRIM(ISNULL(u.${qDel}, N''))) = N'0')
    `)
    const n = Number(r.rowsAffected?.[0] ?? 0)
    if (n === 0) return { error: { status: 400, json: { code: 400, msg: '禁用失败：仅允许禁用在册记录', data: null } } }
    const ctx = await fetchOperatorRowContext(pool, meta, userId)
    await writeLog(req, '修改操作员', stateChangeLogContent(ctx), { targetTable: 'UB_ERP_User' })
    return { data: { UserID: userId } }
  }

  let usercode = String(body.UserCode ?? body.Usercode ?? body.UserName ?? body.Username ?? '').trim()
  const password = body.Password === undefined || body.Password === null ? '' : String(body.Password)
  const truenameIn = String(body.Truename ?? body.truename ?? '').trim()
  usercode = clipNvarcharForColumn(usercode, getSysUsersColumnMaxLen(meta, 'usercode'))
  const username = clipNvarcharForColumn(usercode, getSysUsersColumnMaxLen(meta, 'username'))
  if (!usercode) return { error: { status: 400, json: { code: 400, msg: '登录账号不能为空', data: null } } }

  const uniqEdit = await assertOperatorUsercodeUnique(pool, meta, usercode, userId)
  if (!uniqEdit.ok) return { error: { status: 400, json: { code: 400, msg: uniqEdit.msg, data: null } } }
  if (qTruename && !truenameIn) {
    return { error: { status: 400, json: { code: 400, msg: '姓名（truename）不能为空', data: null } } }
  }

  let roleIdVal = null
  if (qRoleId) {
    const roleCheck = await assertWritableRoleIdLocal(pool, body.RoleID)
    if (!roleCheck.ok) return { error: { status: 400, json: { code: 400, msg: roleCheck.msg, data: null } } }
    roleIdVal = roleCheck.roleId
  }

  const tri = getActorAuditTripletFromReq(req)
  const now = nowAuditString()
  const shouldUpdatePassword = !!(qPwd && String(password).trim())

  const sets2 = [`u.${qUsercode} = @usercode`, `u.${qUsername} = @username`]
  if (qTruename) sets2.push(`u.${qTruename} = @truename`)
  if (qRoleId) sets2.push(`u.${qRoleId} = @roleId`)
  if (shouldUpdatePassword) sets2.push(`u.${qPwd} = @pwd`)
  if (meta.set.has('edittime')) sets2.push(`u.${meta.qb('edittime')} = @now`)
  if (qAuditUid && tri.uidInt != null) sets2.push(`u.${qAuditUid} = @actorUid`)
  if (meta.set.has('uname') && tri.uname) sets2.push(`u.${meta.qb('uname')} = @actorUname`)
  if (meta.set.has('utruename') && tri.utruename) sets2.push(`u.${meta.qb('utruename')} = @actorUtruename`)

  const upd = pool.request()
  upd.input('id', sql.Int, userId)
  upd.input('usercode', sql.NVarChar(80), usercode)
  upd.input('username', sql.NVarChar(80), username)
  if (qTruename) upd.input('truename', sql.NVarChar(100), truenameIn)
  if (qRoleId) upd.input('roleId', sql.Int, roleIdVal)
  if (shouldUpdatePassword) {
    const pwdResolved = await resolveSysUsersPasswordForStorage(password, meta, hashPassword, pool)
    if (pwdResolved.error) {
      return { error: { status: 400, json: { code: 400, msg: pwdResolved.error, data: null } } }
    }
    upd.input('pwd', sql.NVarChar(200), pwdResolved.stored)
  }
  upd.input('now', sql.NVarChar(50), now)
  if (tri.uidInt != null) upd.input('actorUid', sql.Int, tri.uidInt)
  if (tri.uname) upd.input('actorUname', sql.NVarChar(80), tri.uname)
  if (tri.utruename) upd.input('actorUtruename', sql.NVarChar(80), tri.utruename)

  try {
    const r = await upd.query(`
      UPDATE u
      SET ${sets2.join(', ')}
      FROM dbo.[UB_ERP_User] AS u
      WHERE u.${qPk} = @id AND (LTRIM(RTRIM(ISNULL(u.${qDel}, N''))) = N'' OR LTRIM(RTRIM(ISNULL(u.${qDel}, N''))) = N'0')
    `)
    const n = Number(r.rowsAffected?.[0] ?? 0)
    if (n === 0) return { error: { status: 404, json: { code: 404, msg: '未找到在册用户', data: null } } }
    const ctx = await fetchOperatorRowContext(pool, meta, userId)
    await writeLog(req, '修改操作员', stateChangeLogContent(ctx), { targetTable: 'UB_ERP_User' })
    return { data: await getOperatorUserDetail(pool, meta, userId) }
  } catch (dbErr) {
    const mapped = mapSqlServerWriteError(dbErr, { hint: '修改操作员' })
    if (mapped) return { error: { status: mapped.status, json: { code: mapped.status, msg: mapped.msg, data: null } } }
    const errNumber = dbErr?.number ?? dbErr?.originalError?.number
    const errMessage = String(dbErr?.message ?? '')
    if (Number(errNumber) === 2627 || errMessage.includes('Violation of UNIQUE KEY')) {
      return { error: { status: 400, json: { code: 400, msg: usercodeDuplicateMsg(usercode), data: null } } }
    }
    throw dbErr
  }
}

/**
 * 从回收站恢复（del 置 0）
 */
export async function restoreOperatorUserDel(pool, meta, req, userId) {
  const qPk = getSysUsersEntityPkQb(meta)
  const qAuditUid = getSysUsersAuditUidQb(meta)
  const qDel = meta.qb('del')
  if (!qPk || !qDel) return { error: { status: 500, json: { code: 500, msg: '表结构缺少列', data: null } } }

  const ctx0 = await fetchOperatorRowContext(pool, meta, userId)
  if (!ctx0) return { error: { status: 404, json: { code: 404, msg: '未找到该用户', data: null } } }

  const tri = getActorAuditTripletFromReq(req)
  const now = nowAuditString()
  const sets2 = [`u.${qDel} = N'0'`]
  if (meta.set.has('deltime')) sets2.push(`u.${meta.qb('deltime')} = NULL`)
  if (meta.set.has('edittime')) sets2.push(`u.${meta.qb('edittime')} = @now`)
  if (qAuditUid && tri.uidInt != null) sets2.push(`u.${qAuditUid} = @actorUid`)
  if (meta.set.has('uname') && tri.uname) sets2.push(`u.${meta.qb('uname')} = @actorUname`)
  if (meta.set.has('utruename') && tri.utruename) sets2.push(`u.${meta.qb('utruename')} = @actorUtruename`)

  const upd = pool.request()
  upd.input('id', sql.Int, userId)
  upd.input('now', sql.NVarChar(50), now)
  if (tri.uidInt != null) upd.input('actorUid', sql.Int, tri.uidInt)
  if (tri.uname) upd.input('actorUname', sql.NVarChar(80), tri.uname)
  if (tri.utruename) upd.input('actorUtruename', sql.NVarChar(80), tri.utruename)

  const r = await upd.query(`
    UPDATE u
    SET ${sets2.join(', ')}
    FROM dbo.[UB_ERP_User] AS u
    WHERE u.${qPk} = @id AND LTRIM(RTRIM(ISNULL(u.${qDel}, N''))) = N'1'
  `)
  const n = Number(r.rowsAffected?.[0] ?? 0)
  if (n === 0) return { error: { status: 400, json: { code: 400, msg: '恢复失败：该记录不在回收站', data: null } } }

  await writeLog(req, '恢复操作员', stateChangeLogContent(ctx0), { targetTable: 'UB_ERP_User' })
  return { data: await getOperatorUserDetail(pool, meta, userId) }
}
