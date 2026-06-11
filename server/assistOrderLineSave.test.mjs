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

const mockBom000Keys = async (kcaa01) => ({
  bomGuid: `GUID-${kcaa01}`,
  customerName: `BOM-SUP-${kcaa01}`,
})

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
      actor: { uidInt: 42, uname: 'tester', utruename: '测试员' },
      clientIp: '192.168.1.20',
      resolveLineSnapshot: async () => ({ snapshotRemark: 'BOM快照备注' }),
      resolveBom000Keys: mockBom000Keys,
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
    assert.match(recorder.calls[1].sqlText, /\[kcaa12\]/i)
    assert.match(recorder.calls[1].sqlText, /\[kcaa35\]/i)
    assert.equal(recorder.calls[1].inputs.wxak02, 'GUID-MAT-001')
    assert.equal(recorder.calls[1].inputs.guid, 'GUID-MAT-001')
    assert.equal(recorder.calls[1].inputs.systemcode, 'GUID-MAT-001')
    assert.equal(recorder.calls[1].inputs.uid, '42')
    assert.equal(recorder.calls[1].inputs.uname, 'tester')
    assert.equal(recorder.calls[1].inputs.utruename, '测试员')
    assert.match(recorder.calls[1].inputs.addtime, /^\d{4}-\d{1,2}-\d{1,2} \d{2}:\d{2}:\d{2}$/)
    assert.equal(recorder.calls[1].inputs.Customer_Name, 'BOM-SUP-MAT-001')
    assert.match(recorder.calls[1].sqlText, /\[wxak02\]/i)
    assert.match(recorder.calls[1].sqlText, /\[Customer_Name\]/i)
    assert.match(recorder.calls[1].sqlText, /\[pass\]/i)
    assert.match(recorder.calls[1].sqlText, /\[remark\]/i)
    assert.match(recorder.calls[1].sqlText, /\[ip\]/i)
    assert.equal(recorder.calls[1].inputs.wxak06, 'first')
    assert.equal(recorder.calls[1].inputs.snapshotRemark, 'BOM快照备注')
    assert.equal(recorder.calls[1].inputs.type, 1)
    assert.equal(recorder.calls[1].inputs.ip, '192.168.1.20')
    assert.match(recorder.calls[1].sqlText, /N'1',\s*@ip,\s*N'0'/i)
  })

  test('applies resolveLineSnapshot before insert when provided', async () => {
    const recorder = createRequestRecorder()

    await rewriteAssistOrderLines({
      assistOrderNo: 'WX26060902',
      lines: [{ kcaa01: 'MAT-002', kcaa02: '旧名', wxak03: 1 }],
      resolveLineSnapshot: async () => ({
        kcaa02: '库内名',
        kcaa12: 1,
        kcaa35: 'RMB',
        customerName: 'PI-SUP-001',
      }),
      resolveBom000Keys: mockBom000Keys,
      requestFactory: recorder.requestFactory,
    })

    assert.equal(recorder.calls[1].inputs.kcaa02, '库内名')
    assert.equal(recorder.calls[1].inputs.kcaa12, 1)
    assert.equal(recorder.calls[1].inputs.kcaa35, 'RMB')
    assert.equal(recorder.calls[1].inputs.Customer_Name, 'PI-SUP-001')
  })

  test('throws when bom_000 GUID is missing', async () => {
    const recorder = createRequestRecorder()

    await assert.rejects(
      () =>
        rewriteAssistOrderLines({
          assistOrderNo: 'WX26060903',
          lines: [{ kcaa01: 'MAT-NO-GUID', wxak03: 1 }],
          resolveBom000Keys: async () => ({ bomGuid: '', customerName: '' }),
          requestFactory: recorder.requestFactory,
        }),
      /缺少 GUID/,
    )
    assert.equal(recorder.calls.length, 1)
  })
})
