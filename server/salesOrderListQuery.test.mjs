import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  buildSalesOrderListPagedSql,
  buildSalesOrderListWhereSql,
  parseSalesOrderListQuery,
} from './salesOrderListQuery.js'

describe('salesOrderListQuery', () => {
  test('buildSalesOrderListPagedSql 使用 ROW_NUMBER 分页（SQL Server 2008 R2）', () => {
    const { sql: listSql } = buildSalesOrderListPagedSql({
      whereSql: ` AND (ISNULL(h.[del], N'') = N'' OR h.[del] = N'0') `,
      calcStatusExpr: `CASE WHEN LTRIM(RTRIM(ISNULL(h.[is_pur], N''))) = N'1' THEN N'已运算' ELSE N'未运算' END`,
    })

    assert.match(listSql, /ROW_NUMBER\(\)\s+OVER\s+\(ORDER BY\s+h\.\[id\]\s+DESC\)/i)
    assert.match(listSql, /WHERE\s+h\.rn\s+BETWEEN\s+@startRow\s+AND\s+@endRow/i)
    assert.doesNotMatch(listSql, /OFFSET\s+\d+\s+ROWS/i)
    assert.match(listSql, /dbo\.\[UB_ERP_Sales_order\]\s+AS\s+h/i)
  })

  test('buildSalesOrderListWhereSql 在册排除软删、回收站仅 del=1', () => {
    const active = buildSalesOrderListWhereSql({ recycled: false })
    assert.match(active.whereSql, /\[del\].*N'0'/i)
    assert.match(active.whereSql, /ISNULL\(h\.\[del\]/i)

    const bin = buildSalesOrderListWhereSql({ recycled: true })
    assert.match(bin.whereSql, /\[del\].*=.*N'1'/i)
    assert.doesNotMatch(bin.whereSql, /N'0'/i)
  })

  test('parseSalesOrderListQuery 默认分页与回收站参数', () => {
    const q = parseSalesOrderListQuery({})
    assert.equal(q.page, 1)
    assert.equal(q.pageSize, 10)
    assert.equal(q.recycled, false)
    assert.equal(q.pass, '1')

    const bin = parseSalesOrderListQuery({ recycled: '1' })
    assert.equal(bin.recycled, true)
    assert.equal(bin.pass, '')
  })

  test('buildSalesOrderListWhereSql 支持审核状态与统一关键词', () => {
    const active = buildSalesOrderListWhereSql({
      recycled: false,
      pass: '0',
      keyword: 'PI-4166',
    })
    assert.match(active.whereSql, /h\.\[pass\].*=\s*@pass/i)
    assert.match(active.whereSql, /h\.\[xsaj01\].*LIKE\s+@keyword/is)
    assert.match(active.whereSql, /h\.\[systemcode\].*LIKE\s+@keyword/is)
    assert.match(active.whereSql, /h\.\[kehu\].*LIKE\s+@keyword/is)
  })
})
