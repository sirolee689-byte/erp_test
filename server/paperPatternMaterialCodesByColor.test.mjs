import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { excelColumnIndexFromLetters } from './paperPatternImportPreview.js'
import {
  buildMaterialCodesByColor,
  excelColumnLettersFromIndex,
  materialErpPrefix,
  resolveCommitColorNos,
  resolveMaterialsForCommitColor,
  validateMaterialCodesByColorForCommit,
  validateMaterialPrefixConsistency,
} from './paperPatternMaterialCodesByColor.js'

describe('excelColumnIndexFromLetters', () => {
  test('N=14 O=15', () => {
    assert.equal(excelColumnIndexFromLetters('N'), 14)
    assert.equal(excelColumnIndexFromLetters('O'), 15)
    assert.equal(excelColumnLettersFromIndex(14), 'N')
    assert.equal(excelColumnLettersFromIndex(15), 'O')
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

describe('validateMaterialPrefixConsistency', () => {
  test('同一 Material 行分色全码前缀必须一致', () => {
    const materials = [
      {
        groupNo: '1',
        materialName: '主皮',
        codesByColor: [
          { colorNo: 'G3', colIndex: 14, materialCode: 'LA-0368/G3' },
          { colorNo: 'VE12', colIndex: 15, materialCode: 'LA-0369/VE12' },
          { colorNo: 'BLU2', colIndex: 16, materialCode: 'LA-0368/BLU2' },
          { colorNo: 'MO', colIndex: 17, materialCode: 'LA-0368/MO' },
        ],
      },
    ]
    const r = validateMaterialPrefixConsistency(materials, ['G3', 'VE12', 'BLU2', 'MO'])
    assert.equal(r.ok, false)
    assert.equal(r.code, 'MATERIAL_PREFIX_MISMATCH')
    assert.equal(r.data.mismatches.length, 1)
    assert.equal(r.data.mismatches[0].excelCol, 'O')
    assert.equal(r.data.mismatches[0].prefix, 'LA-0369')
    assert.equal(r.data.mismatches[0].expectedPrefix, 'LA-0368')
    assert.match(r.message, /请检查上传的 Excel 文件是否有误/)
  })

  test('同一 Material 行分色全码前缀一致时通过', () => {
    const materials = [
      {
        groupNo: '1',
        codesByColor: [
          { colorNo: 'G3', materialCode: 'LA-0368/G3' },
          { colorNo: 'VE12', materialCode: 'LA-0368/VE12' },
        ],
      },
    ]
    assert.deepEqual(validateMaterialPrefixConsistency(materials, ['G3', 'VE12']), { ok: true })
  })

  test('materialErpPrefix 只取斜杠前缀', () => {
    assert.equal(materialErpPrefix(' LA-0368/G3 '), 'LA-0368')
    assert.equal(materialErpPrefix('LA-0368'), 'LA-0368')
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
