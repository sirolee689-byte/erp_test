import assert from 'node:assert/strict'
import test from 'node:test'
import {
  STOCK_BATCH_RESULT_PREFIX,
  readStockBatchResult,
  removeStockBatchResult,
  writeStockBatchResult,
} from './stockInBatchAdd.js'

function makeStorage() {
  const map = new Map()
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null
    },
    setItem(key, value) {
      map.set(key, String(value))
    },
    removeItem(key) {
      map.delete(key)
    },
  }
}

test('stock in batch result is written to sessionStorage like buy-order batch', () => {
  globalThis.localStorage = makeStorage()
  globalThis.sessionStorage = makeStorage()
  const payload = { sessionId: 's1', lines: [{ kcao02: 'line-1' }] }

  writeStockBatchResult('s1', payload)

  assert.equal(globalThis.localStorage.getItem(`${STOCK_BATCH_RESULT_PREFIX}s1`), null)
  assert.deepEqual(readStockBatchResult('s1'), payload)
})

test('stock in batch result cleanup removes sessionStorage entry', () => {
  globalThis.sessionStorage = makeStorage()
  const key = `${STOCK_BATCH_RESULT_PREFIX}s3`
  globalThis.sessionStorage.setItem(key, '{"session":true}')

  removeStockBatchResult('s3')

  assert.equal(globalThis.sessionStorage.getItem(key), null)
})
