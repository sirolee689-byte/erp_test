import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  buildOtherInboundBatchListSql,
  buildOtherInboundStockAggCteSql,
  enrichOtherInboundBatchRow,
  parseOtherInboundBatchPage,
} from './stockInOtherBatchAdd.js'

describe('stockInOtherBatchAdd', () => {
  test('buildOtherInboundBatchListSql joins bom with stock aggregates', () => {
    const sqlText = buildOtherInboundBatchListSql({ keyword: 'abc' })
    assert.match(sqlText, /inAgg AS/)
    assert.match(sqlText, /outAgg AS/)
    assert.match(sqlText, /FROM dbo\.\[UB_ERP_Bom_000\] AS bom/)
    assert.match(sqlText, /LEFT JOIN inAgg AS i/)
    assert.match(sqlText, /LEFT JOIN outAgg AS o/)
    assert.match(sqlText, /ROW_NUMBER\(\) OVER/)
    assert.match(sqlText, /COUNT\(1\) OVER \(\) AS totalCount/)
    assert.doesNotMatch(sqlText, /OFFSET/)
  })

  test('buildOtherInboundStockAggCteSql groups by kcaa01 and warehouse', () => {
    const sqlText = buildOtherInboundStockAggCteSql()
    assert.match(sqlText, /ih\.\[kcan06\] = @warehouseCode/)
    assert.match(sqlText, /oh\.\[kcap06\] = @warehouseCode/)
    assert.match(sqlText, /GROUP BY il\.\[kcaa01\]/)
    assert.match(sqlText, /GROUP BY ol\.\[kcaa01\]/)
  })

  test('enrichOtherInboundBatchRow always selectable unless already picked', () => {
    const row = enrichOtherInboundBatchRow({
      kcaa01: 'M1',
      systemcode: 'GUID-1',
      approvedInQty: 0,
      approvedOutQty: 0,
      pendingOutQty: 0,
    })
    assert.equal(row.selectLabel, '选择')
    assert.equal(row.selectable, true)
    assert.equal(row.bookQty, 0)
    assert.equal(row.actualQty, 0)

    const picked = enrichOtherInboundBatchRow({
      kcaa01: 'M1',
      systemcode: 'GUID-1',
      approvedInQty: 10,
      approvedOutQty: 2,
      pendingOutQty: 3,
    }, true)
    assert.equal(picked.selectLabel, '已选择')
    assert.equal(picked.selectable, false)
    assert.equal(picked.bookQty, 8)
    assert.equal(picked.actualQty, 5)
  })

  test('parseOtherInboundBatchPage defaults to 10', () => {
    assert.deepEqual(parseOtherInboundBatchPage({}), { page: 1, pageSize: 10, startRow: 1, endRow: 10 })
  })
})
