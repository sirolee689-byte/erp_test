import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  parseSyncBomKcaa01,
  validateSyncBomLineOnOrder,
  validateSyncBomOrderState,
} from './salesOrderSyncBomLogic.js'

describe('salesOrderSyncBomLogic', () => {
  test('parseSyncBomKcaa01 空编码失败', () => {
    assert.equal(parseSyncBomKcaa01('  ').ok, false)
    assert.equal(parseSyncBomKcaa01(' ABC ').ok, true)
  })

  test('validateSyncBomOrderState 已审/回收站', () => {
    assert.match(String(validateSyncBomOrderState({ pass: '1', del: '0' }) ?? ''), /反审/)
    assert.match(String(validateSyncBomOrderState({ pass: '0', del: '1' }) ?? ''), /回收站/)
    assert.equal(validateSyncBomOrderState({ pass: '0', del: '0' }), null)
  })

  test('validateSyncBomLineOnOrder 须在明细中', () => {
    assert.equal(validateSyncBomLineOnOrder('P1', ['P1', 'P2']), null)
    assert.match(String(validateSyncBomLineOnOrder('P9', ['P1']) ?? ''), /不在/)
  })
})
