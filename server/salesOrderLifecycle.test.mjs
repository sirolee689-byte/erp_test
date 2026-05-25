import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  buildPassAuditSetClauses,
  parseSalesOrderId,
  pickSalesOrderAuditColumnNames,
} from './salesOrderLifecycle.js'

describe('salesOrderLifecycle', () => {
  test('parseSalesOrderId 合法/非法', () => {
    assert.deepEqual(parseSalesOrderId('12'), { ok: true, id: 12 })
    assert.equal(parseSalesOrderId('0').ok, false)
    assert.equal(parseSalesOrderId('x').ok, false)
  })

  test('pickSalesOrderAuditColumnNames 探测显式列', () => {
    const cols = new Set(['id', 'pass', 'passtime', 'passuname', 'intime'])
    const picked = pickSalesOrderAuditColumnNames(cols)
    assert.equal(picked.passTime, 'passtime')
    assert.equal(picked.passUname, 'passuname')
    assert.equal(picked.passUid, null)
    assert.ok(!picked.passTime?.includes('intime'))
  })

  test('buildPassAuditSetClauses 审核含 pass 与 edittime', () => {
    const cols = new Set(['pass', 'edittime', 'passtime', 'passuname'])
    const auditCols = pickSalesOrderAuditColumnNames(cols)
    const { sets } = buildPassAuditSetClauses({
      cols,
      auditCols,
      actor: { uidInt: 1, uname: 'u1', utruename: '张三' },
      now: '2026-05-24 10:00:00',
      mode: 'approve',
    })
    assert.ok(sets.some((s) => s.includes("[pass] = N'1'")))
    assert.ok(sets.some((s) => s.includes('[edittime]')))
    assert.ok(sets.some((s) => s.includes('[passtime]')))
  })
})
