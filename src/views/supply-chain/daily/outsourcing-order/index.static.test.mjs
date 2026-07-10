import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const source = readFileSync(new URL('./index.vue', import.meta.url), 'utf8')
const formSource = readFileSync(new URL('./AssistOrderEditForm.vue', import.meta.url), 'utf8')

describe('outsourcing-order index static UI contract', () => {
  test('view mode reuses edit form panel read-only', () => {
    assert.match(source, /pageMode === 'view'/)
    assert.match(source, /isReadonlyForm/)
    assert.match(source, /查看外协订单/)
    assert.doesNotMatch(source, /detailVisible/)
    assert.match(source, /:readonly="isReadonlyForm"/)
    assert.match(formSource, /readonly:\s*\{\s*type:\s*Boolean/)
  })

  test('opens two standalone print formats from the selected order-number queue', () => {
    assert.doesNotMatch(source, /openBatchPrint/)
    assert.doesNotMatch(source, /assist-print-dialog/)
    assert.match(source, /openSelectedPrint\('1'\)/)
    assert.match(source, /openSelectedPrint\('0'\)/)
    assert.match(source, /p_sum: selected\.join\(','\)/)
    assert.match(source, /outsourcing-order-print/)
    assert.match(source, /v-permission="'print'"/)
  })
})
