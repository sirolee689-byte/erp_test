import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { describe, test } from 'node:test'
import { enrichBuyOrderBatchAddPrices, fetchBuyOrderBatchAddLines } from './buyOrderBatchAdd.js'

function fakePool(rows = []) {
  const calls = []
  const recordsets = Array.isArray(rows?.recordsets) ? rows.recordsets : null
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
          if (recordsets) return { recordsets, recordset: recordsets[0] ?? [] }
          return { recordset: rows }
        },
      }
    },
  }
}

describe('buyOrderBatchAdd', () => {
  test('rejects empty or multiple PI for order-purchase batch add', async () => {
    const pool = fakePool()
    const empty = await fetchBuyOrderBatchAddLines(pool, { buyType: '1', piNo: '', supplierCode: 'S01' })
    assert.equal(empty.ok, false)
    assert.equal(empty.status, 400)

    const multi = await fetchBuyOrderBatchAddLines(pool, { buyType: '1', piNo: 'PI-1,PI-2', supplierCode: 'S01' })
    assert.equal(multi.ok, false)
    assert.match(multi.msg, /一个 PI/)
  })

  test('requisition batch add requires supplier and queries Bom_000 by default', async () => {
    const pool = fakePool([
      {
        sid: '',
        systemcode: 'BOM-SYS-2',
        GUID: 'BOM-SYS-2',
        kcaa01: 'BAG-001',
        kcaa02: '主袋',
        kcaa25: 'PCS',
        cgab04: 5,
        cgab05: 5.65,
        tax: 0.13,
        pass: '1',
        totalRows: 1,
        rn: 1,
      },
    ])

    const noSupplier = await fetchBuyOrderBatchAddLines(pool, { buyType: '2', piNo: 'PI-1', supplierCode: '' })
    assert.equal(noSupplier.ok, false)

    const result = await fetchBuyOrderBatchAddLines(pool, {
      buyType: '2',
      piNo: 'PI-4173A',
      supplierCode: 'S01',
      bomCodeId: '3',
      keyword: 'BAG',
      page: '1',
      pageSize: '10',
    })

    assert.equal(result.ok, true)
    assert.equal(result.buyType, '2')
    assert.equal(result.list.length, 1)
    assert.equal(result.list[0].quantity, 0)
    assert.equal(result.list[0].lineKey, 'req|bag-001')
    assert.equal(result.list[0].cgab05, 0)
    const sqlText = pool.calls[0].sql
    assert.match(sqlText, /UB_ERP_Bom_000/)
    assert.match(sqlText, /pass.*= N'1'/i)
    assert.match(sqlText, /NOT LIKE N'%CUT-%'/i)
    assert.doesNotMatch(sqlText, /UB_ERP_Buy_offer_list/)
    assert.match(sqlText, /b\.\[kcaa01\]/)
    assert.doesNotMatch(sqlText, /b\.\[kcaa02\][\s\S]*LIKE @kw/)
    assert.doesNotMatch(sqlText, /UB_ERP_Bom_pi_cost/)
    assert.equal(pool.calls[0].inputs.bomCodeId, 3)
  })

  test('other-purchase batch add reuses requisition BOM query and allows empty reference', async () => {
    const pool = fakePool([
      {
        sid: '',
        systemcode: 'BOM-SYS-4',
        GUID: 'BOM-SYS-4',
        kcaa01: 'TAG-001',
        kcaa02: '拉牌',
        kcaa25: 'PCS',
        pass: '1',
        totalRows: 1,
        rn: 1,
      },
    ])

    const result = await fetchBuyOrderBatchAddLines(pool, {
      buyType: '0',
      piNo: '',
      supplierCode: 'S01',
    })

    assert.equal(result.ok, true)
    assert.equal(result.buyType, '0')
    assert.equal(result.multiPi, false)
    assert.equal(result.list.length, 1)
    assert.equal(result.list[0].buyType, '0')
    assert.equal(result.list[0].quantity, 0)
    const sqlText = pool.calls[0].sql
    assert.match(sqlText, /UB_ERP_Bom_000/)
    assert.doesNotMatch(sqlText, /UB_ERP_Bom_pi_cost/)
  })

  test('requisition multi-PI batch add queries sales list', async () => {
    const pool = fakePool({
      recordsets: [
        [
      {
        sid: '',
        kcaa01Key: 'MAT-9',
        systemcode: 'BOM-SYS-3',
        GUID: 'BOM-SYS-3',
        kcaa01: 'MAT-9',
        kcaa02: '物料',
        pass: '1',
        totalRows: 2,
        rn: 1,
      },
        ],
        [
          { kcaa01Key: 'MAT-9', sid: 'PI-A' },
        ],
      ],
    })

    const result = await fetchBuyOrderBatchAddLines(pool, {
      buyType: '2',
      piNo: 'PI-A,PI-B',
      supplierCode: 'S01',
    })

    assert.equal(result.ok, true)
    assert.equal(result.multiPi, true)
    assert.equal(result.list[0].lineKey, 'pi-a|mat-9')
    assert.equal(result.list[0].sid, 'PI-A')
    const sqlText = pool.calls[0].sql
    assert.match(sqlText, /UB_ERP_Bom_Sales_list/)
    assert.match(sqlText, /@pi0/)
    assert.match(sqlText, /@pi1/)
  })

  test('requisition and other multi-PI batch add groups duplicate material codes before paging', async () => {
    const pool = fakePool({
      recordsets: [
        [
          {
            sid: '',
            kcaa01Key: 'LA-0368/BO',
            systemcode: 'BOM-SYS-LA',
            GUID: 'BOM-SYS-LA',
            kcaa01: 'LA-0368/BO',
            kcaa02: 'LA material',
            pass: '1',
            totalRows: 1,
            rn: 1,
          },
        ],
        [
          { kcaa01Key: 'LA-0368/BO', sid: 'PI-A' },
          { kcaa01Key: 'LA-0368/BO', sid: 'PI-B' },
        ],
      ],
    })

    const result = await fetchBuyOrderBatchAddLines(pool, {
      buyType: '2',
      piNo: 'PI-A,PI-B',
      supplierCode: 'S01',
    })

    assert.equal(result.ok, true)
    assert.equal(result.total, 1)
    assert.equal(result.list.length, 1)
    assert.equal(result.list[0].kcaa01, 'LA-0368/BO')
    assert.equal(result.list[0].sid, 'PI-A,PI-B')
    assert.equal(result.list[0].lineKey, 'pi-a,pi-b|la-0368/bo')
    const sqlText = pool.calls[0].sql
    assert.match(sqlText, /grouped AS/i)
    assert.match(sqlText, /SELECT DISTINCT\s+[\s\S]*pk\.\[kcaa01Key\][\s\S]*sid/i)
    assert.doesNotMatch(sqlText, /STUFF\(/i)
    assert.doesNotMatch(sqlText, /FOR XML PATH/i)
    assert.match(sqlText, /GROUP BY\s+LTRIM\(RTRIM\(CONVERT\(nvarchar\(300\), ISNULL\(s\.\[kcaa01\]/i)
    assert.match(sqlText, /ROW_NUMBER\(\) OVER/i)
    assert.match(sqlText, /COUNT\(1\) OVER\(\) AS totalRows/i)
    assert.doesNotMatch(sqlText, /OFFSET\s+/i)
    assert.doesNotMatch(sqlText, /TRY_CONVERT|TRY_CAST|FORMAT\(|IIF\(|CONCAT\(/i)
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
        categoryName: '皮料类',
        quoteCurrencyName: '美元',
        purchaseCurrencyName: '人民币',
        pass: '1',
      },
    ])

    const result = await fetchBuyOrderBatchAddLines(pool, {
      buyType: '1',
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
    assert.equal(result.list[0].categoryName, '皮料类')
    assert.equal(result.list[0].quoteCurrencyName, '美元')
    assert.equal(result.list[0].purchaseCurrencyName, '人民币')
    assert.equal(result.list[0].pass, '1')
    const sqlText = pool.calls[0].sql
    assert.match(sqlText, /UB_ERP_Bom_pi_cost/)
    assert.match(sqlText, /UB_ERP_Buy_offer_list/)
    assert.match(sqlText, /UB_ERP_Buy_order_list/)
    assert.match(sqlText, /UB_ERP_Stocks_Storage_list/)
    assert.match(sqlText, /UB_ERP_Stocks_material/)
    assert.match(sqlText, /UB_ERP_Finance_currency/)
    assert.match(sqlText, /AS \[categoryName\]/)
    assert.match(sqlText, /AS \[quoteCurrencyName\]/)
    assert.match(sqlText, /AS \[purchaseCurrencyName\]/)
    assert.doesNotMatch(sqlText, /UB_ERP_Stocks\b/)
    assert.doesNotMatch(sqlText, /CAST\(ISNULL\([^)]*, 0\) AS decimal/i)
    assert.doesNotMatch(sqlText, /SUM\(ISNULL\([^)]*, 0\)\)/i)
    assert.doesNotMatch(sqlText, /ISNULL\(c\.\[kcaa12\], 0\) = 1/i)
    assert.doesNotMatch(sqlText, /ISNULL\(c\.\[kcaa\d{2}\], N''\)\)\) LIKE @kw/i)
    assert.match(sqlText, /page_rows AS/i)
    assert.match(sqlText, /supplier_orders AS/i)
    assert.match(sqlText, /last_buy_ids AS/i)
    assert.match(sqlText, /LEFT JOIN last_buy_ids AS lastBuyId/i)
    assert.doesNotMatch(sqlText, /SELECT TOP 1[\s\S]*?gkcaa02[\s\S]*?ORDER BY l\.\[id\] DESC/i)
    assert.match(sqlText, /FROM page_rows AS p/i)
    assert.match(sqlText, /AS price\s+OUTER APPLY/i)
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
      buyType: '1',
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
      buyType: '1',
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

  test('requisition selected rows fetch prices only after save', async () => {
    const pool = fakePool([
      {
        kcaa01: 'BAG-001',
        cgab04: 10,
        cgab05: 11.3,
        tax: 0.13,
      },
    ])

    const result = await enrichBuyOrderBatchAddPrices(pool, {
      supplierCode: 'S01',
      lines: [{ kcaa01: 'BAG-001', kcaa02: 'Bag' }, { kcaa01: 'BAG-002', kcaa02: 'Bag 2' }],
      hasPricePermission: true,
    })

    assert.equal(result.ok, true)
    assert.equal(result.list[0].cgab04, 10)
    assert.equal(result.list[0].cgab05, 11.3)
    assert.equal(result.list[0].tax, 0.13)
    assert.equal(result.list[1].cgab05, undefined)
    const sqlText = pool.calls[0].sql
    assert.match(sqlText, /UB_ERP_Buy_offer_list/)
    assert.match(sqlText, /UB_ERP_Buy_offer/)
    assert.match(sqlText, /ROW_NUMBER\(\) OVER \(PARTITION BY s\.\[kcaa01\] ORDER BY l\.\[id\] DESC\)/)
    assert.equal(pool.calls[0].inputs.code0, 'BAG-001')
    assert.equal(pool.calls[0].inputs.code1, 'BAG-002')
  })

  test('source file keeps SQL Server 2008 forbidden syntax out', async () => {
    const source = await fs.readFile(new URL('./buyOrderBatchAdd.js', import.meta.url), 'utf8')
    assert.doesNotMatch(source, /TRY_CONVERT|TRY_CAST|OFFSET\s+|FORMAT\(|IIF\(|CONCAT\(/i)
    assert.match(source, /KCAA_DECIMAL_FIELDS/)
    assert.match(source, /sqlMaxKcaa/)
  })
})
