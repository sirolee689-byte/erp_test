import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCutMatchingByMajorFirstNonEmpty,
  cutMajorFromCutSeq,
  materialGroupMatchesCut,
  PAPER_PATTERN_BOM_PARTS_VERSION,
  PAPER_PATTERN_BOM_PARTS_PASS_DEFAULT,
  PAPER_PATTERN_CUT_BOM_PARTS_REMARK,
  bom000PriceToBomPartsOrNull,
  parseAccessoryWastageFraction,
  parsePaperPatternQty,
  resolveAccessoryKcac456,
  resolveCutDescribeForBomParts,
} from './paperPatternImportCommitBomParts.js'

test('纸格 Bom_parts 常量', () => {
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

test('parsePaperPatternQty', () => {
  assert.equal(parsePaperPatternQty('1.5'), 1.5)
  assert.equal(parsePaperPatternQty(''), 0)
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
