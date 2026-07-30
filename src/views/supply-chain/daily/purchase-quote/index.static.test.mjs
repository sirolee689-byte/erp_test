import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const source = readFileSync(new URL('./index.vue', import.meta.url), 'utf8')

describe('purchase-quote detail supplier display', () => {
  test('detail keeps its historical supplier option after hydration', () => {
    const start = source.indexOf('async function openQuotePanel')
    const end = source.indexOf('function switchToManage', start)
    const panelSource = source.slice(start, end)

    assert.match(panelSource, /supplierOptions\.value = \[\{ id: 'legacy'/)
    assert.doesNotMatch(panelSource, /supplierOptions\.value = \[\]/)
  })
})
