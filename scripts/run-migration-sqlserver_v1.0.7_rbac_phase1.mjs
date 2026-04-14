/**
 * 方式 B：用与后端相同的 .env 连接 SQL Server，执行完整 RBAC 第一阶段迁移脚本
 * 用法：在项目根目录执行 npm run migrate:rbac-phase1
 */
import dotenv from 'dotenv'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { getPool } from '../server/db.js'

dotenv.config()

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationPath = join(__dirname, 'migrations', 'sqlserver_v1.0.7_rbac_phase1.txt')

async function main() {
  const sqlText = readFileSync(migrationPath, 'utf8')
  console.log('正在执行迁移：', migrationPath)
  const pool = await getPool()
  try {
    await pool.request().query(sqlText)
    console.log('迁移执行完成（若库已是最新状态，重复执行通常也是安全的）。')
  } finally {
    await pool.close()
  }
}

main().catch((err) => {
  console.error('迁移失败：', err?.message || err)
  process.exit(1)
})
