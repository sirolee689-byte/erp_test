/**
 * Sys_Users 物理表兼容层：
 * - ERP 标准列：UserID、UserCode、UserName、Password、Status、RoleID、CreatedAt…
 * - 旧系统列：UserID（业务主键，优先）、uid（人事关联/审计：常对应 Hr_staff.id 或记录操作者）、usercode、username、
 *   password、is_admin、uname、utruename、info 等
 */
import { sql } from './db.js'

const HR_STAFF_TABLE = (() => {
  const t = String(process.env.HR_STAFF_TABLE ?? 'Hr_staff').trim()
  if (!/^[a-zA-Z0-9_]{1,64}$/.test(t)) return 'Hr_staff'
  return t
})()
const HR_STAFF_FROM = `dbo.[${HR_STAFF_TABLE}]`

/** @type {Promise<SysUsersColumnsMeta> | null} */
let SYS_USERS_META_PROMISE = null

/** 清空列元数据缓存（登录前调用，避免 INFORMATION_SCHEMA 变更后进程内误判 del/Status） */
export function invalidateSysUsersColumnsMeta() {
  SYS_USERS_META_PROMISE = null
}

/** bcrypt 哈希写入所需列长下限（约 60 字符） */
export const SYS_USERS_BCRYPT_MIN_COLUMN_LEN = 60

/** 自动扩列目标长度（与 docs/sql/sys_users_password_widen.sql 一致） */
export const SYS_USERS_PASSWORD_COLUMN_TARGET_LEN = 200

/**
 * @typedef {object} SysUsersColumnsMeta
 * @property {Set<string>} set
 * @property {Map<string, string>} exactByLower
 * @property {Map<string, number>} maxLenByLower 小写列名 → CHARACTER_MAXIMUM_LENGTH（-1 表示 MAX）
 * @property {(low: string) => string | null} qb
 * @property {boolean} legacyLayout
 * @property {string} hrStaffFrom
 */

/**
 * SQL 安全标识符（仅来自 INFORMATION_SCHEMA，禁止拼接用户输入）
 * @param {string} exact
 */
function bracketIdent(exact) {
  const s = String(exact ?? '').trim()
  if (!s) return null
  return `[${s.replace(/]/g, ']]')}]`
}

/**
 * @param {import('mssql').ConnectionPool} pool
 * @returns {Promise<SysUsersColumnsMeta>}
 */
export async function getSysUsersColumnsMeta(pool) {
  if (SYS_USERS_META_PROMISE) return SYS_USERS_META_PROMISE
  SYS_USERS_META_PROMISE = (async () => {
    const r = await pool.request().query(`
      SELECT COLUMN_NAME AS n, CHARACTER_MAXIMUM_LENGTH AS maxLen
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = N'dbo' AND TABLE_NAME = N'Sys_Users'
    `)
    const exactByLower = new Map()
    const maxLenByLower = new Map()
    const set = new Set()
    for (const row of r.recordset ?? []) {
      const exact = String(row?.n ?? '').trim()
      if (!exact) continue
      const low = exact.toLowerCase()
      set.add(low)
      exactByLower.set(low, exact)
      const ml = Number(row?.maxLen)
      if (Number.isFinite(ml)) maxLenByLower.set(low, ml)
    }
    /** @param {string} low */
    const qb = (low) => {
      const ex = exactByLower.get(low.toLowerCase())
      return ex ? bracketIdent(ex) : null
    }
    // 旧系统：以 uid + username + usercode 为准（即使同时存在 UserID 列也走旧表语义，避免 Status 为 NULL 被误判）
    const legacyLayout = set.has('uid') && set.has('username') && set.has('usercode')
    return { set, exactByLower, maxLenByLower, qb, legacyLayout, hrStaffFrom: HR_STAFF_FROM }
  })()
  return SYS_USERS_META_PROMISE
}

/**
 * 列最大字符数（nvarchar 按字符计；-1 为 MAX，返回 null 表示不裁剪）
 * @param {SysUsersColumnsMeta} meta
 * @param {string} low 小写列名
 */
export function getSysUsersColumnMaxLen(meta, low) {
  const ml = meta?.maxLenByLower?.get(String(low).toLowerCase())
  if (ml == null || !Number.isFinite(ml)) return null
  if (ml < 0) return null
  return ml
}

