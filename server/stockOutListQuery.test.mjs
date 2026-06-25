import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  buildStockOutListPagedSql,
  buildStockOutListWhereSql,
  parseStockOutListQuery,
} from './stockOutListQuery.js'

describe('stockOutListQuery', () => {
  test('列表查询默认正常数据并用 ROW_NUMBER 分页', () => {
    const opts = parseStockOutListQuery({ page: '2', pageSize: '20', outboundType: '9', warehouseCode: 'CK01' })
    const where = buildStockOutListWhereSql(opts)
    const sql = buildStockOutListPagedSql({ whereSql: where.whereSql }).sql
    assert.equal(opts.page, 2)
    assert.equal(opts.pageSize, 20)
    assert.equal(parseStockOutListQuery({}).pageSize, 10)
    assert.equal(parseStockOutListQuery({ pageSize: '500' }).pageSize, 200)
    assert.equal(where.params.outboundType, '9')
    assert.equal(where.params.warehouseCode, 'CK01')
    assert.match(sql, /ROW_NUMBER\(\) OVER/i)
    assert.doesNotMatch(sql, /OFFSET/i)
    assert.match(sql, /UB_ERP_Stocks_out/i)
    assert.match(sql, /UB_ERP_Stocks_out_list/i)
  })

  test('默认列表只查已审核 pass=1', () => {
    const opts = parseStockOutListQuery({ page: '1' })
    const where = buildStockOutListWhereSql(opts)
    assert.equal(opts.pass, '1')
    assert.equal(where.params.pass, '1')
    assert.match(where.whereSql, /\[pass\]/)
  })

  test('显示未审核时查 pass=0', () => {
    const opts = parseStockOutListQuery({ showUnaudited: '1' })
    assert.equal(opts.pass, '0')
  })

  test('回收站只查 del=1 且不强制 pass', () => {
    const opts = parseStockOutListQuery({ recycled: '1', pass: '1' })
    const where = buildStockOutListWhereSql(opts)
    assert.equal(opts.recycled, true)
    assert.equal(where.params.pass, undefined)
    assert.match(where.whereSql, /\[del\].*= N'1'/)
  })
})

