import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { matchApiPermissionRule } from './apiPermissionGate.js'

describe('matchApiPermissionRule - 材料流水账', () => {
  test('材料流水账接口走统计分析材料流水账 view 权限', () => {
    for (const path of [
      '/api/material-flow-ledger/warehouse-options',
      '/api/material-flow-ledger/material-options',
      '/api/material-flow-ledger/category-options',
      '/api/material-flow-ledger/report',
      '/api/material-flow-ledger/print-header',
    ]) {
      assert.deepEqual(matchApiPermissionRule('GET', path, {}, {}), {
        menuPath: 'inventory/analysis/flow-ledger',
        action: 'view',
      })
    }
  })
})
