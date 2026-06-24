import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { matchApiPermissionRule } from './apiPermissionGate.js'
import { resolveAuditActionAndTable } from './action_map.js'

describe('stock-out permission and action map', () => {
  test('出库单 API 映射到库存日常出库单权限', () => {
    assert.deepEqual(matchApiPermissionRule('GET', '/api/stock-out/list'), { menuPath: 'inventory/daily/stock-out', action: 'view' })
    assert.deepEqual(matchApiPermissionRule('POST', '/api/stock-out'), { menuPath: 'inventory/daily/stock-out', action: 'add' })
    assert.deepEqual(matchApiPermissionRule('PUT', '/api/stock-out/8'), { menuPath: 'inventory/daily/stock-out', action: 'edit' })
    assert.deepEqual(matchApiPermissionRule('POST', '/api/stock-out/8/audit'), { menuPath: 'inventory/daily/stock-out', action: 'audit' })
    assert.deepEqual(matchApiPermissionRule('DELETE', '/api/stock-out/8/hard'), { menuPath: 'inventory/daily/stock-out', action: 'delete' })
  })

  test('操作日志映射出库单正式物理表', () => {
    assert.equal(resolveAuditActionAndTable('GET', '/api/stock-out/list').targetTable, 'UB_ERP_Stocks_out')
    assert.equal(resolveAuditActionAndTable('POST', '/api/stock-out').targetTable, 'UB_ERP_Stocks_out')
    assert.equal(resolveAuditActionAndTable('POST', '/api/stock-out/8/audit').targetTable, 'UB_ERP_Stocks_out')
    assert.notEqual(resolveAuditActionAndTable('DELETE', '/api/stock-out/8/hard').action, '系统操作')
  })
})

