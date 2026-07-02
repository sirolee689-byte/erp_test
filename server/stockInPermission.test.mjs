import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { matchApiPermissionRule } from './apiPermissionGate.js'
import { resolveAuditActionAndTable } from './action_map.js'

describe('stock-in permission and action map', () => {
  test('入库单 API 映射到库存日常入库单权限', () => {
    assert.deepEqual(matchApiPermissionRule('GET', '/api/stock-in/list'), { menuPath: 'inventory/daily/stock-in', action: 'view' })
    assert.deepEqual(matchApiPermissionRule('POST', '/api/stock-in'), { menuPath: 'inventory/daily/stock-in', action: 'add' })
    assert.deepEqual(matchApiPermissionRule('PUT', '/api/stock-in/8'), { menuPath: 'inventory/daily/stock-in', action: 'edit' })
    assert.deepEqual(matchApiPermissionRule('POST', '/api/stock-in/8/audit'), { menuPath: 'inventory/daily/stock-in', action: 'audit' })
    assert.deepEqual(matchApiPermissionRule('POST', '/api/stock-in/8/review'), { menuPath: 'inventory/daily/stock-in', action: 'review' })
    assert.deepEqual(matchApiPermissionRule('GET', '/api/stock-in/surplus-batch-lines'), { menuPath: 'inventory/daily/stock-in', action: 'view' })
    assert.deepEqual(matchApiPermissionRule('POST', '/api/stock-in/surplus-batch-prices'), { menuPath: 'inventory/daily/stock-in', action: 'view' })
    assert.deepEqual(matchApiPermissionRule('GET', '/api/stock-in/label-print-data'), { menuPath: 'inventory/daily/stock-in', action: 'view' })
    assert.deepEqual(matchApiPermissionRule('GET', '/api/stock-in/material-trace/list'), { menuPath: 'inventory/daily/stock-in', action: 'view' })
    assert.equal(matchApiPermissionRule('GET', '/api/stock-in/material-qr-info'), null)
    assert.deepEqual(matchApiPermissionRule('DELETE', '/api/stock-in/8/hard'), { menuPath: 'inventory/daily/stock-in', action: 'delete' })
  })

  test('操作日志映射入库单正式物理表', () => {
    assert.equal(resolveAuditActionAndTable('GET', '/api/stock-in/list').targetTable, 'UB_ERP_Stocks_Storage')
    assert.equal(resolveAuditActionAndTable('GET', '/api/stock-in/surplus-batch-lines').targetTable, 'UB_ERP_Bom_000')
    assert.equal(resolveAuditActionAndTable('POST', '/api/stock-in/surplus-batch-prices').targetTable, 'UB_ERP_Stocks_Storage_list')
    assert.equal(resolveAuditActionAndTable('GET', '/api/stock-in/label-print-data').targetTable, 'UB_ERP_Stocks_Storage,UB_ERP_Stocks_Storage_list')
    assert.equal(resolveAuditActionAndTable('GET', '/api/stock-in/material-trace/list').targetTable, 'UB_ERP_Stocks_Storage_list,UB_ERP_Stocks_Storage')
    assert.equal(resolveAuditActionAndTable('GET', '/api/stock-in/material-qr-info').targetTable, 'UB_ERP_Stocks_Storage,UB_ERP_Stocks_Storage_list,UB_ERP_Bom_000')
    assert.equal(resolveAuditActionAndTable('POST', '/api/stock-in').targetTable, 'UB_ERP_Stocks_Storage')
    assert.equal(resolveAuditActionAndTable('POST', '/api/stock-in/8/audit').targetTable, 'UB_ERP_Stocks_Storage')
    assert.notEqual(resolveAuditActionAndTable('DELETE', '/api/stock-in/8/hard').action, '系统操作')
  })
})

