/**
 * pi_cost 专用 top/t 层级与默认值
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { flattenBomPartsCostUsageFlatForBomCost } from './bomUsageFlatten.js'
import { buildBomCostInsertPayloadFromFlatUsage } from './bomUsageYl.js'
import { getDefaultBomCostHidePrefixes } from './bomCostHidePrefixes.js'
import { enrichBomCostInsertRowsFromBom000 } from './bomCostEnrichFromBom000.js'
import {
  applyPiCostExtendedFieldsToRows,
  applyPiCostKcaa13FromSalesList,
  collectPiCostHierarchyMetaFromTree,
  collectPiCostKcaa13BySourceIdFromTree,
  formatPiCostTempFromOrderQty,
  parsePiCostSalesListKcaa13,
} from './salesOrderPiCostFields.js'

const BAG_PREFIXES = ['BAG', 'TAG', 'OUT', 'RMP', 'RP']

/** BAG 直下 + CUT-BAG 深层 */
function buildBagHierarchyTree() {
  return [
    {
      id: 100,
      kcaa01: 'BAG-PQ3633A1/BLU4',
      kcaa02: '主袋',
      kcac04: 1,
      kcac05: 0,
      level: 1,
      children: [
        {
          id: 101,
          kcaa01: 'ZS-0034/CFL',
          kcaa02: '拉链头',
          kcac04: 2,
          kcac05: 0,
          level: 2,
          children: [],
        },
        {
          id: 102,
          kcaa01: 'CUT-BAGPQ3633A1/BLU4<1-1>',
          kcaa02: '后横唛贴放大',
          kcaa03: 'BLU4',
          kcaa05: 'LA',
          kcaa11: '裁片组',
          kcaa14: 3,
          kcaa15: '04',
          kcaa25: 'loc-cut',
          kcaa26: 1.5,
          kcac04: 1,
          kcac05: 0,
          level: 2,
          children: [
            {
              id: 103,
              kcaa01: 'LA-0231/BLU3',
              kcaa02: '皮料',
              kcac04: 0.5,
              kcac05: 0,
              level: 3,
              children: [],
            },
          ],
        },
      ],
    },
  ]
}

