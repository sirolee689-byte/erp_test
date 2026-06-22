import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const lineSaveSource = readFileSync(new URL('./buyOrderLineSave.js', import.meta.url), 'utf8')
const bomSnapshotSource = readFileSync(new URL('./buyOrderBomSnapshot.js', import.meta.url), 'utf8')
const saveServiceSource = readFileSync(new URL('./buyOrderSaveService.js', import.meta.url), 'utf8')
const feeSaveSource = readFileSync(new URL('./buyOrderFeeSave.js', import.meta.url), 'utf8')

describe('buy order save audit and snapshot fields', () => {
  test('purchase order detail insert writes creator audit fields', () => {
    for (const col of ['[uid]', '[uname]', '[utruename]', '[addtime]']) {
      assert.match(lineSaveSource, new RegExp(`\\${col}`, 'i'))
    }
    for (const param of ['@uid', '@uname', '@utruename', '@addtime']) {
      assert.match(lineSaveSource, new RegExp(param, 'i'))
    }
  })

  test('purchase order BOM snapshot insert writes extended BOM fields and audit fields', () => {
    for (const col of [
      '[GUID]',
      '[kcaa02_en]',
      '[type]',
      '[location]',
      '[sale_price]',
      '[cost_price]',
      '[version]',
      '[uid]',
      '[uname]',
      '[utruename]',
      '[addtime]',
      '[pass]',
    ]) {
      assert.match(bomSnapshotSource, new RegExp(`\\${col}`, 'i'))
    }
    assert.match(bomSnapshotSource, /@GUID/)
    assert.match(bomSnapshotSource, /bom\.GUID \?\? bom\.systemcode/)
  })

  test('save service passes actor into child writers', () => {
    assert.match(saveServiceSource, /rewriteBuyOrderLines\([\s\S]*actor/i)
    assert.match(saveServiceSource, /rewriteBuyOrderBomSnapshots\([\s\S]*actor/i)
    assert.match(saveServiceSource, /rewriteBuyOrderFees\([\s\S]*actor/i)
    assert.match(saveServiceSource, /rewriteBuyOrderFees\([\s\S]*systemCode/i)
  })

  test('purchase order fee insert writes systemcode and audit fields', () => {
    for (const col of ['[systemcode]', '[uid]', '[uname]', '[utruename]', '[addtime]']) {
      assert.match(feeSaveSource, new RegExp(`\\${col}`, 'i'))
    }
  })
})
