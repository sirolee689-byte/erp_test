import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  computeKcao031,
  computeKsum,
  computeTempx,
  fetchStockInPurchaseBatchLines,
  parseFloatRate,
  resolvePurchaseBatchSelectState,
} from './stockInPurchaseBatchAdd.js'
import { readFileSync } from 'node:fs'

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
            return { recordset: [{ linkCol: 'kcap04', qtyCol: 'kcaq03' }] }
          }
          if (/COUNT\(1\)/i.test(sqlText)) {
            return { recordset: [{ total: 1 }] }
          }
          if (/WITH base AS/i.test(sqlText)) {
            return {
              recordset: [
                {
                  id: 1,
                  kcak02: 'BOM-001',
                  systemcode: 'BOM-001',
                  GUID: 'BOM-001',
                  kcak03: 100,
                  kcak04: 10,
                  kcak041: 11.3,
                  tax: 0.13,
                  kcaa01: 'MAT-001',
                  kcaa02: '测试物料',
                  kcaa03: '规格A',
                  kcaa04: 'PCS',
                  kcaa05: 'CAT01',
                  kcaa11: '红色',
                  kcaa25: 'PCS',
                  kcaa26: 1,
                  kcaa27: '0',
                  Reference: 'PI-001',
                  info: '备注',
                  headerRate: '1',
                  currencyRate: '1',
                  currencyName: 'RMB',
                  currencyCode: 'RMB',
                  rn: 1,
                },
              ],
            }
          }
          if (/GROUP BY l\.\[kcao02\]/i.test(sqlText) && /sumr/i.test(sqlText)) {
            return { recordset: [{ detailKey: 'BOM-001', sumr: 30, sumrx: 10 }] }
          }
          if (/GROUP BY ol\.\[kcaa01\]/i.test(sqlText)) {
            return { recordset: [{ materialCode: 'MAT-001', osum: 5, sumox: 0 }] }
          }
          if (/stocks_in/i.test(sqlText)) {
            return { recordset: [{ categoryCode: 'CAT01', stocks_in: '0.05' }] }
          }
          return { recordset: [] }
        },
      }
    },
  }
}

describe('stockInPurchaseBatchAdd', () => {
  test('computeKsum converts by kcaa27', () => {
    assert.equal(computeKsum(100, 2, '0'), 200)
    assert.equal(computeKsum(100, 2, '1'), 50)
  })

  test('computeTempx subtracts occupied inbound and returns', () => {
    assert.equal(computeTempx(100, 30, 10, 5, 0), 65)
  })

  test('computeKcao031 uses float rate and clamps at zero', () => {
    assert.equal(computeKcao031(100, 0.05, 100, 0, 0, 0), 5)
    assert.equal(computeKcao031(100, 0.05, 200, 0, 0, 0), 0)
  })

  test('parseFloatRate supports percent text', () => {
    assert.equal(parseFloatRate('5%'), 0.05)
    assert.equal(parseFloatRate('0.05'), 0.05)
  })

  test('resolvePurchaseBatchSelectState blocks pending return and full rows', () => {
    const blocked = resolvePurchaseBatchSelectState({
      tempx:  0,
      kcao031: 0,
      pendingReturnQty: 2,
      alreadySelected: false,
      isAdmin: true,
    })
    assert.equal(blocked.selectable, false)
    assert.match(blocked.selectLabel, /未审退货/)

    const full = resolvePurchaseBatchSelectState({
      tempx: 0,
      kcao031: 0,
      pendingReturnQty: 0,
      alreadySelected: false,
      isAdmin: true,
    })
    assert.equal(full.selectable, false)
    assert.match(full.selectLabel, /不可选/)
  })

  test('fetchStockInPurchaseBatchLines requires source order', async () => {
    const pool = fakePool()
    const missing = await fetchStockInPurchaseBatchLines(pool, {}, { is_admin: 0 })
    assert.equal(missing.ok, false)
  })

  test('fetchStockInPurchaseBatchLines maps tempx and kcao031', async () => {
    const pool = fakePool()
    const result = await fetchStockInPurchaseBatchLines(
      pool,
      { sourceOrderNo: 'PO-001', page: '1', pageSize: '20' },
      { is_admin: 0 },
    )
    assert.equal(result.ok, true)
    assert.equal(result.list.length, 1)
    assert.equal(result.list[0].tempx, 65)
    assert.equal(result.list[0].kcao031, 70)
    assert.equal(result.list[0].selectable, true)
  })

  test('purchase batch SQL avoids unsafe nvarchar to numeric implicit conversions', () => {
    const source = readFileSync(new URL('./stockInPurchaseBatchAdd.js', import.meta.url), 'utf8')
    assert.doesNotMatch(source, /ISNULL\([^)]+\.\[del\],\s*N''\)/i)
    assert.doesNotMatch(source, /ISNULL\([^)]+\.\[pass\],\s*N''\)/i)
    assert.doesNotMatch(source, /ORDER BY ISNULL\(l\.\[seq\],\s*l\.\[id\]\)/i)
    assert.doesNotMatch(source, /CONVERT\(nvarchar\([^)]*\),\s*ISNULL\(/i)
    assert.doesNotMatch(source, /\bTRY_CONVERT\b/i)
    assert.doesNotMatch(source, /\bTRY_CAST\b/i)
  })
})
