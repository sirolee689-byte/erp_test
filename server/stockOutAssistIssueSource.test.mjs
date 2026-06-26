import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  __buildAssistIssueSourceCountSqlForTest,
  __buildAssistIssueSourceKeywordWhereForTest,
  __buildAssistIssueSourceListSqlForTest,
} from './stockOutHandlers.js'

describe('stock-out assist-issue-source-page SQL', () => {
  test('带关键字 COUNT 只支持 PI、外协商、外协单号模糊搜索', () => {
    const keywordWhere = __buildAssistIssueSourceKeywordWhereForTest(true)
    const sql = __buildAssistIssueSourceCountSqlForTest('', keywordWhere)
    assert.match(sql, /inbound_agg AS/i)
    assert.match(sql, /source AS/i)
    assert.match(sql, /UB_ERP_assist_order_list/i)
    assert.match(sql, /h\.\[wxaj01\]/i)
    assert.match(sql, /h\.\[wxaj04\]/i)
    assert.match(sql, /h\.\[wxaj05\]/i)
    assert.match(sql, /h\.\[kehu\]/i)
    assert.doesNotMatch(keywordWhere, /l\.\[kcaa01\]/i)
    assert.doesNotMatch(keywordWhere, /h\.\[wxaj02\]/i)
    assert.doesNotMatch(keywordWhere, /h\.\[rmb\]/i)
    assert.match(sql, /wxak03/i)
    assert.match(sql, /wxak08/i)
    assert.match(sql, /wxak07/i)
  })

  test('列表 SQL 含入库预聚合 JOIN 且一次查询带 totalCount', () => {
    const listSql = __buildAssistIssueSourceListSqlForTest('', '')
    assert.match(listSql, /inbound_agg AS/i)
    assert.match(listSql, /LEFT JOIN inbound_agg/i)
    assert.match(listSql, /inboundQty/i)
    assert.match(listSql, /kcan03/i)
    assert.match(listSql, /COUNT\(1\) OVER \(\) AS totalCount/i)
    assert.match(listSql, /BETWEEN @startRow AND @endRow/i)
    assert.match(listSql, /l\.\[wxak01\] = h\.\[wxaj01\]/i)
    assert.match(listSql, /ISNULL\(h\.\[pass\]/i)
    assert.match(listSql, /ISNULL\(l\.\[pass\]/i)
    assert.match(listSql, /ISNULL\(h\.\[closed\]/i)
    assert.doesNotMatch(listSql, /SELECT SUM\([\s\S]*FROM[\s\S]*UB_ERP_Stocks_Storage_list[\s\S]*\) AS inboundQty/i)
  })

  test('无关键字时 COUNT 仍从 source 统计主从行', () => {
    const sql = __buildAssistIssueSourceCountSqlForTest('', '')
    assert.match(sql, /SELECT COUNT\(1\) AS total\s+FROM source/i)
  })
})
