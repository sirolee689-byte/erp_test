import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  buildStockInLifecycleSetSql,
  resolveStockInLifecycleConfig,
} from './stockInLifecycle.js'

describe('stockInLifecycle', () => {
  test('已审核入库单不能直接删除，必须先反审核', () => {
    const cfg = resolveStockInLifecycleConfig('delete', { pass: '1', del: '0', sp_flag: '0', closed: '0', inboundType: '1' })
    assert.match(cfg.error, /先反审核/)
  })

  test('复核须已审核且写入 sp_flag', () => {
    assert.match(resolveStockInLifecycleConfig('review', { pass: '0', sp_flag: '0', del: '0' }).error, /未审核/)
    const cfg = resolveStockInLifecycleConfig('review', { pass: '1', sp_flag: '0', del: '0', closed: '0', inboundType: '1' })
    assert.equal(cfg.nextSpFlag, '1')
    const headerCols = new Set(['sp_flag'])
    const sql = buildStockInLifecycleSetSql({
      config: { nextSpFlag: '1' },
      actor: { uid: 1, uname: 'fin' },
      headerCols,
      lineCols: new Set(),
    })
    assert.match(sql.headerSetSql, /\[sp_flag\]=N'1'/)
  })

  test('已复核、已结案、类型 8 都只读不可操作', () => {
    assert.match(resolveStockInLifecycleConfig('audit', { pass: '0', sp_flag: '1' }).error, /已复核/)
    assert.match(resolveStockInLifecycleConfig('audit', { pass: '0', closed: '1' }).error, /已结案/)
    assert.match(resolveStockInLifecycleConfig('audit', { pass: '0', inboundType: '8' }).error, /加工入库/)
  })

  test('审核和反审核会同步主表与明细 pass', () => {
    const headerCols = new Set(['pass', 'passuid', 'passuname', 'shtime'])
    const lineCols = new Set(['pass', 'passuid', 'passuname'])
    const audit = buildStockInLifecycleSetSql({
      config: { nextPass: '1' },
      actor: { uid: 9, uname: 'admin' },
      headerCols,
      lineCols,
    })
    assert.match(audit.headerSetSql, /\[pass\]=N'1'/)
    assert.match(audit.headerSetSql, /\[shtime\]=CONVERT/)
    assert.match(audit.lineSetSql, /\[pass\]=N'1'/)

    const unaudit = buildStockInLifecycleSetSql({
      config: { nextPass: '0' },
      actor: { uid: 9, uname: 'admin' },
      headerCols,
      lineCols,
    })
    assert.match(unaudit.headerSetSql, /\[pass\]=N'0'/)
    assert.match(unaudit.lineSetSql, /\[pass\]=N'0'/)
  })

  test('彻底删除只允许超级管理员', () => {
    const normal = resolveStockInLifecycleConfig('hard-delete', { pass: '0', del: '1', sp_flag: '0', closed: '0' }, { isAdmin: false })
    assert.match(normal.error, /超级管理员/)
    const admin = resolveStockInLifecycleConfig('hard-delete', { pass: '0', del: '1', sp_flag: '0', closed: '0' }, { isAdmin: true })
    assert.equal(admin.hardDelete, true)
    const adminByCol = resolveStockInLifecycleConfig('hard-delete', { pass: '0', del: '1', sp_flag: '0', closed: '0' }, { is_admin: 1 })
    assert.equal(adminByCol.hardDelete, true)
  })
})

