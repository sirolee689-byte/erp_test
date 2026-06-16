import test from 'node:test'
import assert from 'node:assert/strict'

import { buildDispatchOrderLifecycleSetSql, resolveDispatchOrderLifecycleConfig } from './dispatchOrderLifecycle.js'

test('派工单审核、反审核、删除、恢复、彻底删除遵守 pass/del 规则', () => {
  assert.equal(resolveDispatchOrderLifecycleConfig('audit', { pass: '0', del: '0' }).nextPass, '1')
  assert.equal(resolveDispatchOrderLifecycleConfig('unaudit', { pass: '1', del: '0' }).nextPass, '0')
  assert.equal(resolveDispatchOrderLifecycleConfig('delete', { pass: '0', del: '0' }).nextDel, '1')
  assert.equal(resolveDispatchOrderLifecycleConfig('restore', { pass: '0', del: '1' }).nextDel, '0')
  assert.equal(resolveDispatchOrderLifecycleConfig('hard-delete', { pass: '0', del: '1' }).hardDelete, true)
})

test('已审派工单不能编辑删除，已审回收站记录不能彻底删除', () => {
  assert.match(resolveDispatchOrderLifecycleConfig('delete', { pass: '1', del: '0' }).error, /已审核/)
  assert.match(resolveDispatchOrderLifecycleConfig('hard-delete', { pass: '1', del: '1' }).error, /已审核/)
})
