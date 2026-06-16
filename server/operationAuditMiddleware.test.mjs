import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { describe, test } from 'node:test'
import { createOperationAuditMiddleware } from './operationAuditMiddleware.js'

async function runAuditMiddleware({ method, path, body = {} }) {
  const calls = []
  const req = {
    method,
    path,
    body,
    headers: {},
    socket: {},
  }
  const res = new EventEmitter()
  res.statusCode = 200
  const middleware = createOperationAuditMiddleware({
    getCurrentUserFromReq: () => ({ userCode: 'u01', userName: 'operator01' }),
    writeOperationLogAsync: async (payload) => {
      calls.push(payload)
    },
  })

  await new Promise((resolve, reject) => {
    try {
      middleware(req, res, resolve)
    } catch (err) {
      reject(err)
    }
  })
  res.emit('finish')
  await new Promise((resolve) => setImmediate(resolve))
  return calls
}

describe('operationAuditMiddleware assist order exclusions', () => {
  test('skips global audit log for assist order write routes', async () => {
    const routes = [
      ['POST', '/api/assist-order'],
      ['PUT', '/api/assist-order/8'],
      ['POST', '/api/assist-order/8/audit'],
      ['POST', '/api/assist-order/8/unaudit'],
      ['POST', '/api/assist-order/8/close'],
      ['POST', '/api/assist-order/8/unclose'],
      ['POST', '/api/assist-order/8/restore'],
      ['DELETE', '/api/assist-order/8'],
      ['DELETE', '/api/assist-order/8/hard'],
    ]

    for (const [method, path] of routes) {
      const calls = await runAuditMiddleware({ method, path })
      assert.equal(calls.length, 0, `${method} ${path} should not write a global audit log`)
    }
  })

  test('keeps global audit log for non-assist routes', async () => {
    const calls = await runAuditMiddleware({
      method: 'POST',
      path: '/api/inventory/units',
      body: { name: 'PCS' },
    })

    assert.equal(calls.length, 1)
    assert.equal(calls[0].code, 'UB_ERP_Stocks_unit')
  })
})

describe('operationAuditMiddleware dispatch order exclusions', () => {
  test('skips global audit log for dispatch order write routes', async () => {
    const routes = [
      ['POST', '/api/dispatch-order'],
      ['PUT', '/api/dispatch-order/8'],
      ['POST', '/api/dispatch-order/8/audit'],
      ['POST', '/api/dispatch-order/8/unaudit'],
      ['POST', '/api/dispatch-order/8/restore'],
      ['DELETE', '/api/dispatch-order/8'],
      ['DELETE', '/api/dispatch-order/8/hard'],
    ]

    for (const [method, path] of routes) {
      const calls = await runAuditMiddleware({ method, path })
      assert.equal(calls.length, 0, `${method} ${path} should not write a global audit log`)
    }
  })
})
