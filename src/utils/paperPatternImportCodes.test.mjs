import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCutCode,
  buildFactoryStyleKcaa03Path,
  buildMainBomCode,
  colorNoSegmentForBomEncoding,
  normalizeFactoryStyleForBomPathDisplay,
} from './paperPatternImportCodes.js'

test('buildMainBomCode 非清仓与现网一致', () => {
  assert.equal(
    buildMainBomCode({ importTypeFlag5: 'BAG', styleNo: 'PQ2803H1', colorNo: 'R-TEST' }),
    'BAG-PQ2803H1/R-TEST',
  )
})

test('buildMainBomCode 清仓单追加 -OUT', () => {
  assert.equal(
    buildMainBomCode({
      importTypeFlag5: 'BAG',
      styleNo: 'PQ2803H1',
      colorNo: 'R-TEST',
      clearanceOrder: true,
    }),
    'BAG-PQ2803H1/R-TEST-OUT',
  )
})

test('buildCutCode 清仓单在颜色段与序号之间加 -OUT', () => {
  assert.equal(
    buildCutCode({
      importTypeFlag5: 'BAG',
      styleNo: 'PQ2803H1',
      colorNo: 'R-TEST',
      cutSeq: '1-1',
      clearanceOrder: true,
    }),
    'CUT-BAGPQ2803H1/R-TEST-OUT<1-1>',
  )
})

test('colorNoSegmentForBomEncoding 选 A：已有 -OUT 仍再追加', () => {
  assert.equal(colorNoSegmentForBomEncoding('R-TEST-OUT', true), 'R-TEST-OUT-OUT')
})

test('normalizeFactoryStyleForBomPathDisplay 保留横线、去星与空白', () => {
  assert.equal(normalizeFactoryStyleForBomPathDisplay('PQ-2803H1'), 'PQ-2803H1')
  assert.equal(normalizeFactoryStyleForBomPathDisplay(' PQ-*2803H1 '), 'PQ-2803H1')
})

test('buildFactoryStyleKcaa03Path 款色路径', () => {
  assert.equal(buildFactoryStyleKcaa03Path('PQ-3672A1', 'G-TEST'), 'PQ-3672A1/G-TEST')
  assert.equal(buildFactoryStyleKcaa03Path('PQ-3672A1', ''), '')
})
