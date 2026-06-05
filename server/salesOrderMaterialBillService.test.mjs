import test from 'node:test'
import assert from 'node:assert/strict'
import { buildMaterialBillCostLines } from './salesOrderMaterialBillService.js'

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
