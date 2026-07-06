import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { __stockOutStatsForTest } from './stockOutStatsHandlers.js'

const {
  ALL_WAREHOUSE,
  parseReportQuery,
  buildReportWhereSql,
  buildStockOutStatsReportSql,
  outboundTypeLabel,
  serializeReportRow,
} = __stockOutStatsForTest

describe('出库统计表 SQL 口径', () => {
  test('基础查询不强制 pass=1，并按主从 del=0 与日期范围过滤', () => {
    const q = parseReportQuery({
      startDate: '2026-07-01',
      endDate: '2026-07-03',
      warehouseCode: '001',
    })
    const sqlText = buildStockOutStatsReportSql(q)
    assert.match(sqlText, /UB_ERP_Stocks_out/i)
    assert.match(sqlText, /UB_ERP_Stocks_out_list/i)
    assert.match(sqlText, /l\.\[kcaq01\][\s\S]*h\.\[kcap01\]/i)
    assert.match(sqlText, /h\.\[kcap02\] >= @startDate/i)
    assert.match(sqlText, /h\.\[kcap02\] <= @endDate/i)
    assert.match(sqlText, /ISNULL\(h\.\[del\]/i)
    assert.match(sqlText, /ISNULL\(l\.\[del\]/i)
    assert.doesNotMatch(sqlText, /h\.\[pass\][\s\S]*=\s*N?'1'/i)
  })

  test('全部仓库时不拼 kcap06 仓库过滤', () => {
    const q = parseReportQuery({
      startDate: '2026-07-01',
      endDate: '2026-07-03',
      warehouseCode: ALL_WAREHOUSE,
    })
    const whereSql = buildReportWhereSql(q)
    assert.doesNotMatch(whereSql, /@warehouseCode/i)
    assert.doesNotMatch(whereSql, /h\.\[kcap06\][\s\S]*=/i)
  })

  test('具体仓库、出库类别、物料唯一码、分类、关联单位按定稿字段过滤', () => {
    const q = parseReportQuery({
      startDate: '2026-07-01',
      endDate: '2026-07-03',
      warehouseCode: '001',
      outboundType: '7',
      materialSystemcode: 'SC-001',
      materialName: '布',
      materialSpec: '55',
      materialCategories: '0011,0012',
      relatedParty: '客户',
    })
    const whereSql = buildReportWhereSql(q)
    assert.match(whereSql, /h\.\[kcap06\]/i)
    assert.match(whereSql, /h\.\[kcap03\]/i)
    assert.match(whereSql, /l\.\[systemcode\]/i)
    assert.match(whereSql, /l\.\[kcaa02\]/i)
    assert.match(whereSql, /l\.\[kcaa03\]/i)
    assert.match(whereSql, /l\.\[kcaa05\][\s\S]*IN \(@category0, @category1\)/i)
    assert.match(whereSql, /h\.\[kcap05\]/i)
    assert.match(whereSql, /h\.\[kehu\]/i)
  })

  test('数量列取出库数量 kcaq03', () => {
    const q = parseReportQuery({
      startDate: '2026-07-01',
      endDate: '2026-07-03',
      warehouseCode: '001',
    })
    const sqlText = buildStockOutStatsReportSql(q)
    const quantityIndex = sqlText.indexOf('AS quantity')
    assert.notEqual(quantityIndex, -1)
    const quantityExpr = sqlText.slice(Math.max(0, quantityIndex - 1000), quantityIndex)
    assert.match(quantityExpr, /l\.\[kcaq03\]/i)
  })
})

describe('出库统计表展示映射', () => {
  test('已确认类别显示中文，0/5 不擅自命名', () => {
    assert.equal(outboundTypeLabel('1'), '采购退货')
    assert.equal(outboundTypeLabel('4'), '生产领料')
    assert.equal(outboundTypeLabel('6'), '销售出库')
    assert.equal(outboundTypeLabel('9'), '盘亏')
    assert.equal(outboundTypeLabel('0'), '0 未知类别')
    assert.equal(outboundTypeLabel('5'), '5 未知类别')
  })

  test('无价格权限时后端序列化不返回金额字段', () => {
    const row = serializeReportRow({
      auditFlag: '1',
      outboundNo: 'OUT001',
      outboundType: '7',
      quantity: 3,
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
