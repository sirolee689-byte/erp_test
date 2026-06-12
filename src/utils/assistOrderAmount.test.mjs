import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  recalcAssistOrderLineFromQuotedPrices,
  recalcAssistOrderLineFromTaxExcluded,
  recalcAssistOrderLineFromTaxIncluded,
} from './assistOrderAmount.js'

describe('assistOrderAmount', () => {
  test('calculates tax included price and both amounts from tax excluded price', () => {
    const line = recalcAssistOrderLineFromTaxExcluded(
      { wxak03: 12, wxak04: 1.2345, tax: 0.13 },
      { priceDecimals: 4 },
    )

    assert.deepEqual(line, {
      wxak03: 12,
      wxak04: 1.2345,
      tax: 0.13,
      wxak041: 1.395,
      wxak05: 14.81,
      wxak051: 16.74,
    })
  })

  test('reverse calculates tax excluded price from tax included price', () => {
    const line = recalcAssistOrderLineFromTaxIncluded(
      { wxak03: 10, wxak041: 1.13, tax: 0.13 },
      { priceDecimals: 4 },
    )

    assert.deepEqual(line, {
      wxak03: 10,
      wxak04: 1,
      tax: 0.13,
      wxak041: 1.13,
      wxak05: 10,
      wxak051: 11.3,
    })
  })

  test('keeps quoted tax included price and calculates both amounts', () => {
    const line = recalcAssistOrderLineFromQuotedPrices(
      { wxak03: 10, wxak04: 1.2, wxak041: 1.5, tax: 0.13 },
      { priceDecimals: 4 },
    )

    assert.deepEqual(line, {
      wxak03: 10,
      wxak04: 1.2,
      tax: 0.13,
      wxak041: 1.5,
      wxak05: 12,
      wxak051: 15,
    })
  })
})
