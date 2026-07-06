import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { matchApiPermissionRule } from './apiPermissionGate.js'

describe('数据库配置接口权限', () => {
  test('读取配置走 ERP内核 view 权限', () => {
    assert.deepEqual(matchApiPermissionRule('GET', '/api/system/kernel/database-config', {}, {}), {
      menuPath: 'system/kernel/erp-core',
      action: 'view',
    })
  })

  test('保存配置走 ERP内核 edit 权限', () => {
    assert.deepEqual(matchApiPermissionRule('PUT', '/api/system/kernel/database-config', {}, {}), {
      menuPath: 'system/kernel/erp-core',
      action: 'edit',
    })
  })
})
