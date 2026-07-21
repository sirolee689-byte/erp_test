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

  test('stock-in save auto-approves only when it contains details', () => {
    assert.deepEqual(__resolveStockInSaveApprovalForTest(), { autoApprove: false, pass: '0' })
    assert.deepEqual(__resolveStockInSaveApprovalForTest(0), { autoApprove: false, pass: '0' })
    assert.deepEqual(__resolveStockInSaveApprovalForTest(12), { autoApprove: true, pass: '1' })
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
