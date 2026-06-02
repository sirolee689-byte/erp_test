import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { flattenPiBomPartRows } from './salesOrderPiBom.js'

describe('salesOrderPiBom', () => {
  test('flattenPiBomPartRows 深子树可全部展平（无层数上限）', () => {
    const deepChild = { systemcode: 'L5', kcaa01: 'P5', children: [] }
    const n4 = { systemcode: 'L4', kcaa01: 'P4', children: [deepChild] }
    const n3 = { systemcode: 'L3', kcaa01: 'P3', children: [n4] }
    const n2 = { systemcode: 'L2', kcaa01: 'P2', children: [n3] }
    const n1 = { systemcode: 'L1', kcaa01: 'P1', children: [n2] }
    const out = []
    flattenPiBomPartRows('HEAD', [n1], out, 1, 'BAG-X')
    assert.equal(out.length, 5)
    assert.equal(out[0].sourceRow.kcaa01, 'P1')
    assert.equal(out[4].sourceRow.kcaa01, 'P5')
  })
})
