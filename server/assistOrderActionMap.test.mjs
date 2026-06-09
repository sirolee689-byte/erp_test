import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { resolveAuditActionAndTable } from './action_map.js'

describe('assist order action map', () => {
  test('maps assist order routes to readable audit actions', () => {
    assert.equal(resolveAuditActionAndTable('GET', '/api/assist-order/list').targetTable, 'UB_ERP_assist_order')
    assert.equal(resolveAuditActionAndTable('GET', '/api/assist-order/print-data').targetTable, 'UB_ERP_assist_order')
    assert.equal(resolveAuditActionAndTable('POST', '/api/assist-order').targetTable, 'UB_ERP_assist_order')
    assert.equal(resolveAuditActionAndTable('PUT', '/api/assist-order/8').targetTable, 'UB_ERP_assist_order')
    assert.equal(resolveAuditActionAndTable('POST', '/api/assist-order/8/audit').targetTable, 'UB_ERP_assist_order')
    assert.equal(resolveAuditActionAndTable('POST', '/api/assist-order/8/unclose').targetTable, 'UB_ERP_assist_order')
    assert.equal(resolveAuditActionAndTable('DELETE', '/api/assist-order/8/hard').targetTable, 'UB_ERP_assist_order')

    assert.notEqual(resolveAuditActionAndTable('GET', '/api/assist-order/list').action, '绯荤粺鎿嶄綔')
    assert.notEqual(resolveAuditActionAndTable('POST', '/api/assist-order/8/audit').action, '绯荤粺鎿嶄綔')
  })
})
