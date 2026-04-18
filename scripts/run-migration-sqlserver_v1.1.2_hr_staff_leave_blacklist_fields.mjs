/**
 * v1.1.2：离职交互增强：离职原因 / 黑名单字段补齐
 * - Hr_staff：leave_reason / is_blacklist / blacklist_reason
 *
 * 用法：node scripts/run-migration-sqlserver_v1.1.2_hr_staff_leave_blacklist_fields.mjs
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
  console.log(`目标表：dbo.[${table}]；补齐 leave_reason/is_blacklist/blacklist_reason（若已存在则跳过）。`)

  const pool = await getPool()
  try {
    const sql = `
IF NOT EXISTS (
  SELECT 1
  FROM sys.columns AS c
  INNER JOIN sys.tables AS tb ON c.object_id = tb.object_id
  INNER JOIN sys.schemas AS s ON tb.schema_id = s.schema_id
  WHERE s.name = N'dbo' AND tb.name = N'${table}' AND c.name = N'leave_reason'
)
BEGIN
  ALTER TABLE dbo.[${table}] ADD [leave_reason] NVARCHAR(200) NULL;
END

IF NOT EXISTS (
  SELECT 1
  FROM sys.columns AS c
  INNER JOIN sys.tables AS tb ON c.object_id = tb.object_id
  INNER JOIN sys.schemas AS s ON tb.schema_id = s.schema_id
  WHERE s.name = N'dbo' AND tb.name = N'${table}' AND c.name = N'is_blacklist'
)
BEGIN
  ALTER TABLE dbo.[${table}]
  ADD [is_blacklist] INT NOT NULL CONSTRAINT DF_${table}_is_blacklist DEFAULT ((0));
END

IF NOT EXISTS (
  SELECT 1
  FROM sys.columns AS c
  INNER JOIN sys.tables AS tb ON c.object_id = tb.object_id
  INNER JOIN sys.schemas AS s ON tb.schema_id = s.schema_id
  WHERE s.name = N'dbo' AND tb.name = N'${table}' AND c.name = N'blacklist_reason'
)
BEGIN
  ALTER TABLE dbo.[${table}] ADD [blacklist_reason] NVARCHAR(200) NULL;
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

