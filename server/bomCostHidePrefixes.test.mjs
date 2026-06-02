/**
 * BOM / PI 物料单隐藏前缀与落库剔除
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { getDefaultBomCostHidePrefixes } from './bomCostHidePrefixes.js'
import { buildBomCostInsertPayloadFromFlatUsage } from './bomUsageYl.js'

describe('bomCostHidePrefixes', () => {
  test('getDefaultBomCostHidePrefixes 含 CUT-/BAG-/TAG-', () => {
    const prefs = getDefaultBomCostHidePrefixes()
    assert.ok(prefs.some((p) => p.toUpperCase() === 'CUT-'))
    assert.ok(prefs.some((p) => p.toUpperCase() === 'BAG-'))
    assert.ok(prefs.some((p) => p.toUpperCase() === 'TAG-'))
  })

  test('buildBomCostInsertPayloadFromFlatUsage 剔除隐藏前缀与成品根', () => {
    const flat = [
      { kcaa01: 'PQ-TEST1', kcaa02: '成品', yl: 1, loss_rate: 0, total_qty: 1, Describe: '' },
      { kcaa01: 'BAG-TEST1', kcaa02: '包', yl: 1, loss_rate: 0, total_qty: 1, Describe: '' },
      { kcaa01: 'FAB-001', kcaa02: '面料', yl: 0.5, loss_rate: 0.1, total_qty: 0.55, Describe: 'A' },
    ]
    const hidePrefixes = getDefaultBomCostHidePrefixes()
    const payload = buildBomCostInsertPayloadFromFlatUsage(flat, hidePrefixes, 'PQ-TEST1')
    const codes = payload.map((r) => r.kcaa01)
    assert.ok(!codes.includes('PQ-TEST1'))
    assert.ok(!codes.includes('BAG-TEST1'))
    assert.deepEqual(codes, ['FAB-001'])
  })
})
