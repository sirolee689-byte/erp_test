import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { addUnauditToLegacyPermissions } from './rolePermissionUnauditMigration.js'

describe('历史角色反审权限迁移', () => {
  test('audit 自动补 unaudit，重复运行不再变更', () => {
    const first = addUnauditToLegacyPermissions('{"inventory/daily/stock-in":["view","audit"]}')
    assert.equal(first.changed, true)
    assert.deepEqual(JSON.parse(first.json), { 'inventory/daily/stock-in': ['view', 'audit', 'unaudit'] })
    assert.equal(addUnauditToLegacyPermissions(first.json).changed, false)
  })

  test('全权限、路径 all、旧数组和无 audit 的权限保持不变', () => {
    for (const raw of [
      '{"*":["all"]}',
      '{"inventory/daily/stock-in":["all"]}',
      '["inventory/daily/stock-in"]',
      '{"inventory/daily/stock-in":["view"]}',
    ]) {
      assert.equal(addUnauditToLegacyPermissions(raw).changed, false)
    }
  })
})
