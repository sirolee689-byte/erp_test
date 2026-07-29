import assert from 'node:assert/strict'
import { test } from 'node:test'
import { configureOperationLogWriter, writeLog } from './operationLogWriter.js'

test('writeLog writes auditTruename instead of the login display name', async () => {
  const calls = []
  const pool = {
    request() {
      const inputs = new Map()
      return {
        input(name, _type, value) {
          inputs.set(name, value)
          return this
        },
        async query(sqlText) {
          calls.push({ inputs, sqlText })
        },
      }
    },
  }
  configureOperationLogWriter({
    getCurrentUserFromReq: () => ({
      userCode: 'U001',
      userName: 'login-account',
      auditTruename: '张三',
    }),
  })

  await writeLog({}, '新增颜色编码', '新增颜色编码成功', {
    pool,
    targetTable: 'UB_ERP_Stocks_colorcode',
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].inputs.get('uname'), 'U001')
  assert.equal(calls[0].inputs.get('utruename'), '张三')
})
