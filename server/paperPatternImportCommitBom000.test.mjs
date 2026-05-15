import test from 'node:test'
import assert from 'node:assert/strict'
import {
  formatPaperPatternCutKcaa03,
  normalizeFactoryStyleForBomPathDisplay,
} from './paperPatternImportCommitBom000.js'

test('formatPaperPatternCutKcaa03 三位小数与乘号', () => {
  assert.equal(formatPaperPatternCutKcaa03('4.449', '4.739'), '4.449*4.739')
  assert.equal(formatPaperPatternCutKcaa03(4.4491, 4.7394), '4.449*4.739')
})

test('formatPaperPatternCutKcaa03 非法为空按 0', () => {
  assert.equal(formatPaperPatternCutKcaa03('x', ''), '0.000*0.000')
  assert.equal(formatPaperPatternCutKcaa03('', null), '0.000*0.000')
})

test('normalizeFactoryStyleForBomPathDisplay 保留横线、去星与空白', () => {
  assert.equal(normalizeFactoryStyleForBomPathDisplay('PQ-2803H1'), 'PQ-2803H1')
  assert.equal(normalizeFactoryStyleForBomPathDisplay(' PQ-*2803H1 '), 'PQ-2803H1')
})
