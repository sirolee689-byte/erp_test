import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PURCHASE_QUOTE_EXCEL_IMPORT_MAX_CODES,
  __purchaseQuotationExcelImportForTest,
} from './purchaseQuotationExcelImport.js'

const { classifyPurchaseQuoteExcelMaterial, normalizeCodes } = __purchaseQuotationExcelImportForTest

test('采购报价 Excel 物料核验：只接受唯一的在册、已审核、非 CUT 物料', () => {
  const ok = classifyPurchaseQuoteExcelMaterial('A-01', [{ kcaa01: 'A-01', del: '0', pass: '1' }])
  assert.equal(ok.status, 'ok')
  assert.equal(classifyPurchaseQuoteExcelMaterial('A-01', [{ kcaa01: 'A-01', del: '1', pass: '1' }]).status, 'deleted')
  assert.equal(classifyPurchaseQuoteExcelMaterial('A-01', [{ kcaa01: 'A-01', del: '0', pass: '0' }]).status, 'unapproved')
  assert.equal(classifyPurchaseQuoteExcelMaterial('CUT-01', [{ kcaa01: 'CUT-01', del: '0', pass: '1' }]).status, 'not-selectable')
  assert.equal(classifyPurchaseQuoteExcelMaterial('A-01', [
    { kcaa01: 'A-01', del: '0', pass: '1' },
    { kcaa01: 'A-01', del: '0', pass: '1' },
  ]).status, 'duplicate')
})

test('采购报价 Excel 物料核验：去空格、去重并限制单次 1000 条', () => {
  assert.deepEqual(normalizeCodes([' A-01 ', 'a-01', 'B-01']), ['A-01', 'B-01'])
  assert.throws(
    () => normalizeCodes(Array.from({ length: PURCHASE_QUOTE_EXCEL_IMPORT_MAX_CODES + 1 }, (_, index) => `A-${index}`)),
    /最多核验/,
  )
})
