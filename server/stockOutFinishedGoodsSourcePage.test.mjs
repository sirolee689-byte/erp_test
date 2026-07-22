import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  buildStockOutFinishedGoodsKeywordWhere,
  buildStockOutFinishedGoodsShippableLineExistsSql,
  buildStockOutFinishedGoodsSourceListSql,
  fetchStockOutFinishedGoodsSourcePage,
} from './stockOutFinishedGoodsSourcePage.js'

const FORBIDDEN_2012 = /\b(TRY_CONVERT|TRY_CAST|FORMAT|IIF|OFFSET\s+FETCH)\b/i

function assertSql2008(sqlText) {
  assert.ok(!FORBIDDEN_2012.test(sqlText), `SQL 2008 基线违规: ${sqlText.slice(0, 120)}`)
}

describe('stock-out finished-goods-source-page SQL', () => {
  test('列表 SQL 主从展开，按明细行分页', () => {
    const sql = buildStockOutFinishedGoodsSourceListSql({ hasKeyword: false })
    assert.match(sql, /FROM dbo\.\[UB_ERP_Sales_order\] AS h/i)
    assert.match(sql, /INNER JOIN[\s\S]*UB_ERP_Sales_order_list/i)
    assert.match(sql, /sourceOrderNo/i)
    assert.match(sql, /orderDate/i)
    assert.match(sql, /deliveryDate/i)
    assert.match(sql, /poNo/i)
    assert.match(sql, /customerCode/i)
    assert.match(sql, /sourceSystemcode/i)
    assert.match(sql, /kcaa01/i)
    assert.match(sql, /AS orderQty/i)
    assert.match(sql, /xsak03/i)
    assert.match(sql, /plan_quantity/i)
    assert.match(sql, /AS customerStyleNo/i)
    assert.match(sql, /kcaa06/i)
    assert.match(sql, /AS factoryStyleNo/i)
    assert.match(sql, /kcaa09/i)
    assert.match(sql, /groupRowNo/)
    assert.match(sql, /ROW_NUMBER\(\) OVER/i)
    assert.match(sql, /COUNT\(1\) OVER\(\) AS total/i)
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

    const listSql = buildStockOutFinishedGoodsSourceListSql()
    assert.match(listSql, /EXISTS/i)
    assert.match(listSql, /h\.\[closed\].*N'0'/is)
    assert.match(listSql, /h\.\[pass\].*N'1'/is)
    assert.match(listSql, /h\.\[del\]/i)
    assert.match(listSql, /COUNT\(1\) OVER\(\) AS total/i)
    assertSql2008(listSql)
  })

  test('展开明细 xsak02=GUID 且 del/pass 有效，JOIN 不要求 xsak03-xsak06>0', () => {
    const sql = buildStockOutFinishedGoodsSourceListSql({ hasKeyword: false })
    assert.match(sql, /l\.\[xsak02\].*l\.\[GUID\]/is)
    assert.match(sql, /l\.\[pass\].*N'1'/is)
    // xsak03-xsak06>0 仅出现在 EXISTS（PI 进列表），不在 JOIN 明细 WHERE
    const joinLineFilter = sql.split('INNER JOIN')[1]?.split(')')[0] ?? ''
    assert.doesNotMatch(joinLineFilter, /xsak03[\s\S]*xsak06[\s\S]*>\s*0/i)
  })

  test('关键字搜索主表字段与明细 kcaa01/kcaa02/kcaa03', () => {
    const where = buildStockOutFinishedGoodsKeywordWhere(true)
    for (const field of ['xsaj01', 'xsaj02', 'xsaj03', 'xsaj04', 'xsaj05', 'xsaj06', 'xsaj08', 'rmb']) {
      assert.match(where, new RegExp(`h\\.\\[${field}\\]`, 'i'))
    }
    assert.match(where, /l\.\[kcaa01\]/i)
    assert.match(where, /l\.\[kcaa02\]/i)
    assert.match(where, /l\.\[kcaa03\]/i)
    assert.doesNotMatch(where, /remark/i)
    assert.doesNotMatch(where, /LTRIM\(RTRIM/i)
  })

  test('客户筛选按销售订单客户字段进入 SQL', () => {
    const sql = buildStockOutFinishedGoodsSourceListSql({ hasCustomerName: true })
    assert.match(sql, /h\.\[kehu\].*@customerName/is)
    assertSql2008(sql)
  })

  test('分页只执行一条列表 SQL，并从窗口总数返回 total', async () => {
    const queries = []
    const pool = {
      request() {
        const request = {
          input() { return request },
          async query(sqlText) {
            queries.push(sqlText)
            return { recordset: [{ sourceOrderNo: 'PI-001', total: 31, rn: 1 }] }
          },
        }
        return request
      },
    }

    const result = await fetchStockOutFinishedGoodsSourcePage(pool, { keyword: 'PI', page: 1, pageSize: 10 })
    assert.equal(queries.length, 1)
    assert.match(queries[0], /COUNT\(1\) OVER\(\) AS total/i)
    assert.equal(result.total, 31)
    assert.equal(result.list[0].total, 31)
  })
})
