/**
 * pi_cost 落库 payload 与 bom_cost usage-calc 同链路（方案 A：不按 list.id 二次去重）
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { flattenBomPartsCostUsageFlatForBomCost } from './bomUsageFlatten.js'
import { buildBomCostInsertPayloadFromFlatUsage } from './bomUsageYl.js'
import { getDefaultBomCostHidePrefixes } from './bomCostHidePrefixes.js'
import {
  buildPiCostInsertPayloadFromFlatUsage,
  buildPiCostInsertPayloadFromUsageTree,
} from './salesOrderCalculateService.js'
import { buildPiBomUsageTreeNodesFromLayerCache } from './salesOrderPiBomUsageTree.js'

const PRODUCT = 'PQ-3633A1/BLU4'

/** 与 salesOrderPiBomUsageTree.test 同款：4 条路径各 1 行 BN-0008 */
function buildBn0008FixtureLayerCache() {
  const scCut91 = 'SC-CUT-9-1'
  const sc5a = 'SC-5-10-1'
  const sc5b = 'SC-5-10-2'
  const sc5c = 'SC-5-10-3'
  const sharedBn5 = 'BN-0005/-'

  return new Map([
    [
      'HEAD',
      [
        {
          id: 1,
          kcaa01: 'CUT-BAG<9-1>',
          kcac01: 'HEAD',
          kcac02: scCut91,
          systemcode: scCut91,
          kcac04: 1,
          kcac05: 0,
        },
        {
          id: 2,
          kcaa01: 'CUT-BAG<10-1>',
          kcac01: 'HEAD',
          kcac02: sharedBn5,
          systemcode: sc5a,
          kcac04: 1,
          kcac05: 0,
        },
        {
          id: 3,
          kcaa01: 'CUT-BAG<10-2>',
          kcac01: 'HEAD',
          kcac02: sharedBn5,
          systemcode: sc5b,
          kcac04: 1,
          kcac05: 0,
        },
        {
          id: 4,
          kcaa01: 'CUT-BAG<10-3>',
          kcac01: 'HEAD',
          kcac02: sharedBn5,
          systemcode: sc5c,
          kcac04: 1,
          kcac05: 0,
        },
      ],
    ],
    [scCut91, [{ id: 5, kcaa01: 'BN-0008/-', kcac01: scCut91, kcac02: '', systemcode: 'SC-8-9-1', kcac04: 1, kcac05: 0 }]],
    [sc5a, [{ id: 10, kcaa01: 'BN-0005/-', kcac01: sc5a, kcac02: 'SC-BN5-POOL', systemcode: 'SC-BN5-10-1', kcac04: 1, kcac05: 0 }]],
    [sc5b, [{ id: 11, kcaa01: 'BN-0005/-', kcac01: sc5b, kcac02: 'SC-BN5-POOL', systemcode: 'SC-BN5-10-2', kcac04: 1, kcac05: 0 }]],
    [sc5c, [{ id: 12, kcaa01: 'BN-0005/-', kcac01: sc5c, kcac02: 'SC-BN5-POOL', systemcode: 'SC-BN5-10-3', kcac04: 1, kcac05: 0 }]],
    ['SC-BN5-10-1', [{ id: 20, kcaa01: 'BN-0008/-', kcac01: 'SC-BN5-10-1', kcac02: '', systemcode: 'SC-8-10-1', kcac04: 1, kcac05: 0 }]],
    ['SC-BN5-10-2', [{ id: 21, kcaa01: 'BN-0008/-', kcac01: 'SC-BN5-10-2', kcac02: '', systemcode: 'SC-8-10-2', kcac04: 1, kcac05: 0 }]],
    ['SC-BN5-10-3', [{ id: 22, kcaa01: 'BN-0008/-', kcac01: 'SC-BN5-10-3', kcac02: '', systemcode: 'SC-8-10-3', kcac04: 1, kcac05: 0 }]],
  ])
}

function usageCalcPayloadFromTree(tree, product) {
  const flat = flattenBomPartsCostUsageFlatForBomCost(tree, null, [])
  return buildBomCostInsertPayloadFromFlatUsage(flat, getDefaultBomCostHidePrefixes(), product)
}

describe('salesOrderCalculatePiCost', () => {
  test('pi_cost payload 与 usage-calc 平铺结果一致（无 list.id 去重）', () => {
    const tree = buildPiBomUsageTreeNodesFromLayerCache(
      'HEAD',
      1,
      new Set(['HEAD']),
      buildBn0008FixtureLayerCache(),
      PRODUCT,
    )
    const fromPi = buildPiCostInsertPayloadFromUsageTree(tree, PRODUCT)
    const fromUsageCalc = usageCalcPayloadFromTree(tree, PRODUCT)
    assert.equal(fromPi.length, fromUsageCalc.length)
    for (let i = 0; i < fromPi.length; i++) {
      assert.equal(fromPi[i].kcaa01, fromUsageCalc[i].kcaa01)
      assert.equal(fromPi[i].Describe, fromUsageCalc[i].Describe)
      assert.equal(fromPi[i].kcac04, fromUsageCalc[i].kcac04)
      assert.equal(fromPi[i].kcac06, fromUsageCalc[i].kcac06)
    }
  })

  test('四条路径 BN-0008 均进入 pi_cost payload（不因 sourceRowId 压成更少行）', () => {
    const tree = buildPiBomUsageTreeNodesFromLayerCache(
      'HEAD',
      1,
      new Set(['HEAD']),
      buildBn0008FixtureLayerCache(),
      PRODUCT,
    )
    const flat = flattenBomPartsCostUsageFlatForBomCost(tree, null, [])
    const payload = buildPiCostInsertPayloadFromFlatUsage(flat, PRODUCT)
    const bn08 = payload.filter((r) => r.kcaa01 === 'BN-0008/-')
    assert.equal(bn08.length, 4, 'BN-0008 应对应 4 条 pi_cost 行')
  })
  test('pi_cost writes RP material rows and skips RP-PQ structure rows', () => {
    const tree = [
      {
        id: 1,
        kcaa01: 'CUT-BAG<1-1>',
        kcac04: 1,
        kcac05: 0,
        children: [
          {
            id: 2,
            kcaa01: 'RP-0030/-',
            kcac04: 0.5,
            kcac05: 0,
            children: [],
          },
          {
            id: 3,
            kcaa01: 'RP-PQ3633A1/BLU4',
            kcac04: 1,
            kcac05: 0,
            children: [],
          },
        ],
      },
    ]
    const payload = buildPiCostInsertPayloadFromUsageTree(tree, PRODUCT)
    const codes = payload.map((r) => r.kcaa01)
    assert.ok(codes.includes('RP-0030/-'))
    assert.ok(!codes.includes('RP-PQ3633A1/BLU4'))
  })
})
