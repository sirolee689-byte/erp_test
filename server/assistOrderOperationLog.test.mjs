import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { buildAssistOrderLogInfo, writeAssistOrderOperationLog } from './assistOrderOperationLog.js'

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
          return { recordset: [] }
        },
      }
      return req
    },
  }
}

describe('writeAssistOrderOperationLog', () => {
  test('buildAssistOrderLogInfo clips to 500 chars', () => {
    const info = buildAssistOrderLogInfo({
      orderNo: 'WX26060901',
      referenceNo: 'PI-'.padEnd(600, 'X'),
      systemCode: 'WX-TEST',
      actor: { trueName: 'tester' },
    })
    assert.ok(info.length <= 500)
  })

  test('buildAssistOrderLogInfo does not expose system code in visible info', () => {
    const info = buildAssistOrderLogInfo({
      orderNo: 'WX26060501',
      referenceNo: 'PI-2026-001',
      systemCode: 'SYS-HIDDEN-001',
      actor: { trueName: 'tester' },
    })

    assert.match(info, /WX26060501/)
    assert.match(info, /PI-2026-001/)
    assert.doesNotMatch(info, /SYS-HIDDEN-001/)
  })

  test('buildAssistOrderLogInfo does not duplicate operation time from addtime', () => {
    const info = buildAssistOrderLogInfo({
      orderNo: 'WX26060502',
      referenceNo: 'PI-2026-002',
      actor: { trueName: 'tester' },
    })

    assert.doesNotMatch(info, /操作时间/)
    assert.doesNotMatch(info, /\d{4}-\d{2}-\d{2}T/)
  })

  test('writeAssistOrderOperationLog inserts ip column', async () => {
    const pool = createMockPool()

    await writeAssistOrderOperationLog(pool, {
      actName: 'assist order create',
      info: 'order: WX26060901',
      actor: { trueName: 'tester' },
      orderNo: 'WX26060901',
      systemCode: 'WX-TEST',
      ip: '192.168.1.10',
    })

    assert.equal(pool.calls.length, 1)
    assert.match(pool.calls[0].sqlText, /\[ip\]/i)
    assert.equal(pool.calls[0].inputs.ip, '192.168.1.10')
    assert.equal(pool.calls[0].inputs.act_name, 'assist order create')
  })

  test('writes uid, uname, and utruename separately', async () => {
    const pool = createMockPool()

    await writeAssistOrderOperationLog(pool, {
      actName: '申请审核',
      info: '单号：WX26060901',
      actor: { uidInt: 42, uname: 'u01', utruename: '张三' },
      orderNo: 'WX26060901',
      systemCode: 'SYS-001',
      ip: '127.0.0.1',
    })

    assert.equal(pool.calls.length, 1)
    const call = pool.calls[0]
    assert.match(call.sqlText, /\[uid\]/i)
    assert.match(call.sqlText, /@uid/i)
    assert.equal(call.inputs.uid, '42')
    assert.equal(call.inputs.uname, 'u01')
    assert.equal(call.inputs.utruename, '张三')
    assert.equal(call.inputs.code, 'UB_ERP_assist_order')
    assert.equal(call.inputs.systemcode, 'SYS-001')
  })

  test('writes assist order standard table code and unaudit action name', async () => {
    const pool = createMockPool()

    await writeAssistOrderOperationLog(pool, {
      actName: '反审',
      info: '单号：WX26060501',
      actor: { uidInt: 42, uname: 'u01', utruename: '张三' },
      orderNo: 'WX26060501',
      systemCode: 'WX26060501',
    })

    const call = pool.calls[0]
    assert.equal(call.inputs.act_name, '反审')
    assert.equal(call.inputs.code, 'UB_ERP_assist_order')
    assert.equal(call.inputs.systemcode, 'WX26060501')
  })
})
