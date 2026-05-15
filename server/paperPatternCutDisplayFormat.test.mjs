import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  formatPaperPatternCutNumericDisplay,
  formatPaperPatternCutTextDisplay,
} from '../src/utils/paperPatternCutDisplayFormat.js'

describe('paperPatternCutDisplayFormat', () => {
  it('数值三位小数；空为 -', () => {
    assert.equal(formatPaperPatternCutNumericDisplay(''), '-')
    assert.equal(formatPaperPatternCutNumericDisplay('4.449'), '4.449')
    assert.equal(formatPaperPatternCutNumericDisplay(1), '1.000')
  })

  it('非数字数值类原样返回', () => {
    assert.equal(formatPaperPatternCutNumericDisplay('5%'), '5%')
  })

  it('文本空为 -', () => {
    assert.equal(formatPaperPatternCutTextDisplay('  码  '), '码')
    assert.equal(formatPaperPatternCutTextDisplay(''), '-')
  })
})
