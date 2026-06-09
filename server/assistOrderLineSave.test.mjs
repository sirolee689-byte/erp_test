import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { rewriteAssistOrderLines } from './assistOrderLineSave.js'

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

describe('rewriteAssistOrderLines', () => {
  test('physically deletes old lines then inserts current lines including duplicates and raw amount fields', async () => {
    const recorder = createRequestRecorder()

    await rewriteAssistOrderLines({
      assistOrderNo: 'WX26060901',
      lines: [
        {
          seq: 1,
          piNo: 'PI-001',
          kcaa01: 'MAT-001',
          kcaa02: '材料A',
          kcaa03: '规格A',
          kcaa04: 'PCS',
          wxak03: 2,
          wxak04: 1.2345,
          wxak041: 1.395,
          wxak05: 2.47,
          wxak051: 2.79,
          tax: 0.13,
          deliveryDate: '2026-06-20',
          referenceNo: 'REF-1',
          remark: 'first',
        },
        {
          seq: 2,
          piNo: 'PI-001',
          kcaa01: 'MAT-001',
          kcaa02: '材料A',
          wxak03: 3,
          wxak04: 9.8765,
          wxak041: 11.1604,
          wxak05: 29.63,
          wxak051: 33.48,
          tax: 0.13,
          remark: 'duplicate material is allowed',
        },
      ],
      requestFactory: recorder.requestFactory,
    })

    assert.equal(recorder.calls.length, 3)
    assert.match(recorder.calls[0].sqlText, /DELETE\s+FROM\s+dbo\.\[UB_ERP_assist_order_list\]/i)
    assert.match(recorder.calls[1].sqlText, /INSERT\s+INTO\s+dbo\.\[UB_ERP_assist_order_list\]/i)
    assert.match(recorder.calls[2].sqlText, /INSERT\s+INTO\s+dbo\.\[UB_ERP_assist_order_list\]/i)
    assert.equal(recorder.calls[1].inputs.wxak01, 'WX26060901')
    assert.equal(recorder.calls[1].inputs.seq, 1)
    assert.equal(recorder.calls[1].inputs.kcaa01, 'MAT-001')
    assert.equal(recorder.calls[1].inputs.wxak04, 1.2345)
    assert.equal(recorder.calls[1].inputs.wxak041, 1.395)
    assert.equal(recorder.calls[1].inputs.wxak05, 2.47)
    assert.equal(recorder.calls[1].inputs.wxak051, 2.79)
    assert.equal(recorder.calls[1].inputs.tax, 0.13)
    assert.equal(recorder.calls[2].inputs.kcaa01, 'MAT-001')
    assert.equal(recorder.calls[2].inputs.seq, 2)
  })
})
