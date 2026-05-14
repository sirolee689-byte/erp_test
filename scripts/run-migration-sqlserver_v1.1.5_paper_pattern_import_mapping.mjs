/**
 * v1.1.5：创建 paper_pattern_import_mapping（与 dev:server 共用根目录 .env）
 * 用法：在项目根目录执行 node scripts/run-migration-sqlserver_v1.1.5_paper_pattern_import_mapping.mjs
 */
import dotenv from 'dotenv'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { getPool } from '../server/db.js'

dotenv.config()

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationPath = join(__dirname, '..', 'docs', 'sql', 'sqlserver_v1.1.5_paper_pattern_import_mapping.txt')

async function main() {
  const sqlText = readFileSync(migrationPath, 'utf8')
  console.log('正在执行迁移：', migrationPath)
  const pool = await getPool()
  try {
    const batches = sqlText
      .split(/^\s*GO\s*$/gim)
      .map((s) => s.trim())
      .filter(Boolean)
    let i = 0
    for (const batch of batches) {
      i += 1
      await pool.request().query(batch)
      console.log(`已执行第 ${i}/${batches.length} 段 SQL。`)
    }
    console.log('迁移执行完成（重复执行通常也是安全的）。')
  } finally {
    await pool.close()
  }
}

main().catch((err) => {
  console.error('迁移失败：', err?.message || err)
  process.exit(1)
})
