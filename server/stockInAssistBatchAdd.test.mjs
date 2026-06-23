import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { readFileSync } from 'node:fs'
import {
  computeAssistKcao031,
  computeAssistKsum,
  computeAssistPrice,
  computeAssistTempx,
  fetchStockInAssistBatchLines,
  parseAssistFloatRate,
  resolveAssistBatchSelectState,
} from './stockInAssistBatchAdd.js'

function fakePool() {
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
          if (/COL_LENGTH/i.test(sqlText)) {
            return { recordset: [{ linkCol: 'kcap04', qtyCol: 'kcaq03', lineDocCol: 'kcaq01' }] }
          }
          if (/COUNT\(1\)/i.test(sqlText)) {
            return { recordset: [{ total: 1 }] }
          }
          if (/WITH grouped AS/i.test(sqlText)) {
            return {
              recordset: [
                {
                  id: 1,
                  wxak02: 'WX-LINE-001',
                  systemcode: 'WX-LINE-001',
                  GUID: 'WX-LINE-001',
                  wxak03: 100,
                  wxak04: 20,
                  wxak041: 22.6,
                  tax: 0.13,
                  kcaa01: 'MAT-001',
                  kcaa02: '测试物料',
                  kcaa03: '规格A',
                  kcaa04: 'PCS',
                  kcaa05: 'CAT01',
                  kcaa11: '红色',
                  kcaa25: 'PCS',
                  kcaa26: 2,
                  kcaa27: '0',
                  reference: 'PI-001',
                  Describe: '说明',
                  info: '备注',
                  headerRate: '2',
                  currencyRate: '2',
                  currencyName: 'USD',
                  currencyCode: 'USD',
                  rn: 1,
                },
              ],
            }
          }
          if (/GROUP BY l\.\[kcao02\]/i.test(sqlText) && /approvedQty/i.test(sqlText)) {
            return { recordset: [{ detailKey: 'WX-LINE-001', approvedQty: 30, pendingQty: 10 }] }
          }
          if (/FROM dbo\.\[UB_ERP_Stocks_out\]/i.test(sqlText)) {
            return {
              recordset: [
                { materialCode: 'MAT-001', docNo: 'OUT-001', pass: '1', qty: 7 },
                { materialCode: 'MAT-001', docNo: 'OUT-002', pass: '0', qty: 3 },
              ],
            }
          }
          if (/stocks_in/i.test(sqlText)) {
            return { recordset: [{ categoryCode: 'CAT01', stocks_in: '5%' }] }
          }
          return { recordset: [] }
        },
      }
    },
  }
}

describe('stockInAssistBatchAdd', () => {
  test('computeAssistKsum converts by kcaa27', () => {
    assert.equal(computeAssistKsum(100, 2, '0'), 200)
    assert.equal(computeAssistKsum(100, 2, '1'), 50)
  })

  test('computeAssistTempx subtracts inbound only, not outbound', () => {
    assert.equal(computeAssistTempx(200, 30, 10), 160)
  })

  test('computeAssistKcao031 uses float rate from tempx', () => {
    assert.equal(computeAssistKcao031(160, 0.05), 168)
    assert.equal(computeAssistKcao031(-1, 0.05), 0)
  })

  test('parseAssistFloatRate supports percent text', () => {
    assert.equal(parseAssistFloatRate('5%'), 0.05)
    assert.equal(parseAssistFloatRate('0.05'), 0.05)
  })

  test('computeAssistPrice divides by ratio and exchange rate for kcaa27=0', () => {
    assert.equal(computeAssistPrice(20, 2, '0', 2), 5)
    assert.equal(computeAssistPrice(20, 2, '1', 2), 10)
  })

  test('resolveAssistBatchSelectState only allows positive tempx', () => {
    assert.equal(resolveAssistBatchSelectState({ tempx: 1, alreadySelected: false }).selectable, true)
    assert.equal(resolveAssistBatchSelectState({ tempx: 0, alreadySelected: false }).selectable, false)
    assert.equal(resolveAssistBatchSelectState({ tempx: 1, alreadySelected: true }).selectLabel, '已选择')
  })

  test('fetchStockInAssistBatchLines maps assist batch line quantities', async () => {
    const pool = fakePool()
    const result = await fetchStockInAssistBatchLines(pool, {
      inboundType: '2',
      sourceOrderNo: 'WX-001',
      supplierCode: 'SUP-001',
      page: '1',
      pageSize: '20',
    })
    assert.equal(result.ok, true)
    assert.equal(result.list.length, 1)
    assert.equal(result.list[0].orderQty, 200)
    assert.equal(result.list[0].tempx, 160)
    assert.equal(result.list[0].kcao031, 168)
    assert.equal(result.list[0].actualOutboundQty, 7)
    assert.equal(result.list[0].pendingOutboundText, '3 / 1 / OUT-002')
    assert.equal(result.list[0].kcao04, 5)
    assert.equal(result.list[0].selectable, true)
  })

  test('assist batch SQL avoids unsafe nvarchar to numeric implicit conversions', () => {
    const source = readFileSync(new URL('./stockInAssistBatchAdd.js', import.meta.url), 'utf8')
    assert.doesNotMatch(source, /ISNULL\([^)]+\.\[del\],\s*N''\)/i)
    assert.doesNotMatch(source, /ISNULL\([^)]+\.\[pass\],\s*N''\)/i)
    assert.doesNotMatch(source, /ORDER BY ISNULL\(l\.\[seq\],\s*l\.\[id\]\)/i)
    assert.doesNotMatch(source, /CONVERT\(nvarchar\([^)]*\),\s*ISNULL\(/i)
    assert.doesNotMatch(source, /\bTRY_CONVERT\b/i)
    assert.doesNotMatch(source, /\bTRY_CAST\b/i)
  })
})
