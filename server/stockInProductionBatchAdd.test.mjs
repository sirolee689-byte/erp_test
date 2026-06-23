import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { readFileSync } from 'node:fs'
import {
  computeProductionKcao031,
  computeProductionKsum,
  computeProductionTempx,
  fetchStockInProductionBatchLines,
  resolveProductionBatchSelectState,
  validateProductionDispatchHeader,
} from './stockInProductionBatchAdd.js'

function fakePool(headerRow) {
  const calls = []
  const header = headerRow ?? {
    scaj01: 'PG-001',
    scaj05: 'CJ01',
    closed: '0',
    del: '0',
    pass: '1',
    systemcode: 'SYS-001',
  }
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
            if (/Stocks_Storage_list/i.test(sqlText)) {
              return { recordset: [{ lineDocCol: 'kcao01', detailKeyCol: 'kcao02', qtyCol: 'kcao03' }] }
            }
            if (/Stocks_out/i.test(sqlText)) {
              return {
                recordset: [{
                  linkCol: 'kcap04',
                  qtyCol: 'kcaq03',
                  lineDocCol: 'kcaq01',
                  detailKeyCol: 'kcaq02',
                }],
              }
            }
            return { recordset: [] }
          }
          if (/UB_ERP_Dispatch_order/i.test(sqlText) && /TOP 1/i.test(sqlText)) {
            return { recordset: [header] }
          }
          if (/COUNT\(1\)/i.test(sqlText)) {
            return { recordset: [{ total: 1 }] }
          }
          if (/WITH base AS/i.test(sqlText)) {
            return {
              recordset: [
                {
                  id: 1,
                  scak02: 'SCAK-001',
                  systemcode: 'SCAK-001',
                  GUID: 'SCAK-001',
                  scak03: 100,
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
                  info: '派工备注',
                  rn: 1,
                },
              ],
            }
          }
          if (/GROUP BY l\.\[kcao02\]/i.test(sqlText) && /approvedQty/i.test(sqlText) && /Stocks_Storage/i.test(sqlText)) {
            return { recordset: [{ detailKey: 'SCAK-001', approvedQty: 30, pendingQty: 10 }] }
          }
          if (/FROM dbo\.\[UB_ERP_Stocks_out\]/i.test(sqlText)) {
            return {
              recordset: [
                { detailKey: 'SCAK-001', docNo: 'OUT-001', pass: '1', qty: 5 },
                { detailKey: 'SCAK-001', docNo: 'OUT-002', pass: '0', qty: 2 },
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

describe('stockInProductionBatchAdd', () => {
  test('computeProductionKsum converts by kcaa27', () => {
    assert.equal(computeProductionKsum(100, 2, '0'), 200)
    assert.equal(computeProductionKsum(100, 2, '1'), 50)
  })

  test('computeProductionTempx subtracts inbound only and allows negative', () => {
    assert.equal(computeProductionTempx(200, 30, 10), 160)
    assert.equal(computeProductionTempx(200, 250, 0), -50)
  })

  test('computeProductionKcao031 uses float rate from tempx', () => {
    assert.equal(computeProductionKcao031(160, 0.05), 168)
    assert.equal(computeProductionKcao031(-50, 0.05), 0)
  })

  test('resolveProductionBatchSelectState only allows positive tempx', () => {
    assert.equal(resolveProductionBatchSelectState({ tempx: 1, alreadySelected: false }).selectable, true)
    assert.equal(resolveProductionBatchSelectState({ tempx: 0, alreadySelected: false }).selectLabel, '不可选')
    assert.equal(resolveProductionBatchSelectState({ tempx: -5, alreadySelected: false }).selectLabel, '不可选')
  })

  test('validateProductionDispatchHeader rejects closed dispatch', async () => {
    const pool = fakePool({
      scaj01: 'PG-001',
      scaj05: 'CJ01',
      closed: '1',
      del: '0',
      pass: '1',
      systemcode: 'SYS-001',
    })
    const result = await validateProductionDispatchHeader(pool, {
      sourceOrderNo: 'PG-001',
      workshopCode: 'CJ01',
      dispatchSystemcode: '',
    })
    assert.equal(result.ok, false)
    assert.match(result.msg, /结案/)
  })

  test('validateProductionDispatchHeader checks systemcode when provided', async () => {
    const pool = fakePool()
    const result = await validateProductionDispatchHeader(pool, {
      sourceOrderNo: 'PG-001',
      workshopCode: 'CJ01',
      dispatchSystemcode: 'SYS-OTHER',
    })
    assert.equal(result.ok, false)
    assert.match(result.msg, /标识/)
  })

  test('fetchStockInProductionBatchLines maps production batch quantities', async () => {
    const pool = fakePool()
    const result = await fetchStockInProductionBatchLines(pool, {
      sourceOrderNo: 'PG-001',
      workshopCode: 'CJ01',
      dispatchSystemcode: 'SYS-001',
      page: '1',
      pageSize: '20',
    })
    assert.equal(result.ok, true)
    assert.equal(result.list.length, 1)
    assert.equal(result.list[0].orderQty, 200)
    assert.equal(result.list[0].tempx, 160)
    assert.equal(result.list[0].kcao031, 168)
    assert.equal(result.list[0].info, '派工备注')
    assert.equal(result.list[0].reworkQty, 5)
    assert.equal(result.list[0].kcao04, 0)
    assert.equal(result.list[0].tax, 0)
    assert.equal(result.list[0].selectable, true)
  })

  test('fetchStockInProductionBatchLines requires workshop', async () => {
    const pool = fakePool()
    const result = await fetchStockInProductionBatchLines(pool, { sourceOrderNo: 'PG-001' })
    assert.equal(result.ok, false)
    assert.match(result.msg, /生产车间/)
  })

  test('fetchStockInProductionBatchLines fails when header validation fails', async () => {
    const pool = fakePool({
      scaj01: 'PG-001',
      scaj05: 'CJ02',
      closed: '0',
      del: '0',
      pass: '1',
      systemcode: 'SYS-001',
    })
    const result = await fetchStockInProductionBatchLines(pool, {
      sourceOrderNo: 'PG-001',
      workshopCode: 'CJ01',
    })
    assert.equal(result.ok, false)
    assert.match(result.msg, /车间/)
  })

  test('production batch SQL avoids 2012+ syntax', () => {
    const source = readFileSync(new URL('./stockInProductionBatchAdd.js', import.meta.url), 'utf8')
    assert.doesNotMatch(source, /\bTRY_CONVERT\b/i)
    assert.doesNotMatch(source, /\bTRY_CAST\b/i)
    assert.doesNotMatch(source, /\bOFFSET\b/i)
  })

  test('production batch SQL uses physical columns d_info and pi only', () => {
    const source = readFileSync(new URL('./stockInProductionBatchAdd.js', import.meta.url), 'utf8')
    assert.doesNotMatch(source, /lineFirstTextExpr\([^)]*'Describe'/)
    assert.doesNotMatch(source, /nvarcharTextExpr\([^)]*'reference'/)
    assert.doesNotMatch(source, /nvarcharTextExpr\('ol', 'kcao02'/)
    assert.match(source, /d_info/)
    assert.match(source, /lineInfoExpr/)
    assert.match(source, /lineReferenceExpr/)
    assert.match(source, /getStockOutLineMeta/)
    assert.match(source, /detailKeyCol/)
  })
})
