import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildGroupMatchingMapFromMaterialRemarks,
  cutSeqMajorForMaterialGroup,
} from './paperPatternMaterialGroupMatching.js'

test('cutSeqMajorForMaterialGroup', () => {
  assert.equal(cutSeqMajorForMaterialGroup('4-1'), '4')
  assert.equal(cutSeqMajorForMaterialGroup('10-2'), '10')
  assert.equal(cutSeqMajorForMaterialGroup(''), '')
})

test('buildGroupMatchingMapFromMaterialRemarks 首条备注生效', () => {
  const m = buildGroupMatchingMapFromMaterialRemarks([
    { groupNo: '1', remark: '' },
    { groupNo: '4', remark: '主里' },
    { groupNo: '4', remark: '其它' },
  ])
  assert.equal(m.get('1'), undefined)
  assert.equal(m.get('4'), '主里')
})
