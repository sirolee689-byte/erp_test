import test from 'node:test'
import assert from 'node:assert/strict'
import {
  computeFinishedGoodsShippableQty,
  resolveFinishedGoodsBatchSelectState,
  resolveFinishedGoodsDetailKey,
  formatFinishedGoodsPendingText,
} from './stockOutFinishedGoodsBatchAdd.js'
import { computeKsum } from './stockInPurchaseBatchAdd.js'

test('computeFinishedGoodsShippableQty subtracts approved and pending', () => {
  assert.equal(computeFinishedGoodsShippableQty({ orderQty: 100, approvedOutQty: 30, pendingOutQty: 20 }), 50)
  assert.equal(computeFinishedGoodsShippableQty({ orderQty: 10, approvedOutQty: 8, pendingOutQty: 5 }), 0)
})

test('computeKsum unit conversion for sales qty', () => {
  assert.equal(computeKsum(100, 2, '1'), 50)
  assert.equal(computeKsum(100, 2, '0'), 200)
})

test('resolveFinishedGoodsDetailKey prefers xsak02', () => {
  assert.equal(resolveFinishedGoodsDetailKey({ xsak02: 'LINE-1', systemcode: 'SC-1' }), 'LINE-1')
  assert.equal(resolveFinishedGoodsDetailKey({ systemcode: 'SC-2' }), 'SC-2')
})

test('resolveFinishedGoodsBatchSelectState only allows positive shippableQty', () => {
  assert.equal(resolveFinishedGoodsBatchSelectState({ shippableQty: 1, alreadySelected: false }).selectable, true)
  assert.equal(resolveFinishedGoodsBatchSelectState({ shippableQty: 0, alreadySelected: false }).selectLabel, '不可选')
  assert.equal(resolveFinishedGoodsBatchSelectState({ shippableQty: 1, alreadySelected: true }).selectLabel, '已选择')
})

test('formatFinishedGoodsPendingText shows qty / doc count / doc nos', () => {
  const text = formatFinishedGoodsPendingText([
    { docNo: 'OUT-1', qty: 3 },
    { docNo: 'OUT-2', qty: 2 },
  ])
  assert.equal(text, '5 / 2 / OUT-1、OUT-2')
})
