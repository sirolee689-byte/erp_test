import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  formatAssistOrderDeliveryDate,
  resolveAssistOrderPiValue,
} from './assistOrderSaveLogic.js'
import { checkAssistOrderNoAvailable } from './assistOrderSaveService.js'

function mockPoolWithOrderNo(exists, id = 99) {
  return {
    request() {
      return {
        input() {
          return this
        },
        async query() {
          return { recordset: exists ? [{ id }] : [] }
        },
      }
    },
  }
}

describe('assistOrderSaveService header field helpers', () => {
  test('delivery date and pi align with save plan', () => {
    assert.equal(formatAssistOrderDeliveryDate('2026-06-29'), '2026-06-29 00:00:00')
    assert.equal(resolveAssistOrderPiValue('PI-TEST111'), 'PI-TEST111')
    assert.equal(resolveAssistOrderPiValue(undefined), null)
  })
})

describe('checkAssistOrderNoAvailable', () => {
  test('rejects empty order no', async () => {
    const result = await checkAssistOrderNoAvailable(mockPoolWithOrderNo(false), '  ')
    assert.equal(result.available, false)
    assert.match(result.message, /不能为空/)
  })

  test('returns available when order no not taken', async () => {
    const result = await checkAssistOrderNoAvailable(mockPoolWithOrderNo(false), 'WX26060901')
    assert.equal(result.available, true)
    assert.equal(result.message, '')
  })

  test('returns unavailable when order no exists', async () => {
    const result = await checkAssistOrderNoAvailable(mockPoolWithOrderNo(true), 'WX26060901')
    assert.equal(result.available, false)
    assert.match(result.message, /在册记录/)
  })
})

describe('updateAssistOrder header audit SQL', () => {
  test('writes upname/uptruename on edit without overwriting creator uname/utruename', () => {
    const src = readFileSync(fileURLToPath(new URL('./assistOrderSaveService.js', import.meta.url)), 'utf8')
    const updateBlock = src.slice(src.indexOf('export async function updateAssistOrder'))
    assert.match(updateBlock, /\[upname\]=@upname/)
    assert.match(updateBlock, /\[uptruename\]=@uptruename/)
    assert.doesNotMatch(updateBlock, /\[uname\]=@uname/)
    assert.doesNotMatch(updateBlock, /\[utruename\]=@utruename/)
    assert.doesNotMatch(updateBlock, /\[uid\]=@uid/)
  })
})
