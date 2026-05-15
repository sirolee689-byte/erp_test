import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { canEditPaperPatternMaterialWastage } from '../src/utils/paperPatternMaterialWastagePolicy.js'

describe('paperPatternMaterialWastagePolicy', () => {
  it('LA-/LB-/LC- 可编辑（大小写不敏感）', () => {
    assert.equal(canEditPaperPatternMaterialWastage('LA-0368/N'), true)
    assert.equal(canEditPaperPatternMaterialWastage('lb-0021/N'), true)
    assert.equal(canEditPaperPatternMaterialWastage('LC-8888/N'), true)
  })

  it('其它前缀不可编辑', () => {
    assert.equal(canEditPaperPatternMaterialWastage('NN-0021/580'), false)
    assert.equal(canEditPaperPatternMaterialWastage('ZS-0034/CFL'), false)
    assert.equal(canEditPaperPatternMaterialWastage(''), false)
  })
})
