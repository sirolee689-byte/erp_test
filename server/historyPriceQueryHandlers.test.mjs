import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { __historyPriceQueryForTest } from './historyPriceQueryHandlers.js'

const {
  MENU_PATH,
  parseReportQuery,
  validateReportQuery,
  buildMaterialWhereSql,
  buildReportSql,
  serializeReportRows,
} = __historyPriceQueryForTest

describe('历史价格查询参数', () => {
  test('开始日期、结束日期和物料编码必填，开始日期不能大于结束日期', () => {
    assert.equal(validateReportQuery(parseReportQuery({ endDate: '2026-07-09', materialCode: 'BP' })), '开始日期不能为空')
    assert.equal(validateReportQuery(parseReportQuery({ startDate: '2026-07-09', materialCode: 'BP' })), '结束日期不能为空')
    assert.equal(
      validateReportQuery(parseReportQuery({ startDate: '2026-07-10', endDate: '2026-07-09', materialCode: 'BP' })),
      '开始日期不能大于结束日期',
    )
    assert.equal(validateReportQuery(parseReportQuery({ startDate: '2026-07-09', endDate: '2026-07-09' })), '物料编码不能为空')
    assert.equal(validateReportQuery(parseReportQuery({ startDate: '2026-07-09', endDate: '2026-07-09', materialCode: 'BP' })), '')
  })

  test('默认只显示有价格记录的物料', () => {
    const q = parseReportQuery({ startDate: '2026-07-01', endDate: '2026-07-09', materialCode: 'BP' })
    assert.equal(q.onlyWithPrice, true)
  })
})

describe('历史价格查询 SQL 口径', () => {
  test('BOM 物料只取未删除、已审核，并按物料编码模糊圈定范围', () => {
    const q = parseReportQuery({ startDate: '2026-07-01', endDate: '2026-07-09', materialCode: 'BP' })
    const whereSql = buildMaterialWhereSql(q)
    assert.match(whereSql, /b\.\[del\]/i)
    assert.match(whereSql, /b\.\[pass\]/i)
    assert.match(whereSql, /= N'1'/i)
    assert.match(whereSql, /b\.\[kcaa01\][\s\S]*LIKE @materialCode/i)
  })

  test('报价和采购价格用 UNION ALL 合并，日期按次日零点前统计', () => {
    const q = parseReportQuery({ startDate: '2026-07-01', endDate: '2026-07-09', materialCode: 'BP' })
    const sqlText = buildReportSql(q)
    assert.match(sqlText, /UB_ERP_Buy_offer/i)
    assert.match(sqlText, /UB_ERP_Buy_offer_list/i)
    assert.match(sqlText, /UB_ERP_Buy_order/i)
    assert.match(sqlText, /UB_ERP_Buy_order_list/i)
    assert.match(sqlText, /UNION ALL/i)
    assert.match(sqlText, /h\.\[cgaa02\] >= @startDate/i)
    assert.match(sqlText, /h\.\[cgaa02\] < @endDateExclusive/i)
    assert.match(sqlText, /h\.\[kcaj02\] >= @startDate/i)
    assert.match(sqlText, /h\.\[kcaj02\] < @endDateExclusive/i)
  })

  test('供应商条件分别作用到报价供应商和采购供应商', () => {
    const q = parseReportQuery({ startDate: '2026-07-01', endDate: '2026-07-09', materialCode: 'BP', supplierCode: 'CN-1' })
    const sqlText = buildReportSql(q)
    assert.match(sqlText, /h\.\[cgaa04\][\s\S]*= @supplierCode/i)
    assert.match(sqlText, /h\.\[kcaj05\][\s\S]*= @supplierCode/i)
  })

  test('含税价格兼容 Tax=0.13 和 Tax=13 两种历史写法', () => {
    const q = parseReportQuery({ startDate: '2026-07-01', endDate: '2026-07-09', materialCode: 'BP' })
    const sqlText = buildReportSql(q)
    assert.match(sqlText, /WHEN[\s\S]*l\.\[Tax\][\s\S]*> 1 THEN[\s\S]*\/ 100 ELSE/i)
    assert.match(sqlText, /cgab04[\s\S]*\* \(1 \+/i)
    assert.match(sqlText, /kcak04[\s\S]*\* \(1 \+/i)
  })

  test('SQL 不使用全局中间表，也不出现逐物料循环查询语义', () => {
    const q = parseReportQuery({ startDate: '2026-07-01', endDate: '2026-07-09', materialCode: 'BP' })
    const sqlText = buildReportSql(q)
    assert.doesNotMatch(sqlText, /UB_ERP_Stocks_acc/i)
    assert.doesNotMatch(sqlText, /CURSOR/i)
  })
})

describe('历史价格查询返回结构', () => {
  test('同一物料的报价和采购记录合并后，第一条标记最近价格', () => {
    const rows = serializeReportRows([
      {
        materialCode: 'BP-001',
        materialName: '材料',
        materialSpec: '55',
        bomUnit: 'YD',
        bomPrice: 3,
        purchaseUnit: 'Y',
        priceCount: 2,
        priceDate: new Date('2026-07-09T00:00:00'),
        currencyName: '人民币',
        price: 10,
        priceWithTax: 11.3,
        supplierCode: 'CN-1',
        supplierName: '供应商',
        sourceType: '报价',
        sourceNo: 'BJ-1',
      },
      {
        materialCode: 'BP-001',
        priceCount: 2,
        priceDate: new Date('2026-07-01T00:00:00'),
        price: 9,
        priceWithTax: 10.17,
        sourceType: '采购',
        sourceNo: 'ZY-1',
      },
    ])
    assert.equal(rows.length, 1)
    assert.equal(rows[0].prices.length, 2)
    assert.equal(rows[0].prices[0].status, '最近价格')
    assert.equal(rows[0].prices[1].status, '历史价格')
  })

  test('菜单权限路径锁定销售采购外协统计分析下历史价格查询', () => {
    assert.equal(MENU_PATH, 'supply-chain/analysis/price-query')
  })
})
