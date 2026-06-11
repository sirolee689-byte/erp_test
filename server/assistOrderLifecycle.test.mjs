import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { applyAssistOrderLifecycleAction } from './assistOrderLifecycle.js'

function createMockPool(currentRow) {
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
          if (/SELECT TOP 1/i.test(sqlText)) return { recordset: currentRow ? [currentRow] : [] }
          return { recordset: [] }
        },
      }
      return req
    },
  }
}

describe('applyAssistOrderLifecycleAction', () => {
  test('rejects unaudit on a closed order until it is unclosed first', async () => {
    const pool = createMockPool({
      id: 8,
      assistOrderNo: 'WX26060901',
      referenceNo: 'PI-001',
      systemCode: 'WX26060901',
      pass: '1',
      closed: '1',
      del: '0',
    })

    const result = await applyAssistOrderLifecycleAction({
      pool,
      id: 8,
      action: 'unaudit',
      actor: { name: 'Tester' },
    })

    assert.equal(result.ok, false)
    assert.equal(result.status, 400)
    assert.match(result.msg, /先反结案/)
    assert.equal(pool.calls.some((call) => /UPDATE/i.test(call.sqlText)), false)
  })

  test('audits an unaudited active order and writes operation log', async () => {
    const pool = createMockPool({
      id: 9,
      assistOrderNo: 'WX26060902',
      referenceNo: '',
      systemCode: 'WX26060902',
      pass: '0',
      closed: '0',
      del: '0',
    })

    const result = await applyAssistOrderLifecycleAction({
      pool,
      id: 9,
      action: 'audit',
      actor: { trueName: '张三' },
    })

    assert.equal(result.ok, true)
    assert.equal(result.msg, '审核成功')
    assert.ok(pool.calls.some((call) => /UPDATE\s+dbo\.\[UB_ERP_assist_order\]/i.test(call.sqlText) && /\[pass\]=N'1'/i.test(call.sqlText)))
    const logCall = pool.calls.find((call) => /INSERT\s+INTO\s+dbo\.\[UB_Date_ERP_Operation_log\]/i.test(call.sqlText))
    assert.ok(logCall)
    assert.equal(logCall.inputs.act_name, '审核')
    assert.match(logCall.inputs.act_info, /WX26060902/)
    assert.equal(logCall.inputs.act_user, '张三')
  })
  test('unaudits an audited active order and writes standard operation log action', async () => {
    const pool = createMockPool({
      id: 11,
      assistOrderNo: 'WX26060501',
      referenceNo: 'PI-001',
      systemCode: 'WX26060501',
      pass: '1',
      closed: '0',
      del: '0',
    })

    const result = await applyAssistOrderLifecycleAction({
      pool,
      id: 11,
      action: 'unaudit',
      actor: { uidInt: 42, uname: 'u01', utruename: 'operator01' },
    })

    assert.equal(result.ok, true)
    const logCall = pool.calls.find((call) => /INSERT\s+INTO\s+dbo\.\[UB_Date_ERP_Operation_log\]/i.test(call.sqlText))
    assert.ok(logCall)
    assert.equal(logCall.inputs.act_name, '反审')
    assert.equal(logCall.inputs.code, 'UB_ERP_assist_order')
    assert.equal(logCall.inputs.systemcode, 'WX26060501')
  })

  test('hard deletes a recycled order and writes operation log with actor uid', async () => {
    const pool = createMockPool({
      id: 10,
      assistOrderNo: 'WX26060903',
      referenceNo: 'PI-003',
      systemCode: 'WX26060903',
      pass: '0',
      closed: '0',
      del: '1',
    })

    const result = await applyAssistOrderLifecycleAction({
      pool,
      id: 10,
      action: 'hard-delete',
      actor: { uidInt: 77, uname: 'delete01', utruename: 'operator01' },
    })

    assert.equal(result.ok, true)
    assert.ok(pool.calls.some((call) => /DELETE\s+FROM\s+dbo\.\[UB_ERP_assist_order\]/i.test(call.sqlText)))
    const logCall = pool.calls.find((call) => /INSERT\s+INTO\s+dbo\.\[UB_Date_ERP_Operation_log\]/i.test(call.sqlText))
    assert.ok(logCall)
    assert.equal(logCall.inputs.uid, '77')
    assert.equal(logCall.inputs.uname, 'delete01')
    assert.equal(logCall.inputs.utruename, 'operator01')
  })
})
