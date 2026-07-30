import { sql } from './db.js'

/**
 * 将历史细粒度权限中的 audit 补成 unaudit。
 * 旧数组、通配 all 与路径 all 本来就是全权限，保持原样。
 */
export function addUnauditToLegacyPermissions(raw) {
  if (raw == null || raw === '') return { changed: false, json: raw }

  let value = raw
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw)
    } catch {
      return { changed: false, json: raw }
    }
  }
  if (Array.isArray(value) || !value || typeof value !== 'object') {
    return { changed: false, json: typeof raw === 'string' ? raw : JSON.stringify(raw) }
  }

  let changed = false
  const next = {}
  for (const [path, actions] of Object.entries(value)) {
    const list = Array.isArray(actions) ? [...actions] : actions
    if (!Array.isArray(list)) {
      next[path] = list
      continue
    }
    const normalized = list.map((item) => String(item).trim().toLowerCase())
    const isGlobalAll = path === '*' && normalized.includes('all')
    if (!isGlobalAll && normalized.includes('audit') && !normalized.includes('all') && !normalized.includes('unaudit')) {
      list.push('unaudit')
      changed = true
    }
    next[path] = list
  }
  return { changed, json: changed ? JSON.stringify(next) : (typeof raw === 'string' ? raw : JSON.stringify(raw)) }
}

/** 在服务启动前一次性补齐历史角色的反审权限，事务失败则不启动 API。 */
export async function migrateRolePermissionsToUnaudit(pool) {
  const tx = pool.transaction()
  await tx.begin()
  try {
    const rows = await new sql.Request(tx).query(`
      SELECT RoleID, Permissions
      FROM dbo.[New_UB_ERP_System_role]
      WHERE Permissions IS NOT NULL
    `)
    let updated = 0
    for (const row of rows.recordset ?? []) {
      const result = addUnauditToLegacyPermissions(row.Permissions)
      if (!result.changed) continue
      await new sql.Request(tx)
        .input('roleId', sql.Int, Number(row.RoleID))
        .input('permissions', sql.NVarChar(sql.MAX), result.json)
        .query(`UPDATE dbo.[New_UB_ERP_System_role] SET Permissions = @permissions WHERE RoleID = @roleId`)
      updated += 1
    }
    await tx.commit()
    return { scanned: Number(rows.recordset?.length ?? 0), updated }
  } catch (error) {
    try {
      await tx.rollback()
    } catch {}
    throw error
  }
}
