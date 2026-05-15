import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readCutMetricColumnsByExcelCol, readExcelColNorm } from './paperPatternImportCutRow.js'

function rowFromCols(pairs) {
  return {
    rowIndex: 9,
    cells: pairs.map(([colIndex, value]) => ({ colIndex, value: String(value) })),
  }
}

describe('paperPatternImportCutRow', () => {
  it('按 Excel 列号读取第 3～13 列', () => {
    const row = rowFromCols([
      [1, '1-1'],
      [2, '挽手面包'],
      [3, '4.449'],
      [4, '4.739'],
      [5, '1'],
      [6, '1.5'],
      [7, '0.12'],
      [8, '5%'],
      [9, '0.126'],
      [10, '10'],
      [11, '100'],
      [12, 'A+B'],
      [13, '码'],
    ])
    const m = readCutMetricColumnsByExcelCol(row)
    assert.equal(m.length, '4.449')
    assert.equal(m.width, '4.739')
    assert.equal(m.quantity, '1')
    assert.equal(m.fabricWidth, '1.5')
    assert.equal(m.unitConsumption, '0.12')
    assert.equal(m.wastage, '5%')
    assert.equal(m.actualConsumption, '0.126')
    assert.equal(m.unitPrice, '10')
    assert.equal(m.totalAmount, '100')
    assert.equal(m.matching, 'A+B')
    assert.equal(m.unit, '码')
  })

  it('第 12 列（Material 备注）可读', () => {
    const row = rowFromCols([
      [1, '1'],
      [2, '主皮'],
      [11, 'LA-0368/N'],
      [12, '颜色要求'],
    ])
    assert.equal(readExcelColNorm(row, 12), '颜色要求')
  })

  it('缺列返回空串', () => {
    const row = rowFromCols([[1, '2-1'], [2, 'x']])
    const m = readCutMetricColumnsByExcelCol(row)
    assert.equal(m.length, '')
    assert.equal(readExcelColNorm(row, 99), '')
  })
})
