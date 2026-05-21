import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  getErpTableActionsColCount,
  getErpTableActionsColMinWidth,
  erpTableActionsGridClass,
} from './erpTableActionsLayout.js'

test('getErpTableActionsColCount: n<7 每行最多 3', () => {
  assert.equal(getErpTableActionsColCount(0), 1)
  assert.equal(getErpTableActionsColCount(1), 1)
  assert.equal(getErpTableActionsColCount(3), 3)
  assert.equal(getErpTableActionsColCount(6), 3)
})

test('getErpTableActionsColCount: n>=7 为 ceil(n/2)', () => {
  assert.equal(getErpTableActionsColCount(7), 4)
  assert.equal(getErpTableActionsColCount(8), 4)
  assert.equal(getErpTableActionsColCount(9), 5)
  assert.equal(getErpTableActionsColCount(10), 5)
})

test('erpTableActionsGridClass', () => {
  assert.equal(erpTableActionsGridClass(7), 'erp-table-actions--cols-4')
})

test('getErpTableActionsColMinWidth: 按列数估宽', () => {
  assert.equal(getErpTableActionsColMinWidth(5, { compact: true }), 264)
  assert.equal(getErpTableActionsColMinWidth(7, { compact: true }), 346)
  assert.equal(getErpTableActionsColMinWidth(3, { compact: true }), 264)
})
