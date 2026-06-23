import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  __buildSourceOrderCountSqlForTest,
  __buildSourceOrderKeywordSqlForTest,
  __buildSourceOrderListSqlForTest,
  __buildSourceOrderPartyFilterSqlForTest,
  __stockInSourceMetaForTest,
} from './stockInHandlers.js'

function sourceOrderBaseWhereSql(extraKeywordSql = '') {
  return `
    WHERE (ISNULL(h.[del], N'') = N'' OR h.[del] = N'0')
      AND LTRIM(RTRIM(ISNULL(h.[pass], N''))) = N'1'
      AND LTRIM(RTRIM(ISNULL(h.[closed], N'0'))) = N'0'
      ${extraKeywordSql}
  `
}

const FORBIDDEN_2012 = /\b(TRY_CONVERT|TRY_CAST|FORMAT|IIF|OFFSET\s+FETCH)\b/i

function assertSql2008(sqlText) {
  assert.ok(!FORBIDDEN_2012.test(sqlText), `SQL 2008 基线违规: ${sqlText.slice(0, 120)}`)
}

describe('stockIn source-order-page SQL', () => {
  it('派工类型关键字不含 referenceExpr 标量子查询', () => {
    const meta = __stockInSourceMetaForTest('4')
    const kwSql = __buildSourceOrderKeywordSqlForTest('4', meta)
    assert.ok(kwSql.includes('lk.[id] IS NOT NULL'), 'PI 搜索应走 LEFT JOIN 命中')
    assert.ok(kwSql.includes('scaj04'), '头表 PI 应可直接搜')
    assert.ok(!kwSql.includes('SELECT TOP 1'), 'WHERE 禁止 TOP 1 标量子查询')
    assert.ok(!kwSql.includes('EXISTS'), 'WHERE 禁止 EXISTS 与 ROW_NUMBER 组合')
  })

  it('派工带关键字 COUNT 使用 COUNT DISTINCT', () => {
    const meta = __stockInSourceMetaForTest('4')
    const kwSql = __buildSourceOrderKeywordSqlForTest('4', meta)
    const countSql = __buildSourceOrderCountSqlForTest('4', meta, kwSql, true)
    assert.ok(countSql.includes('COUNT(DISTINCT h.[id])'))
    assert.ok(countSql.includes('LEFT JOIN'))
  })

  it('派工带关键字列表先 DISTINCT 再分页', () => {
    const meta = __stockInSourceMetaForTest('4')
    const kwSql = __buildSourceOrderKeywordSqlForTest('4', meta)
    const baseWhere = sourceOrderBaseWhereSql(kwSql)
    const listSql = __buildSourceOrderListSqlForTest('4', meta, baseWhere, true)
    assert.ok(listSql.includes('SELECT DISTINCT'))
    assert.ok(listSql.includes('LEFT JOIN'))
    assertSql2008(listSql)
  })

  it('派工列表 SQL 先分页再 OUTER APPLY PI', () => {
    const meta = __stockInSourceMetaForTest('4')
    const listSql = __buildSourceOrderListSqlForTest('4', meta)
    const applyPos = listSql.indexOf('OUTER APPLY')
    const pageFilterPos = listSql.indexOf('WHERE src.rn BETWEEN @startRow AND @endRow')
    const rnBetweenPos = listSql.lastIndexOf('WHERE src.rn BETWEEN @startRow AND @endRow')
    assert.ok(applyPos > 0, '应有 OUTER APPLY')
    assert.ok(pageFilterPos > 0 && pageFilterPos < applyPos, '应先按 rn 分页再 APPLY')
    assert.ok(rnBetweenPos === pageFilterPos, '分页条件应只出现一次')
    assert.ok(listSql.includes('UB_ERP_Stocks_workshop'), '车间名应 LEFT JOIN')
    assertSql2008(listSql)
  })

  it('采购入库列表 SQL 不出现 referenceNo 重复 AS', () => {
    const meta = __stockInSourceMetaForTest('1')
    const listSql = __buildSourceOrderListSqlForTest('1', meta)
    assert.ok(!listSql.includes('AS referenceNo AS'), 'referenceSelect 与外层别名不得重复 AS')
    assert.ok(listSql.includes('AS referenceNo'), '应保留 referenceNo 列别名')
    assert.ok(listSql.includes('UB_ERP_Buy_order'), '应查采购单头表')
    assert.ok(listSql.includes('UB_ERP_System_supplier'), '应 JOIN 供应商取名称')
    assertSql2008(listSql)
  })

  it('外协类型关键字可搜 wxaj04', () => {
    const meta = __stockInSourceMetaForTest('2')
    const kwSql = __buildSourceOrderKeywordSqlForTest('2', meta)
    assert.ok(kwSql.includes('wxaj04'))
    assertSql2008(kwSql)
  })

  it('派工类型按生产车间 scaj05 过滤', () => {
    const meta = __stockInSourceMetaForTest('4')
    const partySql = __buildSourceOrderPartyFilterSqlForTest(meta)
    const baseWhere = sourceOrderBaseWhereSql(partySql)
    const listSql = __buildSourceOrderListSqlForTest('4', meta, baseWhere, false)
    const countSql = __buildSourceOrderCountSqlForTest('4', meta, '', false, partySql)
    assert.ok(partySql.includes('scaj05'))
    assert.ok(partySql.includes('@relatedPartyCode'))
    assert.ok(listSql.includes('@relatedPartyCode'))
    assert.ok(countSql.includes('@relatedPartyCode'))
    assertSql2008(listSql)
    assertSql2008(countSql)
  })
})
