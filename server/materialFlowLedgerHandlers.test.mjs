import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { __materialFlowLedgerForTest } from './materialFlowLedgerHandlers.js'

const {
  parseReportQuery,
  validateReportQuery,
  buildInboundBaseWhereSql,
  buildOutboundBaseWhereSql,
  buildOpeningBalanceSql,
  buildFlowSelectSql,
  buildFlowReportSql,
  buildPurchaseInTransitSql,
  inboundTypeLabel,
  outboundTypeLabel,
  flowTypeLabel,
  buildLedgerRows,
  serializePurchaseInTransitRow,
} = __materialFlowLedgerForTest

describe('材料流水账参数校验', () => {
  test('开始日期、结束日期、仓库、物料编码必填', () => {
    assert.equal(validateReportQuery(parseReportQuery({})), '开始日期不能为空')
    assert.equal(validateReportQuery(parseReportQuery({ startDate: '2026-07-01' })), '结束日期不能为空')
    assert.equal(
      validateReportQuery(parseReportQuery({ startDate: '2026-07-01', endDate: '2026-07-03' })),
      '仓库不能为空',
    )
    assert.equal(
      validateReportQuery(parseReportQuery({ startDate: '2026-07-01', endDate: '2026-07-03', warehouseCode: '001' })),
      '物料编码不能为空',
    )
  })

  test('包含采购在途解析为布尔值，物料按 materialCode 提交', () => {
    const q = parseReportQuery({
      startDate: '2026-07-01',
      endDate: '2026-07-03',
      warehouseCode: '001',
      materialCode: 'OA-10431/-',
      includePurchaseInTransit: '1',
    })
    assert.equal(q.includePurchaseInTransit, true)
    assert.equal(q.materialCode, 'OA-10431/-')
    assert.equal(q.materialSystemcode, undefined)
  })
})

describe('材料流水账 SQL 口径', () => {
  const q = parseReportQuery({
    startDate: '2026-07-01',
    endDate: '2026-07-03',
    warehouseCode: '001',
    materialCode: 'OA-10431/-',
    materialCategories: '001,002',
  })

  test('入库侧按主表已审核、主从未删除、仓库、kcaa01 精确匹配', () => {
    const sqlText = buildInboundBaseWhereSql(q)
    assert.match(sqlText, /h\.\[pass\]/i)
    assert.doesNotMatch(sqlText, /l\.\[pass\]/i)
    assert.match(sqlText, /h\.\[kcan06\]/i)
    assert.match(sqlText, /l\.\[kcaa01\]/i)
    assert.doesNotMatch(sqlText, /systemcode/i)
  })

  test('出库侧按主表已审核、主从未删除、仓库、kcaa01 精确匹配', () => {
    const sqlText = buildOutboundBaseWhereSql(q)
    assert.match(sqlText, /h\.\[pass\]/i)
    assert.doesNotMatch(sqlText, /l\.\[pass\]/i)
    assert.match(sqlText, /h\.\[kcap06\]/i)
    assert.match(sqlText, /l\.\[kcaa01\]/i)
    assert.doesNotMatch(sqlText, /systemcode/i)
  })

  test('上期结存按开始日期之前入库减出库', () => {
    const sqlText = buildOpeningBalanceSql(q)
    assert.match(sqlText, /h\.\[kcan02\] < @startDate/i)
    assert.match(sqlText, /h\.\[kcap02\] < @startDate/i)
    assert.match(sqlText, /kcao03/i)
    assert.match(sqlText, /kcaq03/i)
  })

  test('流水 SQL 用 UNION ALL 合并入库和出库，不使用真实中间表', () => {
    const sqlText = buildFlowSelectSql(q)
    assert.match(sqlText, /UNION ALL/i)
    assert.match(sqlText, /UB_ERP_Stocks_Storage/i)
    assert.match(sqlText, /UB_ERP_Stocks_out/i)
    assert.doesNotMatch(sqlText, /UB_ERP_Stocks_acc/i)
  })

  test('报表 SQL 按日期、方向、单号、明细 id 稳定排序', () => {
    const sqlText = buildFlowReportSql(q)
    assert.match(sqlText, /ORDER BY docDate ASC, direction ASC, docNo ASC, lineId ASC/i)
  })

  test('区间结束日期按次日零点前统计，对齐库存统计表截止日期', () => {
    const inboundSql = buildInboundBaseWhereSql(q)
    const outboundSql = buildOutboundBaseWhereSql(q)
    assert.match(inboundSql, /h\.\[kcan02\] < @endDateExclusive/i)
    assert.match(outboundSql, /h\.\[kcap02\] < @endDateExclusive/i)
    assert.doesNotMatch(inboundSql, /<= @endDate/i)
    assert.doesNotMatch(outboundSql, /<= @endDate/i)
  })

  test('采购在途 SQL 只查采购单并不写入结存表', () => {
    const sqlText = buildPurchaseInTransitSql(q)
    assert.match(sqlText, /UB_ERP_Buy_order/i)
    assert.match(sqlText, /UB_ERP_Buy_order_list/i)
    assert.match(sqlText, /l\.\[kcaa01\]/i)
    assert.doesNotMatch(sqlText, /UB_ERP_Stocks_acc/i)
  })
})

describe('材料流水账展示映射', () => {
  test('出库类别 4 显示生产领料', () => {
    assert.equal(outboundTypeLabel('4'), '生产领料')
    assert.equal(flowTypeLabel('out', '4'), '生产领料')
    assert.equal(inboundTypeLabel('4'), '生产入库')
  })

  test('逐行滚动结存：上期结存 + 入库 - 出库', () => {
    const rows = buildLedgerRows(5, [
      { direction: 'in', quantity: 3, docNo: 'RK001', flowType: '1', lineId: 1 },
      { direction: 'out', quantity: 2, docNo: 'CK001', flowType: '4', lineId: 2 },
    ])
    assert.equal(rows[0].remark, '上期结存')
    assert.equal(rows[0].balance, 5)
    assert.equal(rows[1].balance, 8)
    assert.equal(rows[2].balance, 6)
  })

  test('注释统一显示单号、类别、PO/PI、关联单号，不拼接备注', () => {
    const rows = buildLedgerRows(0, [
      {
        direction: 'out',
        quantity: 1,
        docNo: 'C180116005',
        flowType: '2',
        referenceText: 'PI-2504',
        relatedNo: '0',
        headerRemark: '不应显示的备注',
        lineId: 1,
      },
    ])
    assert.equal(rows[1].remark, '单号：C180116005，类别：外协领料，PO/PI：PI-2504，关联单号：0')
    assert.doesNotMatch(rows[1].remark, /备注/)
  })

  test('采购在途行不带结存，避免改变实际库存余额', () => {
    const row = serializePurchaseInTransitRow({
      docNo: 'ZY-260904',
      orderQty: 1,
      supplierName: '供应商A',
      lineId: 8,
    }, 3)
    assert.equal(row.rowType, 'purchaseInTransit')
    assert.equal(row.balance, null)
    assert.equal(row.inboundQty, 1)
    assert.match(row.remark, /采购在途/)
  })
})
