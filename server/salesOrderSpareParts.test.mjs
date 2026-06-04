import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  filterSparePartOrderLines,
  filterWholeProductOrderLines,
  isSparePartKcaa01,
  kcaa01MatchesBomCodeExcludePrefix,
  orderLinesHaveSpareParts,
  orderLinesIsMixed,
  orderLinesIsPureSpare,
  resolveCanAddSpareUsage,
} from './salesOrderSpareParts.js'

const PREFIXES = ['PQ-', 'BAG-', 'CUT-', 'OUT-']
const MIXED_LINES = [{ kcaa01: 'PQ-3633A1/BLU4' }, { kcaa01: 'KP-0143/-' }]

describe('salesOrderSpareParts', () => {
  test('kcaa01MatchesBomCodeExcludePrefix：命中排除前缀', () => {
    assert.equal(kcaa01MatchesBomCodeExcludePrefix('PQ-3633A1/BLU4', PREFIXES), true)
    assert.equal(kcaa01MatchesBomCodeExcludePrefix('CUT-BAGPQ3633A1/BLU4<10-1>', PREFIXES), true)
  })

  test('isSparePartKcaa01：KP 等为散件', () => {
    assert.equal(isSparePartKcaa01('KP-0143/-', PREFIXES), true)
    assert.equal(isSparePartKcaa01('PQ-3633A1/BLU4', PREFIXES), false)
  })

  test('orderLinesHaveSpareParts：混单含散件', () => {
    assert.equal(orderLinesHaveSpareParts(MIXED_LINES, PREFIXES), true)
    assert.equal(orderLinesHaveSpareParts([{ kcaa01: 'PQ-3633A1/BLU4' }], PREFIXES), false)
  })

  test('filterSparePartOrderLines：只返回散件行', () => {
    const spare = filterSparePartOrderLines(MIXED_LINES, PREFIXES)
    assert.equal(spare.length, 1)
    assert.equal(spare[0].kcaa01, 'KP-0143/-')
  })

  test('混单 / 纯散件判定', () => {
    assert.equal(orderLinesIsMixed(MIXED_LINES, PREFIXES), true)
    assert.equal(orderLinesIsPureSpare(MIXED_LINES, PREFIXES), false)
    assert.equal(orderLinesIsPureSpare([{ kcaa01: 'KP-0143/-' }], PREFIXES), true)
    assert.equal(orderLinesIsMixed([{ kcaa01: 'KP-0143/-' }], PREFIXES), false)
    assert.equal(filterWholeProductOrderLines(MIXED_LINES, PREFIXES).length, 1)
  })

  test('resolveCanAddSpareUsage', () => {
    const pqOnly = new Set(['PQ-3633A1/BLU4'])
    assert.equal(resolveCanAddSpareUsage([{ kcaa01: 'KP-0143/-' }], PREFIXES, pqOnly), true)
    assert.equal(resolveCanAddSpareUsage(MIXED_LINES, PREFIXES, pqOnly), true)
    assert.equal(resolveCanAddSpareUsage(MIXED_LINES, PREFIXES, new Set()), false)
  })
})