/**
 * 按列长裁剪 nvarchar 入参，降低 8152 概率
 * @param {string} value
 * @param {number | null} maxLen
 */
export function clipNvarcharForColumn(value, maxLen) {
  const s = String(value ?? '')
  if (maxLen == null || maxLen < 0) return s
  if (s.length <= maxLen) return s
  return s.slice(0, maxLen)
}

/**
 * 按登录账号 usercode 查 Sys_Users.truename（业务表 utruename/uptruename 等审计姓名）
 * @param {import('mssql').ConnectionPool | null | undefined} pool
 * @param {string | null | undefined} usercode
 * @returns {Promise<string | null>}
 */
export async function resolveSysUsersTruenameByUsercode(pool, usercode) {
  const triplet = await resolveSysUsersAuditTripletByUsercode(pool, usercode)
  return triplet?.utruename ?? null
}

/**
 * 按登录账号 usercode 查业务表审计三字段（uid / uname / utruename）
 * @param {import('mssql').ConnectionPool | null | undefined} pool
 * @param {string | null | undefined} usercode
 * @returns {Promise<{ uidInt: number | null, uname: string | null, utruename: string | null } | null>}
 */
export async function resolveSysUsersAuditTripletByUsercode(pool, usercode) {
  const code = String(usercode ?? '').trim()
  if (!pool || !code) return null
  const meta = await getSysUsersColumnsMeta(pool)
  const qUsercode = meta.qb('usercode')
  const qPk = getSysUsersEntityPkQb(meta)
  const qUserName = meta.qb('username')
  const qTruename = meta.qb('truename')
  if (!qUsercode) return null

  const selects = []
  if (qPk) {
    selects.push(`CAST(u.${qPk} AS int) AS userId`)
  }
  if (qUserName) {
    selects.push(
      `LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(u.${qUserName}, N'')))) AS userName`,
    )
  }
  if (qTruename) {
    selects.push(
      `LTRIM(RTRIM(CONVERT(nvarchar(100), ISNULL(u.${qTruename}, N'')))) AS truename`,
    )
  }
  if (!selects.length) return null

  const r = await pool
    .request()
    .input('auditUsercode', sql.NVarChar(80), code)
    .query(`
    SELECT TOP (1) ${selects.join(',\n      ')}
    FROM Sys_Users AS u
    WHERE LTRIM(RTRIM(CAST(ISNULL(u.${qUsercode}, N'') AS NVARCHAR(100)))) = @auditUsercode
  `)
  const row = r.recordset?.[0]
  if (!row) return null
  const uidRaw = Number(row.userId)
  const uidInt = Number.isFinite(uidRaw) && uidRaw > 0 ? uidRaw : null
  const uname = String(row.userName ?? '').trim() || null
  const utruename = String(row.truename ?? '').trim() || null
  if (uidInt == null && !uname && !utruename) return null
  return { uidInt, uname, utruename }
}

/**
 * password 列不足 bcrypt 时自动扩至 NVARCHAR(200)（无需手工跑脚本）
 * @param {import('mssql').ConnectionPool} pool
 * @param {SysUsersColumnsMeta} [metaIn]
 */
export async function ensureSysUsersPasswordColumnWiden(pool, metaIn = null) {
  const meta = metaIn ?? (await getSysUsersColumnsMeta(pool))
  const maxLen = getSysUsersColumnMaxLen(meta, 'password')
  if (maxLen == null || maxLen < 0 || maxLen >= SYS_USERS_BCRYPT_MIN_COLUMN_LEN) {
    return meta
  }
  const exact = meta.exactByLower.get('password')
  if (!exact) return meta
  const col = bracketIdent(exact)
  if (!col) return meta
  await pool.request().query(`
    ALTER TABLE dbo.[Sys_Users] ALTER COLUMN ${col} NVARCHAR(${SYS_USERS_PASSWORD_COLUMN_TARGET_LEN}) NULL
  `)
  invalidateSysUsersColumnsMeta()
  return getSysUsersColumnsMeta(pool)
}

