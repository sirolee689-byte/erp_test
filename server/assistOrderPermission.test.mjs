import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { matchApiPermissionRule } from './apiPermissionGate.js'

describe('assist order permission rules', () => {
  test('list and detail use outsourcing-order view permission', () => {
    assert.deepEqual(matchApiPermissionRule('GET', '/api/assist-order/list', {}, {}), {
      menuPath: 'supply-chain/daily/outsourcing-order',
      action: 'view',
    })
    assert.deepEqual(matchApiPermissionRule('GET', '/api/assist-order/8', {}, {}), {
      menuPath: 'supply-chain/daily/outsourcing-order',
      action: 'view',
    })
  })

  test('create and update save routes use add/edit permissions', () => {
    assert.deepEqual(matchApiPermissionRule('GET', '/api/assist-order/suggest-doc-no', {}, {}), {
      menuPath: 'supply-chain/daily/outsourcing-order',
      action: 'add',
    })
    assert.deepEqual(matchApiPermissionRule('GET', '/api/assist-order/supplier-options', {}, {}), {
      menuPath: 'supply-chain/daily/outsourcing-order',
      action: 'view',
    })
    assert.deepEqual(matchApiPermissionRule('GET', '/api/assist-order/currency-options', {}, {}), {
      menuPath: 'supply-chain/daily/outsourcing-order',
      action: 'view',
    })
    assert.deepEqual(matchApiPermissionRule('GET', '/api/assist-order/material-options', {}, {}), {
      menuPath: 'supply-chain/daily/outsourcing-order',
      action: 'view',
    })
    assert.deepEqual(matchApiPermissionRule('GET', '/api/assist-order/fee-options', {}, {}), {
      menuPath: 'supply-chain/daily/outsourcing-order',
      action: 'view',
    })
    assert.deepEqual(matchApiPermissionRule('GET', '/api/assist-order/print-data', {}, {}), {
      menuPath: 'supply-chain/daily/outsourcing-order',
      action: 'view',
    })
    assert.deepEqual(matchApiPermissionRule('POST', '/api/assist-order', {}, {}), {
      menuPath: 'supply-chain/daily/outsourcing-order',
      action: 'add',
    })
    assert.deepEqual(matchApiPermissionRule('PUT', '/api/assist-order/8', {}, {}), {
      menuPath: 'supply-chain/daily/outsourcing-order',
      action: 'edit',
    })
  })

  test('lifecycle routes use audit and delete permissions', () => {
    for (const action of ['audit', 'unaudit', 'close', 'unclose']) {
      assert.deepEqual(matchApiPermissionRule('POST', `/api/assist-order/8/${action}`, {}, {}), {
        menuPath: 'supply-chain/daily/outsourcing-order',
        action: 'audit',
      })
    }
    assert.deepEqual(matchApiPermissionRule('POST', '/api/assist-order/8/restore', {}, {}), {
      menuPath: 'supply-chain/daily/outsourcing-order',
      action: 'delete',
    })
    assert.deepEqual(matchApiPermissionRule('DELETE', '/api/assist-order/8', {}, {}), {
      menuPath: 'supply-chain/daily/outsourcing-order',
      action: 'delete',
    })
    assert.deepEqual(matchApiPermissionRule('DELETE', '/api/assist-order/8/hard', {}, {}), {
      menuPath: 'supply-chain/daily/outsourcing-order',
      action: 'delete',
    })
  })
})
