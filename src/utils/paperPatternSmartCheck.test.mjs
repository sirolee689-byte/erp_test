import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ERP_WORKBENCH_STORAGE,
  mergeWorkbenchMaterialWastageIntoMaterials,
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

test('按当前 fileId 重载智能校验资料时保留已填写的 Material 损耗', () => {
  globalThis.sessionStorage = makeStorage()
  saveWorkbenchPayload({
    fileId: 'file-2',
    materials: [
      { groupNo: '10', wastageFraction: 0.2432 },
      { groupNo: '11', wastageFraction: null },
    ],
    accessories: [],
    colorNos: ['N'],
  })
  const materials = [
    { groupNo: '10', wastageFraction: null },
    { groupNo: '11', wastageFraction: 0.05 },
  ]

  assert.equal(mergeWorkbenchMaterialWastageIntoMaterials(materials, 'file-2'), true)
  assert.deepEqual(materials, [
    { groupNo: '10', wastageFraction: 0.2432 },
    { groupNo: '11', wastageFraction: null },
  ])
  assert.equal(mergeWorkbenchMaterialWastageIntoMaterials(materials, 'other-file'), false)
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
