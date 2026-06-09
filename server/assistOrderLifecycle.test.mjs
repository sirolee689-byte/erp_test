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
    assert.equal(logCall.inputs.act_name, '申请审核')
    assert.match(logCall.inputs.act_info, /WX26060902/)
    assert.equal(logCall.inputs.act_user, '张三')
  })
})
