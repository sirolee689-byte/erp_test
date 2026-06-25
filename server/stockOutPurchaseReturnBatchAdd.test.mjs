import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  computePurchaseReturnPool,
  computePurchaseReturnableQty,
  fetchStockOutPurchaseReturnBatchLines,
  resolvePurchaseReturnSelectState,
} from './stockOutPurchaseReturnBatchAdd.js'
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
          if (/COUNT\(1\)/i.test(sqlText) && /Buy_order_list/i.test(sqlText)) {
            return { recordset: [{ total: 1 }] }
          }
          if (/WITH base AS/i.test(sqlText) && /Buy_order_list/i.test(sqlText)) {
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
                  kcak05: 1000,
                  kcak051: 1130,
                  tax: 0.13,
                  kcaa01: 'MAT-001',
                  kcaa02: '测试物料',
                  kcaa03: '规格A',
                  kcaa04: 'PCS',
                  kcaa11: '红色',
                  kcaa26: 1,
                  kcaa27: '0',
                  Reference: 'PI-001',
                  info: '行备注',
                  rn: 1,
                },
              ],
            }
          }
          if (/GROUP BY l\.\[kcao02\]/i.test(sqlText)) {
            return { recordset: [{ detailKey: 'BOM-001', approvedInQty: 50 }] }
          }
          if (/GROUP BY l\.\[kcaq02\]/i.test(sqlText)) {
            return { recordset: [{ detailKey: 'BOM-001', approvedReturnOutQty: 10, pendingReturnOutQty: 5 }] }
          }
          if (/approvedInQty/i.test(sqlText) && /approvedOutQty/i.test(sqlText) && /materialCode/i.test(sqlText)) {
            return {
              recordset: [{
                materialCode: 'MAT-001',
                approvedInQty: 80,
                approvedOutQty: 20,
                pendingOutQty: 10,
              }],
            }
          }
          return { recordset: [] }
        },
      }
    },
  }
}

describe('stockOutPurchaseReturnBatchAdd', () => {
  test('computePurchaseReturnPool subtracts approved and pending return out', () => {
    assert.equal(computePurchaseReturnPool({ approvedIn: 50, approvedReturnOut: 10, pendingReturnOut: 5 }), 35)
    assert.equal(computePurchaseReturnPool({ approvedIn: 5, approvedReturnOut: 10, pendingReturnOut: 0 }), 0)
  })

  test('computePurchaseReturnableQty caps by warehouse stock', () => {
    assert.equal(computePurchaseReturnableQty({ poolQty: 35, warehouseActualQty: 100 }), 35)
    assert.equal(computePurchaseReturnableQty({ poolQty: 35, warehouseActualQty: 20 }), 20)
    assert.equal(computePurchaseReturnableQty({ poolQty: 0, warehouseActualQty: 20 }), 0)
  })

  test('resolvePurchaseReturnSelectState', () => {
    assert.equal(resolvePurchaseReturnSelectState({ returnableQty: 5, alreadySelected: false }).selectLabel, '选择')
    assert.equal(resolvePurchaseReturnSelectState({ returnableQty: 0, alreadySelected: false }).selectLabel, '库存不足')
    assert.equal(resolvePurchaseReturnSelectState({ returnableQty: 5, alreadySelected: true }).selectLabel, '已选择')
  })

  test('fetchStockOutPurchaseReturnBatchLines maps returnable qty', async () => {
    const pool = fakePool()
    const result = await fetchStockOutPurchaseReturnBatchLines(pool, {
      sourceOrderNo: 'PO-001',
      supplierCode: 'S01',
      warehouseCode: 'WH01',
      page: 1,
      pageSize: 20,
    })
    assert.equal(result.ok, true)
    assert.equal(result.list.length, 1)
    const row = result.list[0]
    // pool = 50 - 10 - 5 = 35; warehouse actual = 80 - 20 - 10 = 50; min = 35
    assert.equal(row.poolQty, 35)
    assert.equal(row.returnableQty, 35)
    assert.equal(row.selectable, true)
    assert.equal(row.sourceLineCode, 'BOM-001')
    assert.equal(row.kcaq04, 10)
    assert.equal(row.kcaq05, 350)
  })

  test('fetchStockOutPurchaseReturnBatchLines validates required params', async () => {
    const pool = fakePool()
    const r1 = await fetchStockOutPurchaseReturnBatchLines(pool, { supplierCode: 'S', warehouseCode: 'W' })
    assert.equal(r1.ok, false)
    assert.match(r1.msg, /采购单/)
  })

  test('source uses warehouse and detail key filters', () => {
    const source = readFileSync(new URL('./stockOutPurchaseReturnBatchAdd.js', import.meta.url), 'utf8')
    assert.match(source, /kcan06/)
    assert.match(source, /kcap06/)
    assert.match(source, /kcao02/)
    assert.match(source, /kcaq02/)
    assert.match(source, /computePurchaseReturnPool/)
  })
})
