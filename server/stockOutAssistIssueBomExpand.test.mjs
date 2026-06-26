import assert from 'node:assert/strict'
import test from 'node:test'
import {
  aggregatePiCostChildrenByMaterial,
  aggregatePiCostOutboundChildren,
  buildAssistIssueLineKey,
  buildAssistIssuePiCostHint,
  buildPiCostOutboundMergeKey,
  computeAssistIssueDefaultQty,
  computeAssistIssueRequiredQty,
  expandAssistIssueLine,
  expandAssistIssueLineForOutbound,
  hasPiCostAnchorMatch,
  mergeBomPartsWithPiUsage,
  pickPiCostChildrenForLine,
  resolveAssistIssueBomParentKey,
} from './stockOutAssistIssueBomExpand.js'

test('buildAssistIssueLineKey 组合 wxak02 与子料', () => {
  assert.equal(buildAssistIssueLineKey('GUID-001', 'BN-0008/-'), 'guid-001|bn-0008/-')
})

test('aggregatePiCostChildrenByMaterial 同子料累加 kcac04', () => {
  const out = aggregatePiCostChildrenByMaterial([
    { kcaa01: 'BN-0008/-', kcac04: 0.5, top_kcaa01: 'BP-0079/956' },
    { kcaa01: 'BN-0008/-', kcac04: 0.5, top_kcaa01: 'BP-0079/956' },
    { kcaa01: 'LA-0001/-', kcac04: 2, top_kcaa01: 'BP-0079/956' },
  ])
  assert.equal(out.length, 2)
  const bn = out.find((r) => r.childKcaa01 === 'BN-0008/-')
  assert.equal(bn.unitUsage, 1)
})

test('pickPiCostChildrenForLine 按 top_kcaa01 与 pq 过滤', () => {
  const rows = [
    { pq: 'BAG-001', kcaa01: 'BN-0008/-', kcac04: 1, top_kcaa01: 'BP-0079/956' },
    { pq: 'BAG-002', kcaa01: 'LA-0001/-', kcac04: 2, top_kcaa01: 'BP-0079/956' },
    { pq: 'BAG-001', kcaa01: 'BP-0079/956', kcac04: 1, top_kcaa01: 'BP-0079/956' },
  ]
  const children = pickPiCostChildrenForLine(rows, 'BP-0079/956', 'BAG-001')
  assert.equal(children.length, 1)
  assert.equal(children[0].childKcaa01, 'BN-0008/-')
})

test('hasPiCostAnchorMatch BAG 锚点 PI 不命中外发半成品编码', () => {
  const bagPiRows = [
    { pq: 'PQ-3671A1/BLU2', kcaa01: 'BN-0008/-', top_kcaa01: 'BAG-PQ3671A1/BLU2' },
    { pq: 'PQ-3671A1/BLU2', kcaa01: 'BP-0038/-', top_kcaa01: 'BAG-PQ3671A1/BLU2' },
  ]
  assert.equal(hasPiCostAnchorMatch(bagPiRows, 'BN-0005/-', 'PQ-3671A1/BLU2'), false)
  assert.equal(hasPiCostAnchorMatch(bagPiRows, 'BAG-PQ3671A1/BLU2', 'PQ-3671A1/BLU2'), true)
})

