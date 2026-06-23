import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildProductionDispatchPickCountSql,
  buildProductionDispatchPickHeaderOrderSql,
  buildProductionDispatchPickKeywordSql,
  buildProductionDispatchPickListSql,
  buildProductionDispatchPickQualLinesCteSql,
  PRODUCTION_DISPATCH_PICK_DEFAULT_PAGE_SIZE,
} from './stockInProductionDispatchPick.js'

const FORBIDDEN_2012 = /\b(TRY_CONVERT|TRY_CAST|FORMAT|IIF|OFFSET\s+FETCH)\b/i

function assertSql2008(sqlText) {
  assert.ok(!FORBIDDEN_2012.test(sqlText), `SQL 2008 基线违规: ${sqlText.slice(0, 120)}`)
}

describe('stockIn production-dispatch-pick-page SQL', () => {
  it('默认每页 10 张派工单', () => {
    assert.equal(PRODUCTION_DISPATCH_PICK_DEFAULT_PAGE_SIZE, 10)
  })

  it('qual_lines CTE 从明细筛有余量派工单号', () => {
    const cteSql = buildProductionDispatchPickQualLinesCteSql()
    assert.ok(cteSql.includes('qual_lines AS'))
    assert.ok(cteSql.includes('SELECT DISTINCT'))
    assert.ok(cteSql.includes('UB_ERP_Dispatch_order_list'))
    assert.ok(cteSql.includes('scak02'))
    assert.ok(cteSql.includes('[GUID]'))
    assert.ok(cteSql.includes('scak03'))
    assertSql2008(cteSql)
  })

  it('计数用 qual_lines 接头表，不用头表逐行 EXISTS', () => {
    const countSql = buildProductionDispatchPickCountSql(false)
    assert.ok(countSql.includes('UB_ERP_Dispatch_order'))
    assert.ok(countSql.includes('qual_lines'))
    assert.ok(countSql.includes('INNER JOIN qual_lines'))
    assert.ok(!countSql.includes('EXISTS'), '应改为明细驱动 JOIN，避免 EXISTS 全表关联')
    assert.ok(countSql.includes('@workshopCode'))
    assert.ok(countSql.includes('closed'), '应过滤未结案')
    assert.ok(!countSql.includes('UB_ERP_Dispatch_order_list AS lk'), '禁止明细 PI 搜索 JOIN')
    assertSql2008(countSql)
  })

  it('关键字仅搜头表字段', () => {
    const kwSql = buildProductionDispatchPickKeywordSql()
    assert.ok(kwSql.includes('scaj01'))
    assert.ok(kwSql.includes('scaj04'))
    assert.ok(kwSql.includes('scaj02'))
    assert.ok(kwSql.includes('scaj06'))
    assert.ok(kwSql.includes('remark'))
    assert.ok(!kwSql.includes('l.[pi]'))
    assert.ok(!kwSql.includes('lk.'))
    assertSql2008(kwSql)
  })

  it('列表 qual_lines + 头表分页再展开明细，按 addtime 倒序', () => {
    const listSql = buildProductionDispatchPickListSql(true)
    const orderSql = buildProductionDispatchPickHeaderOrderSql('h')
    assert.ok(orderSql.includes('[addtime]'))
    assert.ok(listSql.includes('qual_lines'))
    assert.ok(listSql.includes('INNER JOIN qual_lines'))
    assert.ok(listSql.includes('header_page'))
    assert.ok(listSql.includes('hdr_rn BETWEEN @startRow AND @endRow'))
    assert.ok(listSql.includes('picked'))
    assert.ok(listSql.includes('dispatchNo'))
    assert.ok(listSql.includes('dispatchSystemcode'))
    assert.ok(listSql.includes('ORDER BY p.[hdr_rn] ASC'))
    assert.ok(!listSql.includes('EXISTS'))
    assertSql2008(listSql)
    assertSql2008(orderSql)
  })
})
