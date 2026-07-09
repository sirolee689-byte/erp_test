import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ERP_WORKBENCH_STORAGE,
  readWorkbenchPayload,
  saveWorkbenchPayload,
} from './paperPatternSmartCheck.js'

function makeStorage() {
  const data = new Map()
  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null
    },
    setItem(key, value) {
      data.set(key, String(value))
    },
    removeItem(key) {
      data.delete(key)
    },
  }
}

test('workbench payload keeps the current fileId', () => {
  globalThis.sessionStorage = makeStorage()

  saveWorkbenchPayload({
    fileId: 'file-2',
    materials: [{ groupNo: '1' }],
    accessories: [{ seqNo: 'A' }],
    colorNos: ['N'],
  })

  assert.deepEqual(readWorkbenchPayload(), {
    fileId: 'file-2',
    materials: [{ groupNo: '1' }],
    accessories: [{ seqNo: 'A' }],
    colorNos: ['N'],
  })
})

test('old workbench payload without fileId remains readable', () => {
  globalThis.sessionStorage = makeStorage()
  globalThis.sessionStorage.setItem(
    ERP_WORKBENCH_STORAGE,
    JSON.stringify({
      materials: [{ groupNo: '1' }],
      accessories: [],
      colorNos: ['N'],
    }),
  )

  assert.deepEqual(readWorkbenchPayload(), {
    fileId: '',
    materials: [{ groupNo: '1' }],
    accessories: [],
    colorNos: ['N'],
  })
})
