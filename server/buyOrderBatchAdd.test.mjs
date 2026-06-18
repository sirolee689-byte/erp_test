import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { describe, test } from 'node:test'
import { fetchBuyOrderBatchAddLines } from './buyOrderBatchAdd.js'

function fakePool(rows = []) {
  const calls = []
  return {
    calls,
    request() {
      const inputs = {}
      return {
        input(name, _type, value) {
          inputs[name] = value
          return this
        },
        async query(sqlText) {
          calls.push({ sql: sqlText, inputs })
          return { recordset: rows }
        },
      }
    },
  }
}

describe('buyOrderBatchAdd', () => {
  test('rejects empty or multiple PI for order-purchase batch add', async () => {
    const pool = fakePool()
    const empty = await fetchBuyOrderBatchAddLines(pool, { piNo: '', supplierCode: 'S01' })
    assert.equal(empty.ok, false)
    assert.equal(empty.status, 400)

    const multi = await fetchBuyOrderBatchAddLines(pool, { piNo: 'PI-1,PI-2', supplierCode: 'S01' })
    assert.equal(multi.ok, false)
    assert.match(multi.msg, /一个 PI/)
  })

  test('builds SQL Server 2008 compatible query over PI cost, price, purchase and inbound tables', async () => {
    const pool = fakePool([
      {
        piNo: 'PI-4173B',
        systemcode: 'BOM-SYS-1',
        GUID: 'BOM-SYS-1',
        kcaa01: 'MAT-1',
        kcaa02: 'Material',
        kcaa25: 'PCS',
        kcaa26: 2,
        kcaa27: '1',
        kcac06: 5,
        cgab04: 8,
        cgab05: 9.04,
        tax: 0.13,
        buys: 3,
        buysum: 1,
        stockQty: 0,
        stockAfterDeduct: 0,
      },
    ])

    const result = await fetchBuyOrderBatchAddLines(pool, {
      piNo: 'PI-4173B',
      supplierCode: 'S01',
      keyword: 'MAT',
      hasPricePermission: true,
    })

    assert.equal(result.ok, true)
    assert.equal(result.list.length, 1)
    assert.equal(result.list[0].sbuy, 10)
    assert.equal(result.list[0].availableQty, 7)
    assert.equal(result.list[0].maxQty, 17)
    assert.equal(result.list[0].stockQty, 0)
    assert.equal(result.list[0].stockAfterDeduct, 0)
    assert.equal(result.list[0].cgab05, 9.04)
    const sqlText = pool.calls[0].sql
    assert.match(sqlText, /UB_ERP_Bom_pi_cost/)
    assert.match(sqlText, /UB_ERP_Buy_offer_list/)
    assert.match(sqlText, /UB_ERP_Buy_order_list/)
    assert.match(sqlText, /UB_ERP_Stocks_Storage_list/)
    assert.doesNotMatch(sqlText, /UB_ERP_Stocks\b/)
    assert.match(sqlText, /OUTER APPLY/)
    assert.match(sqlText, /ROW_NUMBER\(\) OVER/i)
    assert.doesNotMatch(sqlText, /OFFSET\s+/i)
    assert.doesNotMatch(sqlText, /TRY_CONVERT|TRY_CAST|FORMAT\(|IIF\(|CONCAT\(/i)
  })

  test('supports SQL Server 2008 ROW_NUMBER pagination with total count', async () => {
    const pool = fakePool([
      {
        piNo: 'PI-4173B',
        systemcode: 'BOM-SYS-1',
        GUID: 'BOM-SYS-1',
        kcaa01: 'MAT-1',
        kcaa26: 1,
        kcaa27: '1',
        kcac06: 5,
        cgab04: 8,
        cgab05: 9.04,
        tax: 0.13,
        totalRows: 25,
        rn: 11,
      },
    ])

    const result = await fetchBuyOrderBatchAddLines(pool, {
      piNo: 'PI-4173B',
      supplierCode: 'S01',
      page: '2',
      pageSize: '10',
    })

    assert.equal(result.ok, true)
    assert.equal(result.total, 25)
    assert.equal(result.page, 2)
    assert.equal(result.pageSize, 10)
    assert.equal(result.list.length, 1)
    assert.equal(pool.calls[0].inputs.startRow, 11)
    assert.equal(pool.calls[0].inputs.endRow, 20)
    assert.match(pool.calls[0].sql, /BETWEEN @startRow AND @endRow/)
  })

  test('hides price values when price permission is missing', async () => {
    const pool = fakePool([
      {
        piNo: 'PI-4173B',
        systemcode: 'BOM-SYS-1',
        GUID: 'BOM-SYS-1',
        kcaa01: 'MAT-1',
        kcaa26: 1,
        kcaa27: '1',
        kcac06: 5,
        cgab04: 8,
        cgab05: 9.04,
        tax: 0.13,
      },
    ])

    const result = await fetchBuyOrderBatchAddLines(pool, {
      piNo: 'PI-4173B',
      supplierCode: 'S01',
      hasPricePermission: false,
    })

    assert.equal(result.ok, true)
    assert.equal(result.list[0].cgab04, 0)
    assert.equal(result.list[0].cgab05, 0)
    assert.equal(result.list[0].tax, 0)
    assert.match(pool.calls[0].sql, /CAST\(0 AS decimal\(18, 6\)\) AS cgab05/)
  })

  test('source file keeps SQL Server 2008 forbidden syntax out', async () => {
    const source = await fs.readFile(new URL('./buyOrderBatchAdd.js', import.meta.url), 'utf8')
    assert.doesNotMatch(source, /TRY_CONVERT|TRY_CAST|OFFSET\s+|FORMAT\(|IIF\(|CONCAT\(/i)
    assert.match(source, /KCAA_DECIMAL_FIELDS/)
    assert.match(source, /sqlMaxKcaa/)
  })
})