/**
 * 密码入库：一律 bcrypt；有 pool 时自动扩列，不限制明文密码长度（仅哈希长度受列宽约束）
 * @param {string} plainPassword
 * @param {SysUsersColumnsMeta} meta
 * @param {(plain: string) => Promise<string>} hashPassword
 * @param {import('mssql').ConnectionPool} [pool]
 */
export async function resolveSysUsersPasswordForStorage(plainPassword, meta, hashPassword, pool = null) {
  const plain = String(plainPassword ?? '')
  let m = meta
  if (pool) {
    m = await ensureSysUsersPasswordColumnWiden(pool, meta)
  }
  const hash = await hashPassword(plain)
  const maxLen = getSysUsersColumnMaxLen(m, 'password')

  if (maxLen != null && maxLen >= 0 && maxLen < SYS_USERS_BCRYPT_MIN_COLUMN_LEN) {
    return {
      error: `password 列过短（当前最多 ${maxLen} 字符），无法保存 bcrypt。请联系管理员检查数据库权限或执行 docs/sql/sys_users_password_widen.sql。`,
    }
  }

  if (maxLen != null && maxLen >= 0 && hash.length > maxLen) {
    return {
      error: `password 列过短（当前最多 ${maxLen} 字符），无法保存加密结果。请联系管理员扩列。`,
    }
  }

  return { stored: hash, mode: 'bcrypt' }
}

/**
 * 业务主键列（安全标识符）：优先 UserID；无该列时退回 uid（仅 uid 作主键的极旧库）
 * @param {SysUsersColumnsMeta} meta
 */
export function getSysUsersEntityPkQb(meta) {
  return meta.qb('userid') || meta.qb('uid')
}

/**
 * 仅当存在独立 UserID 主键时，才把 uid 列当作「审计/人事关联」写入；否则 null（避免误改主键 uid）
 * @param {SysUsersColumnsMeta} meta
 */
export function getSysUsersAuditUidQb(meta) {
  const qUserId = meta.qb('userid')
  const quid = meta.qb('uid')
  if (!qUserId || !quid) return null
  return quid
}

/**
 * 与历史代码兼容：仅返回小写列名集合
 * @param {import('mssql').ConnectionPool} pool
 */
export async function getSysUsersColumnSet(pool) {
  const m = await getSysUsersColumnsMeta(pool)
  return m.set
}

/**
 * 从 mssql 行读取字段（驱动返回列名大小写不一致）
 * @param {Record<string, unknown> | null | undefined} row
 * @param {string[]} names 候选名，如 ['del','Del']
 */
export function getSysUserRowFieldIgnoreCase(row, names) {
  if (!row) return undefined
  const keys = Object.keys(row)
  for (const n of names) {
    const t = n.toLowerCase()
    const k = keys.find((x) => x.toLowerCase() === t)
    if (k !== undefined) return row[k]
  }
  return undefined
}

/** del / 逻辑删除：为 1、'1'、true 等视为禁用 */
function isDelDisabledValue(raw) {
  if (raw === true || raw === 1) return true
  const s = String(raw ?? '').trim()
  return s === '1'
}

/**
 * Sys_Users 是否禁止登录：优先看 del（'1'/1/true=禁用），无 del 列时再看 Status（0=禁用）。
 * @param {Record<string, unknown>} userRow 登录查询结果行
 * @param {Set<string>} colset 小写列名
 */
export function isSysUserRowLoginDisabled(userRow, colset) {
  if (colset.has('del')) {
    const raw = getSysUserRowFieldIgnoreCase(userRow, ['del', 'Del', 'DEL'])
    return isDelDisabledValue(raw)
  }
  const st = getSysUserRowFieldIgnoreCase(userRow, ['Status', 'status', 'STATUS'])
  if (st != null && st !== '' && Number(st) === 0) return true
  return false
}

/**
 * 供 API 权限闸门：取出用于 parseRolePermissions 的原始字符串（可能为 NULL）
 * @param {import('mssql').ConnectionPool} pool
 * @param {number} userId Sys_Users.UserID（或极旧库 uid）
 */
