import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  __buildAssistSourceDetailCountSqlForTest,
  __buildAssistSourceDetailKeywordSqlForTest,
  __buildAssistSourceDetailListSqlForTest,
  __buildAssistSourceInboundStatsSqlForTest,
  __classifyAssistSourceKeywordForTest,
  __buildPurchaseSourceDetailKeywordSqlForTest,
  __buildPurchaseSourceDetailCountSqlForTest,
  __buildPurchaseSourceDetailListSqlForTest,
  __classifyPurchaseSourceKeywordForTest,
  __buildSourceOrderCountSqlForTest,
  __buildSourceOrderKeywordSqlForTest,
  __buildSourceOrderListSqlForTest,
  __buildSourceOrderPartyFilterSqlForTest,
  __buildMaterialOptionsSqlForTest,
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
  assert.ok(!FORBIDDEN_2012.test(sqlText), `SQL 2008 baseline violation: ${sqlText.slice(0, 120)}`)
}

describe('stockIn source-order-page SQL', () => {
  it('dispatch keyword search uses a detail LEFT JOIN instead of scalar subqueries', () => {
    const meta = __stockInSourceMetaForTest('4')
    const kwSql = __buildSourceOrderKeywordSqlForTest('4', meta)
    assert.ok(kwSql.includes('lk.[id] IS NOT NULL'))
    assert.ok(kwSql.includes('scaj04'))
    assert.ok(!kwSql.includes('SELECT TOP 1'))
    assert.ok(!kwSql.includes('EXISTS'))
  })

  it('dispatch keyword COUNT uses COUNT DISTINCT', () => {
    const meta = __stockInSourceMetaForTest('4')
    const kwSql = __buildSourceOrderKeywordSqlForTest('4', meta)
    const countSql = __buildSourceOrderCountSqlForTest('4', meta, kwSql, true)
    assert.ok(countSql.includes('COUNT(DISTINCT h.[id])'))
    assert.ok(countSql.includes('LEFT JOIN'))
  })

  it('dispatch keyword list de-duplicates before pagination', () => {
    const meta = __stockInSourceMetaForTest('4')
    const kwSql = __buildSourceOrderKeywordSqlForTest('4', meta)
    const baseWhere = sourceOrderBaseWhereSql(kwSql)
    const listSql = __buildSourceOrderListSqlForTest('4', meta, baseWhere, true)
    assert.ok(listSql.includes('SELECT DISTINCT'))
    assert.ok(listSql.includes('LEFT JOIN'))
    assertSql2008(listSql)
  })

  it('dispatch list paginates before OUTER APPLY PI lookup', () => {
    const meta = __stockInSourceMetaForTest('4')
    const listSql = __buildSourceOrderListSqlForTest('4', meta)
    const applyPos = listSql.indexOf('OUTER APPLY')
    const pageFilterPos = listSql.indexOf('WHERE src.rn BETWEEN @startRow AND @endRow')
    const rnBetweenPos = listSql.lastIndexOf('WHERE src.rn BETWEEN @startRow AND @endRow')
    assert.ok(applyPos > 0)
    assert.ok(pageFilterPos > 0 && pageFilterPos < applyPos)
    assert.equal(rnBetweenPos, pageFilterPos)
    assert.ok(listSql.includes('UB_ERP_Stocks_workshop'))
    assertSql2008(listSql)
  })

  it('purchase source picker is a purchase order detail summary', () => {
    const listSql = __buildPurchaseSourceDetailListSqlForTest('')
    assert.ok(listSql.includes('UB_ERP_Buy_order'))
    assert.ok(listSql.includes('UB_ERP_Buy_order_list'))
    assert.ok(listSql.includes('UB_ERP_Finance_currency'))
    assert.ok(!listSql.includes('UB_ERP_Stocks_Storage'))
    assert.ok(!listSql.includes('UB_ERP_Stocks_out'))
    assert.ok(listSql.includes('groupRowNo'))
    assert.ok(listSql.includes("h.[closed], N'0'"))
    assert.ok(listSql.includes("h.[pass], N''"))
    assert.ok(listSql.includes("l.[del], N''"))
    assertSql2008(listSql)
  })

  it('purchase source picker fetches the source page before inventory statistics are enriched in Node', () => {
    const listSql = __buildPurchaseSourceDetailListSqlForTest('')
    const numberedPos = listSql.indexOf('numbered AS')
    const pageFilterPos = listSql.indexOf('WHERE rn BETWEEN @startRow AND @endRow')
    assert.ok(numberedPos > 0)
    assert.ok(pageFilterPos > numberedPos)
    assert.ok(!listSql.includes('inbound_agg AS'))
    assert.ok(!listSql.includes('return_agg AS'))
    assertSql2008(listSql)
  })

  it('purchase source keyword search chooses the narrowest useful predicate', () => {
    assert.equal(__classifyPurchaseSourceKeywordForTest('ZY-260904'), 'order')
    assert.equal(__classifyPurchaseSourceKeywordForTest('OA-10431'), 'material')
    assert.equal(__classifyPurchaseSourceKeywordForTest('Piquadro'), 'full')

    const orderSql = __buildPurchaseSourceDetailKeywordSqlForTest('ZY-260904')
    assert.ok(orderSql.includes('h.[kcaj01] = @kwExact'))
    assert.ok(orderSql.includes('h.[kcaj01] LIKE @kwPrefix'))
    assert.ok(!orderSql.includes('l.[kcaa01]'))

    const materialSql = __buildPurchaseSourceDetailKeywordSqlForTest('OA-10431')
    assert.ok(materialSql.includes('l.[kcaa01] = @kwExact'))
    assert.ok(materialSql.includes('l.[kcaa01] LIKE @kwPrefix'))
    assert.ok(!materialSql.includes('h.[kcaj04]'))

    const fullSql = __buildPurchaseSourceDetailKeywordSqlForTest('supplier')
    assert.ok(fullSql.includes('kcaj04'))
    assert.ok(fullSql.includes('kcaa02'))
    assertSql2008(orderSql)
    assertSql2008(materialSql)
    assertSql2008(fullSql)
  })

  it('purchase source picker keyword covers purchase fields, PI text, material fields, and currency', () => {
    const keywordSql = `
      AND (
        h.[kcaj01] LIKE @kw
        OR h.[kcaj02] LIKE @kw
        OR h.[kcaj03] LIKE @kw
        OR h.[kcaj04] LIKE @kw
        OR h.[kcaj05] LIKE @kw
        OR h.[kcaj06] LIKE @kw
        OR h.[kcaj08] LIKE @kw
        OR h.[rmb] LIKE @kw
        OR l.[kcaa01] LIKE @kw
      )
    `
    const countSql = __buildPurchaseSourceDetailCountSqlForTest(keywordSql)
    const listSql = __buildPurchaseSourceDetailListSqlForTest(keywordSql)
    for (const col of ['kcaj01', 'kcaj02', 'kcaj03', 'kcaj04', 'kcaj05', 'kcaj06', 'kcaj08', 'rmb', 'kcaa01']) {
      assert.ok(countSql.includes(col), `${col} should be searchable`)
    }
    assert.ok(countSql.includes('UB_ERP_Buy_order_list'))
    assert.ok(listSql.includes('GROUP BY'))
    assert.ok(countSql.includes("h.[closed], N'0'"))
    assert.ok(countSql.includes("h.[pass], N''"))
    assertSql2008(countSql)
    assertSql2008(listSql)
  })

  it('assist type keyword searches wxaj04', () => {
    const meta = __stockInSourceMetaForTest('2')
    const kwSql = __buildSourceOrderKeywordSqlForTest('2', meta)
    assert.ok(kwSql.includes('wxaj04'))
    assertSql2008(kwSql)
  })

  it('assist source picker is an assist order detail summary by default approved only', () => {
    const listSql = __buildAssistSourceDetailListSqlForTest()
    const countSql = __buildAssistSourceDetailCountSqlForTest()
    assert.ok(listSql.includes('UB_ERP_assist_order'))
    assert.ok(listSql.includes('UB_ERP_assist_order_list'))
    assert.ok(listSql.includes('UB_ERP_Finance_currency'))
    assert.ok(listSql.includes('wxak01'))
    assert.ok(listSql.includes('wxaj01'))
    assert.ok(listSql.includes('CONVERT(nvarchar(10), h.[wxaj02], 120) AS assistDate'))
    assert.ok(listSql.includes('wxak08'))
    assert.ok(listSql.includes('groupRowNo'))
    assert.ok(listSql.includes('MIN(l.[id]) AS lineId'))
    assert.ok(!listSql.includes('GROUP BY\n        h.[id],\n        l.[id]'))
    assert.ok(listSql.includes("h.[closed], N'0'"))
    assert.ok(listSql.includes("h.[pass], N''"))
    assert.ok(listSql.includes("l.[del], N''"))
    assert.ok(!listSql.includes(' AS unitPrice'))
    assert.ok(!listSql.includes(' AS unitPriceTax'))
    assert.ok(!listSql.includes(' AS amount'))
    assert.ok(!listSql.includes(' AS amountTax'))
    assert.ok(countSql.includes('COUNT(1) AS total'))
    assertSql2008(listSql)
    assertSql2008(countSql)
  })

  it('assist source picker can include unaudited rows for disabled display', () => {
    const listSql = __buildAssistSourceDetailListSqlForTest({ includeUnaudited: true })
    assert.ok(!listSql.includes("LTRIM(RTRIM(ISNULL(h.[pass], N''))) = N'1'"))
    assert.ok(listSql.includes('AS pass'))
    assertSql2008(listSql)
  })

  it('assist source picker keyword covers assist fields and currency', () => {
    assert.equal(__classifyAssistSourceKeywordForTest('wx26042102'), 'order')
    assert.equal(__classifyAssistSourceKeywordForTest('supplier'), 'full')

    const orderSql = __buildAssistSourceDetailKeywordSqlForTest('wx26042102')
    assert.ok(orderSql.includes('wxaj01'))
    assert.ok(orderSql.includes('@kwExact'))
    assert.ok(orderSql.includes('@kwPrefix'))
    assert.ok(!orderSql.includes('@kw\n'))
    assertSql2008(orderSql)

    const keywordSql = __buildAssistSourceDetailKeywordSqlForTest(true)
    const listSql = __buildAssistSourceDetailListSqlForTest({ keywordSql, supplierFilterSql: 'AND h.[wxaj05] = @assistSupplierCode' })
    for (const col of ['wxaj01', 'wxaj02', 'wxaj03', 'wxaj04', 'wxaj05', 'wxaj06', 'wxaj08', 'rmb']) {
      assert.ok(keywordSql.includes(col), `${col} should be searchable`)
    }
    assert.ok(listSql.includes('@assistSupplierCode'))
    assertSql2008(keywordSql)
    assertSql2008(listSql)
  })

  it('assist source picker inbound quantity counts approved stock-in rows only', () => {
    const statsSql = __buildAssistSourceInboundStatsSqlForTest('AND h.[kcan04] = @orderNo AND l.[kcao02] = @lineKey')
    assert.ok(statsSql.includes('UB_ERP_Stocks_Storage'))
    assert.ok(statsSql.includes('UB_ERP_Stocks_Storage_list'))
    assert.ok(statsSql.includes('h.[kcan03] = 2'))
    assert.ok(statsSql.includes("h.[pass], N''))) = N'1'"))
    assert.ok(statsSql.includes('l.[kcao02]'))
    assert.ok(!statsSql.includes("<> N'1'"))
    assertSql2008(statsSql)
  })

  it('dispatch type filters by workshop scaj05', () => {
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

  it('material options SQL supports paged and non-paged modes', () => {
    const topSql = __buildMaterialOptionsSqlForTest({ keywordSql: 'AND 1 = 1', paged: false })
    const pagedSql = __buildMaterialOptionsSqlForTest({ keywordSql: 'AND 1 = 1', paged: true })
    assert.ok(topSql.includes('SELECT TOP 100 *'))
    assert.ok(topSql.includes('ORDER BY [id] DESC'))
    assert.ok(pagedSql.includes('ROW_NUMBER() OVER (ORDER BY [id] DESC) AS rn'))
    assert.ok(pagedSql.includes('WHERE rn BETWEEN @startRow AND @endRow'))
    assertSql2008(topSql)
    assertSql2008(pagedSql)
  })
})
