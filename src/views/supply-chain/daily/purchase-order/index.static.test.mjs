import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const source = readFileSync(new URL('./index.vue', import.meta.url), 'utf8')
const printSource = readFileSync(new URL('./print.vue', import.meta.url), 'utf8')

describe('purchase-order index static UI contract', () => {
  test('material trace is rendered inside the purchase-order page', () => {
    assert.match(source, /pageMode === 'material-trace'/)
    assert.match(source, /<BuyOrderMaterialTracePanel \/>/)
    assert.doesNotMatch(source, /openMaterialTraceWindow/)
  })

  test('batch audit button is only wired for unaudited page rows', () => {
    assert.match(source, /batchAuditCurrentPage/)
    assert.match(source, /currentPageAuditableRows/)
    assert.match(source, /showUnaudited\.value/)
  })

  test('purchase-order list has batch print controls and opens the print page', () => {
    assert.match(source, /printMode/)
    assert.match(source, /printLanguage/)
    assert.match(source, /printSelectedOrderNos/)
    assert.match(source, /togglePrintSelect/)
    assert.match(source, /openSelectedPrint/)
    assert.match(source, /p_sum: selected\.join/)
    assert.match(source, /purchase-order-print/)
  })

  test('purchase-order print page reads settled query params and has editable note blanks', () => {
    assert.match(printSource, /\/api\/buy-order\/print-data/)
    assert.match(printSource, /route\.query\.p_sum/)
    assert.match(printSource, /route\.query\.print_mx/)
    assert.match(printSource, /route\.query\.print_cn/)
    assert.match(printSource, /printHeaderHtml/)
    assert.match(printSource, /v-html="printHeaderHtml"/)
    assert.match(printSource, /中山市卓越皮具有限公司/)
    assert.match(printSource, /v-model="noteFineRate"/)
    assert.match(printSource, /v-model="noteWarranty"/)
    assert.match(printSource, /v-model="noteSpareRate"/)
    assert.match(printSource, /5个月/)
    assert.match(printSource, /const noteSpareRate = ref\('1'\)/)
    assert.match(printSource, /index \+ 3/)
    assert.match(printSource, /formatErpQtyDisplay/)
    assert.match(printSource, /formatErpMoneyDisplay/)
  })

  test('purchase-order view mode reuses edit form panel read-only', () => {
    assert.match(source, /pageMode === 'view'/)
    assert.match(source, /isReadonlyForm/)
    assert.match(source, /查看采购订单/)
    assert.doesNotMatch(source, /detailVisible/)
    assert.doesNotMatch(source, /DetailBlock/)
    assert.match(source, /pageMode !== 'view'.*saveOrder|v-if="pageMode !== 'view'"/)
  })

  test('purchase-order line tax defaults to 0.13 when tax-included', () => {
    assert.match(source, /resolveLineTax/)
    assert.match(source, /DEFAULT_TAX_RATE = 0\.13/)
    assert.match(source, /tax: resolveLineTax\(row\.tax\)/)
  })

  test('purchase-order detail lines table uses erp number display helpers', () => {
    assert.match(source, /buy-lines-table/)
    assert.match(source, /formatErpQtyDisplay\(row\.quantity/)
    assert.match(source, /formatErpPriceDisplay\(row\.taxExcludedPrice\)/)
    assert.match(source, /formatErpMoneyDisplay\(row\.taxExcludedAmount\)/)
    assert.match(source, /formatErpMoneyDisplay\(row\.taxIncludedAmount\)/)
    assert.match(source, /formatErpTrimDecimal\(row\.tax/)
  })

  test('purchase-order delivery header uses a date button to open the picker once', () => {
    assert.match(source, /openLinesBatchDeliveryDatePicker/)
    assert.match(source, /linesBatchDeliveryPickerRef/)
    assert.match(source, /handleOpen\(\)/)
    assert.match(source, /class="buy-delivery-header__button"/)
    assert.match(source, /class="buy-delivery-floating-picker"/)
    assert.match(source, /:teleported="false"/)
    assert.match(source, /buy-delivery-floating-picker__control/)
    assert.match(source, /linesBatchDeliveryPickerStyle/)
    assert.match(source, />\s*日期\s*</)
  })

  test('purchase-order detail lines batch add keeps quantity empty and trims edit inputs', () => {
    assert.match(source, /resolveBatchLineQuantity/)
    assert.match(source, /formatBuyLineTaxInput/)
    assert.match(source, /formatBuyLineTaxPriceInput/)
    assert.match(source, /:formatter="formatBuyLineTaxInput"/)
    assert.match(source, /:formatter="formatBuyLineTaxPriceInput"/)
    assert.doesNotMatch(source, /buy-lines-table[\s\S]*openLinePiBom/)
    assert.doesNotMatch(source, /v-model="row\.tax"[\s\S]*:precision="4"/)
    assert.doesNotMatch(source, /v-model="row\.taxIncludedPrice"[\s\S]*:precision="form\.header\.decimalPlaces"/)
  })

  test('expanded purchase-order line opens the BOM master detail by material code', () => {
    assert.match(source, /openExpandedLineBom\(line\)/)
    assert.match(source, /function openExpandedLineBom\(row\)/)
    assert.match(source, /row\?\.kcaa01/)
    assert.match(source, /\/inventory\/basic\/bom-data-window\?mode=detail&code=/)
    assert.doesNotMatch(source, /openExpandedLinePiBom/)
    assert.doesNotMatch(source, /pi-bom-data-window/)
  })
})
