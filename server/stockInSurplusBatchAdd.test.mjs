import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  buildSurplusBatchKeywordWhere,
  buildSurplusBatchListSql,
  buildSurplusBatchPricesSql,
  enrichSurplusBatchLineWithPrice,
  enrichSurplusBatchRow,
  parseSurplusBatchPage,
} from './stockInSurplusBatchAdd.js'
import { validateStockInPayload } from './stockInSaveLogic.js'

describe('stockInSurplusBatchAdd', () => {
  test('盘盈选材分页默认 10 条且上限 200', () => {
    assert.deepEqual(parseSurplusBatchPage({}), { page: 1, pageSize: 10, startRow: 1, endRow: 10 })
    assert.equal(parseSurplusBatchPage({ pageSize: 500 }).pageSize, 200)
  })

  test('盘盈选材 SQL 只查物料主档，不按库存正数过滤', () => {
    const sqlText = buildSurplusBatchListSql({ keyword: 'OA' })
    assert.match(sqlText, /UB_ERP_Bom_000/)
    assert.match(sqlText, /ROW_NUMBER\(\) OVER/)
    assert.match(sqlText, /COUNT\(1\) OVER \(\) AS totalCount/)
    assert.match(sqlText, /rn BETWEEN @startRow AND @endRow/)
    assert.doesNotMatch(sqlText, /UB_ERP_Stocks_out/i)
    assert.doesNotMatch(sqlText, /actualQty\s*>\s*0/i)
    assert.doesNotMatch(sqlText, /OFFSET/i)
  })

  test('关键字查询仅材料编码 kcaa01 模糊', () => {
    const where = buildSurplusBatchKeywordWhere('kw')
    assert.match(where, /bom\.\[kcaa01\]/)
    assert.doesNotMatch(where, /bom\.\[kcaa02\]/)
    assert.doesNotMatch(where, /bom\.\[kcaa03\]/)
    assert.doesNotMatch(where, /bom\.\[systemcode\]/)
    assert.doesNotMatch(where, / OR /)
  })

  test('最近复核入库价 SQL 按仓库已审已复核取最新价', () => {
    const sqlText = buildSurplusBatchPricesSql(2)
    assert.match(sqlText, /h\.\[kcan06\] = @warehouseCode/)
    assert.match(sqlText, /h\.\[pass\]/)
    assert.match(sqlText, /h\.\[sp_flag\]/)
    assert.match(sqlText, /ROW_NUMBER\(\) OVER \(PARTITION BY l\.\[kcaa01\]/)
    assert.match(sqlText, /@code0, @code1/)
    assert.doesNotMatch(sqlText, /OFFSET/i)
  })

  test('盘盈行可选状态与默认数量价格映射', () => {
    const row = enrichSurplusBatchRow({ systemcode: 'BOM-1', kcaa01: 'M1', kcaa05: 'CAT' }, false)
    assert.equal(row.selectable, true)
    assert.equal(row.lineKey, 'bom-1')
    const picked = enrichSurplusBatchRow({ systemcode: 'BOM-1', kcaa01: 'M1' }, true)
    assert.equal(picked.selectLabel, '已选择')
    const line = enrichSurplusBatchLineWithPrice(row, { kcao04: 10, kcao041: 11.3, tax: 0.13 })
    assert.equal(line.kcao03, 1)
    assert.equal(line.kcao031, 1)
    assert.equal(line.kcao04, 10)
    assert.equal(line.kcao051, 11.3)
  })

  test('保存校验允许类型 7 无关联单号和无来源明细键', () => {
    const ok = validateStockInPayload({
      header: { inboundType: '7', inboundDate: '2026-07-01', warehouseCode: 'WH', paperNo: 'PY-1' },
      lines: [{ kcaa01: 'M1', kcao03: 1, tax: 0 }],
    })
    assert.equal(ok, null)
    assert.match(validateStockInPayload({
      header: { inboundType: '7', inboundDate: '2026-07-01', warehouseCode: 'WH', paperNo: 'PY-1' },
      lines: [{ kcaa01: 'M1', kcao03: 0, tax: 0 }],
    }), /入库数量必须大于 0/)
  })
})
