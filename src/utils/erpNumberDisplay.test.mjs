import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  formatErpMoneyDisplay,
  formatErpPriceDisplay,
  formatErpQtyDisplay,
  formatErpTrimDecimal,
  roundErpDecimal,
} from './erpNumberDisplay.js'

describe('formatErpTrimDecimal', () => {
  test('三位小数：去末尾 0', () => {
    assert.equal(formatErpTrimDecimal(80.000, { maxDecimals: 3 }), '80')
    assert.equal(formatErpTrimDecimal(54.54, { maxDecimals: 3 }), '54.54')
    assert.equal(formatErpTrimDecimal(54.540, { maxDecimals: 3 }), '54.54')
    assert.equal(formatErpTrimDecimal(0.000, { maxDecimals: 3 }), '0')
  })

  test('两位小数：同样去末尾 0', () => {
    assert.equal(formatErpTrimDecimal(80, { maxDecimals: 2 }), '80')
    assert.equal(formatErpTrimDecimal(54.5, { maxDecimals: 2 }), '54.5')
    assert.equal(formatErpTrimDecimal(54.54, { maxDecimals: 2 }), '54.54')
  })

  test('四位小数：同样去末尾 0', () => {
    assert.equal(formatErpTrimDecimal(1.2340, { maxDecimals: 4 }), '1.234')
    assert.equal(formatErpTrimDecimal(1.2, { maxDecimals: 4 }), '1.2')
  })

  test('一位小数：同样去末尾 0', () => {
    assert.equal(formatErpTrimDecimal(3.0, { maxDecimals: 1 }), '3')
    assert.equal(formatErpTrimDecimal(3.4, { maxDecimals: 1 }), '3.4')
  })

  test('四舍五入后再去 0', () => {
    assert.equal(formatErpTrimDecimal(54.5467, { maxDecimals: 3 }), '54.547')
    assert.equal(formatErpTrimDecimal(54.5444, { maxDecimals: 3 }), '54.544')
  })

  test('负数', () => {
    assert.equal(formatErpTrimDecimal(-54.540, { maxDecimals: 3 }), '-54.54')
  })

  test('空值占位', () => {
    assert.equal(formatErpTrimDecimal(null), '-')
    assert.equal(formatErpTrimDecimal('', { empty: '' }), '')
  })
})

describe('roundErpDecimal', () => {
  test('与展示函数对齐', () => {
    assert.equal(roundErpDecimal(54.5467, 3), 54.547)
    assert.equal(roundErpDecimal(80.0004, 3), 80)
  })
})

describe('别名', () => {
  test('formatErpQtyDisplay', () => {
    assert.equal(formatErpQtyDisplay(80.000), '80')
  })
  test('formatErpMoneyDisplay', () => {
    assert.equal(formatErpMoneyDisplay(100.00), '100')
  })
  test('formatErpPriceDisplay', () => {
    assert.equal(formatErpPriceDisplay(0.5000), '0.5')
  })
})
