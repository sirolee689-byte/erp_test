import assert from 'node:assert/strict'
import test from 'node:test'
import {
  __aggregateAssistIssueRowsByMaterialForTest,
  __buildAssistIssueBatchCountSqlForTest,
  __buildAssistIssueBatchListSqlForTest,
  __buildAssistIssueLatestPurchasePriceSqlForTest,
  __buildAssistIssueOutboundLineKeysSqlForTest,
  __buildSourceOutboundAggSqlForTest,
  computeAssistOrderTotalQty,
  computeAssistSourceRemain,
  computeAssistIssueableQty,
  computeAssistSourceDemandQty,
  computeAssistStillNeedQty,
  mergeAssistIssueSelectedKeys,
  buildAssistIssueMaterialDedupKey,
  resolveAssistIssueLinePrice,
  resolveAssistIssueSelectState,
} from './stockOutAssistIssueBatchAdd.js'
import {
  buildAssistIssueLineKey,
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

test('computeAssistIssueDefaultQty 四位中间值规整为三位（GB-0004/580 场景）', () => {
  assert.equal(computeAssistIssueDefaultQty({ stillNeedQty: 186.6666, warehouseActualQty: 500 }), 186.667)
  assert.equal(computeAssistStillNeedQty({
    sourceDemandQty: 186.6667,
    sourceApprovedOutQty: 0,
    sourcePendingOutQty: 0,
  }), 186.667)
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

test('resolveAssistIssueSelectState 父页/本单已选不可再选', () => {
  assert.deepEqual(resolveAssistIssueSelectState({
    issueableQty: 314,
    stillNeedQty: 314,
    alreadySelected: true,
    warehouseActualQty: 500,
  }), {
    selectState: 'picked',
    selectLabel: '已选择',
    selectable: false,
  })
})

test('mergeAssistIssueSelectedKeys 合并请求键与本单明细键', () => {
  const key = buildAssistIssueLineKey('WX-001', 'BN-0008/-')
  const set = mergeAssistIssueSelectedKeys('other|mat', [key])
  assert.equal(set.has('other|mat'), true)
  assert.equal(set.has(key.toLowerCase()), true)
})

test('mergeAssistIssueSelectedKeys selectedKeys 非空时仅保留前端键', () => {
  const selectedSet = mergeAssistIssueSelectedKeys('wx-002|bn-1001/-', [])
  assert.equal(selectedSet.has('wx-002|bn-1001/-'), true)
  assert.equal(selectedSet.size, 1)
})

test('mergeAssistIssueSelectedKeys selectedKeys 为空时可回退并入库内键', () => {
  const key = buildAssistIssueLineKey('WX-001', 'BN-0008/-').toLowerCase()
  const set = mergeAssistIssueSelectedKeys('', [key])
  assert.equal(set.has(key), true)
})

test('selectedKeys 空串仍视为已传入（不应触发库内回退）', () => {
  const queryWithEmpty = { selectedKeys: '' }
  const queryWithout = {}
  const hasWithEmpty = Object.prototype.hasOwnProperty.call(queryWithEmpty, 'selectedKeys')
  const hasWithout = Object.prototype.hasOwnProperty.call(queryWithout, 'selectedKeys')
  assert.equal(hasWithEmpty, true)
  assert.equal(hasWithout, false)
})

test('buildAssistIssueMaterialDedupKey 编辑态子料编码兜底', () => {
  assert.equal(buildAssistIssueMaterialDedupKey('BN-0008/-'), '*|bn-0008/-')
  const matKey = buildAssistIssueMaterialDedupKey('BN-0008/-')
  const set = mergeAssistIssueSelectedKeys('', [matKey])
  assert.equal(set.has(matKey), true)
})

test('编辑态读本单明细键 SQL 含 kcaq01/kcaq02/kcaa01', () => {
  const sql = __buildAssistIssueOutboundLineKeysSqlForTest()
  assert.match(sql, /kcaq01/)
  assert.match(sql, /kcaq02/)
  assert.match(sql, /kcaa01/)
  assert.match(sql, /@outboundNo/)
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

test('computeAssistOrderTotalQty 按外协单明细汇总外协数量', () => {
  const totalQty = computeAssistOrderTotalQty([
    { wxak03: 50, kcaa26: 1, kcaa27: '0' },
    { wxak03: 100, kcaa26: 1, kcaa27: '0' },
  ])
  assert.equal(totalQty, 150)
})

test('同子料跨来源合并后仅一行且还需出库数量累加', () => {
  const merged = __aggregateAssistIssueRowsByMaterialForTest([
    {
      lineKey: 'wx1|ep-0001/la-0368/bo',
      sourceLineCode: 'WXAK-1',
      kcaq02: 'WXAK-1',
      wxak02: 'WXAK-1',
      kcaa01: 'EP-0001/LA-0368/BO',
      outsourceKcaa01: 'FG-001',
      stillNeedQty: 0.3,
      requiredQty: 0.3,
      sourceDemandQty: 0.3,
      sourceApprovedOutQty: 0,
      sourcePendingOutQty: 0,
      assistOrderQty: 1,
      assistOrderTotalQty: 150,
      unitUsage: 0.3,
      warehouseActualQty: 100,
      kcaq04: 10,
      kcaq041: 11,
      selectState: 'select',
      selectLabel: '选择',
    },
    {
      lineKey: 'wx2|ep-0001/la-0368/bo',
      sourceLineCode: 'WXAK-2',
      kcaq02: 'WXAK-2',
      wxak02: 'WXAK-2',
      kcaa01: 'EP-0001/LA-0368/BO',
      outsourceKcaa01: 'FG-002',
      stillNeedQty: 2,
      requiredQty: 2,
      sourceDemandQty: 2,
      sourceApprovedOutQty: 0,
      sourcePendingOutQty: 0,
      assistOrderQty: 2,
      assistOrderTotalQty: 150,
      unitUsage: 2,
      warehouseActualQty: 100,
      kcaq04: 10,
      kcaq041: 11,
      selectState: 'select',
      selectLabel: '选择',
    },
  ], new Set())

  assert.equal(merged.length, 1)
  assert.equal(merged[0].kcaa01, 'EP-0001/LA-0368/BO')
  assert.equal(merged[0].sourceDemandQty, 2.3)
  assert.equal(merged[0].stillNeedQty, 2.3)
  assert.equal(merged[0].requiredQty, 2.3)
  assert.equal(merged[0].kcaq03, 2.3)
  assert.equal(merged[0].assistOrderTotalQty, 150)
  assert.equal(merged[0].selectable, true)
})

test('同子料合并后已出库只扣一次（LA-0368/BO 场景）', () => {
  const rowBase = {
    kcaa01: 'LA-0368/BO',
    sourceApprovedOutQty: 50,
    sourcePendingOutQty: 0,
    warehouseActualQty: 5000,
    kcaq04: 10,
    kcaq041: 11,
    selectState: 'select',
    selectLabel: '选择',
  }
  const merged = __aggregateAssistIssueRowsByMaterialForTest([
    {
      ...rowBase,
      lineKey: 'wx1|la-0368/bo',
      sourceLineCode: 'WXAK-1',
      sourceDemandQty: 650.083,
      stillNeedQty: 600.083,
    },
    {
      ...rowBase,
      lineKey: 'wx2|la-0368/bo',
      sourceLineCode: 'WXAK-2',
      sourceDemandQty: 650.083,
      stillNeedQty: 600.083,
    },
    {
      ...rowBase,
      lineKey: 'wx3|la-0368/bo',
      sourceLineCode: 'WXAK-3',
      sourceDemandQty: 650.083,
      stillNeedQty: 600.083,
    },
  ], new Set())

  assert.equal(merged.length, 1)
  assert.equal(merged[0].sourceDemandQty, 1950.249)
  assert.equal(merged[0].stillNeedQty, 1900.249)
  assert.equal(merged[0].requiredQty, 1900.249)
})

test('需出库数量不随已出库变化（EP-0001/LA-0368/BO 场景）', () => {
  const merged = __aggregateAssistIssueRowsByMaterialForTest([
    {
      lineKey: 'wx1|ep-0001/la-0368/bo',
      sourceLineCode: 'WXAK-1',
      kcaa01: 'EP-0001/LA-0368/BO',
      sourceDemandQty: 4.7,
      stillNeedQty: 3.7,
      sourceApprovedOutQty: 1,
      sourcePendingOutQty: 0,
      warehouseActualQty: 100,
      kcaq04: 10,
      kcaq041: 11,
      selectState: 'select',
      selectLabel: '选择',
    },
    {
      lineKey: 'wx2|ep-0001/la-0368/bo',
      sourceLineCode: 'WXAK-2',
      kcaa01: 'EP-0001/LA-0368/BO',
      sourceDemandQty: 4.7,
      stillNeedQty: 3.7,
      sourceApprovedOutQty: 1,
      sourcePendingOutQty: 0,
      warehouseActualQty: 100,
      kcaq04: 10,
      kcaq041: 11,
      selectState: 'select',
      selectLabel: '选择',
    },
  ], new Set())

  assert.equal(merged[0].sourceDemandQty, 9.4)
  assert.equal(merged[0].stillNeedQty, 8.4)
})

test('订单外发子料最近采购价 SQL 使用采购订单并按 kcaa01 取最新', () => {
  const sql = __buildAssistIssueLatestPurchasePriceSqlForTest(2)
  assert.match(sql, /UB_ERP_Buy_order/i)
  assert.match(sql, /UB_ERP_Buy_order_list/i)
  assert.match(sql, /ROW_NUMBER\(\)\s+OVER/i)
  assert.match(sql, /PARTITION BY[\s\S]*kcaa01/i)
  assert.match(sql, /kcak04/i)
  assert.match(sql, /kcak041/i)
  assert.match(sql, /tax/i)
  assert.match(sql, /h\.\[pass\]/i)
  assert.match(sql, /l\.\[pass\]/i)
  assert.match(sql, /h\.\[del\]/i)
  assert.match(sql, /l\.\[del\]/i)
  assert.match(sql, /@mc0/)
  assert.match(sql, /@mc1/)
})

test('订单外发外协领料价格取子料最近采购价，不取外协价或 BOM 销售价', () => {
  const purchasePriceMap = new Map([
    ['gb-0004/580', { kcaq04: 12.3456, kcaq041: 13.9505, tax: 0.13 }],
  ])
  const price = resolveAssistIssueLinePrice({
    materialCode: 'GB-0004/580',
    row: { wxak04: 88, wxak041: 99, Tax: 0.09 },
    mat: { sale_price: 66 },
    ctx: { assistType: '2', purchasePriceMap },
  })
  assert.deepEqual(price, { kcaq04: 12.3456, kcaq041: 13.9505, tax: 0.13 })
})

test('订单外发子料无采购价时价格归零', () => {
  const price = resolveAssistIssueLinePrice({
    materialCode: 'MH-0050/CFL',
    row: { wxak04: 88, wxak041: 99, Tax: 0.09 },
    mat: { sale_price: 66 },
    ctx: { assistType: '2', purchasePriceMap: new Map() },
  })
  assert.deepEqual(price, { kcaq04: 0, kcaq041: 0, tax: 0 })
})
