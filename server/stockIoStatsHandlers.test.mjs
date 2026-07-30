import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { __stockIoStatsForTest } from './stockIoStatsHandlers.js'

const {
  ALL_WAREHOUSE,
  parseReportQuery,
  validateReportQuery,
  buildInboundBaseWhereSql,
  buildOutboundBaseWhereSql,
  buildMovementSql,
  buildReportSql,
  buildComputedMetrics,
  serializeReportRow,
} = __stockIoStatsForTest

describe('进销存统计报表参数校验', () => {
  test('开始日期、结束日期、仓库必填，全部仓库可查询', () => {
    assert.equal(validateReportQuery(parseReportQuery({})), '统计开始日期不能为空')
    assert.equal(validateReportQuery(parseReportQuery({ startDate: '2026-07-01' })), '统计结束日期不能为空')
    assert.equal(validateReportQuery(parseReportQuery({ startDate: '2026-07-01', endDate: '2026-07-03' })), '仓库不能为空')
    const allWarehouseQuery = parseReportQuery({ startDate: '2026-07-01', endDate: '2026-07-03', warehouseCode: ALL_WAREHOUSE })
    assert.equal(allWarehouseQuery.allWarehouse, true)
    assert.equal(validateReportQuery(allWarehouseQuery), '')
    assert.equal(
      validateReportQuery(parseReportQuery({ startDate: '2026-07-01', endDate: '2026-07-03', warehouseCode: '001' })),
      '',
    )
  })

  test('物料编码非必填，按 kcaa01 精确匹配', () => {
    const q = parseReportQuery({
      startDate: '2026-07-01',
      endDate: '2026-07-03',
      warehouseCode: '001',
      materialCode: 'GP-0002/580',
    })
    assert.equal(q.materialCode, 'GP-0002/580')
    assert.equal(validateReportQuery(q), '')
    const sqlText = buildInboundBaseWhereSql(q)
    assert.match(sqlText, /l\.\[kcaa01\]/i)
    assert.match(sqlText, /= @materialCode/i)
    assert.doesNotMatch(sqlText, /systemcode/i)
  })

  test('物料名称和规格同时支持明细快照与 BOM 资料匹配', () => {
    const q = parseReportQuery({
      startDate: '2026-07-01',
      endDate: '2026-07-03',
      warehouseCode: '001',
      materialName: '布',
      materialSpec: '55',
    })
    const sqlText = buildInboundBaseWhereSql(q)
    assert.match(sqlText, /l\.\[kcaa02\][\s\S]*@materialName/i)
    assert.match(sqlText, /bf\.\[kcaa02\][\s\S]*@materialName/i)
    assert.match(sqlText, /l\.\[kcaa03\][\s\S]*@materialSpec/i)
    assert.match(sqlText, /bf\.\[kcaa03\][\s\S]*@materialSpec/i)
  })
})

describe('进销存统计报表 SQL 口径', () => {
  test('主表 pass=1，明细不按 pass 过滤', () => {
    const q = parseReportQuery({
      startDate: '2026-07-01',
      endDate: '2026-07-03',
      warehouseCode: '001',
    })
    const inWhere = buildInboundBaseWhereSql(q)
    const outWhere = buildOutboundBaseWhereSql(q)
    assert.match(inWhere, /h\.\[pass\][\s\S]*=\s*N'1'/i)
    assert.doesNotMatch(inWhere, /l\.\[pass\]/i)
    assert.match(outWhere, /h\.\[pass\][\s\S]*=\s*N'1'/i)
    assert.doesNotMatch(outWhere, /l\.\[pass\]/i)
  })

  test('全部仓库使用参数化开关取消入库、出库仓库条件', () => {
    const q = parseReportQuery({ startDate: '2026-07-01', endDate: '2026-07-03', warehouseCode: ALL_WAREHOUSE })
    assert.match(buildInboundBaseWhereSql(q), /@allWarehouse = 1/i)
    assert.match(buildOutboundBaseWhereSql(q), /@allWarehouse = 1/i)
  })

  test('结束日期使用小于次日口径，不使用 <= 23:59:59', () => {
    const q = parseReportQuery({
      startDate: '2026-07-01',
      endDate: '2026-07-03',
      warehouseCode: '001',
    })
    const sqlText = buildMovementSql(q)
    assert.match(sqlText, /h\.\[kcan02\] < @endDateExclusive/i)
    assert.match(sqlText, /h\.\[kcap02\] < @endDateExclusive/i)
    assert.doesNotMatch(sqlText, /<= @endDate/i)
  })

  test('本期入库、出库、补数、盈亏按定稿类别编号拆分', () => {
    const q = parseReportQuery({
      startDate: '2026-07-01',
      endDate: '2026-07-03',
      warehouseCode: '001',
    })
    const sqlText = buildReportSql(q)
    assert.match(sqlText, /direction = N'in' AND typeCode IN \(N'1', N'2', N'0', N'5'\)/i)
    assert.match(sqlText, /direction = N'out' AND typeCode = N'1'/i)
    assert.match(sqlText, /direction = N'out' AND typeCode IN \(N'4', N'0', N'10', N'7', N'2'\)/i)
    assert.match(sqlText, /direction = N'in' AND typeCode IN \(N'3', N'4'\)/i)
    assert.match(sqlText, /direction = N'out' AND typeCode = N'8'/i)
    assert.match(sqlText, /direction = N'in' AND typeCode = N'7'/i)
    assert.match(sqlText, /direction = N'out' AND typeCode = N'9'/i)
  })

  test('报表关联物料、分类、颜色，并取上期最近有效入库单价', () => {
    const q = parseReportQuery({
      startDate: '2026-07-01',
      endDate: '2026-07-03',
      warehouseCode: '001',
    })
    const sqlText = buildReportSql(q)
    assert.match(sqlText, /UB_ERP_Bom_000/i)
    assert.match(sqlText, /New_UB_ERP_Stocks_material/i)
    assert.match(sqlText, /UB_ERP_Stocks_colorcode/i)
    assert.match(sqlText, /previousUnitPrice/i)
    assert.match(sqlText, /TOP \(1\)/i)
    assert.match(sqlText, /kcao04/i)
  })
})

