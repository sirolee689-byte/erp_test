import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { excelColumnIndexFromLetters } from './paperPatternImportPreview.js'
import {
  buildMaterialCodesByColor,
  resolveCommitColorNos,
  resolveMaterialsForCommitColor,
  validateMaterialCodesByColorForCommit,
} from './paperPatternMaterialCodesByColor.js'

describe('excelColumnIndexFromLetters', () => {
  test('N=14 O=15', () => {
    assert.equal(excelColumnIndexFromLetters('N'), 14)
    assert.equal(excelColumnIndexFromLetters('O'), 15)
  })
})

describe('buildMaterialCodesByColor', () => {
  test('与 colorSources 列对齐', () => {
    const row = {
      rowIndex: 6,
      cells: [
        { colIndex: 14, value: 'LA-0368/G3' },
        { colIndex: 15, value: 'LA-0368/VE12' },
        { colIndex: 16, value: 'LA-0368/BLU2' },
      ],
    }
    const colorSources = [
      { colorNo: 'G-TEST', excelCol: 'N' },
      { colorNo: 'VE-TEST', excelCol: 'O' },
      { colorNo: 'BLU2-TEST', excelCol: 'P' },
    ]
    const codes = buildMaterialCodesByColor(row, colorSources)
    assert.deepEqual(
      codes.map((c) => c.materialCode),
      ['LA-0368/G3', 'LA-0368/VE12', 'LA-0368/BLU2'],
    )
  })
})

describe('validateMaterialCodesByColorForCommit', () => {
  test('空列报错', () => {
    const materials = [
      {
        groupNo: '1',
        codesByColor: [
          { colorNo: 'G-TEST', materialCode: 'LA-0368/G3' },
          { colorNo: 'VE-TEST', materialCode: '' },
        ],
      },
    ]
    const r = validateMaterialCodesByColorForCommit(materials, ['G-TEST', 'VE-TEST'])
    assert.equal(r.ok, false)
    assert.equal(r.code, 'MATERIAL_COLOR_CELL_EMPTY')
  })
})

describe('resolveMaterialsForCommitColor', () => {
  test('按色取全码', () => {
    const materials = [
      {
        groupNo: '1',
        materialCode: 'LA-0368',
        codesByColor: [
          { colorNo: 'G-TEST', materialCode: 'LA-0368/G3' },
          { colorNo: 'VE-TEST', materialCode: 'LA-0368/VE12' },
        ],
      },
    ]
    const g = resolveMaterialsForCommitColor(materials, 'G-TEST')
    assert.equal(g[0].materialCode, 'LA-0368/G3')
    const v = resolveMaterialsForCommitColor(materials, 'VE-TEST')
    assert.equal(v[0].materialCode, 'LA-0368/VE12')
  })
})

describe('resolveCommitColorNos', () => {
  test('优先 colorNos 数组', () => {
    assert.deepEqual(resolveCommitColorNos({ colorNos: ['A', 'B'], colorNo: 'X' }), ['A', 'B'])
  })
})
