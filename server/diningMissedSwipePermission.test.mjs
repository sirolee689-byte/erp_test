import assert from 'node:assert/strict'
import test from 'node:test'
import { matchApiPermissionRule } from './apiPermissionGate.js'

test('订餐未刷卡明细和部门候选沿用统计报表查看权限', () => {
  for (const path of [
    '/api/canteen/reports/missed-swipes',
    '/api/canteen/reports/missed-swipes/departments',
  ]) {
    assert.deepEqual(
      matchApiPermissionRule('GET', path, {}, {}),
      { menuPath: 'canteen/reports', action: 'view' },
    )
  }
})
