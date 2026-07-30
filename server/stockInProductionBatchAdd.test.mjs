import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { readFileSync } from 'node:fs'
import {
  aggregateProductionReturnRowsByMaterial,
  computeProductionKcao031,
  computeProductionKsum,
  computeProductionTempx,
  fetchStockInProductionBatchLines,
  resolveProductionBatchSelectState,
  validateProductionDispatchHeader,
} from './stockInProductionBatchAdd.js'

function fakePool(headerRow, options = {}) {
  const calls = []
  const header = headerRow ?? {
    scaj01: 'PG-001',
    scaj05: 'CJ01',
    closed: '0',
    del: '0',
    pass: '1',
    systemcode: 'SYS-001',
  }
  const lineTotal = options.lineTotal ?? 1
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
          if (/INFORMATION_SCHEMA\.COLUMNS/i.test(sqlText) && /New_UB_ERP_Stocks_material/i.test(sqlText)) {
            return { recordset: [{ col: 'cutting_issue' }] }
          }
          if (/UB_ERP_Dispatch_order/i.test(sqlText) && /TOP 1/i.test(sqlText)) {
            if (options.headerMissing) return { recordset: [] }
            return { recordset: [header] }
          }
          if (/New_UB_ERP_Stocks_material/i.test(sqlText) && /cutting_issue/i.test(sqlText)) {
            return { recordset: [{ code: 'CAT01' }] }
          }
          if (/UB_ERP_Dispatch_order_list/i.test(sqlText) && /scak02/i.test(sqlText) && !/WITH base AS/i.test(sqlText) && !/COUNT\(1\)/i.test(sqlText)) {
            if (lineTotal <= 0) return { recordset: [] }
            return {
              recordset: [
                {
                  id: 1,
                  scak02: 'SCAK-001',
                  systemcode: 'SCAK-001',
                  GUID: 'SCAK-001',
                  scak03: 10,
                  pi: 'PI-001',
                  kcaa01: 'BAG-001',
                  kcaa02: '成品A',
                },
                {
                  id: 2,
                  scak02: 'SCAK-002',
                  systemcode: 'SCAK-002',
                  GUID: 'SCAK-002',
                  scak03: 5,
                  pi: 'PI-001',
                  kcaa01: 'BAG-002',
                  kcaa02: '成品B',
                },
              ],
            }
          }
          if (/UB_ERP_Bom_pi_cost/i.test(sqlText)) {
            if (options.cutting) {
              return {
                recordset: [
                  {
                    id: 1,
                    sid: 'PI-001',
                    t_kcaa01: 'CUT-001',
                    top_kcaa01: 'CUT-001',
                    kcaa01: 'CUT-MAT-001',
                    kcaa02: '开料退料子料',
                    kcaa03: 'CUT-R',
                    kcaa04: 'PCS',
                    kcaa05: 'CAT01',
                    kcaa11: '黑色',
                    kcaa25: 'PCS',
                    kcaa26: 1,
                    kcaa27: '0',
                    kcac06: 2,
                    temp: 3,
                    systemcode: 'CUT-BOM-001',
                    GUID: 'CUT-BOM-001',
                  },
                ],
              }
            }
            return {
              recordset: [
                {
                  id: 1,
                  sid: 'PI-001',
                  pq: 'BAG-001',
                  top_kcaa01: 'BAG-001',
                  kcaa01: 'RET-001',
                  kcaa02: '退料子料',
                  kcaa03: '规格R',
                  kcaa04: 'PCS',
                  kcaa05: 'CAT01',
                  kcaa11: '红色',
                  kcaa25: 'PCS',
                  kcaa26: 1,
                  kcaa27: '0',
                  kcac06: 2,
                  systemcode: 'BOM-RET-001',
                  GUID: 'BOM-RET-001',
                },
                {
                  id: 2,
                  sid: 'PI-001',
                  pq: 'BAG-002',
                  top_kcaa01: 'BAG-002',
                  kcaa01: 'RET-001',
                  kcaa02: '退料子料',
                  kcaa03: '规格R',
                  kcaa04: 'PCS',
                  kcaa05: 'CAT01',
                  kcaa11: '红色',
                  kcaa25: 'PCS',
                  kcaa26: 1,
                  kcaa27: '0',
                  kcac06: 1,
                  systemcode: 'BOM-RET-001',
                  GUID: 'BOM-RET-001',
                },
              ],
            }
          }
          if (/COUNT\(1\)/i.test(sqlText)) {
            return { recordset: [{ total: lineTotal }] }
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
          if (/FROM dbo\.\[UB_ERP_Stocks_out\]/i.test(sqlText) && /materialCode/i.test(sqlText)) {
            if (options.cutting) {
              return {
                recordset: [
                  { materialCode: 'CUT-MAT-001', docNo: 'OUT-CUT-A', pass: '1', qty: 6 },
                  { materialCode: 'CUT-MAT-001', docNo: 'OUT-CUT-B', pass: '0', qty: 4 },
                ],
              }
            }
            return {
              recordset: [
                { materialCode: 'RET-001', docNo: 'OUT-A', pass: '1', qty: 7 },
                { materialCode: 'RET-001', docNo: 'OUT-B', pass: '0', qty: 3 },
              ],
            }
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
          if (/UB_ERP_Bom_000/i.test(sqlText)) {
            return { recordset: [{ materialCode: 'BAG-001', kcaa02: '成品A' }, { materialCode: 'BAG-002', kcaa02: '成品B' }] }
          }
          if (/UB_ERP_Stocks_Storage/i.test(sqlText) && /materialCode/i.test(sqlText)) {
            return {
              recordset: [
                { materialCode: 'RET-001', docNo: 'R-IN-A', pass: '1', qty: 2 },
                { materialCode: 'RET-001', docNo: 'R-IN-B', pass: '0', qty: 1 },
              ],
            }
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

  test('fetchStockInProductionBatchLines uses inbound type 5 for production return', async () => {
    const pool = fakePool()
    const result = await fetchStockInProductionBatchLines(pool, {
      inboundType: '5',
      sourceOrderNo: 'PG-001',
      workshopCode: 'CJ01',
      warehouseCode: 'WH01',
      piNo: 'PI-001',
      dispatchSystemcode: 'SYS-001',
      page: '1',
      pageSize: '20',
      fetchAll: '1',
    })
    assert.equal(result.ok, true)
    assert.equal(result.list.length, 1)
    assert.equal(result.list[0].kcaa01, 'RET-001')
    assert.equal(result.list[0].kcao02, 'SCAK-001')
    assert.equal(result.list[0].issuedQty, 10)
    assert.equal(result.list[0].returnedQty, 3)
    assert.equal(result.list[0].returnableQty, 7)
    assert.equal(result.list[0].tempx, 7)
    assert.equal(result.list[0].selectable, true)
    assert.ok(pool.calls.some((call) => /UB_ERP_Bom_pi_cost/i.test(call.sql)), '生产退料批量添加应按 PI 成本用量展开子料')
    assert.ok(pool.calls.some((call) => /kcap03/i.test(call.sql) && /N'4'/i.test(call.sql)), '生产退料应统计生产领料出库数量')
  })

  test('fetchStockInProductionBatchLines type 5 reuses cutting issue source for workshop 04', async () => {
    const pool = fakePool({
      scaj01: 'PG-001',
      scaj05: '04',
      closed: '0',
      del: '0',
      pass: '1',
      systemcode: 'SYS-001',
    }, { cutting: true })
    const result = await fetchStockInProductionBatchLines(pool, {
      inboundType: '5',
      sourceOrderNo: 'PG-001',
      workshopCode: '04',
      warehouseCode: 'WH01',
      piNo: 'PI-001',
      dispatchSystemcode: 'SYS-001',
      page: '1',
      pageSize: '20',
      fetchAll: '1',
    })
    assert.equal(result.ok, true)
    assert.equal(result.batchMode, 'cutting')
    assert.equal(result.list.length, 1)
    assert.equal(result.list[0].kcaa01, 'CUT-MAT-001')
    assert.equal(result.list[0].kcao02, 'CUT|CUT-MAT-001')
    assert.equal(result.list[0].issuedQty, 10)
    assert.equal(result.list[0].returnedQty, 0)
    assert.equal(result.list[0].returnableQty, 10)
    assert.equal(result.list[0].kcao04, 0)
    assert.ok(pool.calls.some((call) => /cutting_issue/i.test(call.sql)), 'cutting return should reuse cutting issue source')
  })

  test('fetchStockInProductionBatchLines type 5 requires dispatchSystemcode', async () => {
    const pool = fakePool()
    const result = await fetchStockInProductionBatchLines(pool, {
      inboundType: '5',
      sourceOrderNo: 'PG-001',
      workshopCode: 'CJ01',
      warehouseCode: 'WH01',
      piNo: 'PI-001',
      page: '1',
      pageSize: '20',
    })
    assert.equal(result.ok, false)
    assert.equal(result.msg, '参数错误！')
  })

  test('fetchStockInProductionBatchLines type 5 returns legacy message when header missing', async () => {
    const pool = fakePool(null, { headerMissing: true })
    const result = await fetchStockInProductionBatchLines(pool, {
      inboundType: '5',
      sourceOrderNo: 'PG-001',
      workshopCode: 'CJ01',
      warehouseCode: 'WH01',
      piNo: 'PI-001',
      dispatchSystemcode: 'SYS-001',
      page: '1',
      pageSize: '20',
    })
    assert.equal(result.ok, false)
    assert.equal(result.msg, '数据不存在,请联系IT部检查!')
  })

  test('fetchStockInProductionBatchLines type 5 returns legacy message when no dispatch lines', async () => {
    const pool = fakePool(null, { lineTotal: 0 })
    const result = await fetchStockInProductionBatchLines(pool, {
      inboundType: '5',
      sourceOrderNo: 'PG-001',
      workshopCode: 'CJ01',
      warehouseCode: 'WH01',
      piNo: 'PI-001',
      dispatchSystemcode: 'SYS-001',
      page: '1',
      pageSize: '20',
    })
    assert.equal(result.ok, false)
    assert.equal(result.msg, '此订单无清单数据,请检查订单数据!')
  })

  test('fetchStockInProductionBatchLines type 4 still works without dispatchSystemcode', async () => {
    const pool = fakePool()
    const result = await fetchStockInProductionBatchLines(pool, {
      inboundType: '4',
      sourceOrderNo: 'PG-001',
      workshopCode: 'CJ01',
      page: '1',
      pageSize: '20',
    })
    assert.equal(result.ok, true)
    assert.equal(result.list.length, 1)
  })

  test('aggregateProductionReturnRowsByMaterial 同子料合并且可退数量扣减已退料', () => {
    const rows = [
      {
        kcaa01: 'RET-001',
        sourceDemandQty: 20,
        dispatchQty: 10,
        scak02: 'SCAK-001',
        dispatchKcaa01: 'BAG-001',
        info: '成品A',
      },
      {
        kcaa01: 'RET-001',
        sourceDemandQty: 5,
        dispatchQty: 5,
        scak02: 'SCAK-002',
        dispatchKcaa01: 'BAG-002',
        info: '成品B',
      },
    ]
    const merged = aggregateProductionReturnRowsByMaterial(rows, new Set(), {
      issueMap: new Map([['RET-001', { approvedQty: 7, pendingQty: 3 }]]),
      returnMap: new Map([['RET-001', { approvedQty: 2, pendingQty: 1 }]]),
      issuePendingMap: new Map(),
      returnPendingMap: new Map(),
    })
    assert.equal(merged.length, 1)
    assert.equal(merged[0].lineKey, 'material|ret-001')
    assert.equal(merged[0].kcao02, 'SCAK-001')
    assert.equal(merged[0].issuedQty, 10)
    assert.equal(merged[0].returnedQty, 3)
    assert.equal(merged[0].returnableQty, 7)
    assert.equal(merged[0].selectable, true)
    assert.equal(merged[0].info, '成品A / 成品B')
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
