import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { __stockMovementStatsForTest } from './stockMovementStatsHandlers.js'

const { ALL_WAREHOUSE, parseReportQuery, buildBranchWhereSql, buildStockMovementStatsReportSql, serializeReportRow, inboundTypeLabel, outboundTypeLabel } = __stockMovementStatsForTest

describe('出入库统计表 SQL 口径', () => {
  test('使用已审核主表、未删除主从和 UNION ALL 合并查询', () => {
    const sqlText = buildStockMovementStatsReportSql(parseReportQuery({ startDate: '2026-07-01', endDate: '2026-07-03', warehouseCode: '001' }))
    assert.match(sqlText, /UNION ALL/i)
    assert.match(sqlText, /UB_ERP_Stocks_Storage/i)
    assert.match(sqlText, /UB_ERP_Stocks_out/i)
    assert.match(sqlText, /h\.\[pass\].*= N'1'/i)
    assert.match(sqlText, /DATEADD\(day, 1, @endDateExclusive\)/i)
    assert.doesNotMatch(sqlText, /UB_ERP_Stocks_acc/i)
  })

  test('材料分类和按方向收发类别使用独立参数集合过滤', () => {
    const q = parseReportQuery({ startDate: '2026-07-01', endDate: '2026-07-03', warehouseCode: '001', materialCategories: 'A,B', movementTypes: 'in:1,out:4' })
    assert.match(buildBranchWhereSql(q, 'in'), /l\.\[kcaa05\].*IN \(@category0, @category1\)/i)
    assert.match(buildBranchWhereSql(q, 'in'), /h\.\[kcan03\].*IN \(@inType0\)/i)
    assert.match(buildBranchWhereSql(q, 'out'), /h\.\[kcap03\].*IN \(@outType0\)/i)
  })

  test('手工填写物料编码时，按入库和出库明细的物料编码精确过滤', () => {
    const q = parseReportQuery({ startDate: '2026-07-01', endDate: '2026-07-03', warehouseCode: '001', materialCode: 'GP-0002/580' })
    assert.equal(q.materialCode, 'GP-0002/580')
    assert.match(buildBranchWhereSql(q, 'in'), /l\.\[kcaa01\].*= @materialCode/i)
    assert.match(buildBranchWhereSql(q, 'out'), /l\.\[kcaa01\].*= @materialCode/i)
  })

  test('全部仓库使用参数化开关取消入库、出库仓库限制', () => {
    const q = parseReportQuery({ startDate: '2026-07-01', endDate: '2026-07-03', warehouseCode: ALL_WAREHOUSE })
    assert.equal(q.allWarehouse, true)
    assert.match(buildBranchWhereSql(q, 'in'), /@allWarehouse = 1/i)
    assert.match(buildBranchWhereSql(q, 'out'), /@allWarehouse = 1/i)
  })
})

describe('出入库统计表展示映射', () => {
  test('收发类别按方向显示且生产领料使用出库类别 4', () => {
    assert.equal(inboundTypeLabel('1'), '采购入库')
    assert.equal(outboundTypeLabel('4'), '生产领料')
  })

  test('无价格权限时不返回金额字段', () => {
    const row = serializeReportRow({ direction: '入库', documentNo: 'IN001', quantity: 1, unitPrice: 10, amount: 10, amountTax: 11.3 }, false)
    assert.equal(row.quantity, 1)
    assert.equal(Object.hasOwn(row, 'unitPrice'), false)
    assert.equal(Object.hasOwn(row, 'amount'), false)
  })
})
