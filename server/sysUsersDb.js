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

/**
 * @typedef {object} SysUsersColumnsMeta
 * @property {Set<string>} set
 * @property {Map<string, string>} exactByLower
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
      SELECT COLUMN_NAME AS n
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = N'dbo' AND TABLE_NAME = N'Sys_Users'
    `)
    const exactByLower = new Map()
    const set = new Set()
    for (const row of r.recordset ?? []) {
      const exact = String(row?.n ?? '').trim()
      if (!exact) continue
      set.add(exact.toLowerCase())
      exactByLower.set(exact.toLowerCase(), exact)
    }
    /** @param {string} low */
    const qb = (low) => {
      const ex = exactByLower.get(low.toLowerCase())
      return ex ? bracketIdent(ex) : null
    }
    // 旧系统：以 uid + username + usercode 为准（即使同时存在 UserID 列也走旧表语义，避免 Status 为 NULL 被误判）
    const legacyLayout = set.has('uid') && set.has('username') && set.has('usercode')
    return { set, exactByLower, qb, legacyLayout, hrStaffFrom: HR_STAFF_FROM }
  })()
  return SYS_USERS_META_PROMISE
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
    if (!qPk) return null
    const isAdminExpr = qIsAdmin ? `CAST(u.${qIsAdmin} AS INT)` : 'CAST(0 AS INT)'
    const delActiveSql = qDel
      ? `AND (LTRIM(RTRIM(ISNULL(u.${qDel}, N''))) = N'' OR LTRIM(RTRIM(ISNULL(u.${qDel}, N''))) = N'0')`
      : ''
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
