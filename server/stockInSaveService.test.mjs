import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  __resolveStockInSaveApprovalForTest,
  __stockInLineBomSnapshotFieldsForTest,
  __stockInSaveSourceMetaForTest,
  buildValidateSourceOrderSql,
} from './stockInSaveService.js'

describe('stockInSaveService', () => {
  test('purchase stock-in save validation uses buy-order kcaj fields', () => {
    const meta = __stockInSaveSourceMetaForTest('1')
    assert.equal(meta.noCol, 'kcaj01')
    assert.equal(meta.partyCol, 'kcaj05')
    assert.equal(meta.lineOrderCol, 'kcak01')

    const sqlText = buildValidateSourceOrderSql(meta)
    assert.match(sqlText, /dbo\.\[UB_ERP_Buy_order\]\s+AS\s+h/i)
    assert.match(sqlText, /h\.\[kcaj01\]/)
    assert.match(sqlText, /h\.\[kcaj05\]/)
    assert.doesNotMatch(sqlText, /cgad01|cgad05/i)
  })

  test('new stock-in save is auto-approved by default', () => {
    assert.deepEqual(__resolveStockInSaveApprovalForTest(null), { autoApprove: true, pass: '1' })
    assert.deepEqual(__resolveStockInSaveApprovalForTest(12), { autoApprove: false, pass: '0' })
  })

  test('stock-in line save includes the required BOM snapshot fields', () => {
    assert.deepEqual(__stockInLineBomSnapshotFieldsForTest(), [
      'kcaa07',
      'kcaa08',
      'kcaa12',
      'kcaa13',
      'kcaa14',
      'kcaa25',
      'kcaa28',
      'kcaa29',
      'kcaa30',
      'kcaa31',
      'kcaa32',
      'kcaa33',
      'kcaa34',
      'kcaa35',
    ])
  })
})
