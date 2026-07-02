import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  buildStockInMaterialTraceCountSql,
  buildStockInMaterialTraceListSql,
  buildStockInMaterialTraceWhereSql,
  parseStockInMaterialTraceQuery,
} from './stockInMaterialTrace.js'

describe('stockInMaterialTrace', () => {
  test('parseStockInMaterialTraceQuery defaults pageSize to 10', () => {
    const q = parseStockInMaterialTraceQuery({})
    assert.equal(q.page, 1)
    assert.equal(q.pageSize, 10)
    assert.equal(q.all, false)
  })

  test('default WHERE filters line and header del/pass', () => {
    const { whereSql } = buildStockInMaterialTraceWhereSql({ all: true, keyword: '' })
    assert.match(whereSql, /l\.\[del\].*N'0'/i)
    assert.match(whereSql, /h\.\[del\].*N'0'/i)
    assert.match(whereSql, /l\.\[pass\].*N'1'/i)
    assert.match(whereSql, /h\.\[pass\].*N'1'/i)
  })

  test('keyword mode searches slim high-frequency columns', () => {
    const { whereSql, params } = buildStockInMaterialTraceWhereSql({ all: false, keyword: 'R26070201' })
    assert.match(whereSql, /l\.\[kcaa01\] LIKE @kw/i)
    assert.match(whereSql, /l\.\[kcao01\] LIKE @kw/i)
    assert.match(whereSql, /h\.\[ck\] LIKE @kw/i)
    assert.match(whereSql, /h\.\[kehu\] LIKE @kw/i)
    assert.doesNotMatch(whereSql, /kcaa35/i)
    assert.doesNotMatch(whereSql, /LTRIM\(RTRIM\(CONVERT/i)
    assert.equal(params.kw, '%R26070201%')
  })

  test('all=1 does not add keyword filter', () => {
    const { whereSql, params } = buildStockInMaterialTraceWhereSql({ all: true, keyword: 'ignored' })
    assert.doesNotMatch(whereSql, /@kw/)
    assert.equal(params.kw, undefined)
  })

  test('list SQL uses storage line/header direct join and ROW_NUMBER pagination', () => {
    const { whereSql } = buildStockInMaterialTraceWhereSql({ all: true, keyword: '' })
    const sqlText = buildStockInMaterialTraceListSql(whereSql)
    assert.match(sqlText, /UB_ERP_Stocks_Storage_list/i)
    assert.match(sqlText, /UB_ERP_Stocks_Storage/i)
    assert.match(sqlText, /l\.\[kcao01\] = h\.\[kcan01\]/i)
    assert.match(sqlText, /ROW_NUMBER\(\) OVER/i)
    assert.match(sqlText, /BETWEEN @startRow AND @endRow/i)
    assert.match(sqlText, /l\.\[Reference\]/i)
    assert.match(sqlText, /l\.\[Describe\]/i)
    assert.match(sqlText, /l\.\[Tax\]/i)
    assert.doesNotMatch(sqlText, /OFFSET/i)
    assert.doesNotMatch(sqlText, /TRY_CONVERT/i)
    assert.doesNotMatch(sqlText, /FORMAT/i)
    assert.doesNotMatch(sqlText, /IIF/i)
    assert.doesNotMatch(sqlText, /CONCAT/i)
  })

  test('count SQL joins header on receipt no directly', () => {
    const { whereSql } = buildStockInMaterialTraceWhereSql({ all: true, keyword: '' })
    const sqlText = buildStockInMaterialTraceCountSql(whereSql)
    assert.match(sqlText, /COUNT\(1\)/i)
    assert.match(sqlText, /INNER JOIN/i)
    assert.match(sqlText, /l\.\[kcao01\] = h\.\[kcan01\]/i)
  })
})
