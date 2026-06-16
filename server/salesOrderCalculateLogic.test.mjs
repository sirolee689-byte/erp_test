import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  isSalesOrderCalculated,
  parseSyncedKcaa01List,
  resolveMaterialBillCalculateScope,
  validateCalculateOrderState,
} from './salesOrderCalculateLogic.js'

describe('salesOrderCalculateLogic', () => {
  test('isSalesOrderCalculated', () => {
    assert.equal(isSalesOrderCalculated('1'), true)
    assert.equal(isSalesOrderCalculated('0'), false)
    assert.equal(isSalesOrderCalculated(''), false)
  })

  test('parseSyncedKcaa01List 去重与校验', () => {
    assert.deepEqual(parseSyncedKcaa01List(null), { ok: true, list: [] })
    assert.deepEqual(parseSyncedKcaa01List([' A ', 'A', 'B']), { ok: true, list: ['A', 'B'] })
    assert.equal(parseSyncedKcaa01List('x').ok, false)
  })

  test('resolveMaterialBillCalculateScope 未运算整单', () => {
    const r = resolveMaterialBillCalculateScope({
      calcFlag: '0',
      orderLineCodes: ['P1', 'P2'],
      syncedKcaa01: ['P1'],
    })
    assert.deepEqual(r, { ok: true, mode: 'full', products: ['P1', 'P2'] })
  })

  test('resolveMaterialBillCalculateScope 有旧 pi_cost + synced → 部分', () => {
    const partial = resolveMaterialBillCalculateScope({
      calcFlag: '0',
      orderLineCodes: ['P1', 'P2'],
      syncedKcaa01: ['P2'],
      hasExistingPiCost: true,
    })
    assert.deepEqual(partial, { ok: true, mode: 'partial', products: ['P2'] })

    const noSync = resolveMaterialBillCalculateScope({
      calcFlag: '1',
      orderLineCodes: ['P1'],
      syncedKcaa01: [],
      hasExistingPiCost: true,
    })
    assert.deepEqual(noSync, { ok: true, mode: 'full', products: ['P1'] })
  })

  test('validateCalculateOrderState', () => {
    assert.equal(validateCalculateOrderState({ pass: '1', del: '0' }), null)
    assert.equal(validateCalculateOrderState({ pass: '0', del: '1' }), '回收站中的订单不可运算')
    assert.equal(validateCalculateOrderState({ pass: '0', del: '0' }), null)
  })
})
