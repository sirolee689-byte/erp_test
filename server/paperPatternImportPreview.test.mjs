import test from 'node:test'
import assert from 'node:assert/strict'
import { cellToPaperPatternCellString } from './paperPatternImportPreview.js'

test('cellToPaperPatternCellString 数值格用 v 不用 w', () => {
  assert.equal(
    cellToPaperPatternCellString({
      t: 'n',
      v: 4.4488525390625,
      w: '4.449',
    }),
    '4.4488525390625',
  )
})

test('cellToPaperPatternCellString 文本格优先 w', () => {
  assert.equal(
    cellToPaperPatternCellString({
      t: 's',
      v: '00123',
      w: '00123',
    }),
    '00123',
  )
})
