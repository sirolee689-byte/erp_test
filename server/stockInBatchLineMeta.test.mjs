import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { getStockInLineMeta, getStockOutLineMeta } from './stockInBatchLineMeta.js'

function metaPool(inRow, outRow) {
  return {
    request() {
      return {
        input() {
          return this
        },
        async query(sqlText) {
          if (/Stocks_Storage_list/i.test(sqlText)) {
            return { recordset: [inRow] }
          }
          if (/Stocks_out/i.test(sqlText)) {
            return { recordset: [outRow] }
          }
          return { recordset: [] }
        },
      }
    },
  }
}

describe('stockInBatchLineMeta', () => {
  test('getStockInLineMeta defaults to kcao columns', async () => {
    const meta = await getStockInLineMeta(metaPool({}, {}))
    assert.equal(meta.lineDocCol, 'kcao01')
    assert.equal(meta.detailKeyCol, 'kcao02')
    assert.equal(meta.qtyCol, 'kcao03')
  })

  test('getStockOutLineMeta prefers kcaq02 as detail key', async () => {
    const meta = await getStockOutLineMeta(metaPool({}, {
      linkCol: 'kcap04',
      qtyCol: 'kcaq03',
      lineDocCol: 'kcaq01',
      detailKeyCol: 'kcaq02',
    }))
    assert.equal(meta.detailKeyCol, 'kcaq02')
    assert.equal(meta.qtyCol, 'kcaq03')
    assert.equal(meta.linkCol, 'kcap04')
  })
})
