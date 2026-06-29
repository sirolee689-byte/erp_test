import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  buildStockOutSourceWritebackSql,
  buildStockOutLifecycleSetSql,
  resolveStockOutLifecycleConfig,
  validateStockOutAuditLineCount,
} from './stockOutLifecycle.js'

describe('stockOutLifecycle', () => {
  test('出库单新增后只能人工审核，已审核不能直接删除', () => {
    const cfg = resolveStockOutLifecycleConfig('delete', { pass: '1', del: '0', closed: '0', outboundType: '1' })
    assert.match(cfg.error, /先反审核/)
  })

  test('已结案单据不可操作', () => {
    assert.match(resolveStockOutLifecycleConfig('audit', { pass: '0', closed: '1' }).error, /已结案/)
  })

  test('无明细出库单不能审核', () => {
    assert.match(validateStockOutAuditLineCount(0), /至少需要一条明细才能审核/)
    assert.equal(validateStockOutAuditLineCount(1), null)
  })

  test('审核和反审核会同步主表与明细 pass', () => {
    const headerCols = new Set(['pass', 'passuid', 'passuname', 'shtime'])
    const lineCols = new Set(['pass', 'passuid', 'passuname'])
    const audit = buildStockOutLifecycleSetSql({
      config: { nextPass: '1' },
      actor: { uid: 9, uname: 'admin' },
      headerCols,
      lineCols,
    })
    assert.match(audit.headerSetSql, /\[pass\]=N'1'/)
    assert.match(audit.headerSetSql, /\[shtime\]=CONVERT/)
    assert.match(audit.lineSetSql, /\[pass\]=N'1'/)

    const unaudit = buildStockOutLifecycleSetSql({
      config: { nextPass: '0' },
      actor: { uid: 9, uname: 'admin' },
      headerCols,
      lineCols,
    })
    assert.match(unaudit.headerSetSql, /\[pass\]=N'0'/)
    assert.match(unaudit.lineSetSql, /\[pass\]=N'0'/)
  })

  test('彻底删除只允许超级管理员', () => {
    const normal = resolveStockOutLifecycleConfig('hard-delete', { pass: '0', del: '1', closed: '0' }, { isAdmin: false })
    assert.match(normal.error, /超级管理员/)
    const admin = resolveStockOutLifecycleConfig('hard-delete', { pass: '0', del: '1', closed: '0' }, { isAdmin: true })
    assert.equal(admin.hardDelete, true)
    const adminByCol = resolveStockOutLifecycleConfig('hard-delete', { pass: '0', del: '1', closed: '0' }, { is_admin: 1 })
    assert.equal(adminByCol.hardDelete, true)
  })
  test('source writeback SQL batches source updates by outbound line source key', () => {
    const auditSql = buildStockOutSourceWritebackSql({
      tableName: 'UB_ERP_Buy_order_list',
      writebackField: 'kcak07',
      keyColumn: 'systemcode',
      direction: 1,
    })
    assert.match(auditSql, /UPDATE tgt/i)
    assert.match(auditSql, /FROM dbo\.\[UB_ERP_Buy_order_list\] AS tgt/i)
    assert.match(auditSql, /UB_ERP_Stocks_out_list/i)
    assert.match(auditSql, /GROUP BY[\s\S]*kcaq02/i)
    assert.match(auditSql, /\[kcak07\] = ISNULL\(tgt\.\[kcak07\], 0\) \+ agg\.\[delta\]/)
    assert.match(auditSql, /tgt\.\[systemcode\] = agg\.\[sourceLineCode\]/)
    assert.doesNotMatch(auditSql, /@sourceLineCode/i)

    const unauditSql = buildStockOutSourceWritebackSql({
      tableName: 'UB_ERP_Buy_order_list',
      writebackField: 'kcak07',
      keyColumn: 'systemcode',
      direction: -1,
    })
    assert.match(unauditSql, /CASE WHEN ISNULL\(tgt\.\[kcak07\], 0\) - agg\.\[delta\] < 0 THEN 0/)
  })

  test('source writeback SQL keeps unit conversion behind convertUnit flag', () => {
    const sql = buildStockOutSourceWritebackSql({
      tableName: 'UB_ERP_assist_order_list',
      writebackField: 'wxak08',
      keyColumn: 'systemcode',
      direction: 1,
    })
    assert.match(sql, /@convertUnit = 1[\s\S]*kcaa27[\s\S]*= N'1'[\s\S]*kcaq03[\s\S]*\*[\s\S]*kcaa26/i)
    assert.match(sql, /@convertUnit = 1[\s\S]*kcaa27[\s\S]*= N'0'[\s\S]*kcaq03[\s\S]*\/[\s\S]*kcaa26/i)
    assert.match(sql, /SUM\(ABS\(/i)
  })

  test('source writeback SQL can join numeric id source keys without per-line updates', () => {
    const sql = buildStockOutSourceWritebackSql({
      tableName: 'UB_ERP_Dispatch_order_list',
      writebackField: 'scak04',
      keyColumn: 'id',
      direction: 1,
    })
    assert.match(sql, /CONVERT\(nvarchar\(200\), tgt\.\[id\]\)/i)
    assert.doesNotMatch(sql, /WHERE \[id\] = @sourceLineCode/i)
  })
})
