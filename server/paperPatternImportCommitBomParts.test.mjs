import test from 'node:test'
import assert from 'node:assert/strict'
import {
  cutMajorFromCutSeq,
  materialGroupMatchesCut,
  parsePaperPatternQty,
} from './paperPatternImportCommitBomParts.js'

test('cutMajorFromCutSeq', () => {
  assert.equal(cutMajorFromCutSeq('3-44'), '3')
  assert.equal(cutMajorFromCutSeq('1-1'), '1')
  assert.equal(cutMajorFromCutSeq(''), '')
})

test('materialGroupMatchesCut', () => {
  assert.equal(materialGroupMatchesCut('3', '3-1'), true)
  assert.equal(materialGroupMatchesCut(3, '3-44'), true)
  assert.equal(materialGroupMatchesCut('2', '3-1'), false)
})

test('parsePaperPatternQty', () => {
  assert.equal(parsePaperPatternQty('1.5'), 1.5)
  assert.equal(parsePaperPatternQty(''), 0)
})
