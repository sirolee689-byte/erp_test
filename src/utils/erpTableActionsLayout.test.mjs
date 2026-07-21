import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  getErpTableActionsColCount,
  getErpTableActionsColMinWidth,
  getErpTableActionsColWidthByLabels,
  getErpTableActionsColWidthByRows,
  erpTableActionsGridClass,
} from './erpTableActionsLayout.js'

test('getErpTableActionsColCount: n<7 每行最多 3', () => {
  assert.equal(getErpTableActionsColCount(0), 1)
  assert.equal(getErpTableActionsColCount(1), 1)
  assert.equal(getErpTableActionsColCount(3), 3)
  assert.equal(getErpTableActionsColCount(6), 3)
})

test('按按钮文案估宽：查看权限只保留查看按钮，右侧留白为 5px', () => {
  assert.equal(getErpTableActionsColWidthByLabels(['查看']), 59)
  assert.equal(getErpTableActionsColWidthByLabels(['彻底删除']), 85)
})

test('singleRow：两按钮按同一行估宽（不按两行折列）', () => {
  const wrapped = getErpTableActionsColWidthByLabels(['查看', '反审'])
  const single = getErpTableActionsColWidthByLabels(['查看', '反审'], { singleRow: true })
  // 两按钮时默认也是 2 列，单行与默认应一致
  assert.equal(single, wrapped)
  assert.ok(single > getErpTableActionsColWidthByLabels(['查看']))
})

test('forceCols: 4 时未审核五行估宽大于默认 3 列', () => {
  const labels = ['查看', '一键运算', '编辑', '审核', '删除']
  const defaultW = getErpTableActionsColWidthByLabels(labels)
  const forcedW = getErpTableActionsColWidthByLabels(labels, { forceCols: 4 })
  assert.ok(forcedW > defaultW)
})

test('按当前页各行实际可见操作取最大宽度', () => {
  const rows = [{ audited: true }, { audited: false }]
  const width = getErpTableActionsColWidthByRows(rows, (row) => (
    row.audited ? ['查看', '反审', '打印选择'] : ['查看']
  ))
  assert.equal(width, getErpTableActionsColWidthByLabels(['查看', '反审', '打印选择']))
})

test('getErpTableActionsColCount: n>=7 为 ceil(n/2)', () => {
  assert.equal(getErpTableActionsColCount(7), 4)
  assert.equal(getErpTableActionsColCount(8), 4)
  assert.equal(getErpTableActionsColCount(9), 5)
  assert.equal(getErpTableActionsColCount(10), 5)
})

test('erpTableActionsGridClass', () => {
  assert.equal(erpTableActionsGridClass(7), 'erp-table-actions--cols-4')
})

test('getErpTableActionsColMinWidth: 按列数估宽', () => {
  assert.equal(getErpTableActionsColMinWidth(5, { compact: true }), 259)
  assert.equal(getErpTableActionsColMinWidth(7, { compact: true }), 341)
  assert.equal(getErpTableActionsColMinWidth(3, { compact: true }), 259)
})
