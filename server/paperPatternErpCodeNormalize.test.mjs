import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  materialErpBaseFromExcelCell,
  normalizeErpCodeDisplay,
  erpCodeLookupKey,
} from './paperPatternErpCodeNormalize.js'

describe('paperPatternErpCodeNormalize', () => {
  it('去掉首尾空白并压缩中间空白', () => {
    assert.equal(normalizeErpCodeDisplay('  LA-0368/N  '), 'LA-0368/N')
    assert.equal(normalizeErpCodeDisplay('LA-\t0368/N'), 'LA- 0368/N')
  })

  it('空与纯空白', () => {
    assert.equal(normalizeErpCodeDisplay(''), '')
    assert.equal(normalizeErpCodeDisplay('   \t  '), '')
  })

  it('比对键：小写', () => {
    assert.equal(erpCodeLookupKey('LA-0368/N'), 'la-0368/n')
    assert.equal(erpCodeLookupKey(''), '')
  })

  it('全角斜杠与 BOM 归一', () => {
    assert.equal(normalizeErpCodeDisplay('NN-0021／580'), 'NN-0021/580')
    assert.equal(normalizeErpCodeDisplay('\uFEFFNN-0021/580'), 'NN-0021/580')
  })

  it('Material N 列 → 基码', () => {
    assert.equal(materialErpBaseFromExcelCell('LA-0368/G3'), 'LA-0368')
    assert.equal(materialErpBaseFromExcelCell('BP-0001/956'), 'BP-0001')
    assert.equal(materialErpBaseFromExcelCell('BP-0038/-'), 'BP-0038')
    assert.equal(materialErpBaseFromExcelCell('BN-0003/dark color'), 'BN-0003')
    assert.equal(materialErpBaseFromExcelCell('LA-0368'), 'LA-0368')
    assert.equal(materialErpBaseFromExcelCell(''), '')
  })
})
