import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { parseRolePermissions, roleAllowsAction, serializePermissionsForStore } from './permissions.js'

describe('反审权限模型', () => {
  test('unaudit 是可保存、可解析的独立动作', () => {
    const saved = serializePermissionsForStore({ 'inventory/daily/stock-in': ['view', 'unaudit'] })
    assert.equal(saved.ok, true)
    const parsed = parseRolePermissions(saved.jsonStr)
    assert.equal(roleAllowsAction(parsed, 'inventory/daily/stock-in', 'unaudit'), true)
    assert.equal(roleAllowsAction(parsed, 'inventory/daily/stock-in', 'audit'), false)
  })

  test('all 仍同时允许审核与反审', () => {
    const parsed = parseRolePermissions('{"inventory/daily/stock-in":["all"]}')
    assert.equal(roleAllowsAction(parsed, 'inventory/daily/stock-in', 'audit'), true)
    assert.equal(roleAllowsAction(parsed, 'inventory/daily/stock-in', 'unaudit'), true)
  })
})
