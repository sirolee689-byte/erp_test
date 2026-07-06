import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { __stockInStatsForTest } from './stockInStatsHandlers.js'

const {
  ALL_WAREHOUSE,
  parseReportQuery,
  buildReportWhereSql,
  buildStockInStatsReportSql,
  inboundTypeLabel,
  serializeReportRow,
} = __stockInStatsForTest

describe('入库统计表 SQL 口径', () => {
  test('基础查询不强制 pass=1，并按主从 del=0 与日期范围过滤', () => {
    const q = parseReportQuery({
      startDate: '2026-07-01',
      endDate: '2026-07-03',
      warehouseCode: '001',
    })
    const sqlText = buildStockInStatsReportSql(q)
    assert.match(sqlText, /UB_ERP_Stocks_Storage/i)
    assert.match(sqlText, /UB_ERP_Stocks_Storage_list/i)
    assert.match(sqlText, /l\.\[kcao01\][\s\S]*h\.\[kcan01\]/i)
    assert.match(sqlText, /h\.\[kcan02\] >= @startDate/i)
    assert.match(sqlText, /h\.\[kcan02\] <= @endDate/i)
    assert.match(sqlText, /ISNULL\(h\.\[del\]/i)
    assert.match(sqlText, /ISNULL\(l\.\[del\]/i)
    assert.doesNotMatch(sqlText, /h\.\[pass\][\s\S]*=\s*N?'1'/i)
  })

  test('全部仓库时不拼 kcan06 仓库过滤', () => {
    const q = parseReportQuery({
      startDate: '2026-07-01',
      endDate: '2026-07-03',
      warehouseCode: ALL_WAREHOUSE,
    })
    const whereSql = buildReportWhereSql(q)
    assert.doesNotMatch(whereSql, /@warehouseCode/i)
    assert.doesNotMatch(whereSql, /h\.\[kcan06\][\s\S]*=/i)
  })

  test('具体仓库、材料代码、分类、关联单位按定稿字段过滤', () => {
    const q = parseReportQuery({
      startDate: '2026-07-01',
      endDate: '2026-07-03',
      warehouseCode: '001',
      inboundType: '1',
      materialCode: 'BP-1',
      materialName: '布',
      materialSpec: '55',
      materialCategory: '0011',
      relatedParty: '供应商',
    })
    const whereSql = buildReportWhereSql(q)
    assert.match(whereSql, /h\.\[kcan06\]/i)
    assert.match(whereSql, /h\.\[kcan03\]/i)
    assert.match(whereSql, /l\.\[kcaa01\]/i)
    assert.match(whereSql, /l\.\[kcaa02\]/i)
    assert.match(whereSql, /l\.\[kcaa03\]/i)
    assert.match(whereSql, /l\.\[kcaa05\]/i)
    assert.match(whereSql, /h\.\[kcan05\]/i)
    assert.match(whereSql, /h\.\[kehu\]/i)
  })

  test('数量列按实际入库数量 kcao03，不取可入库上限 kcao031', () => {
    const q = parseReportQuery({
      startDate: '2026-07-01',
      endDate: '2026-07-03',
      warehouseCode: '001',
      materialCode: 'OA-10431/-',
    })
    const sqlText = buildStockInStatsReportSql(q)
    const quantityIndex = sqlText.indexOf('AS quantity')
    assert.notEqual(quantityIndex, -1)
    const quantityExpr = sqlText.slice(Math.max(0, quantityIndex - 1800), quantityIndex)
    assert.match(quantityExpr, /l\.\[kcao03\]/i)
    assert.doesNotMatch(quantityExpr, /l\.\[kcao031\]/i)
  })
})

describe('入库统计表展示映射', () => {
  test('入库类别 0 和 9 都显示其他入库', () => {
    assert.equal(inboundTypeLabel('0'), '其他入库')
    assert.equal(inboundTypeLabel('9'), '其他入库')
    assert.equal(inboundTypeLabel('1'), '采购入库')
  })

  test('无价格权限时后端序列化不返回金额字段', () => {
    const row = serializeReportRow({
      auditFlag: '1',
      receiptNo: 'IN001',
      inboundType: '1',
      quantity: 3,
      transferQty: 1,
      unitPrice: 10,
      amount: 30,
      unitPriceTax: 11.3,
      amountTax: 33.9,
    }, false)
    assert.equal(row.auditStatus, '已审核')
    assert.equal(row.quantity, 3)
    assert.equal(Object.prototype.hasOwnProperty.call(row, 'unitPrice'), false)
    assert.equal(Object.prototype.hasOwnProperty.call(row, 'amount'), false)
    assert.equal(Object.prototype.hasOwnProperty.call(row, 'unitPriceTax'), false)
    assert.equal(Object.prototype.hasOwnProperty.call(row, 'amountTax'), false)
  })

  test('有价格权限时返回金额字段', () => {
    const row = serializeReportRow({ unitPrice: 10, amount: 30, unitPriceTax: 11.3, amountTax: 33.9 }, true)
    assert.equal(row.unitPrice, 10)
    assert.equal(row.amount, 30)
    assert.equal(row.unitPriceTax, 11.3)
    assert.equal(row.amountTax, 33.9)
  })
})
