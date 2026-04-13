/**
 * SQL Server 连接测试脚本（ESM）
 * 用法：
 * - 确认已配置 .env
 * - 运行：node scripts/test-db.mjs
 */
import dotenv from 'dotenv'
import sql from 'mssql'

dotenv.config()

const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 1433,
  options: {
    // 遇到 “unsupported protocol” 时通常需要关闭 encrypt
    encrypt: String(process.env.DB_ENCRYPT ?? 'false').toLowerCase() === 'true',
    trustServerCertificate: String(process.env.DB_TRUST_SERVER_CERTIFICATE).toLowerCase() === 'true',
  },
}

console.log('正在尝试连接 SQL Server...', {
  server: config.server,
  database: config.database,
  user: config.user,
  port: config.port,
  encrypt: config.options.encrypt,
})

try {
  const pool = await sql.connect(config)
  const result = await pool.request().query('SELECT GETDATE() as currentTime')
  console.log('✅ 连接成功，数据库时间：', result.recordset?.[0]?.currentTime)

  // 顺便验证 Sys_Users 是否存在、是否可查询
  const users = await pool.request().query('SELECT TOP (5) * FROM Sys_Users')
  console.log(`✅ Sys_Users 查询成功（前 5 行），行数：${users.recordset?.length ?? 0}`)

  await sql.close()
} catch (err) {
  console.error('❌ 连接/查询失败：', err)
  process.exitCode = 1
  try {
    await sql.close()
  } catch {
    // ignore
  }
}

