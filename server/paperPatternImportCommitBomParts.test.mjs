import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCutMatchingByMajorFirstNonEmpty,
  buildMaterialGlobalSeqMap,
  cutMajorFromCutSeq,
  materialGroupMatchesCut,
  PAPER_PATTERN_BOM_PARTS_VERSION,
  PAPER_PATTERN_BOM_PARTS_PASS_DEFAULT,
  PAPER_PATTERN_CUT_BOM_PARTS_REMARK,
  bom000PriceToBomPartsOrNull,
  parseAccessoryWastageFraction,
  parsePaperPatternQty,
  cutChildKcac04FromUnitConsumption,
  resolveAccessoryKcac456,
  resolveCutDescribeForBomParts,
  resolveMaterialWastageFraction,
} from './paperPatternImportCommitBomParts.js'
import { erpCodeLookupKey } from './paperPatternErpCodeNormalize.js'

test('纸格 UB_ERP_Bom_parts 常量', () => {
  assert.equal(PAPER_PATTERN_CUT_BOM_PARTS_REMARK, '纸格系统导入')
  assert.equal(PAPER_PATTERN_BOM_PARTS_VERSION, 100)
  assert.equal(PAPER_PATTERN_BOM_PARTS_PASS_DEFAULT, '1')
})

test('cutMajorFromCutSeq', () => {
  assert.equal(cutMajorFromCutSeq('3-44'), '3')
  assert.equal(cutMajorFromCutSeq('1-1'), '1')
  assert.equal(cutMajorFromCutSeq(''), '')
})

test('buildCutMatchingByMajorFirstNonEmpty / resolveCutDescribeForBomParts 子序号同步父段搭配', () => {
  const cuts = [
    { cutSeq: '4-1', matching: '' },
    { cutSeq: '4-2', matching: '主里' },
    { cutSeq: '4-3', matching: '其它' },
  ]
  const map = buildCutMatchingByMajorFirstNonEmpty(cuts)
  assert.equal(map.get('4'), '主里')
  assert.equal(resolveCutDescribeForBomParts('4-1', '', map), '主里')
  assert.equal(resolveCutDescribeForBomParts('4-2', '主里', map), '主里')
})

test('materialGroupMatchesCut', () => {
  assert.equal(materialGroupMatchesCut('3', '3-1'), true)
  assert.equal(materialGroupMatchesCut(3, '3-44'), true)
  assert.equal(materialGroupMatchesCut('2', '3-1'), false)
})

test('buildMaterialGlobalSeqMap 按 Material 列表首次出现赋全局 Seq', () => {
  const map = buildMaterialGlobalSeqMap([
    { materialCode: 'LA-0368/xx' },
    { materialCode: 'NN-0021/xx' },
    { materialCode: 'LA-0368/xx' },
  ])
  assert.equal(map.size, 2)
  assert.equal(map.get(erpCodeLookupKey('LA-0368/xx')), 1)
  assert.equal(map.get(erpCodeLookupKey('NN-0021/xx')), 2)
})

test('parsePaperPatternQty', () => {
  assert.equal(parsePaperPatternQty('1.5'), 1.5)
  assert.equal(parsePaperPatternQty(''), 0)
})

test('cutChildKcac04FromUnitConsumption 取 CUT 单位用量', () => {
  assert.equal(cutChildKcac04FromUnitConsumption('0.12'), 0.12)
  assert.equal(cutChildKcac04FromUnitConsumption('1.23456789'), 1.234568)
  assert.equal(cutChildKcac04FromUnitConsumption(''), 0)
})

test('parseAccessoryWastageFraction', () => {
  assert.equal(parseAccessoryWastageFraction(''), 0)
  assert.equal(parseAccessoryWastageFraction('0%'), 0)
  assert.equal(parseAccessoryWastageFraction('25%'), 0.25)
  assert.equal(parseAccessoryWastageFraction('0.25'), 0.25)
})

test('resolveAccessoryKcac456 显式三列', () => {
  const r = resolveAccessoryKcac456('4', '0%', '4.000', null)
  assert.equal(r.kcac04, 4)
  assert.equal(r.kcac05, 0)
  assert.equal(r.kcac06FromExcel, 4)
})

test('resolveAccessoryKcac456 损耗合计空走库 kcaa33', () => {
  const r = resolveAccessoryKcac456('1', '', '', 0.25)
  assert.equal(r.kcac04, 1)
  assert.equal(r.kcac05, 0.25)
  assert.equal(r.kcac06FromExcel, undefined)
})

test('resolveAccessoryKcac456 库无损耗', () => {
  const r = resolveAccessoryKcac456('2', '', '', null)
  assert.equal(r.kcac04, 2)
  assert.equal(r.kcac05, 0)
  assert.equal(r.kcac06FromExcel, undefined)
})

test('bom000PriceToBomPartsOrNull 六位小数与空值', () => {
  assert.equal(bom000PriceToBomPartsOrNull(null), null)
  assert.equal(bom000PriceToBomPartsOrNull(undefined), null)
  assert.equal(bom000PriceToBomPartsOrNull(1.23456789), 1.234568)
  assert.equal(bom000PriceToBomPartsOrNull('2.1'), 2.1)
})
test('resolveMaterialWastageFraction keeps 6 decimal user input', () => {
  assert.equal(resolveMaterialWastageFraction(0.123456, 0.06), 0.123456)
  assert.equal(resolveMaterialWastageFraction(0.1234567, 0.06), 0.123457)
  assert.equal(resolveMaterialWastageFraction(0, 0.06), 0)
  assert.equal(resolveMaterialWastageFraction(null, 0.654321), 0.654321)
  assert.equal(resolveMaterialWastageFraction(undefined, null), 0)
})
