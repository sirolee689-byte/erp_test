import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { buildAssistOrderLogInfo, writeAssistOrderOperationLog } from './assistOrderOperationLog.js'

describe('assistOrderOperationLog', () => {
  test('buildAssistOrderLogInfo clips to 500 chars', () => {
    const info = buildAssistOrderLogInfo({
      orderNo: 'WX26060901',
      referenceNo: 'PI-'.padEnd(600, 'X'),
      systemCode: 'WX-TEST',
      actor: { trueName: '测试员' },
    })
    assert.ok(info.length <= 500)
  })

  test('writeAssistOrderOperationLog inserts ip column', async () => {
    const calls = []
    const pool = {
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

    await writeAssistOrderOperationLog(pool, {
      actName: '外协订单录入',
      info: '单号：WX26060901',
      actor: { trueName: '张三' },
      orderNo: 'WX26060901',
      systemCode: 'WX-TEST',
      ip: '192.168.1.10',
    })

    assert.equal(calls.length, 1)
    assert.match(calls[0].sqlText, /\[ip\]/i)
    assert.equal(calls[0].inputs.ip, '192.168.1.10')
    assert.equal(calls[0].inputs.act_name, '外协订单录入')
  })
})
