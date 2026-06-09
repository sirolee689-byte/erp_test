import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  buildAssistOrderListPagedSql,
  buildAssistOrderListWhereSql,
  parseAssistOrderListQuery,
} from './assistOrderListQuery.js'

describe('assistOrderListQuery', () => {
  test('buildAssistOrderListPagedSql uses ROW_NUMBER pagination for SQL Server 2008 R2', () => {
    const { whereSql } = buildAssistOrderListWhereSql(parseAssistOrderListQuery({}))
    const { sql: listSql } = buildAssistOrderListPagedSql({ whereSql })

    assert.match(listSql, /ROW_NUMBER\(\)\s+OVER\s+\(ORDER BY\s+h\.\[id\]\s+DESC\)/i)
    assert.match(listSql, /WHERE\s+h\.rn\s+BETWEEN\s+@startRow\s+AND\s+@endRow/i)
    assert.doesNotMatch(listSql, /OFFSET\s+\d+\s+ROWS/i)
    assert.match(listSql, /dbo\.\[UB_ERP_assist_order\]\s+AS\s+h/i)
  })

  test('default list query filters audited and not deleted orders', () => {
    const parsed = parseAssistOrderListQuery({})
    const { whereSql } = buildAssistOrderListWhereSql(parsed)

    assert.equal(parsed.page, 1)
    assert.equal(parsed.pageSize, 10)
    assert.equal(parsed.pass, '1')
    assert.equal(parsed.recycled, false)
    assert.match(whereSql, /h\.\[pass\].*=\s*@pass/i)
    assert.match(whereSql, /ISNULL\(h\.\[del\]/i)
    assert.match(whereSql, /\[del\].*N'0'/i)
  })

  test('recycled list query filters deleted orders without audited default', () => {
    const parsed = parseAssistOrderListQuery({ recycled: '1', pass: '1' })
    const { whereSql } = buildAssistOrderListWhereSql(parsed)

    assert.equal(parsed.recycled, true)
    assert.equal(parsed.pass, '')
    assert.match(whereSql, /\[del\].*=.*N'1'/i)
    assert.doesNotMatch(whereSql, /h\.\[pass\].*=\s*@pass/i)
  })

  test('advanced filters support unaudited, closed status, keyword, supplier, assist type, and delivery sort', () => {
    const parsed = parseAssistOrderListQuery({
      showUnaudited: '1',
      closed: '0',
      keyword: 'WX2606',
      supplier: 'S001',
      assistType: '2',
      sortBy: 'deliveryDate',
    })
    const { whereSql, params } = buildAssistOrderListWhereSql(parsed)
    const { sql: listSql } = buildAssistOrderListPagedSql({ whereSql, sortBy: parsed.sortBy })

    assert.equal(parsed.pass, '0')
    assert.equal(parsed.closed, '0')
    assert.equal(parsed.keyword, 'WX2606')
    assert.equal(parsed.supplier, 'S001')
    assert.equal(parsed.assistType, '2')
    assert.equal(params.keyword, '%WX2606%')
    assert.match(whereSql, /h\.\[closed\].*=\s*@closed/i)
    assert.match(whereSql, /h\.\[wxaj03\].*=\s*@assistType/i)
    assert.match(whereSql, /h\.\[wxaj05\].*LIKE\s+@supplier/i)
    assert.match(whereSql, /h\.\[wxaj01\]/i)
    assert.match(whereSql, /h\.\[notes\]/i)
    assert.match(listSql, /ORDER BY\s+h\.\[wxaj08\]\s+ASC/i)
  })

  test('list sql exposes line and fee summary columns', () => {
    const { whereSql } = buildAssistOrderListWhereSql(parseAssistOrderListQuery({}))
    const { sql: listSql } = buildAssistOrderListPagedSql({ whereSql })

    assert.match(listSql, /lineAgg\.\[itemCount\]/i)
    assert.match(listSql, /lineAgg\.\[totalQty\]/i)
    assert.match(listSql, /lineAgg\.\[taxIncludedTotal\]/i)
    assert.match(listSql, /lineAgg\.\[taxExcludedTotal\]/i)
    assert.match(listSql, /feeAgg\.\[extraFeeTotal\]/i)
    assert.match(listSql, /UB_ERP_assist_order_list/i)
    assert.match(listSql, /UB_ERP_assist_order_money/i)
  })
})