describe('salesOrderPiCostFields', () => {
  test('collectPiCostHierarchyMetaFromTree：裁片下 RP-* 继承 BAG 锚点，不误设自身', () => {
    const tree = [
      {
        id: 100,
        kcaa01: 'BAG-PQ3633A1/BLU4',
        kcaa02: '主袋',
        children: [
          {
            id: 102,
            kcaa01: 'CUT-BAGPQ3633A1/BLU4<25-1>',
            kcaa02: '手挽托',
            children: [
              {
                id: 6181064,
                kcaa01: 'RP-0030/-',
                kcaa02: '5mm 回力胶 38"',
                children: [],
              },
            ],
          },
        ],
      },
    ]
    const meta = collectPiCostHierarchyMetaFromTree(tree, BAG_PREFIXES)
    const rp = meta.get(6181064)
    assert.ok(rp)
    assert.equal(rp.top_kcaa01, 'BAG-PQ3633A1/BLU4')
    assert.equal(rp.top_kcaa02, '主袋')
    assert.equal(rp.t_kcaa01, 'CUT-BAGPQ3633A1/BLU4<25-1>')
    assert.equal(rp.t_kcaa02, '手挽托')
  })

  test('collectPiCostHierarchyMetaFromTree：散件单第一层命中 flag5 时 top 为自身', () => {
    const tree = [
      {
        id: 9001,
        kcaa01: 'RP-0030/-',
        kcaa02: '散件回力胶',
        children: [],
      },
    ]
    const meta = collectPiCostHierarchyMetaFromTree(tree, BAG_PREFIXES)
    const spare = meta.get(9001)
    assert.ok(spare)
    assert.equal(spare.top_kcaa01, 'RP-0030/-')
    assert.equal(spare.top_kcaa02, '散件回力胶')
    assert.equal(spare.t_kcaa01, null)
    assert.equal(spare.t_kcaa02, null)
  })

  test('collectPiCostHierarchyMetaFromTree：BAG 锚点 + 直下 t 留空 + 深层 t 为 CUT', () => {
    const meta = collectPiCostHierarchyMetaFromTree(buildBagHierarchyTree(), BAG_PREFIXES)
    const zs = meta.get(101)
    assert.ok(zs)
    assert.equal(zs.top_kcaa01, 'BAG-PQ3633A1/BLU4')
    assert.equal(zs.top_kcaa02, '主袋')
    assert.equal(zs.t_kcaa01, null)
    assert.equal(zs.t_kcaa02, null)
    assert.equal(zs.t_kcaa03, null)
    assert.equal(zs.t_kcaa14, null)

    const la = meta.get(103)
    assert.ok(la)
    assert.equal(la.top_kcaa01, 'BAG-PQ3633A1/BLU4')
    assert.equal(la.t_kcaa01, 'CUT-BAGPQ3633A1/BLU4<1-1>')
    assert.equal(la.t_kcaa02, '后横唛贴放大')
    assert.equal(la.t_kcaa03, 'BLU4')
    assert.equal(la.t_kcaa05, 'LA')
    assert.equal(la.t_kcaa11, '裁片组')
    assert.equal(la.t_kcaa14, 3)
    assert.equal(la.t_kcaa15, '04')
    assert.equal(la.t_kcaa25, 'loc-cut')
    assert.equal(la.t_kcaa26, 1.5)
  })

  test('formatPiCostTempFromOrderQty：整数与小数', () => {
    assert.equal(formatPiCostTempFromOrderQty(111), '111')
    assert.equal(formatPiCostTempFromOrderQty(130), '130')
    assert.equal(formatPiCostTempFromOrderQty(2.5), '2.5')
    assert.equal(formatPiCostTempFromOrderQty(null), null)
  })

  test('applyPiCostExtendedFieldsToRows：temp 为销售明细订货数量', () => {
    const meta = collectPiCostHierarchyMetaFromTree(buildBagHierarchyTree(), BAG_PREFIXES)
    const flat = flattenBomPartsCostUsageFlatForBomCost(buildBagHierarchyTree(), null, [])
    const payload = buildBomCostInsertPayloadFromFlatUsage(
      flat,
      getDefaultBomCostHidePrefixes(),
      'PQ-3633A1/BLU4',
    )
    const rows = applyPiCostExtendedFieldsToRows(payload, meta, 111)
    assert.ok(rows.length >= 1)
    for (let i = 0; i < rows.length; i++) {
      assert.equal(rows[i].temp, '111')
    }
  })

  test('applyPiCostExtendedFieldsToRows：默认值与 kcac08 计算', () => {
    const meta = collectPiCostHierarchyMetaFromTree(buildBagHierarchyTree(), BAG_PREFIXES)
    const flat = flattenBomPartsCostUsageFlatForBomCost(buildBagHierarchyTree(), null, [])
    const payload = buildBomCostInsertPayloadFromFlatUsage(
      flat,
      getDefaultBomCostHidePrefixes(),
      'PQ-3633A1/BLU4',
    )
    const rows = applyPiCostExtendedFieldsToRows(payload, meta)
    assert.ok(rows.length >= 2)

    const zs = rows.find((r) => r.kcaa01 === 'ZS-0034/CFL')
    assert.ok(zs)
    assert.equal(zs.top_kcaa01, 'BAG-PQ3633A1/BLU4')
    assert.equal(zs.t_kcaa01, null)
    assert.equal(zs.isok, 1)
    assert.equal(zs.pass, '1')
    assert.equal(zs.kcac07, 0)
    assert.equal(zs.kcac08, zs.kcac06)
    assert.equal(zs.kcaa07, 0)
    assert.equal(zs.kcaa08, 0)

    const la = rows.find((r) => r.kcaa01 === 'LA-0231/BLU3')
    assert.ok(la)
    assert.equal(la.top_kcaa01, 'BAG-PQ3633A1/BLU4')
    assert.equal(la.t_kcaa01, 'CUT-BAGPQ3633A1/BLU4<1-1>')
    assert.equal(la.t_kcaa03, 'BLU4')
    assert.equal(la.kcac08, la.kcac06)
  })

  test('parsePiCostSalesListKcaa13：0 与 NULL', () => {
    assert.equal(parsePiCostSalesListKcaa13(0), 0)
    assert.equal(parsePiCostSalesListKcaa13(1), 1)
    assert.equal(parsePiCostSalesListKcaa13(null), null)
    assert.equal(parsePiCostSalesListKcaa13(''), null)
  })

  test('applyPiCostKcaa13FromSalesList：list 有值（含 0）覆盖 bom_000', () => {
    const tree = [
      {
        id: 201,
        kcaa01: 'MB-0001/-',
        kcaa13: 1,
        children: [],
      },
      {
        id: 202,
        kcaa01: 'MB-0002/-',
        kcaa13: 0,
        children: [],
      },
    ]
    const byId = collectPiCostKcaa13BySourceIdFromTree(tree)
    assert.equal(byId.get(201), 1)
    assert.equal(byId.get(202), 0)

    const payload = [
      { sourceRowId: 201, kcaa01: 'MB-0001/-', kcac04: 1, kcac06: 1 },
      { sourceRowId: 202, kcaa01: 'MB-0002/-', kcac04: 2, kcac06: 2 },
      { sourceRowId: 203, kcaa01: 'MB-0003/-', kcac04: 3, kcac06: 3 },
    ]
    const bom000Map = new Map([
      ['mb-0001/-', { kcaa13: 0 }],
      ['mb-0002/-', { kcaa13: 1 }],
      ['mb-0003/-', { kcaa13: 1 }],
    ])
    const enriched = enrichBomCostInsertRowsFromBom000(payload, bom000Map)
    const merged = applyPiCostKcaa13FromSalesList(enriched, byId)
    assert.equal(merged[0].kcaa13, 1)
    assert.equal(merged[1].kcaa13, 0)
    assert.equal(merged[2].kcaa13, 1)
    assert.equal(merged[0].kcac04, 1)
    assert.equal(merged[1].kcac06, 2)
  })

  test('用量 kcac04/06 与 bom_cost payload 一致', () => {
    const tree = buildBagHierarchyTree()
    const flat = flattenBomPartsCostUsageFlatForBomCost(tree, null, [])
    const bomPayload = buildBomCostInsertPayloadFromFlatUsage(
      flat,
      getDefaultBomCostHidePrefixes(),
      'PQ-3633A1/BLU4',
    )
    const meta = collectPiCostHierarchyMetaFromTree(tree, BAG_PREFIXES)
    const piRows = applyPiCostExtendedFieldsToRows(bomPayload, meta)
    assert.equal(piRows.length, bomPayload.length)
    for (let i = 0; i < bomPayload.length; i++) {
      assert.equal(piRows[i].kcaa01, bomPayload[i].kcaa01)
      assert.equal(piRows[i].kcac04, bomPayload[i].kcac04)
      assert.equal(piRows[i].kcac06, bomPayload[i].kcac06)
    }
  })
})
