import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizePaperPatternCutMetric4Digits,
  PAPER_PATTERN_CUT_METRIC_DECIMALS,
} from './paperPatternCutMetricNormalize.js'

test('PAPER_PATTERN_CUT_METRIC_DECIMALS 为 6', () => {
  assert.equal(PAPER_PATTERN_CUT_METRIC_DECIMALS, 6)
})

test('normalizePaperPatternCutMetric4Digits 真实浮点四舍五入为六位', () => {
  assert.equal(normalizePaperPatternCutMetric4Digits('4.4488525390625'), '4.448853')
  assert.equal(normalizePaperPatternCutMetric4Digits(4.4488525390625), '4.448853')
  assert.equal(normalizePaperPatternCutMetric4Digits('8.81884765625'), '8.818848')
})

test('normalizePaperPatternCutMetric4Digits 空与非数字', () => {
  assert.equal(normalizePaperPatternCutMetric4Digits(''), '')
  assert.equal(normalizePaperPatternCutMetric4Digits('5%'), '5%')
})
