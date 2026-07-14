import assert from 'node:assert/strict'
import test from 'node:test'
import { validatePurchaseQuoteExcelRows } from './purchaseQuotationExcelImport.js'

test('采购报价 Excel：空行已由调用方跳过，逐行校验税点、含税价和重复编码', () => {
  const result = validatePurchaseQuoteExcelRows([
    { rowNo: 2, serial: 2, code: 'A-01', tax: 0.03, inclusivePrice: 1.35375 },
    { rowNo: 3, serial: 1, code: 'B-01', tax: '', inclusivePrice: -1 },
    { rowNo: 4, serial: '', code: 'A-01', tax: 0.03, inclusivePrice: 2 },
  ], new Set())
  assert.equal(result.valid.length, 0)
  assert.match(result.failed[0].reason, /Excel 内编码重复/)
  assert.match(result.failed[1].reason, /税点为空/)
  assert.match(result.failed[1].reason, /含税价不能小于 0/)
})

test('采购报价 Excel：成功行按序号排序，序号为空时按 Excel 行号排序', () => {
  const result = validatePurchaseQuoteExcelRows([
    { rowNo: 8, serial: '', code: 'C', tax: 0, inclusivePrice: 1 },
    { rowNo: 3, serial: 1, code: 'A', tax: 0.03, inclusivePrice: 2 },
    { rowNo: 4, serial: 2, code: 'B', tax: 0.03, inclusivePrice: 3 },
  ], new Set(['c-exists']))
  assert.deepEqual(result.valid.map((row) => row.code), ['A', 'B', 'C'])
})
