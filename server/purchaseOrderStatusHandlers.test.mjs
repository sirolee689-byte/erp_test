import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { __purchaseOrderStatusForTest } from './purchaseOrderStatusHandlers.js'

const {
  MENU_PATH,
  parseReportQuery,
  validateReportQuery,
  buildReportWhereSql,
  buildReportSql,
  serializeReportRow,
} = __purchaseOrderStatusForTest

describe('采购订单情况表查询参数', () => {
  test('日期必填且开始日期不能大于结束日期', () => {
    assert.equal(validateReportQuery(parseReportQuery({ endDate: '2026-07-03' })), '查询开始日期不能为空')
    assert.equal(validateReportQuery(parseReportQuery({ startDate: '2026-07-04' })), '查询结束日期不能为空')
    assert.equal(
      validateReportQuery(parseReportQuery({ startDate: '2026-07-04', endDate: '2026-07-03' })),
      '查询开始日期不能大于查询结束日期',
    )
    assert.equal(validateReportQuery(parseReportQuery({ startDate: '2026-07-03', endDate: '2026-07-03' })), '')
  })

  test('默认保留包含未结案，不默认只显示差数', () => {
    const q = parseReportQuery({ startDate: '2026-07-01', endDate: '2026-07-03' })
    assert.equal(q.includeUnclosed, true)
    assert.equal(q.onlyDifference, false)
  })
})

describe('采购订单情况表 SQL 口径', () => {
  test('基础查询不强制采购单 pass=1，日期结束按次日零点前', () => {
    const q = parseReportQuery({ startDate: '2026-07-01', endDate: '2026-07-03' })
    const whereSql = buildReportWhereSql(q)
    assert.match(whereSql, /h\.\[kcaj02\] >= @startDate/i)
    assert.match(whereSql, /h\.\[kcaj02\] < @endDateExclusive/i)
    assert.match(whereSql, /h\.\[del\]/i)
    assert.match(whereSql, /l\.\[del\]/i)
    assert.doesNotMatch(whereSql, /h\.\[pass\][\s\S]*=\s*N?'1'/i)
  })

  test('材料选择优先按采购明细 systemcode 精确匹配', () => {
    const q = parseReportQuery({
      startDate: '2026-07-01',
      endDate: '2026-07-03',
      materialSystemcode: 'SYS-001',
      materialCode: 'BP-001',
    })
    const whereSql = buildReportWhereSql(q)
    assert.match(whereSql, /l\.\[systemcode\]/i)
    assert.match(whereSql, /= @materialSystemcode/i)
    assert.doesNotMatch(whereSql, /@materialCode/i)
  })

  test('入库按 GUID 关联采购明细，数量取 kcao031，退货按采购单号和物料编码汇总', () => {
    const q = parseReportQuery({ startDate: '2026-07-01', endDate: '2026-07-03' })
    const sqlText = buildReportSql(q)
    assert.match(sqlText, /UB_ERP_Buy_order/i)
    assert.match(sqlText, /UB_ERP_Buy_order_list/i)
    assert.match(sqlText, /l\.\[GUID\]/i)
    assert.match(sqlText, /i\.lineGuid = b\.lineGuid/i)
    assert.match(sqlText, /kcao031/i)
    assert.match(sqlText, /kcap03/i)
    assert.match(sqlText, /r\.materialCode = b\.materialCode/i)
  })

  test('采购数量按 kcaa26 和 kcaa27 换算，差数大于 0 过滤可启用', () => {
    const q = parseReportQuery({ startDate: '2026-07-01', endDate: '2026-07-03', onlyDifference: '1' })
    const sqlText = buildReportSql(q)
    assert.match(sqlText, /convertDirection = N'1'[\s\S]*purchaseQtyRaw \/ b\.convertRatio/i)
    assert.match(sqlText, /convertDirection = N'0'[\s\S]*purchaseQtyRaw \* b\.convertRatio/i)
    assert.match(sqlText, /WHERE[\s\S]*>\s*0/i)
  })
})

describe('采购订单情况表展示映射', () => {
  test('无金额权限时不返回入库金额字段', () => {
    const row = serializeReportRow({
      auditFlag: '0',
      purchaseNo: 'ZY-260904',
      supplierCode: '7001',
      supplierName: '供应商',
      purchaseQty: 10,
      pendingInboundQty: 1,
      inboundQty: 8,
      inboundAmount: 80,
      returnQty: 2,
      differenceQty: 4,
    }, false)
    assert.equal(row.purchaseNoDisplay, 'ZY-260904（未审）')
    assert.equal(row.purchaseQty, 10)
    assert.equal(Object.prototype.hasOwnProperty.call(row, 'inboundAmount'), false)
  })

  test('有金额权限时返回入库金额字段', () => {
    const row = serializeReportRow({ purchaseNo: 'PO1', auditFlag: '1', inboundAmount: 88.6 }, true)
    assert.equal(row.purchaseNoDisplay, 'PO1')
    assert.equal(row.inboundAmount, 88.6)
  })

  test('菜单权限路径锁定销售采购外协统计分析下采购订单情况表', () => {
    assert.equal(MENU_PATH, 'supply-chain/analysis/order-status')
  })
})
