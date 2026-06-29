import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  aggregateProductionIssueMaterialRows,
  buildProductionIssueLineKey,
  expandProductionDispatchLine,
  pickPiCostRowsForDispatchLine,
} from './stockOutProductionIssueBomExpand.js'
import {
  __aggregateProductionIssueRowsByMaterialForTest,
  __buildPiDemandSqlForTest,
  __buildPiOutboundSqlForTest,
  __buildProductionDispatchBatchListSqlForTest,
  __buildProductionSourceOutboundSqlForTest,
  buildProductionIssueMaterialDedupKey,
  computePiRemainingQty,
  computeProductionDualStillNeedQty,
  computeProductionIssueDefaultQty,
  computeProductionStillNeedQty,
  joinProductionIssueDispatchProductNames,
  resolveProductionIssueDispatchDescribe,
  resolveProductionIssueDualQtyCaps,
  resolveProductionIssueSelectState,
  resolveProductionIssueLinePrice,
  parseProductionIssueBatchPaging,
  sliceProductionIssueBatchList,
} from './stockOutProductionIssueBatchAdd.js'

describe('stockOutProductionIssueBomExpand', () => {
  test('pickPiCostRowsForDispatchLine 按 top 或 pq 命中', () => {
    const rows = [
      { pq: 'BAG-001', top_kcaa01: 'BAG-001', kcaa01: 'BN-0001/-', kcac06: 1 },
      { pq: 'BAG-002', top_kcaa01: 'BAG-002', kcaa01: 'BN-0002/-', kcac06: 2 },
      { pq: 'BAG-001', top_kcaa01: 'BAG-001', kcaa01: 'BN-0003/-', kcac06: 0.5 },
    ]
    const picked = pickPiCostRowsForDispatchLine(rows, { pq: 'BAG-001', topKcaa01: 'BAG-001' })
    assert.equal(picked.length, 2)
  })

  test('aggregateProductionIssueMaterialRows 按全套属性分组并乘派工数量', () => {
    const rows = [
      { kcaa01: 'BN-0001/-', kcaa03: 'S1', kcac06: 0.3, pq: 'BAG-001', top_kcaa01: 'BAG-001' },
      { kcaa01: 'BN-0001/-', kcaa03: 'S1', kcac06: 0.7, pq: 'BAG-001', top_kcaa01: 'BAG-001' },
      { kcaa01: 'BN-0001/-', kcaa03: 'S2', kcac06: 1, pq: 'BAG-001', top_kcaa01: 'BAG-001' },
    ]
    const agg = aggregateProductionIssueMaterialRows(rows, 10)
    assert.equal(agg.length, 2)
    const s1 = agg.find((x) => x.snapshot.kcaa03 === 'S1')
    assert.equal(s1.dispatchDemandQty, 10)
    const s2 = agg.find((x) => x.snapshot.kcaa03 === 'S2')
    assert.equal(s2.dispatchDemandQty, 10)
  })

  test('expandProductionDispatchLine 保留 scak02 追溯', () => {
    const dispatchLine = { scak02: 'guid-001', kcaa01: 'BAG-001', scak03: 5, kcaa02: '成品A' }
    const piRows = [
      { sid: 'PI-001', pq: 'BAG-001', top_kcaa01: 'BAG-001', kcaa01: 'BN-0001/-', kcac06: 2, kcaa03: 'S1' },
    ]
    const expanded = expandProductionDispatchLine(dispatchLine, piRows, 'PI-001')
    assert.equal(expanded.length, 1)
    assert.equal(expanded[0].scak02, 'guid-001')
    assert.equal(expanded[0].dispatchDemandQty, 10)
  })

  test('buildProductionIssueLineKey', () => {
    const key = buildProductionIssueLineKey('GUID-1', 'bn-0001/-\u0001s1')
    assert.match(key, /^guid-1\|/)
  })
})

