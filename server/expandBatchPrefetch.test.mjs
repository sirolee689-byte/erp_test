import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { bindIntInList, normalizeIntIds } from './sqlInListHelpers.js'

const stockOutExpand = readFileSync(new URL('./stockOutExpandLines.js', import.meta.url), 'utf8')
const stockOutHandlers = readFileSync(new URL('./stockOutHandlers.js', import.meta.url), 'utf8')
const dispatchHandlers = readFileSync(new URL('./dispatchOrderHandlers.js', import.meta.url), 'utf8')
const quotationHandlers = readFileSync(new URL('./createQuotationHandlers.js', import.meta.url), 'utf8')
const purchaseQuotationHandlers = readFileSync(new URL('./purchaseQuotationHandlers.js', import.meta.url), 'utf8')
const assistExpand = readFileSync(new URL('./assistOrderExpandDetail.js', import.meta.url), 'utf8')
const salesExpand = readFileSync(new URL('./salesOrderExpandLines.js', import.meta.url), 'utf8')
const stockInHandlers = readFileSync(new URL('./stockInHandlers.js', import.meta.url), 'utf8')
const gate = readFileSync(new URL('./apiPermissionGate.js', import.meta.url), 'utf8')

test('normalizeIntIds deduplicates and enforces max page size', () => {
  const ok = normalizeIntIds('1,2,2,3')
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.ids, [1, 2, 3])
  const bad = normalizeIntIds(Array.from({ length: 1001 }, (_, i) => i + 1))
  assert.equal(bad.ok, false)
})

test('stock-out expand-lines batch route is registered before generic id route', () => {
  const batchIndex = stockOutHandlers.indexOf("app.get('/api/stock-out/expand-lines/batch'")
  const detailIndex = stockOutHandlers.indexOf("app.get('/api/stock-out/:id', detail)")
  assert.ok(batchIndex > 0)
  assert.ok(detailIndex > batchIndex)
  assert.match(gate, /stock-out\/expand-lines\/batch/)
})

test('dispatch expand-lines batch route is registered before generic id route', () => {
  const batchIndex = dispatchHandlers.indexOf("app.get('/api/dispatch-order/expand-lines/batch'")
  const detailIndex = dispatchHandlers.indexOf("app.get('/api/dispatch-order/:id'")
  assert.ok(batchIndex > 0)
  assert.ok(detailIndex > batchIndex)
})

test('quotation lines batch routes are registered before single lines route', () => {
  const pqBatch = quotationHandlers.indexOf("app.get(`${apiBase}/lines/batch`")
  const pqLines = quotationHandlers.indexOf("app.get(`${apiBase}/:id/lines`")
  assert.ok(pqBatch > 0)
  assert.ok(pqLines > pqBatch)
  assert.match(gate, /purchase-quotations\/lines\/batch/)
  assert.match(gate, /outsourcing-quotations\/lines\/batch/)
})

test('purchase quotation batch prefetch only selects the header fields needed for line linkage', () => {
  assert.match(purchaseQuotationHandlers, /compactBatchHeader:\s*true/)
  assert.match(quotationHandlers, /const batchHeaderProjection/)
  assert.match(quotationHandlers, /SELECT \$\{batchHeaderProjection\}/)
})

test('stock-out expand batch uses IN clause grouping', () => {
  assert.match(stockOutExpand, /fetchStockOutExpandLinesBatch/)
  assert.match(stockOutExpand, /groupRowsByKey/)
  assert.match(stockOutExpand, /IN \(\$\{noIn\.inSql\}\)/)
})

test('assist and sales expand batch avoid SQL Server 2012-only syntax', () => {
  for (const source of [assistExpand, salesExpand, stockInHandlers]) {
    assert.doesNotMatch(source, /TRY_CONVERT|TRY_CAST|OFFSET\s+|FORMAT\(|IIF\(|CONCAT\(/i)
  }
})

test('bindIntInList returns NULL placeholder for empty list', () => {
  const req = { input() {} }
  const result = bindIntInList(req, 'id', [])
  assert.equal(result.inSql, 'NULL')
  assert.deepEqual(result.list, [])
})
