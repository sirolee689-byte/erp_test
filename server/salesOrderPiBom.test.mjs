import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { buildBomPartsUsageTreeNodesFromLayerCache } from './bomUsageTreeBuild.js'
import {
  collectPiBomVirtualRootQtyFromMasterTree,
  collectTopLevelParentKeysFromPiBomTree,
  flattenPiBomPartRows,
  kcaa01MatchesTopLevelFinishedBomCodePrefix,
  parsePiBomVirtualRootQtyInfo,
  piBomListInsertDedupeKey,
  piBomListPhysicalRowKey,
  resolvePiListExpandKeyFromBomPartsRow,
  resolvePiBomListRawParentKeyFromBomPartsRow,
  serializePiBomVirtualRootQtyInfo,
  shouldSkipPiBomListWriteByBomCodePrefix,
} from './salesOrderPiBom.js'

describe('salesOrderPiBom', () => {
  test('flattenPiBomPartRows 深子树可全部展平（无层数上限）', () => {
    const deepChild = { systemcode: 'L5', kcaa01: 'P5', children: [] }
    const n4 = { systemcode: 'L4', kcaa01: 'P4', children: [deepChild] }
    const n3 = { systemcode: 'L3', kcaa01: 'P3', children: [n4] }
    const n2 = { systemcode: 'L2', kcaa01: 'P2', children: [n3] }
    const n1 = { systemcode: 'L1', kcaa01: 'P1', children: [n2] }
    const out = []
    flattenPiBomPartRows('HEAD', [n1], out, 1, 'BAG-X')
    assert.equal(out.length, 5)
    assert.equal(out[0].sourceRow.kcaa01, 'P1')
    assert.equal(out[4].sourceRow.kcaa01, 'P5')
  })

  test('piBomListInsertDedupeKey 同父同 systemcode 只写一行', () => {
    const parent = '637E4014-AAC0-492D-87EF-30F1930A89E2'
    const childRow = {
      kcaa01: 'BN-0008/-',
      kcac02: '82C84EC2-4736-42C3-9CF7-C00C7157006F',
      systemcode: 'SC-BN8-LINE-1',
    }
    const k1 = piBomListInsertDedupeKey(parent, childRow)
    const k2 = piBomListInsertDedupeKey(parent, childRow)
    assert.equal(k1, k2)
    assert.notEqual(
      piBomListInsertDedupeKey(parent, { ...childRow, systemcode: 'SC-BN8-LINE-2' }),
      k1,
    )
    assert.notEqual(
      piBomListInsertDedupeKey('3398D1246FDE86003A66F3FF61BC36DE112', childRow),
      k1,
    )
  })

  test('piBomListInsertDedupeKey 同父同码不同 systemcode 不合并（如 TC-0001/580 两行搭配）', () => {
    const parent = 'PARENT-SC-TC'
    const sharedKcac02 = 'BOM000-GUID-TC-580'
    const rowA = {
      kcaa01: 'TC-0001/580',
      kcac02: sharedKcac02,
      systemcode: 'SC-TC-LINE-A',
      Describe: '橡根/克',
      kcac04: 0.001,
    }
    const rowB = {
      kcaa01: 'TC-0001/580',
      kcac02: sharedKcac02,
      systemcode: 'SC-TC-LINE-B',
      Describe: '防水里',
      kcac04: 0.0025,
    }
    const kA = piBomListInsertDedupeKey(parent, rowA)
    const kB = piBomListInsertDedupeKey(parent, rowB)
    assert.notEqual(kA, kB)
  })

  test('piBomListInsertDedupeKey 无 systemcode 时按 UB_ERP_Bom_parts.id 区分同父同 kcac02', () => {
    const parent = 'PARENT-TC-NOSC'
    const sharedKcac02 = 'BOM000-GUID-SAME'
    const rowA = { id: 1001, kcaa01: 'TC-0001/580', kcac02: sharedKcac02, Describe: '橡根/克' }
    const rowB = { id: 1002, kcaa01: 'TC-0001/580', kcac02: sharedKcac02, Describe: '防水里' }
    assert.notEqual(piBomListInsertDedupeKey(parent, rowA), piBomListInsertDedupeKey(parent, rowB))
    assert.equal(piBomListPhysicalRowKey(rowA), 'id:1001')
  })

  test('piBomListInsertDedupeKey 同物理行多路径只写一行（BN-0008 方案 B）', () => {
    const parent = '637E4014-AAC0-492D-87EF-30F1930A89E2'
    const row = {
      id: 9001,
      kcaa01: 'BN-0008/-',
      kcac02: '82C84EC2-4736-42C3-9CF7-C00C7157006F',
      systemcode: 'SC-BN8-SAME',
    }
    const k1 = piBomListInsertDedupeKey(parent, row)
    const k2 = piBomListInsertDedupeKey(parent, { ...row })
    assert.equal(k1, k2)
    assert.equal(piBomListPhysicalRowKey(row), 'id:9001')
  })

  test('kcaa01MatchesTopLevelFinishedBomCodePrefix 与 UB_ERP_Bom_code flag5 一致', () => {
    const prefixes = ['BAG', 'TAG', 'PQ']
    assert.equal(kcaa01MatchesTopLevelFinishedBomCodePrefix('BAG-PQ3272A1/N', prefixes), true)
    assert.equal(kcaa01MatchesTopLevelFinishedBomCodePrefix('CUT-BAGPQ3633A1/BLU4<1-1>', prefixes), false)
    assert.equal(kcaa01MatchesTopLevelFinishedBomCodePrefix('OUT-TEST', prefixes), false)
  })

  test('collectTopLevelParentKeysFromPiBomTree 收集 BAG/TAG 展开父键', () => {
    const prefixes = ['BAG', 'TAG']
    const tree = [
      {
        kcaa01: 'BAG-PQ3272A1/N',
        systemcode: '2541983F54FE7F2-10484044BD862A534CAF0BB20DCDE091',
        kcac02: '2541983F54FE7F2-10484044BD862A534CAF0BB20DCDE091',
        children: [],
      },
      {
        kcaa01: 'TAG-PQ3272A1/N',
        systemcode: 'TAG-SC-1',
        children: [],
      },
    ]
    const keys = collectTopLevelParentKeysFromPiBomTree(tree, prefixes)
    assert.ok(keys.has('2541983F54FE7F2-10484044BD862A534CAF0BB20DCDE091'))
    assert.ok(keys.has('TAG-SC-1'))
  })

  test('piBomListInsertDedupeKey 顶级成品父层同 systemcode 按 id 区分（TC-0001/580）', () => {
    const parent = '2541983F54FE7F2-10484044BD862A534CAF0BB20DCDE091'
    const topLevelParentKeys = new Set([parent])
    const sharedSc = '04486540-D2C6-4271-B6AE-0E8B1C58E757'
    const rowA = {
      id: 2618666,
      kcaa01: 'TC-0001/580',
      systemcode: sharedSc,
      Describe: '橡根/克',
      kcac04: 0.001,
    }
    const rowB = {
      id: 2618674,
      kcaa01: 'TC-0001/580',
      systemcode: sharedSc,
      Describe: '防水里',
      kcac04: 0.0025,
    }
    const opts = { topLevelParentKeys }
    assert.notEqual(piBomListInsertDedupeKey(parent, rowA, opts), piBomListInsertDedupeKey(parent, rowB, opts))
    assert.equal(piBomListPhysicalRowKey(rowA, { parentSc: parent, topLevelParentKeys }), 'id:2618666')
    assert.equal(
      piBomListInsertDedupeKey(parent, rowA, opts),
      piBomListInsertDedupeKey(parent, rowA, opts),
    )
    assert.equal(
      piBomListInsertDedupeKey(parent, rowA, opts),
      piBomListInsertDedupeKey(parent, rowA),
    )
  })

  test('piBomListInsertDedupeKey CUT parent keeps separate UB_ERP_Bom_parts ids', () => {
    const cutParent = 'SC-CUT-PARENT'
    const topLevelParentKeys = new Set(['2541983F-ONLY-BAG'])
    const rowA = {
      id: 8001,
      kcaa01: 'BN-0008/-',
      systemcode: 'SC-BN8-SAME',
    }
    const rowB = { ...rowA, id: 8002 }
    assert.notEqual(
      piBomListInsertDedupeKey(cutParent, rowA, { topLevelParentKeys }),
      piBomListInsertDedupeKey(cutParent, rowB, { topLevelParentKeys }),
    )
  })

  test('PI BOM list 方案 A：实际子编码均写入，仅 RP-PQ 结构行跳过', () => {
    assert.equal(shouldSkipPiBomListWriteByBomCodePrefix('BAG-PQ3633A1/BLU4'), false)
    assert.equal(shouldSkipPiBomListWriteByBomCodePrefix('TAG-PQ3633A1/BLU4'), false)
    assert.equal(shouldSkipPiBomListWriteByBomCodePrefix('RMP-PQ3633A1/BLU4'), false)
    assert.equal(shouldSkipPiBomListWriteByBomCodePrefix('CUT-BAGPQ3633A1/BLU4<9-1>'), false)
    assert.equal(shouldSkipPiBomListWriteByBomCodePrefix('RP-0030/-'), false)
    assert.equal(shouldSkipPiBomListWriteByBomCodePrefix('RP-PQ3633A1/BLU4'), true)
    assert.equal(shouldSkipPiBomListWriteByBomCodePrefix('TT-0018/BLACK'), false)
  })

  test('PI BOM list raw parent key keeps original UB_ERP_Bom_parts systemcode', () => {
    const row = {
      id: 2192457,
      kcaa01: 'TT-0018/BLACK',
      kcac02: '2021111C4BFB72633CF60E30041D1C6163581E0109',
      systemcode: '2021111C4BFB72633CF60E30041D1C6163581E0109',
    }
    assert.equal(
      resolvePiBomListRawParentKeyFromBomPartsRow(row),
      '2021111C4BFB72633CF60E30041D1C6163581E0109',
    )
  })

  test('resolvePiListExpandKeyFromBomPartsRow 共用 systemcode 时各路径分配独立展开键', () => {
    /** @type {Map<number, string>} */
    const byPartsId = new Map()
    /** @type {Set<string>} */
    const used = new Set()
    const sharedBn5Sc = '637E4014-AAC0-492D-87EF-30F1930A89E2'
    const bn5a = { id: 2617990, kcaa01: 'BN-0005/-', systemcode: sharedBn5Sc, kcac02: sharedBn5Sc }
    const bn5b = { id: 2617998, kcaa01: 'BN-0005/-', systemcode: sharedBn5Sc, kcac02: sharedBn5Sc }
    const bn5c = { id: 2618006, kcaa01: 'BN-0005/-', systemcode: sharedBn5Sc, kcac02: sharedBn5Sc }
    const kA = resolvePiListExpandKeyFromBomPartsRow(bn5a, byPartsId, used)
    const kB = resolvePiListExpandKeyFromBomPartsRow(bn5b, byPartsId, used)
    const kC = resolvePiListExpandKeyFromBomPartsRow(bn5c, byPartsId, used)
    assert.equal(kA, sharedBn5Sc)
    assert.notEqual(kB, sharedBn5Sc)
    assert.notEqual(kC, sharedBn5Sc)
    assert.notEqual(kB, kC)
  })

  test('PI-TEST111 拓扑：4 条 BN-0008 路径写入去重键互不相同', () => {
    const scCut91 = '3398D1246FDE86003A66F3FF61BC36DE112'
    const scCut101 = '349454B1977B8AE65DA68A78C555EEB7EAB'
    const scCut102 = '3542451205F833D8452960112DA20D0801D'
    const scCut103 = '359EEF52C77BBD05BF3FC2CA3AE94E8FFA2'
    const sharedBn5Sc = '637E4014-AAC0-492D-87EF-30F1930A89E2'
    const sharedBn8Sc = '82C84EC2-4736-42C3-9CF7-C00C7157006F'

    /** @type {Map<string, Record<string, unknown>[]>} */
    const layerCache = new Map([
      [
        'HEAD',
        [
          { id: 1, kcaa01: 'CUT-BAG<9-1>', kcac02: scCut91, systemcode: scCut91, kcac04: 1, kcac05: 0 },
          { id: 2, kcaa01: 'CUT-BAG<10-1>', kcac02: scCut101, systemcode: scCut101, kcac04: 1, kcac05: 0 },
          { id: 3, kcaa01: 'CUT-BAG<10-2>', kcac02: scCut102, systemcode: scCut102, kcac04: 1, kcac05: 0 },
          { id: 4, kcaa01: 'CUT-BAG<10-3>', kcac02: scCut103, systemcode: scCut103, kcac04: 1, kcac05: 0 },
        ],
      ],
      [
        scCut91,
        [
          {
            id: 5,
            kcaa01: 'BN-0008/-',
            kcac02: sharedBn8Sc,
            systemcode: sharedBn8Sc,
            kcac04: 1,
            kcac05: 0,
          },
        ],
      ],
      [
        scCut101,
        [
          {
            id: 2617990,
            kcaa01: 'BN-0005/-',
            kcac02: sharedBn5Sc,
            systemcode: sharedBn5Sc,
            kcac04: 1,
            kcac05: 0,
          },
        ],
      ],
      [
        scCut102,
        [
          {
            id: 2617998,
            kcaa01: 'BN-0005/-',
            kcac02: sharedBn5Sc,
            systemcode: sharedBn5Sc,
            kcac04: 1,
            kcac05: 0,
          },
        ],
      ],
      [
        scCut103,
        [
          {
            id: 2618006,
            kcaa01: 'BN-0005/-',
            kcac02: sharedBn5Sc,
            systemcode: sharedBn5Sc,
            kcac04: 1,
            kcac05: 0,
          },
        ],
      ],
      [
        sharedBn5Sc,
        [
          {
            id: 71086,
            kcaa01: 'BN-0008/-',
            kcac02: sharedBn8Sc,
            systemcode: sharedBn8Sc,
            kcac04: 1,
            kcac05: 0,
          },
        ],
      ],
    ])

    const tree = buildBomPartsUsageTreeNodesFromLayerCache('HEAD', 1, new Set(['HEAD']), layerCache, false)
    /** @type {{ parentSc: string, parentNode: unknown, sourceRow: Record<string, unknown> }[]} */
    const flat = []
    flattenPiBomPartRows('HEAD', tree, flat, 1, 'PQ-3633A1/BLU4')

    /** @type {Map<number, string>} */
    const expandKeyByPartsId = new Map()
    /** @type {Set<string>} */
    const usedExpandKeys = new Set(['HEAD'])
    /** @type {Set<string>} */
    const dedupeKeys = new Set()

    for (const { parentSc, parentNode, sourceRow } of flat) {
      if (String(sourceRow?.kcaa01 ?? '') !== 'BN-0008/-') continue
      const parentSourceRow =
        parentNode?._sourceRow && typeof parentNode._sourceRow === 'object'
          ? parentNode._sourceRow
          : parentNode
      const listParentSc = parentSourceRow
        ? resolvePiListExpandKeyFromBomPartsRow(parentSourceRow, expandKeyByPartsId, usedExpandKeys)
        : parentSc
      const dedupeKey = piBomListInsertDedupeKey(listParentSc, sourceRow)
      dedupeKeys.add(dedupeKey)
    }

    assert.equal(dedupeKeys.size, 4, 'BN-0008 四条路径应产生 4 个独立写入键')
  })

  test('PI-TEST111 拓扑：生产写入循环三条 BN-0005 展开键互不相同', () => {
    const scCut101 = '349454B1977B8AE65DA68A78C555EEB7EAB'
    const scCut102 = '3542451205F833D8452960112DA20D0801D'
    const scCut103 = '359EEF52C77BBD05BF3FC2CA3AE94E8FFA2'
    const sharedBn5Sc = '637E4014-AAC0-492D-87EF-30F1930A89E2'
    const sharedBn8Sc = '82C84EC2-4736-42C3-9CF7-C00C7157006F'

    /** @type {Map<string, Record<string, unknown>[]>} */
    const layerCache = new Map([
      [
        'HEAD',
        [
          { id: 2, kcaa01: 'CUT-BAG<10-1>', kcac02: scCut101, systemcode: scCut101, kcac04: 1, kcac05: 0 },
          { id: 3, kcaa01: 'CUT-BAG<10-2>', kcac02: scCut102, systemcode: scCut102, kcac04: 1, kcac05: 0 },
          { id: 4, kcaa01: 'CUT-BAG<10-3>', kcac02: scCut103, systemcode: scCut103, kcac04: 1, kcac05: 0 },
        ],
      ],
      [
        scCut101,
        [
          {
            id: 2617990,
            kcaa01: 'BN-0005/-',
            kcac02: sharedBn5Sc,
            systemcode: sharedBn5Sc,
            kcac04: 1,
            kcac05: 0,
          },
        ],
      ],
      [
        scCut102,
        [
          {
            id: 2617998,
            kcaa01: 'BN-0005/-',
            kcac02: sharedBn5Sc,
            systemcode: sharedBn5Sc,
            kcac04: 1,
            kcac05: 0,
          },
        ],
      ],
      [
        scCut103,
        [
          {
            id: 2618006,
            kcaa01: 'BN-0005/-',
            kcac02: sharedBn5Sc,
            systemcode: sharedBn5Sc,
            kcac04: 1,
            kcac05: 0,
          },
        ],
      ],
      [
        sharedBn5Sc,
        [
          {
            id: 71086,
            kcaa01: 'BN-0008/-',
            kcac02: sharedBn8Sc,
            systemcode: sharedBn8Sc,
            kcac04: 1,
            kcac05: 0,
          },
        ],
      ],
    ])

    const tree = buildBomPartsUsageTreeNodesFromLayerCache('HEAD', 1, new Set(['HEAD']), layerCache, false)
    const flat = []
    flattenPiBomPartRows('HEAD', tree, flat, 1, 'PQ-3633A1/BLU4')

    const expandKeyByPartsId = new Map()
    const usedExpandKeys = new Set(['HEAD'])
    const insertDedupeKeys = new Set()
    /** @type {string[]} */
    const bn5ExpandKeys = []

    for (const { parentSc, parentNode, sourceRow } of flat) {
      if (String(sourceRow?.kcaa01 ?? '') !== 'BN-0005/-') continue
      const parentSourceRow =
        parentNode?._sourceRow && typeof parentNode._sourceRow === 'object'
          ? parentNode._sourceRow
          : parentNode
      const listParentSc = parentSourceRow
        ? resolvePiListExpandKeyFromBomPartsRow(parentSourceRow, expandKeyByPartsId, usedExpandKeys)
        : parentSc
      const rowExpandKey = resolvePiListExpandKeyFromBomPartsRow(sourceRow, expandKeyByPartsId, usedExpandKeys)
      const dedupeKey = piBomListInsertDedupeKey(listParentSc, sourceRow)
      if (dedupeKey && insertDedupeKeys.has(dedupeKey)) continue
      if (dedupeKey) insertDedupeKeys.add(dedupeKey)
      bn5ExpandKeys.push(rowExpandKey)
    }

    assert.equal(bn5ExpandKeys.length, 3)
    assert.equal(new Set(bn5ExpandKeys).size, 3, '三条 BN-0005 须分配独立 systemcode')
    assert.equal(bn5ExpandKeys[0], sharedBn5Sc)
    assert.notEqual(bn5ExpandKeys[1], sharedBn5Sc)
    assert.notEqual(bn5ExpandKeys[2], sharedBn5Sc)
  })

  test('虚拟根用量快照：TAG kcac04=7 可序列化并在运算时还原（info≤50）', () => {
    const flag5Prefixes = ['BAG', 'TAG', 'RMP']
    const tree = [
      { kcaa01: 'BAG-PQ3633A1/BLU4', kcac04: 1, kcac05: 0, children: [] },
      { kcaa01: 'TAG-PQ3633A1/BLU4', kcac04: 7, kcac05: 0, children: [] },
      { kcaa01: 'RMP-PQ3633A1/BLU4', kcac04: 1, kcac05: 0, children: [] },
    ]
    const snap = collectPiBomVirtualRootQtyFromMasterTree(tree, flag5Prefixes)
    assert.equal(snap.get('TAG-PQ3633A1/BLU4')?.kcac04, 7)
    const info = serializePiBomVirtualRootQtyInfo(snap)
    assert.ok(info)
    assert.ok(info.length <= 50, `info 过长: ${info.length} ${info}`)
    assert.equal(info, 'v1:BAG/1,TAG/7,RMP/1')
    const parsed = parsePiBomVirtualRootQtyInfo(info)
    assert.equal(parsed.get('TAG-')?.kcac04, 7)
  })

  test('PI-TEST111 拓扑：TC-0001/580 在 BAG 父下仍保留两行', () => {
    const bagParent = '2541983F54FE7F2-10484044BD862A534CAF0BB20DCDE091'
    const topLevelParentKeys = new Set([bagParent])
    const sharedSc = '04486540-D2C6-4271-B6AE-0E8B1C58E757'
    const rowA = { id: 2618666, kcaa01: 'TC-0001/580', systemcode: sharedSc, Describe: '橡根/克' }
    const rowB = { id: 2618674, kcaa01: 'TC-0001/580', systemcode: sharedSc, Describe: '防水里' }
    const opts = { topLevelParentKeys }
    assert.notEqual(
      piBomListInsertDedupeKey(bagParent, rowA, opts),
      piBomListInsertDedupeKey(bagParent, rowB, opts),
    )
  })
})
