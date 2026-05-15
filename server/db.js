/**
 * SQL Server 数据库连接模块
 * - 通过环境变量读取配置
 * - 使用连接池复用连接，避免频繁建立/断开导致性能问题
 */
import sql from 'mssql'

/** @type {sql.ConnectionPool | null} */
let pool = null

/**
 * 获取（或初始化）SQL Server 连接池
 * @returns {Promise<sql.ConnectionPool>}
 */
export async function getPool() {
  if (pool) return pool

  // 注意：mssql 的配置字段名是固定的（server/database/user/password 等）
  const config = {
    server: process.env.DB_SERVER,
    database: process.env.DB_DATABASE,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 1433,
    options: {
      // tedious 默认 requestTimeout=15000ms；纸格 commit 等大批 INSERT 易超 60s。可用 DB_REQUEST_TIMEOUT_MS 覆盖
      requestTimeout: (() => {
        const n = Number(process.env.DB_REQUEST_TIMEOUT_MS ?? 180000)
        return Number.isFinite(n) && n > 0 ? n : 180000
      })(),
      // 是否启用加密连接（encrypt）
      // - 如果你的 SQL Server 未启用/不支持对应 TLS 协议，开启加密可能出现 “unsupported protocol”
      // - 内网开发环境通常可以先设为 false 跑通；生产环境建议结合证书与安全策略开启
      encrypt: String(process.env.DB_ENCRYPT ?? 'false').toLowerCase() === 'true',
      // 开发环境常见：本机/内网无正式证书时设为 true，避免 TLS 证书校验失败
      trustServerCertificate: String(process.env.DB_TRUST_SERVER_CERTIFICATE).toLowerCase() === 'true',
    },
    pool: {
      // 连接池大小可按并发调整；先给一个稳妥的默认值
      max: 10,
      min: 0,
      idleTimeoutMillis: 30_000,
    },
  }

  // 基础校验：防止因为空配置导致报错信息不直观
  if (!config.server || !config.database) {
    throw new Error('缺少数据库配置：请在 .env 中设置 DB_SERVER 和 DB_DATABASE')
  }

  // SQL Server 登录（SQL 认证）：使用账号 + 密码连接（mssql 在提供 user/password 时会走 SQL 认证）
  if (!String(config.user || '').trim()) {
    throw new Error('缺少 DB_USER：使用 SQL 登录时请在 .env 中设置 DB_USER（例如 sa 或业务账号）')
  }
  if (config.password === undefined || config.password === null) {
    throw new Error('缺少 DB_PASSWORD：使用 SQL 登录时请在 .env 中设置 DB_PASSWORD（若确实无密码可写空字符串）')
  }

  pool = await sql.connect(config)
  return pool
}

export { sql }

