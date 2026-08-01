import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { resolveOperationAuditPolicy } from './action_map.js'

function assertPolicy(mode, routes) {
  for (const [method, path, body] of routes) {
    assert.equal(
      resolveOperationAuditPolicy(method, path, body).mode,
      mode,
      `${method} ${path} should be ${mode}`,
    )
  }
}

describe('operation audit policy catalog', () => {
  test('central whitelist covers the missing-log modules', () => {
    assertPolicy('central', [
      ['POST', '/api/roles'],
      ['PUT', '/api/roles/permissions'],
      ['PUT', '/api/users/change-password'],
      ['POST', '/api/hr/departments'],
      ['POST', '/api/hr/staff'],
      ['POST', '/api/hr/dormitory/check-in'],
      ['POST', '/api/inventory/color-code'],
      ['POST', '/api/inventory/units'],
      ['POST', '/api/inventory/unit-conversion'],
      ['POST', '/api/inventory/material-category'],
      ['POST', '/api/inventory/workshop-dept'],
      ['POST', '/api/inventory/warehouse'],
      ['POST', '/api/inventory/bom'],
      ['POST', '/api/bom/usage-calc'],
      ['POST', '/api/paper-pattern/import/commit-bom000'],
      ['POST', '/api/sales-order'],
      ['POST', '/api/sales-order/7/calculate'],
      ['PUT', '/api/inventory/pi-bom-data/basic'],
      ['POST', '/api/supply-chain/suppliers'],
      ['POST', '/api/supply-chain/customers'],
      ['POST', '/api/supply-chain/settlement-methods'],
      ['PUT', '/api/supply-chain/purchase-quotations/audit'],
      ['POST', '/api/supply-chain/outsourcing-quotations'],
      ['POST', '/api/customs-declaration/generate'],
      ['PUT', '/api/stock-out/cutting-issue-config'],
      ['POST', '/api/system/kernel/print-image'],
    ])
  })

  test('business strategy prevents duplicate central logs', () => {
    assertPolicy('business', [
      ['POST', '/api/buy-order'],
      ['POST', '/api/assist-order/3/audit'],
      ['DELETE', '/api/dispatch-order/3/hard'],
      ['POST', '/api/stock-in/3/review'],
      ['POST', '/api/stock-out'],
      ['PUT', '/api/system/kernel/mail-config'],
      ['POST', '/api/users'],
      ['PUT', '/api/inventory/bom/parts/BOM-01'],
      ['PUT', '/api/hr/staff/leave/E001'],
      ['POST', '/api/hr/dormitory/electric/settle'],
    ])
  })

  test('read-only POST and dry-run writes are ignored', () => {
    assertPolicy('ignore', [
      ['POST', '/api/dining/login'],
      ['POST', '/api/dining/logout'],
      ['PUT', '/api/dining/meals'],
      ['POST', '/api/stock-in/surplus-batch-prices'],
      ['POST', '/api/stock-out/other-batch-prices'],
      ['POST', '/api/buy-order/batch-add-prices'],
      ['POST', '/api/customs-declaration/preview'],
      ['POST', '/api/supply-chain/purchase-quotations/excel-import/materials'],
      ['POST', '/api/paper-pattern/import/upload'],
      ['POST', '/api/inventory/pi-bom-data/replace-material', { dryRun: true }],
    ])
  })

  test('unknown writes remain unknown so coverage checks can fail explicitly', () => {
    assert.equal(resolveOperationAuditPolicy('POST', '/api/new-unmapped-write').mode, 'unknown')
  })
})
