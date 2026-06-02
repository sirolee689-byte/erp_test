import test from 'node:test'
import assert from 'node:assert/strict'
import {
  aggregateBomConsumptionFromFlat,
  flattenBomPartsCostUsageFlat,
  flattenBomPartsCostUsageFlatForBomCost,
} from './bomUsageFlatten.js'

function round4(n) {
  return Math.round(Number(n) * 10000) / 10000
}

test('成本用量表：子 BOM 按父级配件单位用量倍率参与合并', () => {
  const tree = [
    {
      kcaa01: 'BAG-PQTEST',
      kcaa02: '主袋',
      kcac04: 1,
      kcac05: 0,
      children: [
        {
          kcaa01: 'LA-0368/MO',
          kcaa02: '里布',
          kcac04: 2.1936,
          kcac05: 0.22,
          children: [],
        },
      ],
    },
    {
      kcaa01: 'TAG-PQTEST',
      kcaa02: '吊牌',
      kcac04: 4,
      kcac05: 0,
      children: [
        {
          kcaa01: 'LA-0368/MO',
          kcaa02: '里布',
          kcac04: 0.015,
          kcac05: 0.22,
          children: [],
        },
      ],
    },
  ]

  const flat = flattenBomPartsCostUsageFlat(tree, null, [])
  const rows = aggregateBomConsumptionFromFlat(flat, ['BAG-', 'TAG-'])
  const hit = rows.find((r) => r.kcaa01 === 'LA-0368/MO')

  assert.ok(hit)
  assert.equal(round4(hit.sumay), 2.2536)
  assert.equal(round4(hit.kcac05), 0.22)
  assert.equal(round4(hit.sumby), 2.7494)
})

test('成本用量表：CUT 不吃自身数量，但必须保留 TAG/BAG 的上层倍率', () => {
  const tree = [
    {
      kcaa01: 'BAG-PQ1975B1/MO',
      kcaa02: '主袋',
      kcac04: 1,
      kcac05: 0,
      children: [
        {
          kcaa01: 'CUT-BAGPQ1975B1/MO<1-1>',
          kcaa02: '裁片',
          kcac04: 9,
          kcac05: 0,
          children: [
            {
              kcaa01: 'LA-0368/MO',
              kcaa02: '2.0VITOLDBAG皮',
              kcac04: 2.1936,
              kcac05: 0.22,
              children: [],
            },
          ],
        },
      ],
    },
    {
      kcaa01: 'TAG-PQ1975B1/MO',
      kcaa02: '拉牌',
      kcac04: 4,
      kcac05: 0,
      children: [
        {
          kcaa01: 'CUT-TAGPQ1975B1/MO<1-1>',
          kcaa02: '拉牌放大',
          kcac04: 9,
          kcac05: 0,
          children: [
            {
              kcaa01: 'LA-0368/MO',
              kcaa02: '2.0VITOLDBAG皮',
              kcac04: 0.015,
              kcac05: 0.22,
              children: [],
            },
          ],
        },
      ],
    },
  ]

  const flat = flattenBomPartsCostUsageFlat(tree, null, [])
  const tagCut = flat.find((r) => r.kcaa01 === 'CUT-TAGPQ1975B1/MO<1-1>')
  const rows = aggregateBomConsumptionFromFlat(flat, ['BAG-', 'TAG-', 'CUT-'])
  const hit = rows.find((r) => r.kcaa01 === 'LA-0368/MO')

  assert.ok(tagCut)
  assert.equal(round4(tagCut.yl), 36)
  assert.ok(hit)
  assert.equal(round4(hit.sumay), 2.2536)
  assert.equal(round4(hit.kcac05), 0.22)
  assert.equal(round4(hit.sumby), 2.7494)
})

test('bom_cost 写库：CUT 自身数量要放大下层子编码用量', () => {
  const tree = [
    {
      kcaa01: 'CUT-BAGPQ3633A1/BLU4<6-1>',
      kcaa02: '裁片',
      kcac04: 2,
      kcac05: 0,
      children: [
        {
          kcaa01: 'BM-0032/395',
          kcaa02: '涤纶布',
          kcac04: 0.0612,
          kcac05: 0,
          children: [],
        },
      ],
    },
  ]

  const displayFlat = flattenBomPartsCostUsageFlat(tree, null, [])
  const bomCostFlat = flattenBomPartsCostUsageFlatForBomCost(tree, null, [])
  const displayMaterial = displayFlat.find((r) => r.kcaa01 === 'BM-0032/395')
  const bomCostMaterial = bomCostFlat.find((r) => r.kcaa01 === 'BM-0032/395')

  assert.ok(displayMaterial)
  assert.ok(bomCostMaterial)
  assert.equal(round4(displayMaterial.yl), 0.0612)
  assert.equal(round4(bomCostMaterial.yl), 0.1224)
})
