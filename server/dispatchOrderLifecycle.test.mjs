import test from 'node:test'
import assert from 'node:assert/strict'

import { applyDispatchOrderLifecycleAction, buildDispatchOrderLifecycleSetSql, resolveDispatchOrderLifecycleConfig } from './dispatchOrderLifecycle.js'

function createMockPool() {
  const calls = []
  return {
    calls,
    request() {
      const inputs = {}
      const req = {
        input(name, _type, value) {
          inputs[name] = value
          return req
        },
        async query(sqlText) {
          calls.push({ sqlText, inputs: { ...inputs } })
          if (/SELECT TOP 1/i.test(sqlText) && /UB_ERP_Dispatch_order/i.test(sqlText)) {
            return { recordset: [{ id: 1, dispatchOrderNo: 'PG-001', referenceNo: 'PI-001', systemCode: 'SYS-001', pass: '0', del: '0' }] }
          }
          if (/COUNT\(1\)\s+AS\s+cnt/i.test(sqlText)) return { recordset: [{ cnt: 1 }] }
          if (/FROM\s+sys\.columns/i.test(sqlText)) return { recordset: ['pass', 'passuid', 'passuname'].map((name) => ({ name })) }
          return { recordset: [] }
        },
      }
      return req
    },
  }
}

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

test('未审未删派工单允许进入审核流程（空明细由 apply 阶段查库拦截）', () => {
  const cfg = resolveDispatchOrderLifecycleConfig('audit', { pass: '0', del: '0' })
  assert.equal(cfg.nextPass, '1')
  assert.equal(cfg.error, undefined)
})

test('派工单生命周期日志写入调用方传入的 IP', async () => {
  const pool = createMockPool()
  const result = await applyDispatchOrderLifecycleAction({
    pool,
    id: 1,
    action: 'audit',
    actor: { utruename: '张三', ip: '192.168.1.19' },
  })
  assert.equal(result.ok, true)
  const logCall = pool.calls.find((call) => /INSERT\s+INTO\s+dbo\.\[UB_Date_ERP_Operation_log\]/i.test(call.sqlText))
  assert.equal(logCall.inputs.ip, '192.168.1.19')
})
