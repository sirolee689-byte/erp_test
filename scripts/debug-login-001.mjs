/**
 * 诊断 001 登录：打印 Sys_Users 列元数据、模拟登录行、isSysUserRowLoginDisabled、POST /api/login
 * 用法：node scripts/debug-login-001.mjs
 */
import dotenv from 'dotenv'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getPool, sql } from '../server/db.js'
import { getSysUsersColumnsMeta, isSysUserRowLoginDisabled } from '../server/sysUsersDb.js'

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '.env') })

const loginId = String(process.argv[2] ?? '001').trim()
const password = String(process.argv[3] ?? process.env.E2E_PASSWORD ?? '123')

async function main() {
  const pool = await getPool()
  const meta = await getSysUsersColumnsMeta(pool)
  console.log('legacyLayout=', meta.legacyLayout, 'has del=', meta.set.has('del'), 'has is_active=', meta.set.has('is_active'))

  let result
  const request = pool.request()
  request.input('LoginId', sql.NVarChar(100), loginId)

  if (meta.legacyLayout) {
    const qUid = meta.qb('uid')
    const qUsercode = meta.qb('usercode')
    const qUsername = meta.qb('username')
    const qPassword = meta.qb('password')
    const isActiveSel = meta.set.has('is_active') ? `u.${meta.qb('is_active')} AS is_active,` : ''
    const delSel = meta.set.has('del') ? `u.${meta.qb('del')} AS del,` : ''
    const qIsAdmin = meta.set.has('is_admin') ? meta.qb('is_admin') : null
    const roleNameSql = qIsAdmin
      ? `CASE WHEN u.${qIsAdmin} = 1 THEN N'系统管理员' ELSE N'普通用户' END`
      : `N'普通用户'`
    const permSql = qIsAdmin ? `CASE WHEN u.${qIsAdmin} = 1 THEN N'{"*":["all"]}' ELSE N'[]' END` : `N'[]'`
    result = await request.query(`
      SELECT TOP (1)
        u.${qUid} AS UserID,
        u.${qUsercode} AS UserCode,
        u.${qUsername} AS UserName,
        ${delSel}
        u.${qPassword} AS Password,
        CAST(1 AS INT) AS Status,
        ${isActiveSel}
        CAST(NULL AS INT) AS RoleID,
        CAST(${roleNameSql} AS NVARCHAR(50)) AS RoleName,
        CAST(${permSql} AS NVARCHAR(MAX)) AS Permissions
      FROM Sys_Users AS u
      LEFT JOIN ${meta.hrStaffFrom} AS s ON s.[id] = u.${qUid}
      WHERE u.${qUsername} = @LoginId OR u.${qUsercode} = @LoginId
    `)
  } else {
    result = await request.query(`
      SELECT TOP (1)
        u.UserID,
        u.UserCode,
        u.UserName,
        ${meta.set.has('del') ? `u.${meta.qb('del')} AS del,` : ''}
        u.Password,
        u.Status,
        ${meta.set.has('is_active') ? 'u.is_active AS is_active,' : ''}
        u.RoleID
      FROM Sys_Users AS u
      WHERE u.UserName = @LoginId
    `)
  }

  const row = result.recordset?.[0]
  if (!row) {
    console.log('无匹配行（账号不存在）')
    return
  }
  console.log('recordset keys=', Object.keys(row))
  console.log('row JSON=', JSON.stringify(row, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)))

  const disabled = isSysUserRowLoginDisabled(row, meta.set)
  console.log('isSysUserRowLoginDisabled=', disabled)

  const api = String(process.env.PLAYWRIGHT_API_URL ?? 'http://localhost:3001').replace(/\/$/, '')
  const res = await fetch(`${api}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ Account: loginId, Password: password }),
  })
  const json = await res.json().catch(() => ({}))
  console.log('POST /api/login', res.status, json)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