describe('进销存统计报表计算', () => {
  test('按加权成本计算出库、补数和结存', () => {
    const m = buildComputedMetrics({
      previousQty: 10,
      previousUnitPrice: 2,
      periodInQty: 5,
      periodInAmount: 15,
      periodOutQty: 6,
      periodSupplementQty: 2,
      periodProfitLossQty: 1,
      periodProfitLossAmount: 3,
    })
    assert.equal(m.previousAmount, 20)
    assert.equal(m.periodInUnitPrice, 3)
    assert.equal(m.periodOutUnitPrice, 2.333333)
    assert.equal(m.periodOutAmount, 14)
    assert.equal(m.supplementUnitPrice, 2.333333)
    assert.equal(m.supplementAmount, 4.666667)
    assert.equal(m.endingQty, 8)
    assert.equal(Math.round(m.endingAmount * 1000000) / 1000000, 19.333333)
  })

  test('结存数量小于等于 0.01 时按 0 显示', () => {
    const m = buildComputedMetrics({
      previousQty: 0.005,
      previousUnitPrice: 10,
      periodInQty: 0,
      periodInAmount: 0,
      periodOutQty: 0,
      periodSupplementQty: 0,
      periodProfitLossQty: 0,
      periodProfitLossAmount: 0,
    })
    assert.equal(m.endingQty, 0)
    assert.equal(m.endingAmount, 0)
    assert.equal(m.endingUnitPrice, 0)
  })

  test('无价格权限时不返回金额和单价字段', () => {
    const row = serializeReportRow({
      warehouseCode: '001',
      warehouseName: '货仓',
      materialCode: 'GP-0002/580',
      materialId: 10,
      materialName: '布料',
      categoryCode: '001',
      categoryName: '里布',
      previousQty: 1,
      previousUnitPrice: 2,
      periodInQty: 1,
      periodInAmount: 3,
      periodOutQty: 0,
      periodSupplementQty: 0,
      periodProfitLossQty: 0,
      periodProfitLossAmount: 0,
    }, false)
    assert.equal(row.materialCode, 'GP-0002/580')
    assert.equal(row.previousQty, 1)
    assert.equal(Object.hasOwn(row, 'previousAmount'), false)
    assert.equal(Object.hasOwn(row, 'periodInAmount'), false)
    assert.equal(Object.hasOwn(row, 'endingAmount'), false)
  })

  test('零发生且零结存的物料行被过滤', () => {
    const row = serializeReportRow({
      warehouseCode: '001',
      warehouseName: '货仓',
      materialCode: 'ZERO',
      materialId: 10,
      previousQty: 0,
      previousUnitPrice: 0,
      periodInQty: 0,
      periodInAmount: 0,
      periodOutQty: 0,
      periodSupplementQty: 0,
      periodProfitLossQty: 0,
      periodProfitLossAmount: 0,
    }, true)
    assert.equal(row, null)
  })

  test('异常提示可见但不阻断报表行', () => {
    const row = serializeReportRow({
      warehouseCode: '001',
      warehouseName: '货仓',
      materialCode: 'MISS',
      materialId: null,
      categoryCode: '001',
      categoryName: '',
      colorCode: '580',
      colorName: '',
      previousQty: 10,
      previousUnitPrice: 0,
      periodInQty: 0,
      periodInAmount: 10,
      periodOutQty: 3,
      periodSupplementQty: 0,
      periodProfitLossQty: 1,
      periodProfitLossAmount: 0,
    }, true)
    assert.match(row.warning, /缺少物料资料/)
    assert.match(row.warning, /缺少分类名称/)
    assert.match(row.warning, /缺少颜色名称/)
    assert.match(row.warning, /缺少上期成本单价/)
    assert.match(row.warning, /本期入库金额存在但入库数量为0/)
    assert.match(row.warning, /盈亏金额缺失/)
  })
})
