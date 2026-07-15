import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildStockStatsReportTempTableSql,
  normalizeStockStatsCategoryCodes,
} from './stockStatsHandlers.js'

test('库存统计类别参数支持逗号、多值数组并去重', () => {
  assert.deepEqual(normalizeStockStatsCategoryCodes(' 001,002,001,, 003 '), ['001', '002', '003'])
  assert.deepEqual(normalizeStockStatsCategoryCodes(['001', ' 002 ', '', '001']), ['001', '002'])
})

test('库存统计多类别使用参数化临时表并按入库明细 kcaa05 过滤', () => {
  const sqlText = buildStockStatsReportTempTableSql(['selectedCategory0', 'selectedCategory1'])

  assert.match(sqlText, /CREATE TABLE #selectedCategory/)
  assert.match(sqlText, /@selectedCategory0/)
  assert.match(sqlText, /@selectedCategory1/)
  assert.match(sqlText, /selectedCategory\.\[code\].*\[kcaa05\]/s)
  assert.match(sqlText, /AND NOT EXISTS \(SELECT 1 FROM #selectedCategory\)/)
  assert.equal((sqlText.match(/FROM #selectedCategory AS selectedCategory/g) || []).length, 4)
  assert.doesNotMatch(sqlText, /r\.\[kcaa05\] LIKE @materialCategoryLike/)
})

test('库存统计全部仓库使用参数化开关，不把全部仓库作为实际仓库编码过滤', () => {
  const sqlText = buildStockStatsReportTempTableSql([])
  assert.match(sqlText, /@allWarehouse = 1/)
})
