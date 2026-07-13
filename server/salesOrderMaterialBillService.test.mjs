import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildMaterialBillConsumptionLinesFromCost,
  buildMaterialBillCostLines,
  buildMaterialBillSingleUsageByProduct,
  formatMaterialBillColorDisplay,
} from './salesOrderMaterialBillService.js'

test('formatMaterialBillColorDisplay joins code and Chinese name like BOM', () => {
  assert.equal(formatMaterialBillColorDisplay('419', '深灰色'), '419,深灰色')
  assert.equal(formatMaterialBillColorDisplay('419', ''), '419')
  assert.equal(formatMaterialBillColorDisplay('', '深灰色'), '')
})

test('buildMaterialBillCostLines returns px and sorts by pq then px then id', () => {
  const rows = [
    { id: 4, pq: 'PQ-B', kcaa01: 'B-NO-PX', kcac04: 1, kcac05: 0, kcac06: 1, px: null },
    { id: 3, pq: 'PQ-A', kcaa01: 'A-PX-20', kcac04: 1, kcac05: 0, kcac06: 1, px: 20 },
    { id: 2, pq: 'PQ-A', kcaa01: 'A-NO-PX', kcac04: 1, kcac05: 0, kcac06: 1, px: null },
    { id: 1, pq: 'PQ-A', kcaa01: 'A-PX-10', kcac04: 1, kcac05: 0, kcac06: 1, px: 10 },
  ]
  const out = buildMaterialBillCostLines(rows, new Map([['PQ-A', 5]]))

  assert.deepEqual(
    out.map((row) => row.kcaa01),
    ['A-PX-10', 'A-PX-20', 'A-NO-PX', 'B-NO-PX'],
  )
  assert.deepEqual(
    out.map((row) => row.px),
    [10, 20, null, null],
  )
  assert.equal(out[0].orderQty, 5)
  assert.equal(out[0].prepQty, 5)
})

test('buildMaterialBillCostLines formats kcaa11 with colorName', () => {
  const out = buildMaterialBillCostLines(
    [
      {
        id: 1,
        pq: 'PQ-A',
        kcaa01: 'BP-0079/419',
        kcaa11: '419',
        colorName: '深灰色',
        kcac04: 1,
        kcac05: 0,
        kcac06: 1,
      },
      {
        id: 2,
        pq: 'PQ-A',
        kcaa01: 'MAT-NO-NAME',
        kcaa11: '580',
        colorName: '',
        kcac04: 1,
        kcac05: 0,
        kcac06: 1,
      },
    ],
    new Map(),
  )
  assert.equal(out[0].kcaa11, '419,深灰色')
  assert.equal(out[1].kcaa11, '580')
})

test('buildMaterialBillConsumptionLinesFromCost scales usage by orderQty before merge', () => {
  const costLines = buildMaterialBillCostLines(
    [
      { id: 1, pq: 'PQ-A', kcaa01: 'MAT-1', kcac04: 0.5, kcac05: 0, kcac06: 0.5, Describe: '' },
      { id: 2, pq: 'PQ-B', kcaa01: 'MAT-1', kcac04: 0.2, kcac05: 0, kcac06: 0.2, Describe: '' },
    ],
    new Map([
      ['PQ-A', 100],
      ['PQ-B', 200],
    ]),
  )
  const out = buildMaterialBillConsumptionLinesFromCost(costLines)

  assert.equal(out.length, 1)
  assert.equal(out[0].kcaa01, 'MAT-1')
  assert.equal(out[0].sumay, 90)
  assert.equal(out[0].sumby, 90)
})

test('buildMaterialBillConsumptionLinesFromCost joins distinct colors with semicolon', () => {
  const costLines = buildMaterialBillCostLines(
    [
      {
        id: 1,
        pq: 'PQ-A',
        kcaa01: 'MAT-1',
        kcaa11: '419',
        colorName: '深灰色',
        kcac04: 1,
        kcac05: 0,
        kcac06: 1,
        Describe: '',
      },
      {
        id: 2,
        pq: 'PQ-B',
        kcaa01: 'MAT-1',
        kcaa11: '580',
        colorName: '黑色',
        kcac04: 1,
        kcac05: 0,
        kcac06: 1,
        Describe: '',
      },
    ],
    new Map([
      ['PQ-A', 1],
      ['PQ-B', 1],
    ]),
  )
  const out = buildMaterialBillConsumptionLinesFromCost(costLines)
  assert.equal(out.length, 1)
  assert.equal(out[0].kcaa11, '419,深灰色;580,黑色')
})

test('buildMaterialBillSingleUsageByProduct sums kcac06 by product code', () => {
  const costLines = buildMaterialBillCostLines(
    [
      { id: 1, pq: 'PQ-3675A1/MO', kcaa01: 'MAT-1', kcac04: 10, kcac05: 0, kcac06: 66.7459 },
      { id: 2, pq: 'PQ-3675A1/MO', kcaa01: 'MAT-2', kcac04: 20, kcac05: 0, kcac06: 1.3511 },
      { id: 3, pq: 'PQ-OTHER', kcaa01: 'MAT-3', kcac04: 30, kcac05: 0, kcac06: 30 },
    ],
    new Map(),
  )
  const out = buildMaterialBillSingleUsageByProduct(costLines)

  assert.equal(out.get('PQ-3675A1/MO'), 68.097)
  assert.equal(out.get('PQ-OTHER'), 30)
})