describe('stockOutProductionIssueBatchAdd', () => {
  test('computeProductionIssueDefaultQty 取 min(还需出库, 库存)', () => {
    assert.equal(
      computeProductionIssueDefaultQty({ stillNeedQty: 100, warehouseActualQty: 50 }),
      50,
    )
    assert.equal(
      computeProductionIssueDefaultQty({ stillNeedQty: 10, warehouseActualQty: 100 }),
      10,
    )
  })

  test('computeProductionStillNeedQty 扣减派工单维度已出与未审出', () => {
    assert.equal(
      computeProductionStillNeedQty({
        sourceDemandQty: 100,
        sourceApprovedOutQty: 30,
        sourcePendingOutQty: 20,
      }),
      50,
    )
    assert.equal(
      computeProductionStillNeedQty({
        sourceDemandQty: 10,
        sourceApprovedOutQty: 10,
        sourcePendingOutQty: 5,
      }),
      0,
    )
  })

  test('computePiRemainingQty PI共用池剩余', () => {
    assert.equal(computePiRemainingQty({ piDemandQty: 100, piIssuedQty: 30 }), 70)
    assert.equal(computePiRemainingQty({ piDemandQty: 50, piIssuedQty: 60 }), 0)
  })

  test('computeProductionDualStillNeedQty 取派工剩余与PI剩余较紧者', () => {
    const piExhausted = computeProductionDualStillNeedQty({
      sourceDemandQty: 100,
      dispatchApprovedOutQty: 0,
      dispatchPendingOutQty: 0,
      piDemandQty: 100,
      piIssuedQty: 100,
    })
    assert.equal(piExhausted.dispatchStillNeedQty, 100)
    assert.equal(piExhausted.piRemainingQty, 0)
    assert.equal(piExhausted.stillNeedQty, 0)

    const piTighter = computeProductionDualStillNeedQty({
      sourceDemandQty: 100,
      dispatchApprovedOutQty: 0,
      dispatchPendingOutQty: 0,
      piDemandQty: 100,
      piIssuedQty: 70,
    })
    assert.equal(piTighter.stillNeedQty, 30)

    const dispatchTighter = computeProductionDualStillNeedQty({
      sourceDemandQty: 100,
      dispatchApprovedOutQty: 80,
      dispatchPendingOutQty: 0,
      piDemandQty: 500,
      piIssuedQty: 0,
    })
    assert.equal(dispatchTighter.stillNeedQty, 20)
  })

  test('resolveProductionIssueDualQtyCaps 默认可选受双道限制与库存约束', () => {
    const caps = resolveProductionIssueDualQtyCaps({
      sourceDemandQty: 100,
      dispatchApprovedOutQty: 0,
      dispatchPendingOutQty: 0,
      piDemandQty: 100,
      piIssuedQty: 95,
      warehouseActualQty: 50,
    })
    assert.equal(caps.piRemainingQty, 5)
    assert.equal(caps.stillNeedQty, 5)
    assert.equal(caps.issueableQty, 5)
  })

  test('resolveProductionIssueSelectState', () => {
    assert.equal(
      resolveProductionIssueSelectState({
        issueableQty: 1,
        stillNeedQty: 10,
        warehouseActualQty: 10,
        alreadySelected: false,
      }).selectLabel,
      '选择',
    )
    assert.equal(
      resolveProductionIssueSelectState({
        issueableQty: 0,
        stillNeedQty: 10,
        warehouseActualQty: 0,
        alreadySelected: false,
      }).selectLabel,
      '库存不足',
    )
    assert.equal(
      resolveProductionIssueSelectState({
        issueableQty: 0,
        stillNeedQty: 0,
        warehouseActualQty: 10,
        alreadySelected: false,
      }).selectLabel,
      '不可选',
    )
  })

  test('resolveProductionIssueLinePrice 取子料最近采购价，无则归零', () => {
    const purchasePriceMap = new Map([
      ['mh-0214/-', { kcaq04: 30.0885, kcaq041: 34.0, tax: 0.13 }],
    ])
    const price = resolveProductionIssueLinePrice({
      materialCode: 'MH-0214/-',
      purchasePriceMap,
    })
    assert.deepEqual(price, { kcaq04: 30.0885, kcaq041: 34, tax: 0.13 })
    assert.deepEqual(
      resolveProductionIssueLinePrice({ materialCode: 'MH-9999/-', purchasePriceMap }),
      { kcaq04: 0, kcaq041: 0, tax: 0 },
    )
  })

  test('resolveProductionIssueDispatchDescribe 取 Bom_000 名称，未命中兜底派工明细名', () => {
    const map = new Map([['bag-001', '防丢器成品名']])
    assert.equal(
      resolveProductionIssueDispatchDescribe('BAG-001', '派工快照名', map),
      '防丢器成品名',
    )
    assert.equal(
      resolveProductionIssueDispatchDescribe('BAG-999', '派工快照名', map),
      '派工快照名',
    )
    assert.equal(resolveProductionIssueDispatchDescribe('BAG-999', '', map), '')
  })

  test('joinProductionIssueDispatchProductNames 去重后用 / 拼接', () => {
    assert.equal(
      joinProductionIssueDispatchProductNames(['同一货品名', '同一货品名']),
      '同一货品名',
    )
    assert.equal(
      joinProductionIssueDispatchProductNames(['货品A', '货品B', '货品A']),
      '货品A / 货品B',
    )
  })

  test('__aggregateProductionIssueRowsByMaterialForTest 合并备注为货品名称', () => {
    const rows = [
      {
        kcaa01: 'BN-0001/-',
        sourceDemandQty: 1,
        dispatchDemandQty: 1,
        warehouseActualQty: 100,
        scak02: 'g1',
        dispatchKcaa01: 'BAG-A',
        Describe: '货品A',
        dispatchKcaa02: '货品A',
        sourceApprovedOutQty: 0,
        sourcePendingOutQty: 0,
        warehouseBookQty: 100,
        warehousePendingOutQty: 0,
        kcaq04: 1,
        kcaq041: 1,
        tax: 0,
        kcaa02: '料A',
        materialSnapshot: { kcaa02: '料A' },
      },
      {
        kcaa01: 'BN-0001/-',
        sourceDemandQty: 2,
        dispatchDemandQty: 2,
        warehouseActualQty: 100,
        scak02: 'g2',
        dispatchKcaa01: 'BAG-B',
        Describe: '货品B',
        dispatchKcaa02: '货品B',
        sourceApprovedOutQty: 0,
        sourcePendingOutQty: 0,
        warehouseBookQty: 100,
        warehousePendingOutQty: 0,
        kcaq04: 1,
        kcaq041: 1,
        tax: 0,
        kcaa02: '料A',
        materialSnapshot: { kcaa02: '料A' },
      },
    ]
    const ctx = {
      piNo: 'PI-1',
      sourceOutboundMap: new Map([['BN-0001/-', { approvedQty: 0, pendingQty: 0 }]]),
      sourcePendingDocMap: new Map(),
      piDemandMap: new Map([['BN-0001/-', 1000]]),
      piIssuedMap: new Map([['BN-0001/-', 0]]),
    }
    const merged = __aggregateProductionIssueRowsByMaterialForTest(rows, new Set(), ctx)
    assert.equal(merged.length, 1)
    assert.equal(merged[0].Describe, '货品A / 货品B')
    assert.equal(merged[0].info, '货品A / 货品B')
  })

  test('__aggregateProductionIssueRowsByMaterialForTest 合并后保留单价并重算金额', () => {
    const rows = [
      {
        kcaa01: 'BN-0001/-',
        sourceDemandQty: 1,
        dispatchDemandQty: 1,
        warehouseActualQty: 100,
        scak02: 'g1',
        dispatchKcaa01: 'BAG-A',
        sourceApprovedOutQty: 0,
        sourcePendingOutQty: 0,
        warehouseBookQty: 100,
        warehousePendingOutQty: 0,
        kcaq04: 30.0885,
        kcaq041: 34,
        tax: 0.13,
        kcaa02: '料A',
        materialSnapshot: { kcaa02: '料A' },
      },
      {
        kcaa01: 'BN-0001/-',
        sourceDemandQty: 2,
        dispatchDemandQty: 2,
        warehouseActualQty: 100,
        scak02: 'g2',
        dispatchKcaa01: 'BAG-B',
        sourceApprovedOutQty: 0,
        sourcePendingOutQty: 0,
        warehouseBookQty: 100,
        warehousePendingOutQty: 0,
        kcaq04: 30.0885,
        kcaq041: 34,
        tax: 0.13,
        kcaa02: '料A',
        materialSnapshot: { kcaa02: '料A' },
      },
    ]
    const ctx = {
      piNo: 'PI-1',
      sourceOutboundMap: new Map([['BN-0001/-', { approvedQty: 0, pendingQty: 0 }]]),
      sourcePendingDocMap: new Map(),
      piDemandMap: new Map([['BN-0001/-', 1000]]),
      piIssuedMap: new Map([['BN-0001/-', 0]]),
    }
    const merged = __aggregateProductionIssueRowsByMaterialForTest(rows, new Set(), ctx)
    assert.equal(merged.length, 1)
    assert.equal(merged[0].kcaq04, 30.0885)
    assert.equal(merged[0].kcaq041, 34)
    assert.equal(merged[0].issueableQty, 3)
    assert.equal(merged[0].kcaq05, 90.27)
    assert.equal(merged[0].kcaq051, 102)
  })

  test('__aggregateProductionIssueRowsByMaterialForTest 同子料累加需出库、已出只扣一次', () => {
    const rows = [
      {
        kcaa01: 'BN-0001/-',
        sourceDemandQty: 0.3,
        dispatchDemandQty: 0.3,
        warehouseActualQty: 100,
        scak02: 'g1',
        dispatchKcaa01: 'BAG-A',
        sourceApprovedOutQty: 0,
        sourcePendingOutQty: 0,
        warehouseBookQty: 100,
        warehousePendingOutQty: 0,
        kcaa02: '料A',
        materialSnapshot: { kcaa02: '料A' },
      },
      {
        kcaa01: 'BN-0001/-',
        sourceDemandQty: 2,
        dispatchDemandQty: 2,
        warehouseActualQty: 100,
        scak02: 'g2',
        dispatchKcaa01: 'BAG-B',
        sourceApprovedOutQty: 0,
        sourcePendingOutQty: 0,
        warehouseBookQty: 100,
        warehousePendingOutQty: 0,
        kcaa02: '料A',
        materialSnapshot: { kcaa02: '料A' },
      },
    ]
    const ctx = {
      piNo: 'PI-1',
      sourceOutboundMap: new Map([['BN-0001/-', { approvedQty: 50, pendingQty: 0 }]]),
      sourcePendingDocMap: new Map(),
      piDemandMap: new Map([['BN-0001/-', 1000]]),
      piIssuedMap: new Map([['BN-0001/-', 0]]),
    }
    const merged = __aggregateProductionIssueRowsByMaterialForTest(rows, new Set(), ctx)
    assert.equal(merged.length, 1)
    assert.equal(merged[0].lineKey, 'material|bn-0001/-')
    assert.equal(merged[0].sourceDemandQty, 2.3)
    assert.equal(merged[0].stillNeedQty, 0)
    assert.equal(merged[0].issueableQty, 0)
  })

  test('__aggregateProductionIssueRowsByMaterialForTest PI已被其他车间领满时不可选', () => {
    const rows = [
      {
        kcaa01: 'BM-0023/-',
        sourceDemandQty: 50,
        dispatchDemandQty: 50,
        warehouseActualQty: 100,
        scak02: 'g1',
        dispatchKcaa01: 'BAG-A',
        sourceApprovedOutQty: 0,
        sourcePendingOutQty: 0,
        warehouseBookQty: 100,
        warehousePendingOutQty: 0,
        kcaq04: 1,
        kcaq041: 1,
        tax: 0,
        kcaa02: '料A',
        materialSnapshot: { kcaa02: '料A' },
      },
    ]
    const ctx = {
      piNo: 'PI-956',
      sourceOutboundMap: new Map([['BM-0023/-', { approvedQty: 0, pendingQty: 0 }]]),
      sourcePendingDocMap: new Map(),
      piDemandMap: new Map([['BM-0023/-', 100]]),
      piIssuedMap: new Map([['BM-0023/-', 100]]),
    }
    const merged = __aggregateProductionIssueRowsByMaterialForTest(rows, new Set(), ctx)
    assert.equal(merged[0].stillNeedQty, 0)
    assert.equal(merged[0].selectLabel, '不可选')
  })

  test('buildProductionIssueMaterialDedupKey', () => {
    assert.equal(buildProductionIssueMaterialDedupKey('BN-0001/-'), '*|bn-0001/-')
  })

  test('production batch SQL avoids 2012+ syntax', () => {
    const source = readFileSync(new URL('./stockOutProductionIssueBatchAdd.js', import.meta.url), 'utf8')
    assert.doesNotMatch(source, /TRY_CONVERT|TRY_CAST|OFFSET\s|FORMAT\s*\(|IIF\s*\(|CONCAT\s*\(/i)
    const expandSource = readFileSync(new URL('./stockOutProductionIssueBomExpand.js', import.meta.url), 'utf8')
    assert.doesNotMatch(expandSource, /TRY_CONVERT|TRY_CAST|OFFSET\s|FORMAT\s*\(|IIF\s*\(/i)
  })

  test('来源出库 SQL 使用生产领料类型与派工单号', () => {
    const sql = __buildProductionSourceOutboundSqlForTest()
    assert.match(sql, /kcap03.*N'4'/i)
    assert.match(sql, /kcap04.*@sourceOrderNo/i)
    assert.match(sql, /kcap06.*@warehouseCode/i)
  })

  test('PI已出 SQL 仅按 kcap08 与 kcaa01，不按车间/派工/仓库', () => {
    const sql = __buildPiOutboundSqlForTest()
    assert.match(sql, /kcap08.*@piNo/i)
    assert.match(sql, /kcaa01/i)
    assert.doesNotMatch(sql, /kcap04/i)
    assert.doesNotMatch(sql, /kcap05/i)
    assert.doesNotMatch(sql, /kcap06/i)
    assert.doesNotMatch(sql, /kehu/i)
  })

  test('PI总量 SQL 来自 pi_cost sid+isok+kcaa01', () => {
    const sql = __buildPiDemandSqlForTest()
    assert.match(sql, /UB_ERP_Bom_pi_cost/i)
    assert.match(sql, /isok/i)
    assert.match(sql, /@piNo/i)
    assert.match(sql, /kcaa01/i)
  })

  test('派工明细 SQL 要求 scak02=GUID', () => {
    const sql = __buildProductionDispatchBatchListSqlForTest()
    assert.match(sql, /scak02.*GUID/is)
  })

  test('fetchAll=1 时 slice 返回全量不受 200 条限制', () => {
    const paging = parseProductionIssueBatchPaging({ fetchAll: '1', pageSize: 20 })
    assert.equal(paging.fetchAll, true)
    const rows = Array.from({ length: 250 }, (_, i) => ({ kcaa01: `M-${i}` }))
    const sliced = sliceProductionIssueBatchList(rows, paging)
    assert.equal(sliced.list.length, 250)
    assert.equal(sliced.total, 250)
    assert.equal(sliced.pageSize, 250)
  })

  test('无 fetchAll 时仍按 pageSize 上限 200 切片', () => {
    const paging = parseProductionIssueBatchPaging({ page: 2, pageSize: 500 })
    assert.equal(paging.pageSize, 200)
    const rows = Array.from({ length: 250 }, (_, i) => ({ kcaa01: `M-${i}` }))
    const sliced = sliceProductionIssueBatchList(rows, paging)
    assert.equal(sliced.list.length, 50)
    assert.equal(sliced.total, 250)
    assert.equal(sliced.page, 2)
  })
})
