/**
 * BOM / PI material cost hide-prefix rules.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { getDefaultBomCostHidePrefixes } from './bomCostHidePrefixes.js'
import { buildBomCostInsertPayloadFromFlatUsage } from './bomUsageYl.js'

describe('bomCostHidePrefixes', () => {
  test('getDefaultBomCostHidePrefixes includes CUT-/BAG-/TAG-', () => {
    const prefs = getDefaultBomCostHidePrefixes()
    assert.ok(prefs.some((p) => p.toUpperCase() === 'CUT-'))
    assert.ok(prefs.some((p) => p.toUpperCase() === 'BAG-'))
    assert.ok(prefs.some((p) => p.toUpperCase() === 'TAG-'))
  })

  test('pi_cost keeps normal RP material rows but hides RP-PQ structure rows', () => {
    const hidePrefixes = getDefaultBomCostHidePrefixes()
    const flat = [
      { kcaa01: 'RP-0030/-', kcaa02: 'RP material', yl: 1, loss_rate: 0, total_qty: 1 },
      { kcaa01: 'RP-PQ3633A1/BLU4', kcaa02: 'RP structure', yl: 1, loss_rate: 0, total_qty: 1 },
    ]
    const payload = buildBomCostInsertPayloadFromFlatUsage(flat, hidePrefixes, 'PQ-3633A1/BLU4')
    assert.deepEqual(payload.map((r) => r.kcaa01), ['RP-0030/-'])
  })

  test('buildBomCostInsertPayloadFromFlatUsage removes hidden prefixes and product root', () => {
    const flat = [
      { kcaa01: 'PQ-TEST1', kcaa02: 'product', yl: 1, loss_rate: 0, total_qty: 1, Describe: '' },
      { kcaa01: 'BAG-TEST1', kcaa02: 'bag', yl: 1, loss_rate: 0, total_qty: 1, Describe: '' },
      { kcaa01: 'FAB-001', kcaa02: 'fabric', yl: 0.5, loss_rate: 0.1, total_qty: 0.55, Describe: 'A' },
    ]
    const hidePrefixes = getDefaultBomCostHidePrefixes()
    const payload = buildBomCostInsertPayloadFromFlatUsage(flat, hidePrefixes, 'PQ-TEST1')
    const codes = payload.map((r) => r.kcaa01)
    assert.ok(!codes.includes('PQ-TEST1'))
    assert.ok(!codes.includes('BAG-TEST1'))
    assert.deepEqual(codes, ['FAB-001'])
  })
})
