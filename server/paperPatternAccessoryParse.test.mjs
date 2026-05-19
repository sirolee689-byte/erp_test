import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, test } from 'node:test'
import {
  filterAccessoriesForCommitColor,
  flattenAccessoriesForDisplay,
  isAccessorySeqToken,
  resolveAccessoryCodesByColorFromRow,
  resolveAccessoryErpCodesFromRow,
  tryParseAccessoryRow,
} from './paperPatternAccessoryParse.js'
import { parsePaperPatternImportTreeFromBuffer } from './paperPatternImportParse.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SAMPLE_XLS = join(__dirname, '..', 'docs', 'PQ-3672A1-TEST - 副本.xls')

/** @param {Array<[number, string]>} pairs */
function accessoryExcelRow(pairs) {
  return {
    rowIndex: 80,
    cells: pairs.map(([colIndex, value]) => ({ colIndex, value })),
  }
}

const COLOR_SOURCES = [
  { colorNo: 'G-TEST', excelCol: 'N', colIndex: 14 },
  { colorNo: 'VE-TEST', excelCol: 'O', colIndex: 15 },
  { colorNo: 'BLU2-TEST', excelCol: 'P', colIndex: 16 },
]

describe('isAccessorySeqToken', () => {
  test('纯数字', () => {
    assert.equal(isAccessorySeqToken('47'), true)
    assert.equal(isAccessorySeqToken('1-1'), false)
  })
})

describe('resolveAccessoryCodesByColorFromRow', () => {
  test('三色相同保留三行（各带 colorNo）', () => {
    const row = accessoryExcelRow([
      [1, '1'],
      [14, 'ZS-0034/CFL'],
      [15, 'ZS-0034/CFL'],
      [16, 'ZS-0034/CFL'],
    ])
    const items = resolveAccessoryCodesByColorFromRow(row, COLOR_SOURCES)
    assert.equal(items.length, 3)
    assert.deepEqual(
      items.map((x) => x.colorNo),
      ['G-TEST', 'VE-TEST', 'BLU2-TEST'],
    )
    assert.ok(items.every((x) => x.erpCode === 'ZS-0034/CFL'))
  })

  test('三色不同保留三条', () => {
    const row = accessoryExcelRow([
      [1, '47'],
      [14, 'KT-CA6592B2BM-S-4/G'],
      [15, 'KT-CA6592B2BM-S-4/VE'],
      [16, 'KT-CA6592B2BM-S-4/BLU2'],
    ])
    const items = resolveAccessoryCodesByColorFromRow(row, COLOR_SOURCES)
    assert.equal(items.length, 3)
    assert.equal(items[0].erpCode, 'KT-CA6592B2BM-S-4/G')
    assert.equal(items[0].colorNo, 'G-TEST')
    assert.equal(items[2].colorNo, 'BLU2-TEST')
  })
})

describe('resolveAccessoryErpCodesFromRow', () => {
  test('去重后的 ERP 列表', () => {
    const row = accessoryExcelRow([
      [1, '1'],
      [14, 'ZS-0034/CFL'],
      [15, 'ZS-0034/CFL'],
      [16, 'ZS-0034/CFL'],
    ])
    assert.deepEqual(resolveAccessoryErpCodesFromRow(row, COLOR_SOURCES), ['ZS-0034/CFL'])
  })
})

describe('flattenAccessoriesForDisplay', () => {
  test('codesByColor 展平含 colorNo', () => {
    const flat = flattenAccessoriesForDisplay([
      {
        seqNo: '47',
        codesByColor: [
          { colorNo: 'G-TEST', colIndex: 14, erpCode: 'A/G' },
          { colorNo: 'VE-TEST', colIndex: 15, erpCode: 'A/VE' },
        ],
        accessoryName: '扣',
        usageQty: '1',
        wastage: '',
        lineTotal: '',
        matching: '',
      },
    ])
    assert.equal(flat.length, 2)
    assert.equal(flat[0].seqNo, '47')
    assert.equal(flat[0].erpCode, 'A/G')
    assert.equal(flat[0].colorNo, 'G-TEST')
    assert.equal(flat[1].colorNo, 'VE-TEST')
  })
})

describe('filterAccessoriesForCommitColor', () => {
  test('按 colorNo 过滤', () => {
    const all = [
      { seqNo: '27', erpCode: 'TC-0001/CH208A', colorNo: 'G-TEST' },
      { seqNo: '27', erpCode: 'TC-0001/CH716', colorNo: 'VE-TEST' },
      { seqNo: '1', erpCode: 'ZS-0034/CFL', colorNo: 'G-TEST' },
    ]
    const g = filterAccessoriesForCommitColor(all, 'G-TEST')
    assert.equal(g.length, 2)
    assert.ok(g.every((x) => x.colorNo === 'G-TEST'))
  })
})

describe('parsePaperPatternImportTreeFromBuffer Accessory', () => {
  test('PQ-3672A1 样表 Accessory 展平', () => {
    const buf = readFileSync(SAMPLE_XLS)
    const tree = parsePaperPatternImportTreeFromBuffer(buf, { importTypeFlag5: 'BAG' })
    const acc = tree.accessories
    assert.ok(acc.length > 0)
    const seq1 = acc.filter((a) => a.seqNo === '1')
    assert.equal(seq1.length, 3)
    assert.ok(seq1.every((a) => a.erpCode === 'ZS-0034/CFL'))
    assert.deepEqual(
      seq1.map((a) => a.colorNo).sort(),
      ['BLU2-TEST', 'G-TEST', 'VE-TEST'].sort(),
    )
    const seq47 = acc.filter((a) => a.seqNo === '47')
    const erp47 = seq47.map((a) => a.erpCode).sort()
    assert.equal(seq47.length, 3)
    assert.ok(erp47.some((c) => c.includes('/G')))
    assert.ok(erp47.some((c) => c.includes('/VE')))
    assert.ok(erp47.some((c) => c.includes('/BLU2')))
  })
})
