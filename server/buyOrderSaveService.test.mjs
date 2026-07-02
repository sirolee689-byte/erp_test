import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { suggestBuyOrderNo, validateLockedBuyOrderLineQuantities } from './buyOrderSaveService.js'

function createSuggestPool(recordset = []) {
  const calls = []
  return {
    calls,
    request() {
      const params = {}
      return {
        input(name, _type, value) {
          params[name] = value
          return this
        },
        async query(sqlText) {
          calls.push({ sqlText, params })
          return { recordset }
        },
      }
    },
  }
}

describe('buyOrderSaveService', () => {
  test('suggests the next ZY number from the latest non-deleted order only', async () => {
    const pool = createSuggestPool([{ buyOrderNo: 'ZY-260851' }])

    const suggested = await suggestBuyOrderNo(pool, { numberType: 'ZY', saveDate: '2026-06-18' })

    assert.equal(suggested, 'ZY-260852')
    assert.equal(pool.calls[0].params.prefix, 'ZY-%')
    assert.match(pool.calls[0].sqlText, /SELECT\s+TOP\s+1/i)
    assert.match(pool.calls[0].sqlText, /\[kcaj01\][\s\S]*LIKE\s+@prefix/i)
    assert.match(pool.calls[0].sqlText, /\[del\][\s\S]*=\s+N'0'/i)
    assert.match(pool.calls[0].sqlText, /ORDER\s+BY[\s\S]*\[kcaj01\][\s\S]*DESC/i)
  })

  test('allows quantity changes for lines without inbound records', () => {
    const err = validateLockedBuyOrderLineQuantities({
      oldLines: [{ id: 1, bomSystemCode: 'BOM-1', kcaa01: 'LA-001', quantity: 2, inboundLocked: '0' }],
      newLines: [{ id: 1, bomSystemCode: 'BOM-1', kcaa01: 'LA-001', quantity: 5 }],
    })
    assert.equal(err, null)
  })

  test('rejects quantity changes for lines with inbound records', () => {
    const err = validateLockedBuyOrderLineQuantities({
      oldLines: [{ id: 2, bomSystemCode: 'BOM-2', kcaa01: 'LA-002', quantity: 2, inboundLocked: '1' }],
      newLines: [{ id: 2, bomSystemCode: 'BOM-2', kcaa01: 'LA-002', quantity: 3 }],
    })
    assert.match(err, /LA-002/)
    assert.match(err, /不允许修改采购数量/)
  })

  test('also treats boolean inbound lock as locked', () => {
    const err = validateLockedBuyOrderLineQuantities({
      oldLines: [{ id: 22, bomSystemCode: 'BOM-22', kcaa01: 'LA-022', quantity: 2, inboundLocked: true }],
      newLines: [{ id: 22, bomSystemCode: 'BOM-22', kcaa01: 'LA-022', quantity: 3 }],
    })
    assert.match(err, /LA-022/)
  })

  test('rejects deleting a line with inbound records', () => {
    const err = validateLockedBuyOrderLineQuantities({
      oldLines: [{ id: 3, bomSystemCode: 'BOM-3', kcaa01: 'LA-003', quantity: 1, inboundLocked: '1' }],
      newLines: [],
    })
    assert.match(err, /LA-003/)
    assert.match(err, /不允许删除/)
  })
})
