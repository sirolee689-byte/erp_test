import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { buildStockOutAvailabilitySql, calcAvailableQty } from './stockOutAvailability.js'

describe('stockOutAvailability', () => {
  test('可用库存等于已审入库减已审出库再减未审占用', () => {
    assert.equal(calcAvailableQty({ approvedInQty: 100, approvedOutQty: 30, pendingOutQty: 20 }), 50)
    assert.equal(calcAvailableQty({ approvedInQty: 10, approvedOutQty: 30, pendingOutQty: 20 }), 0)
  })

  test('库存 SQL 按 2008 R2 语法聚合并支持排除当前出库单', () => {
    const sql = buildStockOutAvailabilitySql({ excludeOutboundNo: 'C26062401' })
    assert.match(sql, /UB_ERP_Stocks_Storage/i)
    assert.match(sql, /UB_ERP_Stocks_out/i)
    assert.match(sql, /approvedInQty/i)
    assert.match(sql, /pendingOutQty/i)
    assert.match(sql, /@excludeOutboundNo/i)
    assert.doesNotMatch(sql, /TRY_CONVERT|OFFSET|FORMAT|IIF|CONCAT/i)
  })
})

