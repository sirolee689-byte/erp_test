import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { describe, test } from 'node:test'
import {
  buildBomMasterOperationChineseContent,
  createOperationAuditMiddleware,
} from './operationAuditMiddleware.js'

async function runAuditMiddleware({
  method,
  path,
  body = {},
  statusCode = 200,
  user = { userCode: 'u01', userName: 'operator01' },
}) {
  const calls = []
  const req = {
    method,
    path,
    body,
    params: {},
    query: {},
    headers: {},
    socket: {},
  }
  const res = new EventEmitter()
  res.statusCode = statusCode
  const middleware = createOperationAuditMiddleware({
    getCurrentUserFromReq: () => user,
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

describe('operationAuditMiddleware stock-in exclusions', () => {
  test('skips global audit log for stock-in write routes', async () => {
    const routes = [
      ['POST', '/api/stock-in'],
      ['PUT', '/api/stock-in/8'],
      ['POST', '/api/stock-in/8/audit'],
      ['POST', '/api/stock-in/8/unaudit'],
      ['POST', '/api/stock-in/8/review'],
      ['POST', '/api/stock-in/8/restore'],
      ['DELETE', '/api/stock-in/8'],
      ['DELETE', '/api/stock-in/8/hard'],
    ]

    for (const [method, path] of routes) {
      const calls = await runAuditMiddleware({ method, path })
      assert.equal(calls.length, 0, `${method} ${path} should not write a global audit log`)
    }
  })
})

describe('operationAuditMiddleware hybrid policy', () => {
  test('central routes write exactly one readable log', async () => {
    const calls = await runAuditMiddleware({
      method: 'POST',
      path: '/api/inventory/color-code',
      body: { code: 'R01', name: '红色' },
    })

    assert.equal(calls.length, 1)
    assert.equal(calls[0].action, '新增颜色编码')
    assert.equal(calls[0].code, 'UB_ERP_Stocks_colorcode')
    assert.match(calls[0].content, /R01/)
  })

  test('business logged routes are skipped to prevent duplicate logs', async () => {
    const routes = [
      ['POST', '/api/buy-order'],
      ['PUT', '/api/system/kernel/mail-config'],
      ['POST', '/api/users'],
      ['PUT', '/api/supply-chain/purchase-quotations'],
      ['POST', '/api/hr/dormitory/electric/settle'],
    ]

    for (const [method, path] of routes) {
      const calls = await runAuditMiddleware({ method, path })
      assert.equal(calls.length, 0, `${method} ${path} should use its business log`)
    }
  })

  test('read-only POST, dry run, failed request and unknown write do not write logs', async () => {
    const scenarios = [
      { method: 'POST', path: '/api/customs-declaration/preview' },
      { method: 'POST', path: '/api/inventory/pi-bom-data/replace-material', body: { dryRun: true } },
      { method: 'POST', path: '/api/inventory/color-code', statusCode: 400 },
      { method: 'POST', path: '/api/not-registered-write' },
    ]

    for (const scenario of scenarios) {
      const calls = await runAuditMiddleware(scenario)
      assert.equal(calls.length, 0, `${scenario.method} ${scenario.path} should not write a log`)
    }
  })

  test('password change summary never contains request secrets', async () => {
    const calls = await runAuditMiddleware({
      method: 'PUT',
      path: '/api/users/change-password',
      body: {
        oldPassword: 'old-secret',
        newPassword: 'new-secret',
        token: 'token-secret',
      },
    })

    assert.equal(calls.length, 1)
    assert.equal(calls[0].content, '修改个人密码')
    assert.doesNotMatch(calls[0].content, /old-secret|new-secret|token-secret/)
  })

  test('generic central summaries exclude core keys and mail passwords', async () => {
    const calls = await runAuditMiddleware({
      method: 'POST',
      path: '/api/sales-order',
      body: {
        systemcode: 'SO-SYS-01',
        key: 'core-key-secret',
        ConstMailServerPassword: 'mail-password-secret',
        authorization: 'bearer-secret',
        lines: [{ code: 'P001' }],
      },
    })

    assert.equal(calls.length, 1)
    assert.match(calls[0].content, /SO-SYS-01/)
    assert.doesNotMatch(
      calls[0].content,
      /core-key-secret|mail-password-secret|bearer-secret/,
    )
  })

  test('central log writes UB_ERP_User.truename into the audit utruename field', async () => {
    const calls = await runAuditMiddleware({
      method: 'POST',
      path: '/api/inventory/color-code',
      body: { code: 'R02', name: '蓝色' },
      user: {
        userCode: 'U001',
        userName: 'login-account',
        auditTruename: '张三',
      },
    })

    assert.equal(calls.length, 1)
    assert.equal(calls[0].uname, 'U001')
    assert.equal(calls[0].utruename, '张三')
  })
})

describe('BOM 主档操作日志文案', () => {
  const user = { userName: '张三' }
  const snapshot = { systemcode: 'SC-3311', kcaa01: 'PQ-3311A1/N' }

  test('单件操作使用真实 BOM 编码，而不是 systemcode', () => {
    const scenarios = [
      ['PUT', '/api/inventory/bom/unaudit', '张三反审了编码「PQ-3311A1/N」'],
      ['PUT', '/api/inventory/bom', '张三编辑了编码「PQ-3311A1/N」'],
      ['PUT', '/api/inventory/bom/audit', '张三审核了编码「PQ-3311A1/N」'],
      ['DELETE', '/api/inventory/bom/systemcode/SC-3311', '张三删除了编码「PQ-3311A1/N」'],
      ['DELETE', '/api/inventory/bom/systemcode/SC-3311/permanent', '张三彻底删除了编码「PQ-3311A1/N」'],
      ['POST', '/api/bom/usage-calc-legacy', '张三一键运算了编码「PQ-3311A1/N」'],
    ]

    for (const [method, path, expected] of scenarios) {
      assert.equal(
        buildBomMasterOperationChineseContent(user, method, path, {
          body: { systemcode: 'SC-3311' },
          params: { systemcode: 'SC-3311' },
          __auditBomMasterBySystemcode: { 'SC-3311': snapshot },
        }),
        expected,
      )
    }
  })

  test('批量一键运算逐项显示已运算的 BOM 编码', () => {
    assert.equal(
      buildBomMasterOperationChineseContent(user, 'POST', '/api/bom/usage-calc-batch', {
        body: { systemcodes: ['SC-3311', 'SC-3312'] },
        __auditBomMasterBySystemcode: {
          'SC-3311': snapshot,
          'SC-3312': { systemcode: 'SC-3312', kcaa01: 'PQ-3312A1/N' },
        },
      }),
      '张三批量一键运算了编码「PQ-3311A1/N、PQ-3312A1/N」',
    )
  })
})
