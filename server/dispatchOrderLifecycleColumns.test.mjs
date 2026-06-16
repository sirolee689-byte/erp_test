import test from 'node:test'
import assert from 'node:assert/strict'

import { buildDispatchOrderLifecycleSetSql } from './dispatchOrderLifecycle.js'

test('dispatch order lifecycle writes only columns that exist in legacy tables', () => {
  const headerCols = new Set(['pass', 'del', 'delname', 'deltruename', 'deltime'])
  const lineCols = new Set(['pass', 'del'])
  const actor = { uidInt: 7, uname: 'admin', utruename: 'manager' }

  const audit = buildDispatchOrderLifecycleSetSql({
    config: { nextPass: '1' },
    actor,
    headerCols,
    lineCols,
  })
  assert.equal(audit.headerSetSql, "[pass]=N'1'")
  assert.equal(audit.lineSetSql, "[pass]=N'1'")
  assert.equal(audit.headerSetSql.includes('passuname'), false)
  assert.equal(audit.lineSetSql.includes('passuid'), false)

  const unaudit = buildDispatchOrderLifecycleSetSql({
    config: { nextPass: '0' },
    actor,
    headerCols,
    lineCols,
  })
  assert.equal(unaudit.headerSetSql, "[pass]=N'0'")
  assert.equal(unaudit.lineSetSql, "[pass]=N'0'")

  const softDelete = buildDispatchOrderLifecycleSetSql({
    config: { nextDel: '1' },
    actor,
    headerCols,
    lineCols,
  })
  assert.equal(softDelete.headerSetSql.includes('[delid]'), false)
  assert.equal(softDelete.headerSetSql.includes('[delname]=@delname'), true)
  assert.equal(softDelete.headerSetSql.includes('[deltruename]=@deltruename'), true)
  assert.equal(softDelete.headerSetSql.includes('[deltime]='), true)
})
