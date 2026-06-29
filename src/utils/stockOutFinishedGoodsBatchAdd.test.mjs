import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { deriveFinishedGoodsCustomsModel } from './stockOutFinishedGoodsBatchAdd.js'

describe('deriveFinishedGoodsCustomsModel', () => {
  test('PQ- 前缀且带 / 后缀时取斜杠前段', () => {
    assert.equal(deriveFinishedGoodsCustomsModel('PQ-3691A1/N'), '3691A1')
  })

  test('PQ- 前缀无斜杠时取整段后缀', () => {
    assert.equal(deriveFinishedGoodsCustomsModel('PQ-3790A1'), '3790A1')
  })

  test('非 PQ- 编码返回空', () => {
    assert.equal(deriveFinishedGoodsCustomsModel('CUT-123'), '')
    assert.equal(deriveFinishedGoodsCustomsModel(''), '')
  })

  test('大小写不敏感识别 PQ- 前缀', () => {
    assert.equal(deriveFinishedGoodsCustomsModel('pq-2803H1/x'), '2803H1')
  })
})
