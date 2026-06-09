import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { rewriteAssistOrderFees } from './assistOrderFeeSave.js'

function createRequestRecorder() {
  const calls = []
  return {
    calls,
    requestFactory() {
      const inputs = {}
      const req = {
        input(name, _type, value) {
          inputs[name] = value
          return req
        },
        async query(sqlText) {
          calls.push({ sqlText, inputs: { ...inputs } })
          return { recordset: [] }
        },
      }
      return req
    },
  }
}

describe('rewriteAssistOrderFees', () => {
  test('physically deletes old fees then inserts all current fees without a ten-row limit', async () => {
    const recorder = createRequestRecorder()
    const fees = Array.from({ length: 11 }, (_, i) => ({
      seq: i + 1,
      feeCode: `FEE-${String(i + 1).padStart(2, '0')}`,
      feeName: `Fee ${i + 1}`,
      money: i + 0.5,
      tax: 0.13,
      remark: `remark ${i + 1}`,
    }))

    const result = await rewriteAssistOrderFees({
      assistOrderNo: 'WX26060901',
      fees,
      requestFactory: recorder.requestFactory,
    })

    assert.equal(result.count, 11)
    assert.equal(recorder.calls.length, 12)
    assert.match(recorder.calls[0].sqlText, /DELETE\s+FROM\s+dbo\.\[UB_ERP_assist_order_money\]/i)
    assert.match(recorder.calls[1].sqlText, /INSERT\s+INTO\s+dbo\.\[UB_ERP_assist_order_money\]/i)
    assert.match(recorder.calls[11].sqlText, /INSERT\s+INTO\s+dbo\.\[UB_ERP_assist_order_money\]/i)
    assert.equal(recorder.calls[1].inputs.assist_code, 'WX26060901')
    assert.equal(recorder.calls[1].inputs.kcaa01, 'FEE-01')
    assert.equal(recorder.calls[1].inputs.kcaa02, 'Fee 1')
    assert.equal(recorder.calls[1].inputs.money, 0.5)
    assert.equal(recorder.calls[11].inputs.kcaa01, 'FEE-11')
  })
})
