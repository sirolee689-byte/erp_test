import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  buildNextBuyOrderNo,
  calculateBuyOrderAmount,
  normalizeBuyOrderHeader,
  resolveBuyOrderTypeOptions,
  validateBuyOrderHeader,
} from './buyOrderSaveLogic.js'

describe('buyOrderSaveLogic', () => {
  test('generates ZY and PO numbers without reusing deleted occupied numbers', () => {
    assert.equal(buildNextBuyOrderNo({ numberType: 'ZY', saveDate: '2026-06-18', existingOrderNos: ['ZY-2501', 'ZY-2509'] }), 'ZY-2510')
    assert.equal(buildNextBuyOrderNo({ numberType: 'PO', saveDate: '2026-06-18', existingOrderNos: ['PO-0098', 'PO-0099'] }), 'PO-0100')
  })

  test('generates current-year number by save year and next sequence', () => {
    assert.equal(buildNextBuyOrderNo({ numberType: '2026', saveDate: '2026-06-18', existingOrderNos: ['202600001', '202600165'] }), '202600166')
  })

  test('applies number type to purchase type defaults and locks', () => {
    assert.deepEqual(resolveBuyOrderTypeOptions('ZY'), { defaultType: '1', allowedTypes: ['1', '2'] })
    assert.deepEqual(resolveBuyOrderTypeOptions('PO'), { defaultType: '2', allowedTypes: ['2'] })
    assert.deepEqual(resolveBuyOrderTypeOptions('2026'), { defaultType: '2', allowedTypes: ['0', '1', '2'] })
  })

  test('requires source number for order purchase and multi-PI purchase, but not other purchase', () => {
    assert.match(validateBuyOrderHeader(normalizeBuyOrderHeader({ buyDate: '2026-06-18', buyType: '1', supplierCode: 'S01', taxIncluded: '1', currencyCode: 'RMB' })), /关联单号/)
    assert.match(validateBuyOrderHeader(normalizeBuyOrderHeader({ buyDate: '2026-06-18', buyType: '2', supplierCode: 'S01', taxIncluded: '1', currencyCode: 'RMB' })), /关联单号/)
    assert.equal(validateBuyOrderHeader(normalizeBuyOrderHeader({ buyDate: '2026-06-18', buyType: '0', supplierCode: 'S01', taxIncluded: '1', currencyCode: 'RMB' })), null)
  })

  test('calculates amounts from tax-included unit price and supports no-tax mode', () => {
    assert.deepEqual(calculateBuyOrderAmount({ quantity: 3, taxIncludedPrice: 113, tax: 0.13, decimalPlaces: 4, taxIncludedMode: '1' }), {
      taxExcludedPrice: 100,
      taxIncludedPrice: 113,
      taxExcludedAmount: 300,
      taxIncludedAmount: 339,
      tax: 0.13,
    })
    assert.deepEqual(calculateBuyOrderAmount({ quantity: 2, taxIncludedPrice: 88.1234, tax: 0.13, decimalPlaces: 4, taxIncludedMode: '2' }), {
      taxExcludedPrice: 88.1234,
      taxIncludedPrice: 88.1234,
      taxExcludedAmount: 176.25,
      taxIncludedAmount: 176.25,
      tax: 0,
    })
  })
})
