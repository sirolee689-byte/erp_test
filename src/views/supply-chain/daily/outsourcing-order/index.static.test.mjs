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
})
