import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  buildAssistBatchLineKey,
  buildBomQtyMapFromCostLines,
  buildCurrentLineQtyMap,
  buildFirstBomQtyMapFromCostLines,
  buildPiCostPxMapFromCostLines,
  calcAvailableQty,
  classifyBatchAddMaterialPath,
  filterBatchAddMaterialRows,
  kcaa01MatchesBomCodeAssistBatchPrefix,
  mergeBatchAddMaterialRows,
  resolveBatchAddBomQty,
  resolveBatchAddCodeColor,
  sortBatchAddMaterialRows,
} from './assistOrderBatchAdd.js'

describe('assistOrderBatchAdd', () => {
  test('buildAssistBatchLineKey normalizes parts', () => {
    const key = buildAssistBatchLineKey(' PI-01 ', ' STYLE-A ', ' M-001 ')
    assert.equal(key, 'pi-01|style-a|m-001')
  })

  test('buildBomQtyMapFromCostLines sums kcac06 * orderQty', () => {
    const map = buildBomQtyMapFromCostLines([
      { pq: 'P1', kcaa01: 'M1', kcac06: 1.1, orderQty: 100 },
      { pq: 'P1', kcaa01: 'M1', kcac06: 0.5, orderQty: 100 },
      { pq: 'P1', kcaa01: 'M2', kcac06: 2, orderQty: 100 },
    ])
    assert.equal(map.get('p1|m1'), 160)
    assert.equal(map.get('p1|m2'), 200)
  })

  test('buildCurrentLineQtyMap aggregates wxak03 by line key', () => {
    const map = buildCurrentLineQtyMap(
      [
        { piNo: 'PI1', product: 'P1', kcaa01: 'M1', wxak03: 2 },
        { piNo: 'PI1', product: 'P1', kcaa01: 'M1', wxak03: 3 },
      ],
      'PI1',
    )
    assert.equal(map.get('pi1|p1|m1'), 5)
  })

  test('calcAvailableQty never goes below zero', () => {
    assert.equal(calcAvailableQty(10, 4, 3), 3)
    assert.equal(calcAvailableQty(5, 8, 0), 0)
  })

  test('buildFirstBomQtyMapFromCostLines uses first kcac06 only', () => {
    const map = buildFirstBomQtyMapFromCostLines([
      { pq: 'P1', kcaa01: 'M1', kcac06: 1.1, orderQty: 100 },
      { pq: 'P1', kcaa01: 'M1', kcac06: 0.5, orderQty: 100 },
      { pq: 'P1', kcaa01: 'M2', kcac06: 2, orderQty: 100 },
    ])
    assert.equal(map.get('p1|m1'), 110)
    assert.equal(map.get('p1|m2'), 200)
  })

  test('filterBatchAddMaterialRows dedupes by kcaa01 and hides non-outsource', () => {
    const rows = filterBatchAddMaterialRows([
      { kcaa01: 'M1', isOutsource: 1, kcaa02: 'first' },
      { kcaa01: 'M1', isOutsource: 1, kcaa02: 'dup' },
      { kcaa01: 'M2', isOutsource: 0, kcaa02: 'hidden' },
      { kcaa01: 'M3', isOutsource: 1, kcaa02: 'ok' },
    ])
    assert.equal(rows.length, 2)
    assert.equal(rows[0].kcaa02, 'first')
    assert.equal(rows[1].kcaa02, 'ok')
  })

  test('kcaa01MatchesBomCodeAssistBatchPrefix follows legacy bomstr', () => {
    assert.equal(kcaa01MatchesBomCodeAssistBatchPrefix('BAG-001', 'BAG'), true)
    assert.equal(kcaa01MatchesBomCodeAssistBatchPrefix('PQ-3633A1/BLU4', 'PQ'), true)
    assert.equal(kcaa01MatchesBomCodeAssistBatchPrefix('XX-OUT', 'OUT'), true)
    assert.equal(kcaa01MatchesBomCodeAssistBatchPrefix('RP-001', 'BAG'), false)
  })

  test('resolveBatchAddCodeColor uses Bom_code flag5 prefix only', () => {
    const prefixes = ['PQ', 'BAG', 'OUT']
    assert.equal(
      resolveBatchAddCodeColor({ kcaa01: 'RP-001', bomCodePrefixes: prefixes }),
      'pi_cost',
    )
    assert.equal(
      resolveBatchAddCodeColor({ kcaa01: 'BAG-001', bomCodePrefixes: prefixes }),
      'sales_list',
    )
    assert.equal(
      resolveBatchAddCodeColor({ kcaa01: 'PQ-3633A1/BLU4', bomCodePrefixes: prefixes }),
      'sales_list',
    )
    assert.equal(
      resolveBatchAddCodeColor({ kcaa01: 'XX-OUT', bomCodePrefixes: prefixes }),
      'sales_list',
    )
  })

  test('mergeBatchAddMaterialRows appends semi-finished not in pkcaa01 tree', () => {
    const merged = mergeBatchAddMaterialRows(
      [{ kcaa01: 'RP-001', isOutsource: 1 }],
      [
        { product: 'PQ-1', kcaa03: 'PQ-1', kcaa01: 'BAG-001', isOutsource: 1 },
        { product: 'PQ-1', kcaa03: 'PQ-1', kcaa01: 'RP-001', isOutsource: 1 },
      ],
      'PQ-1',
      ['BAG'],
    )
    assert.equal(merged.length, 2)
    assert.equal(merged[0].kcaa01, 'RP-001')
    assert.equal(merged[1].kcaa01, 'BAG-001')
  })

  test('mergeBatchAddMaterialRows skips prefix codes in pkcaa01 subtree', () => {
    const merged = mergeBatchAddMaterialRows(
      [{ kcaa01: 'TAG-PQ-1', isOutsource: 1 }],
      [
        {
          product: 'PQ-1',
          kcaa03: 'PQ-1',
          kcaa01: 'TAG-PQ-1',
          isOutsource: 1,
          kcac04: 1.5,
        },
      ],
      'PQ-1',
      ['TAG'],
    )
    assert.equal(merged.length, 1)
    assert.equal(merged[0].kcaa01, 'TAG-PQ-1')
    assert.equal(merged[0].kcac04, 1.5)
  })

  test('classifyBatchAddMaterialPath splits three legacy paths', () => {
    const prefixes = ['TAG', 'BAG']
    assert.equal(
      classifyBatchAddMaterialPath({ kcaa01: 'RP-001' }, 'PQ-1', prefixes),
      'pi_cost_red',
    )
    assert.equal(
      classifyBatchAddMaterialPath({ kcaa01: 'TAG-001', kcaa03: 'PQ-1' }, 'PQ-1', prefixes),
      'sales_list_blue',
    )
    assert.equal(
      classifyBatchAddMaterialPath({ kcaa01: 'BAG-002', kcaa03: 'OTHER' }, 'PQ-1', prefixes),
      'pi_cost_blue',
    )
  })

  test('buildPiCostPxMapFromCostLines keeps first px per product|material', () => {
    const map = buildPiCostPxMapFromCostLines([
      { pq: 'P1', kcaa01: 'M1', px: 30 },
      { pq: 'P1', kcaa01: 'M1', px: 10 },
      { pq: 'P1', kcaa01: 'M2', px: 5 },
    ])
    assert.equal(map.get('p1|m1'), 30)
    assert.equal(map.get('p1|m2'), 5)
  })

  test('sortBatchAddMaterialRows orders red by px, sales_list blue by seq, pi_cost blue by px', () => {
    const piCostPxMap = new Map([
      ['pq-1|rp-b', 20],
      ['pq-1|rp-a', 10],
      ['pq-1|tag-w', 5],
      ['pq-1|bag-z', 15],
    ])
    const sorted = sortBatchAddMaterialRows(
      [
        { kcaa01: 'RP-B', seq: 1 },
        { kcaa01: 'RP-A', seq: 2 },
        { kcaa01: 'TAG-X', kcaa03: 'PQ-1', seq: 30 },
        { kcaa01: 'BAG-Y', kcaa03: 'PQ-1', seq: 10 },
        { kcaa01: 'BAG-Z', kcaa03: 'OTHER', seq: 99 },
        { kcaa01: 'TAG-W', kcaa03: 'OTHER', seq: 1 },
      ],
      'PQ-1',
      ['TAG', 'BAG'],
      piCostPxMap,
    )
    assert.deepEqual(
      sorted.map((r) => r.kcaa01),
      ['RP-A', 'RP-B', 'BAG-Y', 'TAG-X', 'TAG-W', 'BAG-Z'],
    )
  })

  test('resolveBatchAddBomQty uses xsak03 * kcac04 for semi-finished', () => {
    const bomQtyMap = new Map()
    const qty = resolveBatchAddBomQty({
      product: 'PQ-3672',
      material: 'TAG-PQ3672A1/G',
      matRow: { kcac04: 1.21 },
      bomQtyMap,
      orderQty: 100,
      bomCodePrefixes: ['TAG'],
    })
    assert.equal(qty, 121)
  })

  test('resolveBatchAddBomQty prefers pi_cost when key exists', () => {
    const bomQtyMap = new Map([['pq-1|m1', 50]])
    const qty = resolveBatchAddBomQty({
      product: 'PQ-1',
      material: 'M1',
      matRow: { kcac04: 2 },
      bomQtyMap,
      orderQty: 100,
      bomCodePrefixes: ['TAG'],
    })
    assert.equal(qty, 50)
  })

  test('semi-finished available qty uses kcac04 path end-to-end', () => {
    const bomQtyMap = new Map()
    const bomQty = resolveBatchAddBomQty({
      product: 'PQ-3672',
      material: 'TAG-PQ3672A1/G',
      matRow: { kcac04: 1.21 },
      bomQtyMap,
      orderQty: 100,
      bomCodePrefixes: ['TAG'],
    })
    assert.equal(calcAvailableQty(bomQty, 0, 0), 121)
  })

})
