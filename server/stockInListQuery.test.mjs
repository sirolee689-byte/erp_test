import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  buildStockInListPagedSql,
  buildStockInListWhereSql,
  parseStockInListQuery,
} from './stockInListQuery.js'

describe('stockInListQuery', () => {
  test('列表分页使用 ROW_NUMBER，兼容 SQL Server 2008 R2', () => {
    const q = parseStockInListQuery({ page: '2', pageSize: '20', receiptNo: 'R260617' })
    const { whereSql, params } = buildStockInListWhereSql(q)
    const { sql } = buildStockInListPagedSql({ whereSql })

    assert.equal(q.page, 2)
    assert.equal(q.pageSize, 20)
    assert.equal(params.receiptNo, '%R260617%')
    assert.match(sql, /ROW_NUMBER\(\)\s+OVER/i)
    assert.doesNotMatch(sql, /OFFSET\s+\d+\s+ROWS/i)
    assert.doesNotMatch(sql, /FETCH\s+NEXT/i)
  })

  test('正常列表排除回收站，回收站只查 del=1', () => {
    const normal = buildStockInListWhereSql(parseStockInListQuery({}))
    assert.match(normal.whereSql, /ISNULL\(h\.\[del\]/i)
    assert.match(normal.whereSql, /h\.\[del\]\s*=\s*N'0'/i)

    const recycled = buildStockInListWhereSql(parseStockInListQuery({ recycled: '1' }))
    assert.match(recycled.whereSql, /h\.\[del\].*N'1'/is)
    assert.doesNotMatch(recycled.whereSql, /@pass/)
  })

  test('关键词覆盖单号、日期、关联单号、纸质单号、备注（不含供应商）', () => {
    const { whereSql, params } = buildStockInListWhereSql(parseStockInListQuery({ keyword: '2026-06' }))
    assert.equal(params.keyword, '%2026-06%')
    assert.match(whereSql, /\[kcan01\]/)
    assert.match(whereSql, /\[kcan02\].*120/i)
    assert.match(whereSql, /\[kcan04\]/)
    assert.match(whereSql, /\[kcan08\]/)
    assert.match(whereSql, /\[remark\]/)
    assert.doesNotMatch(whereSql, /\[kehu\].*@keyword/is)
  })

  test('显示未复核时排除 sp_flag=1', () => {
    const { whereSql } = buildStockInListWhereSql(parseStockInListQuery({ showUnreviewed: '1' }))
    assert.match(whereSql, /\[sp_flag\].*<>.*N'1'/is)
  })

  test('支持 PRD 要求的搜索条件', () => {
    const { whereSql, params } = buildStockInListWhereSql(
      parseStockInListQuery({
        receiptNo: 'R',
        inboundType: '1',
        warehouseCode: 'WH',
        relatedParty: '供应商',
        sourceOrderNo: 'PO',
        pass: '0',
        inboundDateStart: '2026-06-01',
        inboundDateEnd: '2026-06-17',
        paperNo: 'DN',
      }),
    )

    assert.equal(params.pass, '0')
    assert.equal(params.inboundType, '1')
    assert.equal(params.warehouseCode, 'WH')
    assert.equal(params.inboundDateEnd, '2026-06-17 23:59:59')
    assert.match(whereSql, /\[kcan01\]/)
    assert.match(whereSql, /\[kcan03\]/)
    assert.match(whereSql, /\[kcan06\]/)
    assert.match(whereSql, /\[kehu\]/)
    assert.match(whereSql, /\[kcan04\]/)
    assert.match(whereSql, /\[kcan08\]/)
  })
})

