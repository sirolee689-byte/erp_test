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
})