test('WX26061104 PI-4171：BAG 锚点走 Bom_parts 直接子层', () => {
  const bomHeadMap = new Map([
    ['bn-0005/-', { systemcode: '637E4014-AAC0-492D-87EF-30F1930A89E2' }],
    ['bp-0079/956', { systemcode: '2026528F61B2BAA322C51FBE540C62AA2A7CB7C78' }],
  ])
  const bomPartsMap = new Map([
    ['637e4014-aac0-492d-87ef-30f1930a89e2', [{ kcaa01: 'BN-0008/-', kcac04: 1 }]],
    ['2026528f61b2baa322c51fbe540c62aa2a7cb7c78', [{ kcaa01: 'BP-0038/-', kcac04: 1 }]],
  ])
  const bagPiRows = [
    { pq: 'PQ-3671A1/BLU2', kcaa01: 'BN-0008/-', kcac04: 0.2, top_kcaa01: 'BAG-PQ3671A1/BLU2' },
    { pq: 'PQ-3671A1/BLU2', kcaa01: 'BP-0038/-', kcac04: 0.08, top_kcaa01: 'BAG-PQ3671A1/BLU2' },
  ]
  const lineBn5 = {
    kcaa01: 'BN-0005/-',
    wxak02: '637E4014-AAC0-492D-87EF-30F1930A89E2',
    wxak03: 314,
    Product: 'PQ-3671A1/BLU2',
  }
  const lineBp = {
    kcaa01: 'BP-0079/956',
    wxak02: '2026528F61B2BAA322C51FBE540C62AA2A7CB7C78',
    wxak03: 123,
    Product: 'PQ-3671A1/BLU2',
  }
  const ctx = { piNo: 'PI-4171', piCostRows: bagPiRows, bomPartsMap, bomHeadMap }
  const exBn5 = expandAssistIssueLine(lineBn5, ctx)
  const exBp = expandAssistIssueLine(lineBp, ctx)
  assert.equal(exBn5[0].childKcaa01, 'BN-0008/-')
  assert.equal(exBn5[0].outsourceKcaa01, 'BN-0005/-')
  assert.equal(exBn5[0].wxak03, 314)
  assert.equal(exBn5[0].unitUsage, 1)
  assert.equal(exBn5[0].expandSource, 'bom_parts')
  assert.equal(exBp[0].childKcaa01, 'BP-0038/-')
  assert.equal(exBp[0].outsourceKcaa01, 'BP-0079/956')
  assert.equal(exBp[0].wxak03, 123)
  assert.equal(exBp[0].unitUsage, 1)
  assert.equal(exBp[0].expandSource, 'bom_parts')
})

test('resolveAssistIssueBomParentKey 优先 Bom_000.systemcode', () => {
  const bomHeadMap = new Map([
    ['bn-0005/-', { systemcode: 'SC-BOM-HEAD' }],
  ])
  const key = resolveAssistIssueBomParentKey(
    { kcaa01: 'BN-0005/-', wxak02: 'WXAK-FALLBACK' },
    bomHeadMap,
  )
  assert.equal(key, 'SC-BOM-HEAD')
})

test('mergeBomPartsWithPiUsage 锚点命中时用 pi_cost 汇总单用量', () => {
  const piMap = new Map([
    ['bn-0008/-', { unitUsage: 2.5, snapshot: { kcaa01: 'BN-0008/-', kcac04: 2.5 } }],
  ])
  const merged = mergeBomPartsWithPiUsage([{ kcaa01: 'BN-0008/-', kcac04: 1 }], piMap)
  assert.equal(merged[0].unitUsage, 2.5)
  assert.equal(merged[0].expandSource, 'pi_cost')
})

test('buildAssistIssuePiCostHint Bom 子层成功不提示', () => {
  assert.equal(
    buildAssistIssuePiCostHint('PI-4171', [{ expandSource: 'bom_parts' }]),
    '',
  )
  assert.equal(
    buildAssistIssuePiCostHint('PI-4171', []),
    '当前 PI 未找到可展开子料，请确认已完成销售订单一键运算',
  )
  assert.equal(
    buildAssistIssuePiCostHint('PI-4171', [{ expandSource: 'self' }]),
    '当前 PI 未命中 pi_cost/BOM 子层，已以外协明细本身兜底',
  )
})

test('computeAssistIssueRequiredQty 外协数量×单用量', () => {
  const qty = computeAssistIssueRequiredQty({
    wxak03: 314,
    kcaa26: 1,
    kcaa27: '0',
    unitUsage: 1,
  })
  assert.equal(qty, 314)
})

test('computeAssistIssueDefaultQty 不超过库存', () => {
  assert.equal(computeAssistIssueDefaultQty({ stillNeedQty: 100, warehouseActualQty: 30 }), 30)
})

test('expandAssistIssueLine PI 锚点命中且 Bom 有直接子层', () => {
  const assistLine = {
    kcaa01: 'BP-0079/956',
    wxak02: 'GUID-BP',
    wxak03: 314,
    Product: 'BAG-001',
  }
  const piCostRows = [
    { pq: 'BAG-001', kcaa01: 'BN-0008/-', kcac04: 1, top_kcaa01: 'BP-0079/956' },
  ]
  const bomPartsMap = new Map([
    ['guid-bp', [{ kcaa01: 'BN-0008/-', kcac04: 3 }]],
  ])
  const expanded = expandAssistIssueLine(assistLine, {
    piNo: 'PI-001',
    piCostRows,
    bomPartsMap,
    bomHeadMap: new Map(),
  })
  assert.equal(expanded.length, 1)
  assert.equal(expanded[0].childKcaa01, 'BN-0008/-')
  assert.equal(expanded[0].outsourceKcaa01, 'BP-0079/956')
  assert.equal(expanded[0].expandSource, 'pi_cost')
  assert.equal(expanded[0].unitUsage, 1)
})

