/**
 * v1.1.0：为 Hr_staff（或 .env HR_STAFF_TABLE）增加 remark（备注），与 dev:server 共用根目录 .env
 * 用法：在项目根目录执行 node scripts/run-migration-sqlserver_v1.1.0_hr_staff_add_remark.mjs
 */
import dotenv from 'dotenv'
import { getPool } from '../server/db.js'

dotenv.config()

function safeStaffTableName() {
  const t = String(process.env.HR_STAFF_TABLE ?? 'Hr_staff').trim()
  if (!/^[a-zA-Z0-9_]{1,64}$/.test(t)) {
    console.warn('[迁移] HR_STAFF_TABLE 不合法，已回退为 Hr_staff')
    return 'Hr_staff'
  }
  return t
}

async function main() {
  const table = safeStaffTableName()
  console.log('目标表：dbo.[' + table + ']，新增列 remark（若已存在则跳过）。')
  const pool = await getPool()
  try {
    const sql = `
IF NOT EXISTS (
  SELECT 1
  FROM sys.columns AS c
  INNER JOIN sys.tables AS tb ON c.object_id = tb.object_id
  INNER JOIN sys.schemas AS s ON tb.schema_id = s.schema_id
  WHERE s.name = N'dbo' AND tb.name = N'${table}' AND c.name = N'remark'
)
BEGIN
  ALTER TABLE dbo.[${table}] ADD remark NVARCHAR(500) NULL;
END
`
    await pool.request().query(sql)
    console.log('迁移执行完成（重复执行安全）。')
  } finally {
    await pool.close()
  }
}

main().catch((err) => {
  console.error('迁移失败：', err?.message || err)
  process.exit(1)
})
