import assert from 'node:assert/strict'
import test from 'node:test'
import {
  __buildAssistIssueBatchCountSqlForTest,
  __buildAssistIssueBatchListSqlForTest,
  __buildSourceOutboundAggSqlForTest,
  computeAssistSourceRemain,
  computeAssistIssueableQty,
  computeAssistSourceDemandQty,
  computeAssistStillNeedQty,
  resolveAssistIssueSelectState,
} from './stockOutAssistIssueBatchAdd.js'
import {
  buildAssistIssuePiCostHint,
  computeAssistIssueDefaultQty,
} from './stockOutAssistIssueBomExpand.js'
import {
  __buildAssistIssueSourceCountSqlForTest,
  __buildAssistIssueSourceListSqlForTest,
} from './stockOutHandlers.js'

test('computeAssistSourceRemain 含 wxak07 调整', () => {
  const remain = computeAssistSourceRemain({
    wxak03: 100,
    wxak07: 10,
    wxak08: 25,
    kcaa26: 1,
    kcaa27: '0',
  })
  assert.equal(remain, 85)
})

test('computeAssistIssueableQty 取来源与库存较小值', () => {
  assert.equal(
    computeAssistIssueableQty({ sourceRemain: 50, pendingIssueOut: 10, warehouseActualQty: 30 }),
    30,
  )
})

test('computeAssistStillNeedQty 扣减来源已出与未审出', () => {
  assert.equal(
    computeAssistStillNeedQty({
      sourceDemandQty: 314,
      sourceApprovedOutQty: 50,
      sourcePendingOutQty: 14,
    }),
    250,
  )
  assert.equal(
    computeAssistStillNeedQty({
      sourceDemandQty: 100,
      sourceApprovedOutQty: 80,
      sourcePendingOutQty: 30,
    }),
    0,
  )
})

test('computeAssistSourceDemandQty 外协数量×单用量', () => {
  assert.equal(
    computeAssistSourceDemandQty({
      wxak03: 314,
      kcaa26: 1,
      kcaa27: '0',
      unitUsage: 1,
    }),
    314,
  )
})

test('computeAssistIssueDefaultQty min(还需出库, 实际库存)', () => {
  assert.equal(computeAssistIssueDefaultQty({ stillNeedQty: 100, warehouseActualQty: 30 }), 30)
  assert.equal(computeAssistIssueDefaultQty({ stillNeedQty: 20, warehouseActualQty: 50 }), 20)
})

test('resolveAssistIssueSelectState 子料库存不足', () => {
  assert.deepEqual(resolveAssistIssueSelectState({
    issueableQty: 0,
    stillNeedQty: 10,
    alreadySelected: false,
    warehouseActualQty: 0,
  }), {
    selectState: 'disabled_stock',
    selectLabel: '库存不足',
    selectable: false,
  })
})

test('resolveAssistIssueSelectState 来源已出满不可选', () => {
  assert.deepEqual(resolveAssistIssueSelectState({
    issueableQty: 0,
    stillNeedQty: 0,
    alreadySelected: false,
    warehouseActualQty: 20,
  }), {
    selectState: 'disabled_source',
    selectLabel: '不可选',
    selectable: false,
  })
})

test('resolveAssistIssueSelectState 库存充足可选', () => {
  assert.deepEqual(resolveAssistIssueSelectState({
    issueableQty: 5,
    stillNeedQty: 10,
    alreadySelected: false,
    warehouseActualQty: 20,
  }), {
    selectState: 'select',
    selectLabel: '选择',
    selectable: true,
  })
})

test('来源出库汇总 SQL 含 kcap04/kcap06/kcaa01/kcap03', () => {
  const sql = __buildSourceOutboundAggSqlForTest()
  assert.match(sql, /kcap04/)
  assert.match(sql, /kcap06/)
  assert.match(sql, /kcaa01/)
  assert.match(sql, /kcap03/)
})

test('外协选单 COUNT SQL 含 l.kcaa01 绑定', () => {
  const keywordWhere = `AND (
    LTRIM(RTRIM(CONVERT(nvarchar(200), ISNULL(l.[kcaa01], N'')))) LIKE @keyword
  )`
  const sql = __buildAssistIssueSourceCountSqlForTest('', keywordWhere)
  assert.match(sql, /l\.\[kcaa01\]/)
  assert.match(sql, /wxak03/)
  assert.match(sql, /wxak08/)
})

test('外协选单 LIST SQL 分页', () => {
  const sql = __buildAssistIssueSourceListSqlForTest('', '')
  assert.match(sql, /BETWEEN @startRow AND @endRow/)
})

test('外协领料批量添加 PI 筛选', () => {
  const noPiSql = __buildAssistIssueBatchCountSqlForTest({ piNo: '' })
  assert.doesNotMatch(noPiSql, /@piNo/)

  const piSql = __buildAssistIssueBatchListSqlForTest({ piNo: 'PI-001' })
  assert.match(piSql, /h\.\[wxaj04\]/)
  assert.match(piSql, /= @piNo/)
  assert.match(piSql, /h\.\[pass\]/i)
  assert.match(piSql, /l\.\[pass\]/i)
  assert.doesNotMatch(piSql, /BETWEEN @startRow/)
})

test('buildAssistIssuePiCostHint bom_parts 展开成功不提示', () => {
  assert.equal(buildAssistIssuePiCostHint('PI-4171', [{ expandSource: 'bom_parts' }]), '')
})
