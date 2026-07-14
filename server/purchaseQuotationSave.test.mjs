import assert from 'node:assert/strict'
import test from 'node:test'
import { __purchaseQuotationSaveForTest } from './purchaseQuotationSave.js'

test('snapshot fields exclude mq and zq', () => {
  assert.equal(__purchaseQuotationSaveForTest.BOM_COPY_FIELDS.includes('mq'), false)
  assert.equal(__purchaseQuotationSaveForTest.BOM_COPY_FIELDS.includes('zq'), false)
})

test('采购报价保存只接受三段供应商组合值', () => {
  assert.deepEqual(__purchaseQuotationSaveForTest.parseSupplier('S01,供应商A,10'), { code: 'S01', name: '供应商A' })
  assert.equal(__purchaseQuotationSaveForTest.parseSupplier('S01,供应商A'), null)
})

test('采购报价保存保留页面明细顺序，不从 BOM 主档读取不存在的 seq', () => {
  assert.equal(__purchaseQuotationSaveForTest.pageSeq({ Seq: 7 }, 1), 7)
  assert.equal(__purchaseQuotationSaveForTest.pageSeq({}, 3), 3)
})

test('报价日期、有效期和币别组合值在保存前校验', () => {
  const check = __purchaseQuotationSaveForTest.validateHeader({
    cgaa01: 'BJ-01', cgaa02: '2026-07-13', cgaa07: '2026-07-12',
    supplierCombo: 'S01,供应商A,10', currencyCombo: '001,人民币',
  })
  assert.match(check.error, /有效日期/)
})
