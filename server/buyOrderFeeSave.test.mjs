import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { normalizeBuyOrderFees } from './buyOrderFeeSave.js'

const feeSaveSource = readFileSync(new URL('./buyOrderFeeSave.js', import.meta.url), 'utf8')

describe('buyOrderFeeSave', () => {
  test('normalizeBuyOrderFees keeps fee code rows only', () => {
    const rows = normalizeBuyOrderFees([
      { feeCode: 'FEE-01', money: 10 },
      { feeCode: '', money: 5 },
    ])
    assert.equal(rows.length, 1)
    assert.equal(rows[0].feeCode, 'FEE-01')
  })

  test('fee save source includes systemcode and audit columns', () => {
    for (const col of ['[systemcode]', '[uid]', '[uname]', '[utruename]', '[addtime]']) {
      assert.match(feeSaveSource, new RegExp(`\\${col}`, 'i'))
    }
    for (const param of ['@systemcode', '@uid', '@uname', '@utruename', '@addtime']) {
      assert.match(feeSaveSource, new RegExp(param, 'i'))
    }
    assert.match(feeSaveSource, /formatSalesOrderAuditTime/)
  })
})
