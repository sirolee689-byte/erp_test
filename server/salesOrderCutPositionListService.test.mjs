import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildBomSupplementMaterials,
  mergeCutPositionMaterials,
} from './salesOrderCutPositionListService.js'
import {
  aggregateOutsourcingMaterials,
  attachCutInfoToMaterials,
} from './salesOrderOutsourcingListService.js'

test('buildBomSupplementMaterials uses kcac04×orderQty and fixes position/cutLeather to -', () => {
  const out = buildBomSupplementMaterials(
    [
      {
        kcaa01: 'BN-0005/-',
        kcaa02: '牛津布',
        kcaa03: '58"',
        kcaa04: 'YD',
        kcaa11: '580',
        colorName: '黑色',
        kcac04: 0.02,
        seq: 1,
      },
      {
        kcaa01: '',
        kcaa02: '空编码应跳过',
        kcac04: 1,
      },
    ],
    50,
  )
  assert.equal(out.length, 1)
  assert.equal(out[0].kcaa01, 'BN-0005/-')
  assert.equal(out[0].kcaa11, '580,黑色')
  assert.equal(out[0].unit, 'YD')
  assert.equal(out[0].unitUsage, 0.02)
  assert.equal(out[0].totalQty, 1)
  assert.equal(out[0].position, '-')
  assert.equal(out[0].cutLeather, '-')
  assert.equal(out[0].source, 'bom_supplement')
})

test('mergeCutPositionMaterials appends Part2 after Part1 without dedupe and sums totals', () => {
  const part1 = attachCutInfoToMaterials(
    aggregateOutsourcingMaterials(
      [{ kcaa01: 'M1', kcaa02: '围顶', kcaa03: '', kcaa11: '', kcac06: 1, px: 1, kcac03: 'PC' }],
      10,
    ),
    [{ kcaa01: 'CUT-1', kcaa02: '主皮 围顶', systemcode: 'SC1' }],
    new Map([['SC1', [{ Describe: '主皮', kcaa02: '皮', kcaa01: 'LA-1' }]]]),
  )
  const part2 = buildBomSupplementMaterials(
    [
      { kcaa01: 'M1', kcaa02: '围顶', kcaa03: '', kcaa04: 'PC', kcaa11: '', kcac04: 2 },
      { kcaa01: 'X2', kcaa02: '补料', kcaa03: '', kcaa04: 'PC', kcaa11: '', kcac04: 0.5 },
    ],
    10,
  )
  const { materials, materialsTotalQty } = mergeCutPositionMaterials(part1, part2)
  assert.equal(materials.length, 3)
  assert.equal(materials[0].source, 'pi_cost')
  assert.equal(materials[0].position, '主皮')
  assert.equal(materials[0].cutLeather, '主皮 LA-1')
  assert.equal(materials[1].source, 'bom_supplement')
  assert.equal(materials[1].kcaa01, 'M1')
  assert.equal(materials[1].position, '-')
  assert.equal(materials[2].kcaa01, 'X2')
  // Part1 total 10 + Part2 20 + 5 = 35
  assert.equal(materialsTotalQty, 35)
})
