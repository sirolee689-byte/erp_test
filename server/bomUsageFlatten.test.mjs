import test from 'node:test'
import assert from 'node:assert/strict'
import {
  aggregateBomConsumptionFromFlat,
  flattenBomPartsCostUsageFlat,
  flattenBomPartsCostUsageFlatForBomCost,
  flattenBomPartsCostUsageFlatForLegacyBomCost,
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

test('UB_ERP_Bom_cost 写库：CUT 中间层数量按 1 跳过，不放大下层子编码用量', () => {
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
  assert.equal(round4(bomCostMaterial.yl), 0.0612)
})

test('UB_ERP_Bom_cost 写库：CUT 中间层不继续放大更深层子 BOM', () => {
  const tree = [
    {
      kcaa01: 'CUT-SSPQ3122I2/GRN<5-1>',
      kcaa02: 'CUT',
      kcac04: 2,
      kcac05: 0,
      children: [
        {
          kcaa01: 'BN-0005/-',
          kcaa02: 'middle bom',
          kcac04: 0.0037,
          kcac05: 0,
          children: [
            {
              kcaa01: 'BN-0008/-',
              kcaa02: 'leaf bom',
              kcac04: 1,
              kcac05: 0,
              children: [],
            },
          ],
        },
      ],
    },
  ]

  const displayFlat = flattenBomPartsCostUsageFlat(tree, null, [])
  const bomCostFlat = flattenBomPartsCostUsageFlatForBomCost(tree, null, [])
  const displayBn5 = displayFlat.find((r) => r.kcaa01 === 'BN-0005/-')
  const displayBn8 = displayFlat.find((r) => r.kcaa01 === 'BN-0008/-')
  const bomCostBn5 = bomCostFlat.find((r) => r.kcaa01 === 'BN-0005/-')
  const bomCostBn8 = bomCostFlat.find((r) => r.kcaa01 === 'BN-0008/-')

  assert.ok(displayBn5)
  assert.ok(displayBn8)
  assert.ok(bomCostBn5)
  assert.ok(bomCostBn8)
  assert.equal(round4(displayBn5.yl), 0.0037)
  assert.equal(round4(displayBn8.yl), 0.0037)
  assert.equal(round4(bomCostBn5.yl), 0.0037)
  assert.equal(round4(bomCostBn8.yl), 0.0037)
})

test('旧一键运算：CUT 中间层数量持续放大下层与更深层子件', () => {
  const tree = [
    {
      kcaa01: 'CUT-SSPQ3122I2/GRN<5-1>',
      kcaa02: 'CUT',
      kcac04: 2,
      kcac05: 0,
      children: [
        {
          kcaa01: 'BN-0005/-',
          kcaa02: 'middle bom',
          kcac04: 0.0037,
          kcac05: 0,
          children: [
            {
              kcaa01: 'BN-0008/-',
              kcaa02: 'leaf bom',
              kcac04: 1,
              kcac05: 0,
              children: [],
            },
          ],
        },
      ],
    },
  ]

  const oldFlat = flattenBomPartsCostUsageFlatForLegacyBomCost(tree, null, [])
  const oldBn5 = oldFlat.find((r) => r.kcaa01 === 'BN-0005/-')
  const oldBn8 = oldFlat.find((r) => r.kcaa01 === 'BN-0008/-')

  assert.ok(oldBn5)
  assert.ok(oldBn8)
  assert.equal(round4(oldBn5.yl), 0.0074)
  assert.equal(round4(oldBn8.yl), 0.0074)
})

test('UB_ERP_Bom_cost 写库：非 CUT 父层数量仍逐层相乘', () => {
  const tree = [
    {
      kcaa01: 'PQ-3188A3/GRN',
      kcaa02: '主档',
      kcac04: 1,
      kcac05: 0,
      children: [
        {
          kcaa01: 'BAG-PQ3188A3/GRN',
          kcaa02: '子件',
          kcac04: 2,
          kcac05: 0,
          children: [
            {
              kcaa01: 'LA-0240/GR3',
              kcaa02: '里布',
              kcac04: 0.1673,
              kcac05: 0,
              children: [],
            },
          ],
        },
      ],
    },
  ]

  const bomCostFlat = flattenBomPartsCostUsageFlatForBomCost(tree, null, [])
  const material = bomCostFlat.find((r) => r.kcaa01 === 'LA-0240/GR3')
  assert.ok(material)
  assert.equal(round4(material.yl), 0.3346)
})

test('BOM usage flatten keeps actual kcac05 precision when computing total_qty', () => {
  const tree = [
    {
      kcaa01: 'LA-0240/N',
      kcaa02: 'DAYTONA皮',
      kcac04: 2,
      kcac05: 0.23456,
      children: [],
    },
  ]

  const flat = flattenBomPartsCostUsageFlatForBomCost(tree, null, [])
  assert.equal(flat.length, 1)
  assert.equal(flat[0].loss_rate, 0.23456)
  assert.equal(flat[0].total_qty, 2.46912)
})
