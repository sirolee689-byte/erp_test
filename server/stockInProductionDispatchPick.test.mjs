import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildProductionDispatchPickCountSql,
  buildProductionDispatchPickHeaderOrderSql,
  buildProductionDispatchPickKeywordSql,
  buildProductionDispatchPickKwHeadersCteSql,
  buildProductionDispatchPickListSql,
  buildProductionDispatchPickQualLinesCteSql,
  buildProductionDispatchReturnAggCteSql,
  fetchStockInProductionDispatchPickPage,
  PRODUCTION_DISPATCH_PICK_DEFAULT_PAGE_SIZE,
  validateProductionDispatchWorkshop,
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
    assert.ok(cteSql.includes('scak04'))
    assert.ok(cteSql.includes('scak05'))
    assert.ok(cteSql.includes('> 0'))
    assertSql2008(cteSql)
  })

  it('生产退料选派工明细按类型 5 放开入库余量过滤，并带出已退料数量', () => {
    const cteSql = buildProductionDispatchPickQualLinesCteSql('5')
    const returnAggSql = buildProductionDispatchReturnAggCteSql()
    const listSql = buildProductionDispatchPickListSql(false, '5')
    assert.ok(cteSql.includes('UB_ERP_Dispatch_order_list'))
    assert.ok(!cteSql.includes('scak04'), '生产退料选择派工明细不按已入库余量过滤')
    assert.ok(returnAggSql.includes("N'5'"))
    assert.ok(returnAggSql.includes('returnedQty'))
    assert.ok(listSql.includes('returned_lines'))
    assert.ok(listSql.includes('returnedQty'))
    assert.ok(listSql.includes('@workshopCode'))
    assert.ok(listSql.includes('closed'), '应过滤未结案')
    assertSql2008(cteSql)
    assertSql2008(returnAggSql)
    assertSql2008(listSql)
  })

  it('计数用 qual_lines 接头表，不用头表逐行 EXISTS', () => {
    const countSql = buildProductionDispatchPickCountSql(false)
    assert.ok(countSql.includes('UB_ERP_Dispatch_order'))
    assert.ok(countSql.includes('qual_lines'))
    assert.ok(countSql.includes('eligible'))
    assert.ok(countSql.includes('header_page'))
    assert.ok(!countSql.includes('EXISTS'), '应改为明细驱动 JOIN，避免 EXISTS 全表关联')
    assert.ok(countSql.includes('@workshopCode'))
    assert.ok(countSql.includes('closed'), '应过滤未结案')
    assert.ok(!countSql.includes('UB_ERP_Dispatch_order_list AS lk'), '禁止明细 PI 搜索 JOIN')
    assertSql2008(countSql)
  })

  it('有搜索时 kw_headers 先筛头表再 JOIN qual_lines', () => {
    const kwCte = buildProductionDispatchPickKwHeadersCteSql('4')
    const countSql = buildProductionDispatchPickCountSql(true, '4')
    const listSql = buildProductionDispatchPickListSql(true, '4')
    assert.ok(kwCte.includes('kw_headers AS'))
    assert.ok(kwCte.includes('LIKE @keyword'))
    assert.ok(countSql.includes('kw_headers'))
    assert.ok(countSql.includes('eligible'))
    assert.ok(listSql.includes('kw_headers'))
    assert.ok(listSql.includes('eligible'))
    assertSql2008(kwCte)
    assertSql2008(countSql)
    assertSql2008(listSql)
  })

  it('生产入库列表不含 returned_lines，用 COUNT OVER 带出 totalHeaders', () => {
    const listSql = buildProductionDispatchPickListSql(true, '4')
    assert.ok(!listSql.includes('returned_lines'), '生产入库不需已退料汇总')
    assert.ok(listSql.includes('COUNT(1) OVER()'))
    assert.ok(listSql.includes('totalHeaders'))
    assert.ok(listSql.includes('CAST(0 AS decimal(18, 4)) AS returnedQty'))
    assertSql2008(listSql)
  })

  it('有搜索时列表查询合并总数，不单独跑 COUNT', async () => {
    let queryCount = 0
    const pool = {
      request() {
        return {
          input() { return this },
          async query(sqlText) {
            queryCount += 1
            if (queryCount === 1) return { recordset: [{ code: '03', name: '包装部' }] }
            assert.ok(String(sqlText).includes('totalHeaders'), '列表应带 COUNT OVER 总数')
            assert.ok(!String(sqlText).includes('returned_lines'), '生产入库列表不应含 returned_lines')
            return {
              recordset: [
                { lineId: 1, dispatchNo: 'PG1111', totalHeaders: 3, hdr_rn: 1 },
              ],
            }
          },
        }
      },
    }

    const result = await fetchStockInProductionDispatchPickPage(pool, {
      workshopCode: '03',
      inboundType: '4',
      keyword: '1111',
      page: 1,
      pageSize: 10,
    })

    assert.equal(queryCount, 2, '仅车间校验 + 列表，无独立 COUNT')
    assert.equal(result.total, 3)
    assert.equal(result.list.length, 1)
  })

  it('生产入库选择窗口关键字仅搜派工单号和 PI号', () => {
    const kwSql = buildProductionDispatchPickKeywordSql()
    assert.ok(kwSql.includes('scaj01'))
    assert.ok(kwSql.includes('scaj04'))
    assert.ok(!kwSql.includes('scaj03'))
    assert.ok(!kwSql.includes('scaj05'))
    assert.ok(!kwSql.includes('scaj02'))
    assert.ok(!kwSql.includes('scaj06'))
    assert.ok(!kwSql.includes('remark'))
    assert.ok(!kwSql.includes('rmb'))
    assert.ok(!kwSql.includes('l.[pi]'))
    assert.ok(!kwSql.includes('lk.'))
    assertSql2008(kwSql)
  })

  it('生产入库空搜索不加载派工单列表', async () => {
    let queryCount = 0
    const pool = {
      request() {
        return {
          input() { return this },
          async query() {
            queryCount += 1
            if (queryCount === 1) return { recordset: [{ code: 'BZB', name: '包装部' }] }
            throw new Error('空搜索不应继续查询派工单列表')
          },
        }
      },
    }

    const result = await fetchStockInProductionDispatchPickPage(pool, {
      workshopCode: 'BZB',
      inboundType: '4',
      keyword: '',
      page: 1,
      pageSize: 10,
    })

    assert.equal(queryCount, 1)
    assert.equal(result.ok, true)
    assert.equal(result.total, 0)
    assert.deepEqual(result.list, [])
  })

  it('生产退料空搜索不加载派工单列表', async () => {
    let queryCount = 0
    const pool = {
      request() {
        return {
          input() { return this },
          async query() {
            queryCount += 1
            if (queryCount === 1) return { recordset: [{ code: 'BZB', name: '包装部' }] }
            throw new Error('空搜索不应继续查询派工单列表')
          },
        }
      },
    }

    const result = await fetchStockInProductionDispatchPickPage(pool, {
      workshopCode: 'BZB',
      inboundType: '5',
      keyword: '',
      page: 1,
      pageSize: 10,
    })

    assert.equal(queryCount, 1)
    assert.equal(result.ok, true)
    assert.equal(result.total, 0)
    assert.deepEqual(result.list, [])
  })

  it('列表 qual_lines + 头表分页再展开明细，按 addtime 倒序', () => {
    const listSql = buildProductionDispatchPickListSql(true)
    const orderSql = buildProductionDispatchPickHeaderOrderSql('h')
    assert.ok(orderSql.includes('[addtime]'))
    assert.ok(listSql.includes('qual_lines'))
    assert.ok(listSql.includes('eligible'))
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

  it('无效生产车间返回指定中文提示', async () => {
    const pool = {
      request() {
        return {
          input() { return this },
          async query() { return { recordset: [] } },
        }
      },
    }
    const result = await validateProductionDispatchWorkshop(pool, 'BAD')
    assert.equal(result.ok, false)
    assert.equal(result.status, 400)
    assert.equal(result.msg, '此生产车间错误,请重新选择!')
  })
})
