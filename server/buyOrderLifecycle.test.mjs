import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { applyBuyOrderLifecycleAction, buildBuyOrderSoftDeleteSql } from './buyOrderLifecycle.js'

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
          if (/SELECT TOP 1\s+\[id\]/i.test(sqlText) && /UB_ERP_Bom_buy_order/i.test(sqlText)) return { recordset: [{ id: opts.bomSnapshotId ?? 88 }] }
          if (/FROM\s+sys\.columns/i.test(sqlText) && /UB_ERP_Buy_order/i.test(sqlText)) {
            return { recordset: (opts.headerColumns ?? ['id', 'del', 'delname', 'deltruename', 'deltime']).map((name) => ({ name })) }
          }
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
  test('soft delete only writes delete audit columns that exist on the buy order table', () => {
    const withoutDelId = buildBuyOrderSoftDeleteSql({
      headerCols: new Set(['id', 'del', 'delname', 'deltruename', 'deltime']),
      actor: { uidInt: 7, uname: 'buyer01', utruename: 'buyer name' },
    })
    assert.match(withoutDelId.setSql, /\[del\]=N'1'/)
    assert.doesNotMatch(withoutDelId.setSql, /\[delid\]/i)
    assert.match(withoutDelId.setSql, /\[delname\]=@delname/)
    assert.match(withoutDelId.setSql, /\[deltruename\]=@deltruename/)
    assert.match(withoutDelId.setSql, /\[deltime\]=CONVERT/)
    assert.equal(withoutDelId.params.delid, undefined)

    const withDelId = buildBuyOrderSoftDeleteSql({
      headerCols: new Set(['id', 'del', 'delid']),
      actor: { uidInt: 7 },
    })
    assert.match(withDelId.setSql, /\[delid\]=@delid/)
    assert.equal(withDelId.params.delid, '7')
  })

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

  test('reverse audit reason links to BOM snapshot id and does not write legacy xsaj01 column', async () => {
    const row = { id: 2, buyOrderNo: 'ZY-2502', referenceNo: 'PI-2', systemCode: 'SYS-2', pass: '1', closed: '0', del: '0' }
    const pool = createMockPool(row, { inboundCount: 0, bomSnapshotId: 99 })
    const result = await applyBuyOrderLifecycleAction({
      pool,
      id: 2,
      action: 'unaudit',
      actor: { uidInt: 7, uname: 'buyer01', utruename: '采购员' },
      reason: '录错供应商',
    })
    assert.equal(result.ok, true)
    const insertReason = pool.calls.find((call) => /INSERT\s+INTO\s+dbo\.\[UB_ERP_Buy_order_sp\]/i.test(call.sqlText))
    assert.ok(insertReason)
    assert.match(insertReason.sqlText, /\[oid\]/)
    assert.match(insertReason.sqlText, /\[kcaj01\]/)
    assert.doesNotMatch(insertReason.sqlText, /\[xsaj01\]/i)
    assert.equal(insertReason.inputs.oid, '99')
    assert.equal(insertReason.inputs.kcaj01, 'ZY-2502')
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

  test('deletes an unaudited order without writing missing delid column', async () => {
    const row = { id: 4, buyOrderNo: 'ZY-2504', referenceNo: 'PI-4', systemCode: 'SYS-4', pass: '0', closed: '0', del: '0' }
    const pool = createMockPool(row, { headerColumns: ['id', 'del', 'delname', 'deltruename', 'deltime'] })
    const result = await applyBuyOrderLifecycleAction({
      pool,
      id: 4,
      action: 'delete',
      actor: { uidInt: 7, uname: 'buyer01', utruename: 'buyer name' },
    })
    assert.equal(result.ok, true)
    const update = pool.calls.find((call) => /UPDATE\s+dbo\.\[UB_ERP_Buy_order\]\s+SET\s+\[del\]=N'1'/i.test(call.sqlText))
    assert.ok(update)
    assert.doesNotMatch(update.sqlText, /\[delid\]/i)
    assert.match(update.sqlText, /\[delname\]=@delname/)
    assert.equal(update.inputs.delname, 'buyer01')
    assert.equal(update.inputs.deltruename, 'buyer name')
  })
})
