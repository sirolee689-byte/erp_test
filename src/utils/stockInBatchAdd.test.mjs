import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import {
  STOCK_BATCH_RESULT_PREFIX,
  addSelectableStockBatchRows,
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

test('全选只追加当前页可选行，并保留跨页已选内容', () => {
  const existing = new Map([['previous', { lineKey: 'previous' }]])
  const pageRows = [
    { lineKey: 'available', selectable: true },
    { lineKey: 'blocked', selectable: false },
    { lineKey: 'previous', selectable: true },
  ]

  const selected = addSelectableStockBatchRows(pageRows, existing)
  const selectedAgain = addSelectableStockBatchRows(pageRows, selected)

  assert.deepEqual([...selected.keys()], ['previous', 'available'])
  assert.deepEqual([...selectedAgain.keys()], ['previous', 'available'])
})

test('所有入库单批量添加工具栏以全选替换查询全部，且全选在保存前', () => {
  const batchWindows = [
    '../views/inventory/daily/stock-in/batch-add-window.vue',
    '../views/inventory/daily/stock-in/assist-return-batch-window.vue',
    '../views/inventory/daily/stock-in/surplus-batch-window.vue',
    '../views/inventory/daily/stock-in/other-batch-window.vue',
  ]

  for (const relativePath of batchWindows) {
    const source = fs.readFileSync(path.resolve(import.meta.dirname, relativePath), 'utf8')
    assert.equal(source.includes('查询全部'), false, relativePath)
    assert.ok(source.indexOf('全选') < source.indexOf('保存已选数据'), relativePath)
  }
})
