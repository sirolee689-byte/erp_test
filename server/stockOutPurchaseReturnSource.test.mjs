import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  __buildPurchaseReturnSourceCountSqlForTest,
  __buildPurchaseReturnSourceListSqlForTest,
} from './stockOutHandlers.js'

const FORBIDDEN_2012 = /\b(TRY_CONVERT|TRY_CAST|FORMAT|IIF|OFFSET\s+FETCH)\b/i

function assertSql2008(sqlText) {
  assert.ok(!FORBIDDEN_2012.test(sqlText), `SQL 2008 基线违规: ${sqlText.slice(0, 120)}`)
}

const keywordWhere = `AND (
  LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(h.[kcaj01], N'')))) LIKE @keyword
  OR LTRIM(RTRIM(CONVERT(nvarchar(500), ISNULL(l.[kcaa03], N'')))) LIKE @keyword
)`

describe('stock-out purchase-return-source-page SQL', () => {
  it('带关键字 COUNT 使用 source CTE 且 JOIN 明细表', () => {
    const countSql = __buildPurchaseReturnSourceCountSqlForTest('', keywordWhere)
    assert.ok(countSql.includes('WITH source AS'), 'COUNT 应包在 source CTE 内')
    assert.ok(countSql.includes('SELECT COUNT(1) AS total'), '应统计总数')
    assert.ok(countSql.includes('FROM source'), '应从 source 计数')
    assert.ok(countSql.includes('UB_ERP_Buy_order_list'), '应 JOIN 采购明细')
    assert.ok(countSql.includes('l.[kcaa03]'), '关键字可搜明细规格')
    assert.ok(!/SELECT COUNT\(1\) AS total\s+FROM\s+dbo\.\[UB_ERP_Buy_order\]/i.test(countSql), '禁止仅查主表却引用 l 别名')
    assertSql2008(countSql)
  })

  it('列表 SQL 与 COUNT 共用 source CTE', () => {
    const listSql = __buildPurchaseReturnSourceListSqlForTest('', keywordWhere)
    assert.ok(listSql.includes('WITH source AS'), '列表应使用 source CTE')
    assert.ok(listSql.includes('WHERE rn BETWEEN @startRow AND @endRow'), '列表应分页')
    assert.ok(listSql.includes('l.[kcaa03]'), '列表关键字可搜明细')
    assertSql2008(listSql)
  })

  it('无关键字时 COUNT 仍从 source 统计主从行', () => {
    const countSql = __buildPurchaseReturnSourceCountSqlForTest('', '')
    assert.ok(countSql.includes('FROM source'))
    assert.ok(countSql.includes('INNER JOIN'))
    assertSql2008(countSql)
  })
})
