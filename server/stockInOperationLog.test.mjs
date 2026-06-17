import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildStockInLogInfo, writeStockInOperationLog } from './stockInOperationLog.js'

test('writeStockInOperationLog uses official operation log payload keys', async () => {
  const calls = []
  const pool = {
    request() {
      const params = {}
      return {
        input(k, _t, v) {
          params[k] = v
          return this
        },
        async query(sqlText) {
          calls.push({ sqlText, params })
          return { recordset: [] }
        },
      }
    },
  }

  const info = buildStockInLogInfo({ receiptNo: 'R26061701', sourceOrderNo: 'PO1', actor: { utruename: '张三' } })
  await writeStockInOperationLog(pool, {
    actName: '新增入库单',
    info,
    actor: { uname: 'admin', utruename: '张三' },
    receiptNo: 'R26061701',
    systemCode: 'R-260617X',
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].params.act_name, '新增入库单')
  assert.match(calls[0].params.act_info, /R26061701/)
  assert.equal(calls[0].params.code, 'UB_ERP_Stocks_Storage')
})

