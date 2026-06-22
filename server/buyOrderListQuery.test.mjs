import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { buildBuyOrderListPagedSql, buildBuyOrderListWhereSql, parseBuyOrderListQuery } from './buyOrderListQuery.js'

describe('buyOrderListQuery', () => {
  test('normal list defaults to del=0 without filtering pass so closed and unaudited orders remain visible', () => {
    const q = parseBuyOrderListQuery({})
    const { whereSql, params } = buildBuyOrderListWhereSql(q)
    assert.equal(q.pageSize, 10)
    assert.match(whereSql, /h\.\[del\]/)
    assert.doesNotMatch(whereSql, /@pass/)
    assert.deepEqual(params, {})
  })

  test('paged sql uses real buy order fields and SQL Server 2008 ROW_NUMBER pagination', () => {
    const { whereSql } = buildBuyOrderListWhereSql(parseBuyOrderListQuery({ keyword: 'PI-4173A', pass: '1' }))
    const { sql } = buildBuyOrderListPagedSql({ whereSql })
    assert.match(sql, /ROW_NUMBER\(\)\s+OVER/i)
    assert.match(sql, /UB_ERP_Buy_order/i)
    assert.match(sql, /h\.\[kcaj01\]/)
    assert.match(sql, /h\.\[kcaj05\]/)
    assert.match(sql, /h\.\[kcaj08\]/)
    assert.match(sql, /h\.\[kcaj09\]/)
    assert.match(sql, /h\.\[kcaj10\]/)
    assert.match(sql, /pendingInboundQty/)
    assert.match(sql, /h\.\[addtime\]/)
    assert.match(sql, /h\.\[kehu\]/)
    assert.doesNotMatch(sql, /cgad01|cgad05|OFFSET|TRY_CONVERT|FORMAT|IIF|CONCAT/i)
  })

  test('paged sql uses safe decimal aggregation for legacy nvarchar numeric columns', () => {
    const { whereSql } = buildBuyOrderListWhereSql(parseBuyOrderListQuery({}))
    const { sql } = buildBuyOrderListPagedSql({ whereSql })
    assert.match(sql, /WHEN l\.\[kcak03\] IS NULL THEN 0/)
    assert.match(sql, /WHEN m\.\[money\] IS NULL THEN 0/)
    assert.doesNotMatch(sql, /SUM\(ISNULL\(l\.\[kcak03\], 0\)\)/)
  })
})
