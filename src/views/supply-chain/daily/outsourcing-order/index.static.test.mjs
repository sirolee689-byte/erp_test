import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const source = readFileSync(new URL('./index.vue', import.meta.url), 'utf8')
const formSource = readFileSync(new URL('./AssistOrderEditForm.vue', import.meta.url), 'utf8')

describe('outsourcing-order index static UI contract', () => {
  test('view mode reuses edit form panel read-only', () => {
    assert.match(source, /pageMode === 'view'/)
    assert.match(source, /isReadonlyForm/)
    assert.match(source, /查看外协订单/)
    assert.doesNotMatch(source, /detailVisible/)
    assert.match(source, /:readonly="isReadonlyForm"/)
    assert.match(formSource, /readonly:\s*\{\s*type:\s*Boolean/)
  })

  test('opens two standalone print formats from the selected order-number queue', () => {
    assert.doesNotMatch(source, /openBatchPrint/)
    assert.doesNotMatch(source, /assist-print-dialog/)
    assert.match(source, /openSelectedPrint\('1'\)/)
    assert.match(source, /openSelectedPrint\('0'\)/)
    assert.match(source, /p_sum: selected\.join\(','\)/)
    assert.match(source, /outsourcing-order-print/)
    assert.match(source, /v-permission="'print'"/)
  })

  test('main list keeps the requested leading columns and shows currency name', () => {
    const actionColumnMarker = source.indexOf('class-name="erp-col-actions"')
    const tableStart = source.lastIndexOf('<el-table-column', actionColumnMarker)
    const tableEnd = source.indexOf('</el-table>', tableStart)
    const tableSource = source.slice(tableStart, tableEnd)
    const anchors = [
      'label="操作"',
      'prop="assistOrderNo"',
      'assistTypeText(row.assistType)',
      'isAudited(row)',
      'isClosed(row)',
    ]
    let last = -1
    for (const anchor of anchors) {
      const next = tableSource.indexOf(anchor, last + 1)
      assert.ok(next > last, `主表前置列顺序错误：${anchor}`)
      last = next
    }
    assert.match(tableSource, /prop="currencyName"/)
    assert.match(tableSource, /row\.currencyName \|\| row\.currencyCode/)
  })

  test('expanded detail follows the confirmed warehouse and material column contract', () => {
    const expandStart = source.indexOf('<el-table-column type="expand"')
    const expandEnd = source.indexOf('</el-table>', expandStart)
    const expandedSource = source.slice(expandStart, expandEnd)
    const anchors = [
      'label="',
      'openExpandedLineBom(line)',
      'class="assist-warehouse-cell"',
      'prop="kcaa01"',
      'prop="kcaa02"',
      'prop="kcaa03"',
      'prop="kcaa11"',
      'prop="kcaa04"',
      'prop="wxak03"',
      'prop="wxak04"',
      'prop="wxak041"',
      'prop="wxak05"',
      'prop="wxak051"',
      'prop="tax"',
      'prop="piNo"',
      'prop="product"',
      'prop="describe"',
      'formatDate(line.deliveryDate)',
      'prop="remark"',
    ]
    let last = -1
    for (const anchor of anchors) {
      const next = expandedSource.indexOf(anchor, last + 1)
      assert.ok(next > last, `展开明细缺少或排序错误：${anchor}`)
      last = next
    }
    assert.match(source, /openExpandedLineBom\(line\)/)
    assert.match(source, /toggleWarehouseDetail\(line, 'inbound'\)/)
    assert.match(source, /toggleWarehouseDetail\(line, 'outbound'\)/)
    assert.match(source, /bom-data-window\?mode=detail&code=/)
  })
})
