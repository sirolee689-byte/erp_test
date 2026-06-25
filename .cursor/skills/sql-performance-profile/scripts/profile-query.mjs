/**
 * 单条 SQL 测时（只读探测用）。
 * 默认 30s 超时；超时进程退出码 124。
 *
 * 用法：
 *   node profile-query.mjs --label "Q1" --sql "SELECT 1"
 *   node profile-query.mjs --label "Q1" --sql-file .scratch/profile/q1.sql
 *
 * 环境变量：PROFILE_TIMEOUT_MS（默认 30000）
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import sql from 'mssql'

function parseArgs(argv) {
  const out = { label: 'query', sql: '', sqlFile: '' }
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--label' && argv[i + 1]) {
      out.label = argv[++i]
    } else if (a === '--sql' && argv[i + 1]) {
      out.sql = argv[++i]
    } else if (a === '--sql-file' && argv[i + 1]) {
      out.sqlFile = argv[++i]
    }
  }
  return out
}

function loadSql({ sql: inline, sqlFile }) {
  if (inline) return inline
  if (sqlFile) return readFileSync(resolve(sqlFile), 'utf8')
  throw new Error('请提供 --sql 或 --sql-file')
}

async function main() {
  const args = parseArgs(process.argv)
  const queryText = loadSql(args)
  const timeoutMs = (() => {
    const n = Number(process.env.PROFILE_TIMEOUT_MS ?? 30000)
    return Number.isFinite(n) && n > 0 ? n : 30000
  })()

  const config = {
    server: process.env.DB_SERVER,
    database: process.env.DB_DATABASE,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 1433,
    options: {
      requestTimeout: timeoutMs,
      encrypt: String(process.env.DB_ENCRYPT ?? 'false').toLowerCase() === 'true',
      trustServerCertificate: String(process.env.DB_TRUST_SERVER_CERTIFICATE).toLowerCase() === 'true',
    },
  }

  if (!config.server || !config.database) {
    console.error('缺少 DB_SERVER / DB_DATABASE，请确认 .env 已配置')
    process.exit(2)
  }

  const started = Date.now()
  let pool
  try {
    pool = await sql.connect(config)
    const result = await pool.request().query(queryText)
    const elapsed = Date.now() - started
    const rows = Array.isArray(result.recordset) ? result.recordset.length : 0
    console.log(JSON.stringify({
      ok: true,
      label: args.label,
      elapsedMs: elapsed,
      rowCount: rows,
      timeoutMs,
      status: elapsed >= timeoutMs ? 'near_timeout' : 'ok',
    }, null, 2))
  } catch (err) {
    const elapsed = Date.now() - started
    const timedOut = elapsed >= timeoutMs - 50
      || /timeout|timed out|ETIMEOUT/i.test(String(err?.message || err))
    console.log(JSON.stringify({
      ok: false,
      label: args.label,
      elapsedMs: elapsed,
      timeoutMs,
      status: timedOut ? 'timeout' : 'error',
      message: String(err?.message || err),
    }, null, 2))
    process.exit(timedOut ? 124 : 1)
  } finally {
    try {
      await pool?.close()
    } catch {
      /* ignore */
    }
  }
}

main()
