import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, test } from 'node:test'
import {
  extractColorNosFromRow4,
  normalizeColorNoFromCell,
  parsePaperPatternImportTreeFromBuffer,
  PAPER_PATTERN_COLOR_ROW_INDEX,
  PAPER_PATTERN_COLOR_START_COL_INDEX,
  tryParseMaterialRow,
} from './paperPatternImportParse.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SAMPLE_XLS = join(__dirname, '..', 'docs', 'PQ-3672A1-TEST - 副本.xls')

function row4WithCells(pairs) {
  const cells = pairs.map(([colIndex, value]) => ({ colIndex, value }))
  return [{ rowIndex: PAPER_PATTERN_COLOR_ROW_INDEX, cells }]
}

describe('normalizeColorNoFromCell', () => {
  test('混排截断至首个汉字前', () => {
    assert.equal(normalizeColorNoFromCell('G-TEST黄色'), 'G-TEST')
    assert.equal(normalizeColorNoFromCell('VE-TEST 绿'), 'VE-TEST')
    assert.equal(normalizeColorNoFromCell('R-TEST'), 'R-TEST')
  })
})

describe('extractColorNosFromRow4', () => {
  test('N4/O4 两色，P4 空则停止', () => {
    const rows = row4WithCells([
      [PAPER_PATTERN_COLOR_START_COL_INDEX, 'G-TEST黄色'],
      [15, 'VE-TEST 绿'],
      [16, ''],
    ])
    const { colorNos } = extractColorNosFromRow4(rows)
    assert.deepEqual(colorNos, ['G-TEST', 'VE-TEST'])
  })

  test('leading 空：N4 空 O4 有色', () => {
    const rows = row4WithCells([
      [PAPER_PATTERN_COLOR_START_COL_INDEX, ''],
      [15, 'G-TEST黄色'],
    ])
    const { colorNos } = extractColorNosFromRow4(rows)
    assert.deepEqual(colorNos, ['G-TEST'])
  })

  test('中间空单元格停止，不读 P4', () => {
    const rows = row4WithCells([
      [PAPER_PATTERN_COLOR_START_COL_INDEX, 'G-TEST'],
      [15, ''],
      [16, 'VE-TEST'],
    ])
    const { colorNos } = extractColorNosFromRow4(rows)
    assert.deepEqual(colorNos, ['G-TEST'])
  })

  test('无色号行返回空数组', () => {
    const { colorNos } = extractColorNosFromRow4([{ rowIndex: 5, cells: [{ colIndex: 14, value: 'X' }] }])
    assert.deepEqual(colorNos, [])
  })
})

/** @param {Array<[number, string]>} pairs */
function materialExcelRow(pairs) {
  return {
    rowIndex: 6,
    cells: pairs.map(([colIndex, value]) => ({ colIndex, value })),
  }
}

describe('tryParseMaterialRow', () => {
  test('仅 N 列取基码；codesByColor 含 N/O/P 全码', () => {
    const row = materialExcelRow([
      [1, '1'],
      [2, '主皮'],
      [14, 'LA-0368/G3'],
      [15, 'LA-0368/VE12'],
      [16, 'LA-0368/BLU2'],
    ])
    const colorSources = [
      { colorNo: 'G-TEST', excelCol: 'N' },
      { colorNo: 'VE-TEST', excelCol: 'O' },
      { colorNo: 'BLU2-TEST', excelCol: 'P' },
    ]
    const m = tryParseMaterialRow(row, colorSources)
    assert.ok(m)
    assert.equal(m.groupNo, '1')
    assert.equal(m.materialName, '主皮')
    assert.equal(m.materialCode, 'LA-0368')
    assert.deepEqual(
      m.codesByColor.map((x) => x.materialCode),
      ['LA-0368/G3', 'LA-0368/VE12', 'LA-0368/BLU2'],
    )
  })

  test('1-1 不是 Material 行', () => {
    const row = materialExcelRow([
      [1, '1-1'],
      [2, '裁片'],
      [14, 'LA-0368/G3'],
    ])
    assert.equal(tryParseMaterialRow(row), null)
  })

  test('N 列为空则 ERP 为空', () => {
    const row = materialExcelRow([
      [1, '2'],
      [2, '主里'],
      [16, 'BP-0001/956'],
    ])
    const m = tryParseMaterialRow(row)
    assert.ok(m)
    assert.equal(m.materialCode, '')
  })
})

describe('parsePaperPatternImportTreeFromBuffer Material', () => {
  test('PQ-3672A1 样表前几组 N 列基码', () => {
    const buf = readFileSync(SAMPLE_XLS)
    const tree = parsePaperPatternImportTreeFromBuffer(buf, { importTypeFlag5: 'BAG' })
    const byGroup = new Map(tree.materials.map((m) => [m.groupNo, m.materialCode]))
    assert.equal(byGroup.get('1'), 'LA-0368')
    assert.equal(byGroup.get('2'), 'BP-0001')
    assert.equal(byGroup.get('3'), 'NN-0021')
    assert.equal(byGroup.get('5'), 'BP-0038')
    const accIdx = tree.materials.findIndex((m) => String(m.materialName).includes('Accessory'))
    assert.equal(accIdx, -1)
  })

  test('PQ-3672A1 分组1 三色全码', () => {
    const buf = readFileSync(SAMPLE_XLS)
    const tree = parsePaperPatternImportTreeFromBuffer(buf, { importTypeFlag5: 'BAG' })
    const g1 = tree.materials.find((m) => m.groupNo === '1')
    assert.ok(g1?.codesByColor?.length >= 3)
    const byColor = new Map(g1.codesByColor.map((x) => [x.colorNo, x.materialCode]))
    assert.equal(byColor.get('G-TEST'), 'LA-0368/G3')
    assert.equal(byColor.get('VE-TEST'), 'LA-0368/VE12')
    assert.ok(String(byColor.get('BLU2-TEST') ?? '').startsWith('LA-0368/'))
  })
})
