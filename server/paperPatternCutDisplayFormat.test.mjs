import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  formatPaperPatternCutMetric4Display,
  formatPaperPatternCutNumericDisplay,
  formatPaperPatternCutTextDisplay,
} from '../src/utils/paperPatternCutDisplayFormat.js'

describe('paperPatternCutDisplayFormat', () => {
  it('数值三位小数；空为 -', () => {
    assert.equal(formatPaperPatternCutNumericDisplay(''), '-')
    assert.equal(formatPaperPatternCutNumericDisplay('4.449'), '4.449')
    assert.equal(formatPaperPatternCutNumericDisplay(1), '1.000')
  })

  it('长宽单位用量：四位小数四舍五入', () => {
    assert.equal(formatPaperPatternCutMetric4Display('4.44956'), '4.4496')
    assert.equal(formatPaperPatternCutMetric4Display(1), '1.0000')
    assert.equal(formatPaperPatternCutMetric4Display(''), '-')
  })

  it('非数字数值类原样返回', () => {
    assert.equal(formatPaperPatternCutNumericDisplay('5%'), '5%')
  })

  it('文本空为 -', () => {
    assert.equal(formatPaperPatternCutTextDisplay('  码  '), '码')
    assert.equal(formatPaperPatternCutTextDisplay(''), '-')
  })
})
