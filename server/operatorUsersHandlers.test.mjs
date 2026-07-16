import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { hasIsAdminInput, isLastSuperAdmin, parseIsAdminInput } from './operatorUsersHandlers.js'

describe('操作员超级管理员保护', () => {
  test('未传超级管理员字段时保持普通操作员默认值', () => {
    assert.equal(hasIsAdminInput({ UserName: 'tester' }), false)
    assert.equal(parseIsAdminInput({}), 0)
  })

  test('兼容三个超级管理员字段名', () => {
    assert.equal(parseIsAdminInput({ is_admin: 1 }), 1)
    assert.equal(parseIsAdminInput({ isAdmin: true }), 1)
    assert.equal(parseIsAdminInput({ IsAdmin: 'true' }), 1)
    assert.equal(parseIsAdminInput({ is_admin: 0 }), 0)
  })

  test('最后一名超级管理员不可降级或删除', () => {
    assert.equal(isLastSuperAdmin({ targetIsAdmin: 1, adminTotal: 1 }), true)
    assert.equal(isLastSuperAdmin({ targetIsAdmin: 1, adminTotal: 2 }), false)
    assert.equal(isLastSuperAdmin({ targetIsAdmin: 0, adminTotal: 1 }), false)
  })
})
