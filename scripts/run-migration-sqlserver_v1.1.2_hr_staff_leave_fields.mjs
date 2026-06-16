/**
 * v1.1.2：员工离职/状态修改：补齐字段
 * - UB_ERP_Hr_staff（或 .env HR_STAFF_TABLE）：status NVARCHAR(20) 默认“在职”、leave_date DATETIME
 * - UB_ERP_User：is_active INT 默认 1
 *
 * 用法：在项目根目录执行
 * node scripts/run-migration-sqlserver_v1.1.2_hr_staff_leave_fields.mjs
 */
import dotenv from 'dotenv'
import { getPool } from '../server/db.js'

dotenv.config()

function safeStaffTableName() {
  const t = String(process.env.HR_STAFF_TABLE ?? 'UB_ERP_Hr_staff').trim()
  if (!/^[a-zA-Z0-9_]{1,64}$/.test(t)) {
    console.warn('[迁移] HR_STAFF_TABLE 不合法，已回退为 UB_ERP_Hr_staff')
    return 'UB_ERP_Hr_staff'
  }
  return t
}

async function main() {
  const staffTable = safeStaffTableName()
  console.log(`目标员工表：dbo.[${staffTable}]；将补齐 status/leave_date。`)
  console.log('目标账号表：dbo.[UB_ERP_User]；将补齐 is_active。')

  const pool = await getPool()
  try {
    const sql = `
IF NOT EXISTS (
  SELECT 1
  FROM sys.columns AS c
  INNER JOIN sys.tables AS tb ON c.object_id = tb.object_id
  INNER JOIN sys.schemas AS s ON tb.schema_id = s.schema_id
  WHERE s.name = N'dbo' AND tb.name = N'${staffTable}' AND c.name = N'status'
)
BEGIN
  ALTER TABLE dbo.[${staffTable}]
  ADD [status] NVARCHAR(20) NOT NULL
      CONSTRAINT DF_${staffTable}_status DEFAULT (N'在职');
END

IF NOT EXISTS (
  SELECT 1
  FROM sys.columns AS c
  INNER JOIN sys.tables AS tb ON c.object_id = tb.object_id
  INNER JOIN sys.schemas AS s ON tb.schema_id = s.schema_id
  WHERE s.name = N'dbo' AND tb.name = N'${staffTable}' AND c.name = N'leave_date'
)
BEGIN
  ALTER TABLE dbo.[${staffTable}]
  ADD [leave_date] DATETIME NULL;
END

IF NOT EXISTS (
  SELECT 1
  FROM sys.columns AS c
  INNER JOIN sys.tables AS tb ON c.object_id = tb.object_id
  INNER JOIN sys.schemas AS s ON tb.schema_id = s.schema_id
  WHERE s.name = N'dbo' AND tb.name = N'UB_ERP_User' AND c.name = N'is_active'
)
BEGIN
  ALTER TABLE dbo.[UB_ERP_User]
  ADD [is_active] INT NOT NULL
      CONSTRAINT DF_UB_ERP_User_is_active DEFAULT ((1));
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

