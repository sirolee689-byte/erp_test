import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  normalizeStockOutHeader,
  validateStockOutPayload,
} from './stockOutSaveLogic.js'
import { resolveStockOutSourceWritebackConfig } from './stockOutLifecycle.js'

describe('stock-out supplement production issue type 8', () => {
  test('allows empty dispatch order but requires workshop', () => {
    assert.equal(validateStockOutPayload({
      header: { outboundType: '8', warehouseCode: 'CK01', inTax: '1', relatedPartyCode: 'WS01' },
      lines: [{ kcaa01: 'A', kcaq03: 1 }],
    }), null)
    assert.match(validateStockOutPayload({
      header: { outboundType: '8', warehouseCode: 'CK01', inTax: '1', sourceOrderNo: '' },
      lines: [{ kcaa01: 'A', kcaq03: 1 }],
    }), /生产车间|鐢熶骇杞﹂棿/)
    assert.equal(validateStockOutPayload({
      header: { outboundType: '8', warehouseCode: 'CK01', inTax: '1', relatedPartyCode: 'WS01', sourceOrderNo: 'PG01' },
      lines: [{ kcaa01: 'A', kcaq03: 1 }],
    }), null)
  })

  test('stores kcap08 as PI only when dispatch order is selected', () => {
    const withDispatch = normalizeStockOutHeader({
      outboundType: '8',
      sourceOrderNo: 'PG01',
      piNo: 'PI-PG-8',
      paperNo: 'PN-IGNORED',
      relatedPartyCode: 'WS01',
    })
    assert.equal(withDispatch.paperNo, '')
    assert.equal(withDispatch.piNo, 'PI-PG-8')

    const withoutDispatch = normalizeStockOutHeader({
      outboundType: '8',
      sourceOrderNo: '',
      kcap08: 'PN-8',
      relatedPartyCode: 'WS01',
    })
    assert.equal(withoutDispatch.paperNo, 'PN-8')
    assert.equal(withoutDispatch.piNo, '')
  })

  test('does not enter source writeback config', () => {
    assert.equal(resolveStockOutSourceWritebackConfig('8'), null)
    assert.equal(resolveStockOutSourceWritebackConfig('7'), null)
    assert.equal(resolveStockOutSourceWritebackConfig('4')?.writebackField, 'scak04')
  })
})