export async function fetchSysUserPermissionSource(pool, userId) {
  const meta = await getSysUsersColumnsMeta(pool)
  const id = Math.floor(Number(userId))
  if (!Number.isFinite(id) || id <= 0) return null

  const req = pool.request().input('UserID', sql.Int, id)

  if (meta.legacyLayout) {
    const qPk = getSysUsersEntityPkQb(meta)
    const qIsAdmin = meta.set.has('is_admin') ? meta.qb('is_admin') : null
    const qDel = meta.set.has('del') ? meta.qb('del') : null
    const qRoleId = meta.qb('roleid')
    const legacyOperatorV2 = meta.set.has('del') && meta.set.has('pass')
    if (!qPk) return null
    const isAdminExpr = qIsAdmin ? `CAST(u.${qIsAdmin} AS INT)` : 'CAST(0 AS INT)'
    const delActiveSql = qDel
      ? `AND (LTRIM(RTRIM(ISNULL(u.${qDel}, N''))) = N'' OR LTRIM(RTRIM(ISNULL(u.${qDel}, N''))) = N'0')`
      : ''
    if (legacyOperatorV2 && qRoleId) {
      const r = await req.query(`
        SELECT TOP (1)
          ${isAdminExpr} AS is_admin,
          CAST(r.Permissions AS NVARCHAR(MAX)) AS Permissions
        FROM Sys_Users AS u
        LEFT JOIN Sys_Roles AS r ON r.RoleID = u.${qRoleId}
        WHERE u.${qPk} = @UserID
        ${delActiveSql}
      `)
      const row = r.recordset?.[0]
      if (Number(row?.is_admin) === 1) return '{"*":["all"]}'
      const perm = row?.Permissions
      return perm != null && perm !== undefined ? String(perm) : null
    }
    const r = await req.query(`
      SELECT TOP (1) ${isAdminExpr} AS is_admin
      FROM Sys_Users AS u
      WHERE u.${qPk} = @UserID
      ${delActiveSql}
    `)
    const row = r.recordset?.[0]
    if (Number(row?.is_admin) === 1) return '{"*":["all"]}'
    return '[]'
  }

  const qDelErp = meta.set.has('del') ? meta.qb('del') : null
  const delActiveErp = qDelErp
    ? `AND (LTRIM(RTRIM(ISNULL(u.${qDelErp}, N''))) = N'' OR LTRIM(RTRIM(ISNULL(u.${qDelErp}, N''))) = N'0')`
    : ''
  const r = await req.query(`
    SELECT TOP (1) r.Permissions AS Permissions
    FROM Sys_Users AS u
    INNER JOIN Sys_Roles AS r ON r.RoleID = u.RoleID
    WHERE u.UserID = @UserID AND u.Status = 1 AND r.Status = 1
    ${delActiveErp}
  `)
  return r.recordset?.[0]?.Permissions ?? null
}

/**
 * 改密等：定位当前用户行的「账号编码」列 SQL 片段（带表别名 u.）
 * @param {SysUsersColumnsMeta} meta
 */
export function sysUsersAccountCodeExpr(meta) {
  if (meta.legacyLayout) {
    const c = meta.qb('usercode')
    return c ? `u.${c}` : null
  }
  const c = meta.qb('usercode')
  return c ? `u.${c}` : 'u.[UserCode]'
}

/**
 * 密码列（带 u.）
 * @param {SysUsersColumnsMeta} meta
 */
export function sysUsersPasswordExpr(meta) {
  const c = meta.qb('password')
  return c ? `u.${c}` : 'u.[Password]'
}

/**
 * 旧版 Sys_Users 仅支持登录/只读列表；拦截本 ERP 的写接口
 * @param {import('mssql').ConnectionPool} pool
 * @param {import('express').Response} res
 * @returns {Promise<boolean>} true 表示已响应 400，调用方应 return
 */
export async function rejectLegacySysUsersCrud(pool, res) {
  const meta = await getSysUsersColumnsMeta(pool)
  if (!meta.legacyLayout) return false
  // 同时具备 del、pass 时由 operatorUsersHandlers（JOIN 人事/角色）接管写操作，不再拦截
  if (meta.set.has('del') && meta.set.has('pass')) return false
  res.status(400).json({
    code: 400,
    msg:
      '当前为旧系统 Sys_Users 结构（uid/username/usercode 等），不支持在本页新增、编辑或删除用户；请在原系统或人事侧维护后刷新。',
    data: null,
  })
  return true
}
