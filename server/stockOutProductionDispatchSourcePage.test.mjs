import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  buildRelatedOutboundAggCteSql,
  buildRelatedOutboundNoExpr,
  buildStockOutProductionDispatchFullCountSql,
  buildStockOutProductionDispatchFullListSql,
  buildStockOutProductionDispatchHeaderCountSql,
  buildStockOutProductionDispatchHeaderListSql,
  buildStockOutProductionDispatchHeaderOrderSql,
  parseWorkshopInput,
} from './stockOutProductionDispatchSourcePage.js'

describe('stock-out production-dispatch-source-page SQL', () => {
  test('头表模式按 scaj01 倒序且过滤车间/审核/结案', () => {
    const countSql = buildStockOutProductionDispatchHeaderCountSql(false)
    const listSql = buildStockOutProductionDispatchHeaderListSql(false)
    const orderSql = buildStockOutProductionDispatchHeaderOrderSql('h')
    assert.match(countSql, /ROW_NUMBER\(\)/)
    assert.match(orderSql, /scaj01.*DESC/i)
    assert.match(countSql, /scaj05.*@workshopCode/i)
    assert.match(countSql, /closed.*N'0'/i)
    assert.match(countSql, /pass.*N'1'/i)
    assert.match(listSql, /rn BETWEEN @startRow AND @endRow/)
  })

  test('全部显示模式明细 scak02=GUID 且 del=0', () => {
    const countSql = buildStockOutProductionDispatchFullCountSql(false)
    const listSql = buildStockOutProductionDispatchFullListSql(true)
    assert.match(countSql, /scak02.*GUID/i)
    assert.match(countSql, /groupRowNo/)
    assert.match(listSql, /kcaa01/)
    assert.match(listSql, /dispatchQty/)
    assert.match(listSql, /@keyword/)
    // 头表 WHERE 与明细 WHERE 之间必须有 AND，否则 2008 R2 报 Incorrect syntax near 'LTRIM'
    assert.match(countSql, /@workshopCode\s+AND\s+LTRIM\(RTRIM\(ISNULL\(CONVERT\(nvarchar\(20\), l\.\[del\]\)/i)
  })

  test('关联出库单号聚合与 CASE 文案', () => {
    const cte = buildRelatedOutboundAggCteSql()
    const expr = buildRelatedOutboundNoExpr()
    assert.match(cte, /UB_ERP_Stocks_out/)
    assert.match(cte, /kcap04/)
    assert.match(expr, /未审：/)
    assert.match(expr, /未出单/)
  })

  test('车间入参解析', () => {
    assert.equal(parseWorkshopInput('').msg, '请先选择生产车间!')
    assert.equal(parseWorkshopInput('bad,').msg, '生产车间选择错误,请重新选择!')
    const ok = parseWorkshopInput('WS01,包装部,')
    assert.equal(ok.ok, true)
    assert.equal(ok.code, 'WS01')
    assert.equal(ok.name, '包装部')
  })
})
