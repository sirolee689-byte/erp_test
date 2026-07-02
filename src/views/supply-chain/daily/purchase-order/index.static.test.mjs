import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const source = readFileSync(new URL('./index.vue', import.meta.url), 'utf8')

describe('purchase-order index static UI contract', () => {
  test('material trace is rendered inside the purchase-order page', () => {
    assert.match(source, /pageMode === 'material-trace'/)
    assert.match(source, /<BuyOrderMaterialTracePanel \/>/)
    assert.doesNotMatch(source, /openMaterialTraceWindow/)
  })

  test('batch audit button is only wired for unaudited page rows', () => {
    assert.match(source, /批量审核当前页/)
    assert.match(source, /currentPageAuditableRows/)
    assert.match(source, /showUnaudited\.value/)
    assert.match(source, /batchAuditCurrentPage/)
  })
})
