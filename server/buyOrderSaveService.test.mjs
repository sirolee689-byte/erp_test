import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { suggestBuyOrderNo } from './buyOrderSaveService.js'

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
})
