import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildDispatchOrderListPagedSql,
  buildDispatchOrderListWhereSql,
  parseDispatchOrderListQuery,
} from './dispatchOrderListQuery.js'

test('派工单列表默认只看已审在册，未审核开关只看未审', () => {
  const normal = parseDispatchOrderListQuery({})
  assert.equal(normal.pass, '1')
  assert.equal(normal.recycled, false)

  const unaudited = parseDispatchOrderListQuery({ showUnaudited: '1' })
  assert.equal(unaudited.pass, '0')

  const { whereSql } = buildDispatchOrderListWhereSql(unaudited)
  assert.match(whereSql, /h\.\[del\]/)
  assert.match(whereSql, /h\.\[pass\]/)
})

test('派工单回收站只按 del=1，不附加 pass 过滤', () => {
  const q = parseDispatchOrderListQuery({ recycled: '1', showUnaudited: '1' })
  assert.equal(q.recycled, true)
  assert.equal(q.pass, '')
  const { whereSql } = buildDispatchOrderListWhereSql(q)
  assert.match(whereSql, /h\.\[del\].*= N'1'/)
  assert.doesNotMatch(whereSql, /@pass/)
})

test('派工单列表分页使用 ROW_NUMBER，兼容 SQL Server 2008 R2', () => {
  const { sql } = buildDispatchOrderListPagedSql({ whereSql: '' })
  assert.match(sql, /ROW_NUMBER\(\) OVER/)
  assert.match(sql, /BETWEEN @startRow AND @endRow/)
  assert.doesNotMatch(sql.toUpperCase(), /OFFSET\s+\d+\s+ROWS/)
  assert.doesNotMatch(sql.toUpperCase(), /TRY_CONVERT|TRY_CAST|FORMAT\(|IIF\(|CONCAT\(/)
})
