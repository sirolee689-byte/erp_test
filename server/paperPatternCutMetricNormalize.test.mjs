import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizePaperPatternCutMetric4Digits } from './paperPatternCutMetricNormalize.js'

test('normalizePaperPatternCutMetric4Digits 真实浮点四舍五入', () => {
  assert.equal(normalizePaperPatternCutMetric4Digits('4.4488525390625'), '4.4489')
  assert.equal(normalizePaperPatternCutMetric4Digits(4.4488525390625), '4.4489')
})

test('normalizePaperPatternCutMetric4Digits 空与非数字', () => {
  assert.equal(normalizePaperPatternCutMetric4Digits(''), '')
  assert.equal(normalizePaperPatternCutMetric4Digits('5%'), '5%')
})
