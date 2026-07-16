import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  materialBom000LookupParams,
  materialBomRowMatchesRequest,
  rowQualifiesMaterialBomFields,
  rowQualifiesMaterialBomPreviewFields,
} from './paperPatternMaterialBomFields.js'

describe('paperPatternMaterialBomFields', () => {
  it('materialBom000LookupParams base code uses LIKE prefix', () => {
    assert.deepEqual(materialBom000LookupParams('BP-0001'), {
      base: 'BP-0001',
      likePrefix: 'BP-0001/%',
      mode: 'prefix',
    })
    assert.deepEqual(materialBom000LookupParams('  LA-0368  '), {
      base: 'LA-0368',
      likePrefix: 'LA-0368/%',
      mode: 'prefix',
    })
    assert.deepEqual(materialBom000LookupParams(''), { base: '', likePrefix: '', mode: 'none' })
  })

  it('materialBom000LookupParams full code uses exact matching', () => {
    assert.deepEqual(materialBom000LookupParams('LA-0368/G3'), {
      base: 'LA-0368/G3',
      likePrefix: '',
      mode: 'exact',
    })
  })

  it('materialBomRowMatchesRequest', () => {
    assert.equal(materialBomRowMatchesRequest('LA-0368/G3', 'LA-0368/G3'), true)
    assert.equal(materialBomRowMatchesRequest('LA-0368/VE12', 'LA-0368/G3'), false)
    assert.equal(materialBomRowMatchesRequest('LA-0368', 'LA-0368'), true)
    assert.equal(materialBomRowMatchesRequest('LA-0368/BLU2', 'LA-0368'), true)
    assert.equal(materialBomRowMatchesRequest('LA-0369', 'LA-0368'), false)
  })

  it('formal import requires both unit and wastage', () => {
    assert.equal(rowQualifiesMaterialBomFields('YD', 0.06), true)
    assert.equal(rowQualifiesMaterialBomFields('YD', 0), true)
    assert.equal(rowQualifiesMaterialBomFields('', 0.06), false)
    assert.equal(rowQualifiesMaterialBomFields('YD', null), false)
    assert.equal(rowQualifiesMaterialBomFields('YD', Number.NaN), false)
  })

  it('preview keeps a material with unit when wastage is empty', () => {
    assert.equal(rowQualifiesMaterialBomPreviewFields('SF'), true)
    assert.equal(rowQualifiesMaterialBomPreviewFields('SF', null), true)
    assert.equal(rowQualifiesMaterialBomPreviewFields(''), false)
  })
})
