/**
 * 只读：输出 Hr_staff / HR_staff 与 HR_Departments 的列结构
 * 注意：仅用于本机排查，不做任何写入操作
 */
import dotenv from 'dotenv'
import sql from 'mssql'

dotenv.config()

const encrypt = String(process.env.DB_ENCRYPT ?? 'false').toLowerCase() === 'true'
const config = {
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT || 1433),
  options: {
    encrypt,
    trustServerCertificate: String(process.env.DB_TRUST_SERVER_CERTIFICATE ?? 'true').toLowerCase() === 'true',
  },
}

const schemaName = 'dbo'
const tables = ['Hr_staff', 'HR_staff', 'HR_Departments']

const sqlText = `
SELECT
  COLUMN_NAME,
  DATA_TYPE,
  CHARACTER_MAXIMUM_LENGTH AS LEN,
  IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @table
ORDER BY ORDINAL_POSITION
`

async function main() {
  await sql.connect(config)
  try {
    for (const tableName of tables) {
      const req = new sql.Request()
      req.input('schema', sql.NVarChar(50), schemaName)
      req.input('table', sql.NVarChar(128), tableName)
      const r = await req.query(sqlText)
      console.log(`\n=== ${schemaName}.${tableName} columns=${r.recordset.length} ===`)
      for (const row of r.recordset) {
        const len = row.LEN == null ? '' : String(row.LEN)
        console.log([row.COLUMN_NAME, row.DATA_TYPE, len, row.IS_NULLABLE].join('\t'))
      }
    }
  } finally {
    await sql.close()
  }
}

main().catch((e) => {
  console.error('schema_check_failed', String(e?.message ?? e))
  process.exit(1)
})

