import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  calcAssistOrderExpandSubtotal,
  calcAssistOrderPageSubtotal,
} from './assistOrderPageSubtotal.js'

describe('calcAssistOrderExpandSubtotal', () => {
  test('sums detail lines and trailing fee rows', () => {
    const result = calcAssistOrderExpandSubtotal([
      { wxak03: 100, wxak05: 1000, wxak051: 1030 },
      { wxak03: 50, wxak05: 500, wxak051: 515 },
      { _rowType: 'fee', wxak051: 50 },
    ])

    assert.equal(result.quantity, 150)
    assert.equal(result.amountEx, 1500)
    assert.equal(result.amountInc, 1595)
  })
})

describe('calcAssistOrderPageSubtotal', () => {
  test('sums line totals and includes extra fees in tax-included amount', () => {
    const result = calcAssistOrderPageSubtotal([
      { totalQty: 100, taxExcludedTotal: 1000, taxIncludedTotal: 1030, extraFeeTotal: 50 },
      { totalQty: 50, taxExcludedTotal: 500, taxIncludedTotal: 515, extraFeeTotal: 0 },
    ])

    assert.equal(result.quantity, 150)
    assert.equal(result.amountEx, 1500)
    assert.equal(result.amountInc, 1595)
    assert.ok(Math.abs(result.unitPriceEx - 10) < 1e-9)
    assert.ok(Math.abs(result.unitPriceInc - 1595 / 150) < 1e-9)
  })

  test('unit prices are null when quantity is zero', () => {
    const result = calcAssistOrderPageSubtotal([
      { totalQty: 0, taxExcludedTotal: 0, taxIncludedTotal: 0, extraFeeTotal: 20 },
    ])

    assert.equal(result.quantity, 0)
    assert.equal(result.amountInc, 20)
    assert.equal(result.unitPriceEx, null)
    assert.equal(result.unitPriceInc, null)
  })
})
