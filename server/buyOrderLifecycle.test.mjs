import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { applyBuyOrderLifecycleAction } from './buyOrderLifecycle.js'

function createMockPool(currentRow, opts = {}) {
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
          if (/SELECT TOP 1/i.test(sqlText) && /UB_ERP_Buy_order/i.test(sqlText)) return { recordset: currentRow ? [currentRow] : [] }
          if (/COUNT\(1\)\s+AS\s+lineCount/i.test(sqlText)) return { recordset: [{ lineCount: opts.lineCount ?? 1 }] }
          if (/COUNT\(1\)\s+AS\s+inboundCount/i.test(sqlText)) return { recordset: [{ inboundCount: opts.inboundCount ?? 0 }] }
          return { recordset: [] }
        },
      }
      return req
    },
  }
}

describe('applyBuyOrderLifecycleAction', () => {
  test('audits an unaudited order only when it has detail lines', async () => {
    const pool = createMockPool({ id: 1, buyOrderNo: 'ZY-2501', referenceNo: 'PI-1', systemCode: 'SYS-1', pass: '0', closed: '0', del: '0' })
    const result = await applyBuyOrderLifecycleAction({ pool, id: 1, action: 'audit', actor: { utruename: '张三' } })
    assert.equal(result.ok, true)
    assert.ok(pool.calls.some((call) => /UPDATE\s+dbo\.\[UB_ERP_Buy_order\]/i.test(call.sqlText) && /\[pass\]=N'1'/i.test(call.sqlText)))
  })

  test('rejects audit when the order has no detail lines', async () => {
    const pool = createMockPool({ id: 1, buyOrderNo: 'ZY-2501', referenceNo: 'PI-1', systemCode: 'SYS-1', pass: '0', closed: '0', del: '0' }, { lineCount: 0 })
    const result = await applyBuyOrderLifecycleAction({ pool, id: 1, action: 'audit', actor: {} })
    assert.equal(result.ok, false)
    assert.match(result.msg, /明细/)
  })

  test('reverse audit requires reason and is blocked by active inbound receipt', async () => {
    const row = { id: 2, buyOrderNo: 'ZY-2502', referenceNo: 'PI-2', systemCode: 'SYS-2', pass: '1', closed: '0', del: '0' }
    const noReason = await applyBuyOrderLifecycleAction({ pool: createMockPool(row), id: 2, action: 'unaudit', actor: {}, reason: '' })
    assert.equal(noReason.ok, false)
    assert.match(noReason.msg, /原因/)

    const linked = await applyBuyOrderLifecycleAction({ pool: createMockPool(row, { inboundCount: 1 }), id: 2, action: 'unaudit', actor: {}, reason: '录错' })
    assert.equal(linked.ok, false)
    assert.match(linked.msg, /入库/)
  })

  test('close requires an active inbound receipt and unclose requires super admin', async () => {
    const row = { id: 3, buyOrderNo: 'ZY-2503', referenceNo: 'PI-3', systemCode: 'SYS-3', pass: '1', closed: '0', del: '0' }
    const noInbound = await applyBuyOrderLifecycleAction({ pool: createMockPool(row, { inboundCount: 0 }), id: 3, action: 'close', actor: {} })
    assert.equal(noInbound.ok, false)
    assert.match(noInbound.msg, /入库/)

    const closedRow = { ...row, closed: '1' }
    const ordinary = await applyBuyOrderLifecycleAction({ pool: createMockPool(closedRow), id: 3, action: 'unclose', actor: { uidInt: 2 } })
    assert.equal(ordinary.ok, false)
    assert.match(ordinary.msg, /超级管理员/)
  })
})
