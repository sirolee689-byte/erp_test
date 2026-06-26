/**
 * 开料出库配置：UB_ERP_Stocks_material.cutting_issue
 * 用法：node scripts/run-migration-sqlserver_stock_out_cutting_issue_flag.mjs
 */
import dotenv from 'dotenv'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { getPool } from '../server/db.js'

dotenv.config()

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationPath = join(__dirname, 'migrations', 'sqlserver_stock_out_cutting_issue_flag.txt')

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
    const check = await pool.request().query(`
      SELECT COLUMN_NAME, DATA_TYPE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = N'UB_ERP_Stocks_material' AND COLUMN_NAME = N'cutting_issue'
    `)
    console.log('列核对：', check.recordset)
    const cnt = await pool.request().query(`
      SELECT COUNT(*) AS n
      FROM dbo.[UB_ERP_Stocks_material]
      WHERE LTRIM(RTRIM(ISNULL(CONVERT(nvarchar(20), cutting_issue), N'0'))) = N'1'
    `)
    console.log('cutting_issue=1 分类数：', cnt.recordset?.[0]?.n)
    console.log('迁移执行完成。')
  } finally {
    await pool.close()
  }
}

main().catch((err) => {
  console.error('迁移失败：', err?.message || err)
  process.exit(1)
})
