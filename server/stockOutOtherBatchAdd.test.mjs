import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  buildOtherBatchKeywordWhere,
  buildOtherBatchListSql,
  buildOtherBatchPriceSql,
  buildOtherBatchPricesSql,
  calcOtherBatchStockQty,
  enrichOtherBatchLineWithPrice,
  enrichOtherBatchRow,
  formatMaterialPassLabel,
  formatPurchaseDirection,
  parseOtherBatchPage,
} from './stockOutOtherBatchAdd.js'

describe('stockOutOtherBatchAdd', () => {
  test('calcOtherBatchStockQty computes book and actual qty', () => {
    const r = calcOtherBatchStockQty({ approvedInQty: 100, approvedOutQty: 30, pendingOutQty: 20 })
    assert.equal(r.bookQty, 70)
    assert.equal(r.actualQty, 50)
    assert.equal(r.selectable, true)
    assert.equal(r.displayActualQty, 50)
  })

  test('calcOtherBatchStockQty marks non-positive actual as not selectable', () => {
    const r = calcOtherBatchStockQty({ approvedInQty: 10, approvedOutQty: 8, pendingOutQty: 5 })
    assert.equal(r.actualQty, -3)
    assert.equal(r.displayActualQty, 0)
    assert.equal(r.selectable, false)
  })

  test('parseOtherBatchPage defaults to 5 and caps at 200', () => {
    assert.deepEqual(parseOtherBatchPage({}), { page: 1, pageSize: 5, startRow: 1, endRow: 5 })
    assert.equal(parseOtherBatchPage({ pageSize: 500 }).pageSize, 200)
  })

  test('buildOtherBatchListSql groups by materialCode and uses ROW_NUMBER', () => {
    const sqlText = buildOtherBatchListSql({ keyword: 'abc' })
    assert.match(sqlText, /materialBase/)
    assert.match(sqlText, /GROUP BY/)
    assert.match(sqlText, /ROW_NUMBER\(\) OVER/)
    assert.match(sqlText, /COUNT\(1\) OVER \(\) AS totalCount/)
    assert.match(sqlText, /rn BETWEEN @startRow AND @endRow/)
    assert.match(sqlText, /il\.\[kcao01\] = ih\.\[kcan01\]/)
    assert.doesNotMatch(sqlText, /OFFSET/)
  })

  test('buildOtherBatchPriceSql uses direct join and partition by material', () => {
    const sqlText = buildOtherBatchPriceSql()
    assert.match(sqlText, /lp\.\[kcao01\] = lh\.\[kcan01\]/)
    assert.match(sqlText, /lp\.\[kcaa01\] = @materialCode/)
    assert.match(sqlText, /ROW_NUMBER\(\) OVER \(PARTITION BY lp\.\[kcaa01\]/)
    assert.match(sqlText, /sp_flag/)
  })

  test('buildOtherBatchPricesSql batches IN clause', () => {
    const sqlText = buildOtherBatchPricesSql(3)
    assert.match(sqlText, /@code0, @code1, @code2/)
    assert.match(sqlText, /WHERE rn = 1/)
  })

  test('buildOtherBatchKeywordWhere searches bom and materialCode', () => {
    const where = buildOtherBatchKeywordWhere('kw')
    assert.match(where, /sc\.\[materialCode\] LIKE @keyword/)
    assert.match(where, /bom\.\[kcaa01\]/)
    assert.match(where, /bom\.\[systemcode\]/)
  })

  test('enrichOtherBatchRow maps select states', () => {
    const selectable = enrichOtherBatchRow({ materialCode: 'M1', approvedInQty: 10, approvedOutQty: 2, pendingOutQty: 3 })
    assert.equal(selectable.selectLabel, '选择')
    assert.equal(selectable.selectState, 'select')
    const picked = enrichOtherBatchRow({ materialCode: 'M1', approvedInQty: 10, approvedOutQty: 2, pendingOutQty: 3, alreadySelected: true })
    assert.equal(picked.selectLabel, '已选择')
    const shortage = enrichOtherBatchRow({ materialCode: 'M2', approvedInQty: 5, approvedOutQty: 4, pendingOutQty: 2 })
    assert.equal(shortage.selectLabel, '库存不足')
  })

  test('enrichOtherBatchLineWithPrice fills qty and amounts', () => {
    const line = enrichOtherBatchLineWithPrice(
      { materialCode: 'M1', actualQty: 2, kcaa01: 'M1' },
      { kcaq04: 10, kcaq041: 11.3, tax: 0.13 },
    )
    assert.equal(line.kcaq03, 2)
    assert.equal(line.kcaq031, 2)
    assert.equal(line.kcaq05, 20)
    assert.equal(line.kcaq051, 22.6)
  })

  test('format helpers', () => {
    assert.equal(formatMaterialPassLabel('1'), '已审核')
    assert.equal(formatPurchaseDirection('1'), '使用->采购')
    assert.equal(formatPurchaseDirection('0'), '采购->使用')
  })
})