test('expandAssistIssueLine 无子料时兜底外协明细本身', () => {
  const assistLine = { kcaa01: 'MAT-ONLY', wxak02: 'GUID-X', wxak03: 10 }
  const expanded = expandAssistIssueLine(assistLine, {
    piNo: '',
    piCostRows: [],
    bomPartsMap: new Map(),
    bomHeadMap: new Map(),
  })
  assert.equal(expanded.length, 1)
  assert.equal(expanded[0].childKcaa01, 'MAT-ONLY')
  assert.equal(expanded[0].expandSource, 'self')
  assert.equal(expanded[0].unitUsage, 1)
})

test('expandAssistIssueLine Bom_parts 直接子层', () => {
  const assistLine = { kcaa01: 'BP-0079/956', wxak02: 'GUID-BP', wxak03: 100 }
  const bomPartsMap = new Map([
    ['guid-bp', [{ kcaa01: 'BN-0008/-', kcac04: 2 }]],
  ])
  const expanded = expandAssistIssueLine(assistLine, {
    piNo: '',
    piCostRows: [],
    bomPartsMap,
    bomHeadMap: new Map(),
  })
  assert.equal(expanded[0].childKcaa01, 'BN-0008/-')
  assert.equal(expanded[0].unitUsage, 2)
  assert.equal(expanded[0].expandSource, 'bom_parts')
})

test('buildPiCostOutboundMergeKey 同 kcaa01 不同规格不合并', () => {
  const a = buildPiCostOutboundMergeKey({ kcaa01: 'BN-0008/-', kcaa03: '规格A' })
  const b = buildPiCostOutboundMergeKey({ kcaa01: 'BN-0008/-', kcaa03: '规格B' })
  assert.notEqual(a, b)
})

test('aggregatePiCostOutboundChildren 同属性累加 kcac06', () => {
  const out = aggregatePiCostOutboundChildren([
    { kcaa01: 'BN-0008/-', kcaa03: 'S1', kcac06: 0.3, pq: 'BP-0079/956' },
    { kcaa01: 'BN-0008/-', kcaa03: 'S1', kcac06: 0.7, pq: 'BP-0079/956' },
    { kcaa01: 'BN-0008/-', kcaa03: 'S2', kcac06: 1, pq: 'BP-0079/956' },
  ])
  assert.equal(out.length, 2)
  const merged = out.find((r) => r.snapshot?.kcaa03 === 'S1')
  assert.equal(merged?.unitUsage, 1)
  assert.equal(merged?.expandSource, 'pi_cost_outbound')
})

test('expandAssistIssueLineForOutbound pq=外协明细 kcaa01', () => {
  const piRows = [
    { sid: 'PI-001', pq: 'BP-0079/956', kcaa01: 'BN-0008/-', kcac06: 2, kcaa02: '子料名' },
    { sid: 'PI-001', pq: 'BP-0079/956', kcaa01: 'BP-0079/956', kcac06: 1 },
  ]
  const assistLine = {
    kcaa01: 'BP-0079/956',
    pi: 'PI-001',
    wxak02: 'GUID-BP',
    wxak03: 314,
    Product: 'BAG-001',
  }
  const expanded = expandAssistIssueLineForOutbound(assistLine, {
    piNo: 'PI-001',
    piCostOutboundRows: piRows,
  })
  assert.equal(expanded.length, 2)
  const bn = expanded.find((r) => r.childKcaa01 === 'BN-0008/-')
  assert.ok(bn)
  assert.equal(bn.outsourceKcaa01, 'BP-0079/956')
  assert.equal(bn.unitUsage, 2)
  assert.equal(bn.expandSource, 'pi_cost_outbound')
  assert.equal(bn.childSnapshot.kcaa02, '子料名')
})

test('buildAssistIssuePiCostHint 订单外发兜底文案', () => {
  assert.equal(
    buildAssistIssuePiCostHint('PI-1', [{ expandSource: 'self' }], { assistType: '2' }),
    '当前 PI 未命中 pi_cost 用量结果，已以外协明细本身兜底',
  )
})
