/**
 * SQL Server 写入错误 → 前端可读中文（避免一律「数据库写入失败」）
 */

/** bcrypt 哈希典型长度（$2b$10$...） */
export const SQL_ERR_TRUNCATION = 8152
export const SQL_ERR_UNIQUE = 2627

/**
 * @param {unknown} err
 */
export function getSqlServerErrorNumber(err) {
  const e = /** @type {{ number?: number; originalError?: { number?: number; info?: { number?: number } }; code?: unknown }} */ (
    err
  )
  const n = e?.number ?? e?.originalError?.number ?? e?.originalError?.info?.number ?? e?.code
  const num = Number(n)
  return Number.isFinite(num) ? num : 0
}

/**
 * @param {unknown} err
 */
export function isSqlTruncationError(err) {
  const n = getSqlServerErrorNumber(err)
  if (n === SQL_ERR_TRUNCATION) return true
  const msg = String(
    /** @type {{ message?: string; originalError?: { message?: string } }} */ (err)?.message ??
      /** @type {{ originalError?: { message?: string } }} */ (err)?.originalError?.message ??
      '',
  )
  return msg.includes('would be truncated') || msg.includes('字符串或二进制数据将被截断')
}

/**
 * @param {unknown} err
 * @param {{ hint?: string }} [opts]
 * @returns {{ status: number; msg: string } | null}
 */
export function mapSqlServerWriteError(err, opts = {}) {
  const hint = opts.hint ? String(opts.hint) : ''
  if (isSqlTruncationError(err)) {
    const base =
      '写入失败：有字段内容超过数据库列长度限制。请缩短登录账号、姓名等内容；若与密码相关，请由 DBA 执行扩列脚本 docs/sql/sys_users_password_widen.sql（将 password 扩至 NVARCHAR(200) 以支持 bcrypt）。'
    return { status: 400, msg: hint ? `${base}（${hint}）` : base }
  }
  const n = getSqlServerErrorNumber(err)
  const msg = String(
    /** @type {{ message?: string; originalError?: { message?: string } }} */ (err)?.message ??
      /** @type {{ originalError?: { message?: string } }} */ (err)?.originalError?.message ??
      '',
  )
  if (n === SQL_ERR_UNIQUE || msg.includes('Violation of UNIQUE KEY')) {
    return { status: 400, msg: hint ? `数据重复：${hint}` : '数据重复，请勿重复提交' }
  }
  return null
}
