/**
 * v1.1.1：数据库优化 + 辞职模块：字段补齐
 * - UB_ERP_User：Account（登录账号，唯一） + is_active（默认1）
 * - UB_ERP_Hr_staff：UserCode（档案工号） + status（默认在职） + leave_date
 *
 * 用法：在项目根目录执行
 * node scripts/run-migration-sqlserver_v1.1.1_sys_users_account_is_active_and_staff_status.mjs
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
  console.log(`目标员工表：dbo.[${staffTable}]；将补齐 UserCode/status/leave_date。`)
  console.log('目标账号表：dbo.[UB_ERP_User]；将补齐 Account/is_active。')

  const pool = await getPool()
  try {
    const sql = `
IF NOT EXISTS (
  SELECT 1
  FROM sys.columns AS c
  INNER JOIN sys.tables AS tb ON c.object_id = tb.object_id
  INNER JOIN sys.schemas AS s ON tb.schema_id = s.schema_id
  WHERE s.name = N'dbo' AND tb.name = N'UB_ERP_User' AND c.name = N'Account'
)
BEGIN
  ALTER TABLE dbo.[UB_ERP_User] ADD [Account] NVARCHAR(50) NULL;
END

-- 注意：同一个批次里“先加列再 UPDATE 新列”会触发编译期错误，因此用动态 SQL 执行
IF COL_LENGTH('dbo.UB_ERP_User', 'Account') IS NOT NULL
BEGIN
  EXEC(N'
    UPDATE dbo.[UB_ERP_User]
    SET Account = LTRIM(RTRIM(UserCode))
    WHERE (Account IS NULL OR LTRIM(RTRIM(Account)) = N'''''''') AND LTRIM(RTRIM(UserCode)) <> N'''''''';
  ')
END

IF EXISTS (
  SELECT 1
  FROM sys.columns AS c
  INNER JOIN sys.tables AS tb ON c.object_id = tb.object_id
  INNER JOIN sys.schemas AS s ON tb.schema_id = s.schema_id
  WHERE s.name = N'dbo' AND tb.name = N'UB_ERP_User' AND c.name = N'Account' AND c.is_nullable = 1
)
BEGIN
  ALTER TABLE dbo.[UB_ERP_User] ALTER COLUMN [Account] NVARCHAR(50) NOT NULL;
END

IF NOT EXISTS (
  SELECT 1
  FROM sys.key_constraints AS kc
  INNER JOIN sys.tables AS tb ON kc.parent_object_id = tb.object_id
  INNER JOIN sys.schemas AS s ON tb.schema_id = s.schema_id
  WHERE s.name = N'dbo' AND tb.name = N'UB_ERP_User' AND kc.type = N'UQ' AND kc.name = N'UQ_UB_ERP_User_Account'
)
BEGIN
  ALTER TABLE dbo.[UB_ERP_User] ADD CONSTRAINT UQ_UB_ERP_User_Account UNIQUE ([Account]);
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
  ADD [is_active] INT NOT NULL CONSTRAINT DF_UB_ERP_User_is_active DEFAULT ((1));
END

IF NOT EXISTS (
  SELECT 1
  FROM sys.columns AS c
  INNER JOIN sys.tables AS tb ON c.object_id = tb.object_id
  INNER JOIN sys.schemas AS s ON tb.schema_id = s.schema_id
  WHERE s.name = N'dbo' AND tb.name = N'${staffTable}' AND c.name = N'UserCode'
)
BEGIN
  ALTER TABLE dbo.[${staffTable}] ADD [UserCode] NVARCHAR(50) NULL;
END

IF COL_LENGTH('dbo.${staffTable}', 'UserCode') IS NOT NULL
BEGIN
  EXEC(N'
    UPDATE dbo.[${staffTable}]
    SET UserCode = LTRIM(RTRIM(code))
    WHERE (UserCode IS NULL OR LTRIM(RTRIM(UserCode)) = N'''''''') AND LTRIM(RTRIM(code)) <> N'''''''';
  ')
END

IF NOT EXISTS (
  SELECT 1
  FROM sys.columns AS c
  INNER JOIN sys.tables AS tb ON c.object_id = tb.object_id
  INNER JOIN sys.schemas AS s ON tb.schema_id = s.schema_id
  WHERE s.name = N'dbo' AND tb.name = N'${staffTable}' AND c.name = N'status'
)
BEGIN
  ALTER TABLE dbo.[${staffTable}]
  ADD [status] NVARCHAR(20) NOT NULL CONSTRAINT DF_${staffTable}_status DEFAULT (N'在职');
END

IF NOT EXISTS (
  SELECT 1
  FROM sys.columns AS c
  INNER JOIN sys.tables AS tb ON c.object_id = tb.object_id
  INNER JOIN sys.schemas AS s ON tb.schema_id = s.schema_id
  WHERE s.name = N'dbo' AND tb.name = N'${staffTable}' AND c.name = N'leave_date'
)
BEGIN
  ALTER TABLE dbo.[${staffTable}] ADD [leave_date] DATETIME NULL;
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

