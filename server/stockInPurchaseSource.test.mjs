import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { __stockInSourceMetaForTest } from './stockInHandlers.js'

describe('stock-in purchase source contract', () => {
  test('purchase inbound uses buy-order kcaj fields and BOM systemcode detail key', () => {
    const meta = __stockInSourceMetaForTest('1')
    assert.equal(meta.noCol, 'kcaj01')
    assert.equal(meta.partyCol, 'kcaj05')
    assert.equal(meta.lineOrderCol, 'kcak01')
    assert.equal(meta.detailKeyCol, 'kcak02')
    assert.equal(meta.taxIncludedPriceCol, 'kcak041')
    assert.equal(meta.taxCol, 'tax')
  })
})
