import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  canEditPaperPatternMaterialWastage,
  collectMissingEditableMaterialWastage,
  isMaterialWastageFractionFilled,
} from '../src/utils/paperPatternMaterialWastagePolicy.js'

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

  it('isMaterialWastageFractionFilled：0 合法，空非法', () => {
    assert.equal(isMaterialWastageFractionFilled(0), true)
    assert.equal(isMaterialWastageFractionFilled(0.06), true)
    assert.equal(isMaterialWastageFractionFilled(null), false)
    assert.equal(isMaterialWastageFractionFilled(''), false)
  })

  it('collectMissingEditableMaterialWastage 仅统计可编辑且未填行', () => {
    const missing = collectMissingEditableMaterialWastage([
      { wastageEditable: true, wastageFraction: null, groupNo: '1', materialCode: 'LA-1/N' },
      { wastageEditable: true, wastageFraction: 0.05, groupNo: '2', materialCode: 'LB-2/N' },
      { wastageEditable: false, wastageFraction: null, groupNo: '3', materialCode: 'NN-3/N' },
    ])
    assert.equal(missing.length, 1)
    assert.equal(missing[0].materialCode, 'LA-1/N')
  })
})
