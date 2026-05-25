/**
 * 销售订单列表 SQL 集成测试（需 .env 数据库；无 DB 时跳过）
 */
import assert from 'node:assert/strict'
import dotenv from 'dotenv'
import sql from 'mssql'
import { describe, test } from 'node:test'
import {
  buildSalesOrderCalcStatusExpr,
  buildSalesOrderListPagedSql,
  buildSalesOrderListWhereSql,
} from './salesOrderListQuery.js'

dotenv.config()

const hasDb = Boolean(process.env.DB_SERVER && process.env.DB_USER)

describe('salesOrder list SQL integration', { skip: !hasDb }, () => {
  test('在册分页查询返回 piNo 与 calcStatus 列', async () => {
    const pool = await sql.connect({
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      server: process.env.DB_SERVER,
      database: process.env.DB_DATABASE,
      port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 1433,
      options: {
        encrypt: String(process.env.DB_ENCRYPT ?? 'false').toLowerCase() === 'true',
        trustServerCertificate:
          String(process.env.DB_TRUST_SERVER_CERTIFICATE).toLowerCase() === 'true',
      },
    })

    try {
      const { whereSql } = buildSalesOrderListWhereSql({ recycled: false })
      const { sql: listSql } = buildSalesOrderListPagedSql({
        whereSql,
        calcStatusExpr: buildSalesOrderCalcStatusExpr('is_pur'),
      })
      const r = await pool
        .request()
        .input('startRow', sql.Int, 1)
        .input('endRow', sql.Int, 3)
        .query(listSql)

      assert.ok(Array.isArray(r.recordset))
      if ((r.recordset ?? []).length > 0) {
        const row = r.recordset[0]
        assert.ok('piNo' in row)
        assert.ok('calcStatus' in row)
        assert.match(String(row.calcStatus), /已运算|未运算/)
      }
    } finally {
      await pool.close()
    }
  })
})
