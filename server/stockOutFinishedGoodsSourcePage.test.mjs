import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  buildStockOutFinishedGoodsKeywordWhere,
  buildStockOutFinishedGoodsShippableLineExistsSql,
  buildStockOutFinishedGoodsSourceCountSql,
  buildStockOutFinishedGoodsSourceListSql,
} from './stockOutFinishedGoodsSourcePage.js'

const FORBIDDEN_2012 = /\b(TRY_CONVERT|TRY_CAST|FORMAT|IIF|OFFSET\s+FETCH)\b/i

function assertSql2008(sqlText) {
  assert.ok(!FORBIDDEN_2012.test(sqlText), `SQL 2008 基线违规: ${sqlText.slice(0, 120)}`)
}

describe('stock-out finished-goods-source-page SQL', () => {
  test('列表 SQL 只查销售订单主表，按 PI 一行分页', () => {
    const sql = buildStockOutFinishedGoodsSourceListSql({ hasKeyword: false })
    assert.match(sql, /FROM dbo\.\[UB_ERP_Sales_order\] AS h/i)
    assert.doesNotMatch(sql, /INNER JOIN[\s\S]*UB_ERP_Sales_order_list/i)
    assert.match(sql, /sourceOrderNo/i)
    assert.match(sql, /poNo/i)
    assert.match(sql, /customerCode/i)
    assert.match(sql, /sourceSystemcode/i)
    assert.doesNotMatch(sql, /kcaa01/i)
    assert.doesNotMatch(sql, /groupRowNo/i)
    assert.match(sql, /ROW_NUMBER\(\) OVER/i)
    assert.match(sql, /COUNT\(1\) OVER \(\) AS totalCount/i)
    assert.match(sql, /rn BETWEEN @startRow AND @endRow/i)
    assertSql2008(sql)
  })

  test('可出明细用 EXISTS 过滤：del/pass/xsak02=GUID 且 xsak03-xsak06 大于 0', () => {
    const existsSql = buildStockOutFinishedGoodsShippableLineExistsSql()
    assert.match(existsSql, /EXISTS/i)
    assert.match(existsSql, /l\.\[xsak01\]\s*=\s*h\.\[xsaj01\]/i)
    assert.match(existsSql, /ISNULL\(l\.\[del\]/i)
    assert.match(existsSql, /UB_ERP_Sales_order_list/i)
    assert.match(existsSql, /l\.\[pass\].*N'1'/is)
    assert.match(existsSql, /l\.\[del\]/i)
    assert.match(existsSql, /l\.\[xsak02\].*l\.\[GUID\]/is)
    assert.match(existsSql, /xsak03[\s\S]*-[\s\S]*xsak06[\s\S]*>\s*0/i)

    const countSql = buildStockOutFinishedGoodsSourceCountSql()
    assert.match(countSql, /EXISTS/i)
    assert.match(countSql, /h\.\[closed\].*N'0'/is)
    assert.match(countSql, /h\.\[pass\].*N'1'/is)
    assert.match(countSql, /h\.\[del\]/i)
    assertSql2008(countSql)
  })

  test('关键字只搜索用户指定的销售订单主表字段', () => {
    const where = buildStockOutFinishedGoodsKeywordWhere(true)
    for (const field of ['xsaj01', 'xsaj02', 'xsaj03', 'xsaj04', 'xsaj05', 'xsaj06', 'xsaj08', 'rmb']) {
      assert.match(where, new RegExp(`h\\.\\[${field}\\]`, 'i'))
    }
    assert.doesNotMatch(where, /l\.\[kcaa01\]/i)
    assert.doesNotMatch(where, /remark/i)
  })

  test('客户筛选按销售订单客户字段进入 SQL', () => {
    const sql = buildStockOutFinishedGoodsSourceListSql({ hasCustomerName: true })
    assert.match(sql, /h\.\[kehu\].*@customerName/is)
    assertSql2008(sql)
  })
})
