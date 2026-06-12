import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  normalizeAssistOrderFees,
  rewriteAssistOrderFees,
} from './assistOrderFeeSave.js'

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
    assert.doesNotMatch(recorder.calls[1].sqlText, /\[(seq|kid)\]/i)
    assert.ok(!Object.hasOwn(recorder.calls[1].inputs, 'seq'))
    assert.equal(recorder.calls[1].inputs.assist_code, 'WX26060901')
    assert.equal(recorder.calls[1].inputs.kcaa01, 'FEE-01')
    assert.equal(recorder.calls[1].inputs.kcaa02, 'Fee 1')
    assert.equal(recorder.calls[1].inputs.money, 0.5)
    assert.equal(recorder.calls[11].inputs.kcaa01, 'FEE-11')
  })

  test('skips placeholder rows without feeCode even when money is zero', async () => {
    const recorder = createRequestRecorder()
    const fees = [
      ...Array.from({ length: 10 }, (_, i) => ({
        seq: i + 1,
        feeCode: '',
        feeName: '',
        money: 0,
        tax: 0,
        remark: '',
      })),
      {
        seq: 11,
        feeCode: 'FEE-0001',
        feeName: '染色费',
        money: 200,
        tax: 0,
        remark: '加急',
      },
    ]

    const normalized = normalizeAssistOrderFees(fees)
    assert.equal(normalized.length, 1)
    assert.equal(normalized[0].feeCode, 'FEE-0001')

    const result = await rewriteAssistOrderFees({
      assistOrderNo: 'WX26060902',
      fees,
      requestFactory: recorder.requestFactory,
    })

    assert.equal(result.count, 1)
    assert.equal(recorder.calls.length, 2)
    assert.match(recorder.calls[0].sqlText, /DELETE/i)
    assert.match(recorder.calls[1].sqlText, /INSERT/i)
    assert.equal(recorder.calls[1].inputs.kcaa01, 'FEE-0001')
    assert.equal(recorder.calls[1].inputs.money, 200)
  })
})
