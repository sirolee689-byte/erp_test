import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  buildStockOutMaterialTraceCountSql,
  buildStockOutMaterialTraceListSql,
  buildStockOutMaterialTraceWhereSql,
  parseStockOutMaterialTraceQuery,
} from './stockOutMaterialTrace.js'

describe('stockOutMaterialTrace', () => {
  test('parseStockOutMaterialTraceQuery defaults pageSize to 10', () => {
    const q = parseStockOutMaterialTraceQuery({})
    assert.equal(q.page, 1)
    assert.equal(q.pageSize, 10)
    assert.equal(q.all, false)
  })

  test('default WHERE filters line del=0 and header pass=1', () => {
    const { whereSql } = buildStockOutMaterialTraceWhereSql({ all: true, keyword: '' })
    assert.match(whereSql, /l\.\[del\].*N'0'/i)
    assert.match(whereSql, /h\.\[pass\].*N'1'/i)
    assert.match(whereSql, /h\.\[del\]/i)
  })

  test('keyword mode builds slim direct-column LIKE', () => {
    const { whereSql, params } = buildStockOutMaterialTraceWhereSql({ all: false, keyword: 'PQ-001' })
    assert.match(whereSql, /l\.\[kcaa01\] LIKE @kw/i)
    assert.match(whereSql, /l\.\[kcaq01\] LIKE @kw/i)
    assert.match(whereSql, /h\.\[ck\] LIKE @kw/i)
    assert.doesNotMatch(whereSql, /kcaa35/i)
    assert.doesNotMatch(whereSql, /LTRIM\(RTRIM\(CONVERT/i)
    assert.equal(params.kw, '%PQ-001%')
  })

  test('all=1 does not add keyword filter', () => {
    const { whereSql, params } = buildStockOutMaterialTraceWhereSql({ all: true, keyword: 'ignored' })
    assert.doesNotMatch(whereSql, /@kw/)
    assert.equal(params.kw, undefined)
  })

  test('list SQL uses direct join and ROW_NUMBER pagination', () => {
    const { whereSql } = buildStockOutMaterialTraceWhereSql({ all: true, keyword: '' })
    const sqlText = buildStockOutMaterialTraceListSql(whereSql)
    assert.match(sqlText, /UB_ERP_Stocks_out_list/i)
    assert.match(sqlText, /UB_ERP_Stocks_out/i)
    assert.match(sqlText, /l\.\[kcaq01\] = h\.\[kcap01\]/i)
    assert.match(sqlText, /ROW_NUMBER\(\) OVER/i)
    assert.match(sqlText, /BETWEEN @startRow AND @endRow/i)
    assert.doesNotMatch(sqlText, /OFFSET/i)
    assert.doesNotMatch(sqlText, /TRY_CONVERT/i)
    assert.doesNotMatch(sqlText, /COUNT\(1\) OVER/i)
  })

  test('count SQL joins header on outbound no directly', () => {
    const { whereSql } = buildStockOutMaterialTraceWhereSql({ all: true, keyword: '' })
    const sqlText = buildStockOutMaterialTraceCountSql(whereSql)
    assert.match(sqlText, /COUNT\(1\)/i)
    assert.match(sqlText, /INNER JOIN/i)
    assert.match(sqlText, /l\.\[kcaq01\] = h\.\[kcap01\]/i)
  })
})
