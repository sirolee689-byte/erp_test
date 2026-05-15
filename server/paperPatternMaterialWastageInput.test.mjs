import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  formatFractionAsDecimalText,
  formatFractionAsPercentText,
  parsePercentUserInputToFraction,
} from '../src/utils/paperPatternMaterialWastageInput.js'

describe('paperPatternMaterialWastageInput', () => {
  it('parsePercentUserInputToFraction', () => {
    assert.equal(parsePercentUserInputToFraction('3'), 0.03)
    assert.equal(parsePercentUserInputToFraction('3%'), 0.03)
    assert.equal(parsePercentUserInputToFraction(' 3.5 % '), 0.035)
    assert.equal(parsePercentUserInputToFraction(''), null)
    assert.equal(parsePercentUserInputToFraction('x'), null)
  })

  it('formatFractionAsDecimalText', () => {
    assert.equal(formatFractionAsDecimalText(0.06), '0.06')
    assert.equal(formatFractionAsDecimalText(0.03), '0.03')
    assert.equal(formatFractionAsDecimalText(null), '')
  })

  it('formatFractionAsPercentText', () => {
    assert.equal(formatFractionAsPercentText(0.03), '3.00%')
    assert.equal(formatFractionAsPercentText(null), '')
  })
})
