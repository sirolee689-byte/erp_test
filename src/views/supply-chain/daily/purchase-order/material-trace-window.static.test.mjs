import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const source = readFileSync(new URL('./material-trace-window.vue', import.meta.url), 'utf8')

describe('purchase-order material-trace-window static UI contract', () => {
  test('does not auto load list on mount', () => {
    assert.match(source, /onMounted\(\(\)\s*=>\s*\{\s*loadColumnSetting\(\)/)
    assert.doesNotMatch(source, /onMounted\(\(\)\s*=>\s*\{[\s\S]*?loadList\(/)
    assert.match(source, /traceEverQueried/)
  })

  test('uses viewport bottom horizontal scroll like manage list', () => {
    assert.match(source, /<ErpTableViewportHScroll>/)
    assert.match(source, /class="erp-list-table buy-trace-table"/)
    assert.match(source, /refreshErpTableViewportHScroll/)
  })

  test('shows empty hint before first search', () => {
    assert.match(source, /请输入关键字后点「立即查询」/)
    assert.match(source, /onPageSizeChange/)
    assert.match(source, /if \(!traceEverQueried\.value\) return/)
  })

  test('does not render operation column or openSource', () => {
    assert.doesNotMatch(source, /label="操作"/)
    assert.doesNotMatch(source, /openSource/)
  })

  test('has column setting and export like stock stats', () => {
    assert.match(source, />列设置</)
    assert.match(source, />导出信息</)
    assert.match(source, /TRACE_COLUMN_SETTING_KEY/)
    assert.match(source, /exportReportXlsx/)
    assert.match(source, /visibleTraceColumns/)
  })

  test('numeric columns use erp number display trim', () => {
    assert.match(source, /formatErpQtyDisplay/)
    assert.match(source, /formatErpPriceDisplay/)
    assert.match(source, /key: 'sale_price'[\s\S]*format: 'price'/)
    assert.match(source, /formatTraceCell/)
  })
})
