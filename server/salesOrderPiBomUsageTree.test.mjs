import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { flattenBomPartsCostUsageFlatForBomCost } from './bomUsageFlatten.js'
import {
  buildPiBomUsageTreeNodesFromLayerCache,
  inferVirtualRootTopLevelMeta,
  resolvePiBomUsageTreeRootKeys,
} from './salesOrderPiBomUsageTree.js'
import { flattenPiBomTreeForEdit } from './salesOrderPiBomMaintainLogic.js'

describe('salesOrderPiBomUsageTree', () => {
  test('订单头无子行时从虚拟根（BAG/TAG/RMP expand key）展开', () => {
    const headSc = 'HEAD-PQ'
    const bagSc = 'SC-BAG'
    const tagSc = 'SC-TAG'
    const cutBag = 'SC-CUT-BAG'
    const cutTag = 'SC-CUT-TAG'

    const listRows = [
      { kcac01: bagSc, kcac02: cutBag, systemcode: cutBag, seq: 1, id: 1 },
      { kcac01: tagSc, kcac02: cutTag, systemcode: cutTag, seq: 2, id: 2 },
    ]

    const roots = resolvePiBomUsageTreeRootKeys(headSc, listRows)
    assert.deepEqual(roots, [bagSc, tagSc])

    /** @type {Map<string, Record<string, unknown>[]>} */
    const layerCache = new Map([
      [
        bagSc,
        [
          {
            id: 1,
            kcaa01: 'CUT-BAG<1>',
            kcac01: bagSc,
            kcac02: cutBag,
            systemcode: cutBag,
            kcac04: 1,
            kcac05: 0,
          },
        ],
      ],
      [
        tagSc,
        [
          {
            id: 2,
            kcaa01: 'CUT-TAG<1>',
            kcac01: tagSc,
            kcac02: cutTag,
            systemcode: cutTag,
            kcac04: 1,
            kcac05: 0,
          },
        ],
      ],
      [cutBag, [{ id: 10, kcaa01: 'BN-0001/-', kcac01: cutBag, kcac02: '', systemcode: 'SC-BN1', kcac04: 1, kcac05: 0 }]],
      [cutTag, [{ id: 11, kcaa01: 'BN-0002/-', kcac01: cutTag, kcac02: '', systemcode: 'SC-BN2', kcac04: 1, kcac05: 0 }]],
    ])

    /** @type {any[]} */
    const tree = []
    for (const rootKey of roots) {
      tree.push(
        ...buildPiBomUsageTreeNodesFromLayerCache(
          rootKey,
          1,
          new Set([rootKey]),
          layerCache,
          'PQ-3633A1/BLU4',
        ),
      )
    }

    assert.equal(tree.length, 2)
    assert.equal(tree[0].kcaa01, 'CUT-BAG<1>')
    assert.equal(tree[1].kcaa01, 'CUT-TAG<1>')
    assert.equal(tree[0].children?.[0]?.kcaa01, 'BN-0001/-')
    assert.equal(tree[1].children?.[0]?.kcaa01, 'BN-0002/-')
  })

  test('订单头有直接子行时仍从 head systemcode 展开（兼容旧数据）', () => {
    const headSc = 'HEAD'
    const listRows = [
      { kcac01: headSc, kcac02: 'SC-CUT', systemcode: 'SC-CUT', seq: 1, id: 1 },
      { kcac01: 'VIRTUAL-BAG', kcac02: 'SC-CUT2', systemcode: 'SC-CUT2', seq: 2, id: 2 },
    ]
    assert.deepEqual(resolvePiBomUsageTreeRootKeys(headSc, listRows), [headSc])
  })

  test('按 kcac01 父子挂接，每条裁片路径各自展开子件（对标 BOM 用量树）', () => {
    const scCut91 = 'SC-CUT-9-1'
    const scCut101 = 'SC-CUT-10-1'
    const scCut102 = 'SC-CUT-10-2'
    const scCut103 = 'SC-CUT-10-3'
    const sc5a = 'SC-5-10-1'
    const sc5b = 'SC-5-10-2'
    const sc5c = 'SC-5-10-3'

    /** @type {Map<string, Record<string, unknown>[]>} */
    const layerCache = new Map([
      [
        'HEAD',
        [
          {
            id: 1,
            kcaa01: 'CUT-BAG<9-1>',
            kcac01: 'HEAD',
            kcac02: scCut91,
            systemcode: scCut91,
            kcac04: 1,
            kcac05: 0,
          },
          {
            id: 2,
            kcaa01: 'CUT-BAG<10-1>',
            kcac01: 'HEAD',
            kcac02: 'BN-0005/-',
            systemcode: scCut101,
            kcac04: 1,
            kcac05: 0,
          },
          {
            id: 3,
            kcaa01: 'CUT-BAG<10-2>',
            kcac01: 'HEAD',
            kcac02: 'BN-0005/-',
            systemcode: scCut102,
            kcac04: 1,
            kcac05: 0,
          },
          {
            id: 4,
            kcaa01: 'CUT-BAG<10-3>',
            kcac01: 'HEAD',
            kcac02: 'BN-0005/-',
            systemcode: scCut103,
            kcac04: 1,
            kcac05: 0,
          },
        ],
      ],
      [
        scCut91,
        [
          {
            id: 5,
            kcaa01: 'BN-0008/-',
            kcac01: scCut91,
            kcac02: '',
            systemcode: 'SC-8-9-1',
            kcac04: 1,
            kcac05: 0,
          },
        ],
      ],
      [
        scCut101,
        [
          {
            id: 10,
            kcaa01: 'BN-0005/-',
            kcac01: scCut101,
            kcac02: 'BN-0008/-',
            systemcode: sc5a,
            kcac04: 1,
            kcac05: 0,
          },
        ],
      ],
      [
        scCut102,
        [
          {
            id: 11,
            kcaa01: 'BN-0005/-',
            kcac01: scCut102,
            kcac02: 'BN-0008/-',
            systemcode: sc5b,
            kcac04: 1,
            kcac05: 0,
          },
        ],
      ],
      [
        scCut103,
        [
          {
            id: 12,
            kcaa01: 'BN-0005/-',
            kcac01: scCut103,
            kcac02: 'BN-0008/-',
            systemcode: sc5c,
            kcac04: 1,
            kcac05: 0,
          },
        ],
      ],
      [
        sc5a,
        [
          {
            id: 20,
            kcaa01: 'BN-0008/-',
            kcac01: sc5a,
            kcac02: '',
            systemcode: 'SC-8-10-1',
            kcac04: 1,
            kcac05: 0,
          },
        ],
      ],
      [
        sc5b,
        [
          {
            id: 21,
            kcaa01: 'BN-0008/-',
            kcac01: sc5b,
            kcac02: '',
            systemcode: 'SC-8-10-2',
            kcac04: 1,
            kcac05: 0,
          },
        ],
      ],
      [
        sc5c,
        [
          {
            id: 22,
            kcaa01: 'BN-0008/-',
            kcac01: sc5c,
            kcac02: '',
            systemcode: 'SC-8-10-3',
            kcac04: 1,
            kcac05: 0,
          },
        ],
      ],
    ])

    const tree = buildPiBomUsageTreeNodesFromLayerCache(
      'HEAD',
      1,
      new Set(['HEAD']),
      layerCache,
      'PQ-3633A1/BLU4',
    )
    const flat = flattenPiBomTreeForEdit(tree)
    const bn08 = flat.filter((r) => r.kcaa01 === 'BN-0008/-')
    assert.equal(bn08.length, 4, 'BN-0008 应出现 4 次（每条路径 1 次）')
    assert.equal(new Set(bn08.map((r) => r.id)).size, 4)

    const cut91 = tree.find((n) => n.kcaa01 === 'CUT-BAG<9-1>')
    assert.ok(cut91, '<9-1> 裁片应存在')
    assert.equal(cut91.children?.filter((c) => c.kcaa01 === 'BN-0008/-').length ?? 0, 1)

    function bn08UnderCut10x(cutCode) {
      const cut = tree.find((n) => n.kcaa01 === cutCode)
      assert.ok(cut, `${cutCode} 应存在`)
      const bn5 = cut.children?.find((c) => c.kcaa01 === 'BN-0005/-')
      assert.ok(bn5, `${cutCode} 下应有 BN-0005`)
      return bn5.children?.filter((c) => c.kcaa01 === 'BN-0008/-').length ?? 0
    }

    assert.equal(bn08UnderCut10x('CUT-BAG<10-1>'), 1)
    assert.equal(bn08UnderCut10x('CUT-BAG<10-2>'), 1)
    assert.equal(bn08UnderCut10x('CUT-BAG<10-3>'), 1)
  })

  test('kcac02 共用 ERP 编码时按 systemcode 展开，不重复挂子件', () => {
    const sharedBn5 = 'BN-0005/-'
    const sc5a = 'SC-5-10-1'
    const sc5b = 'SC-5-10-2'
    const sc5c = 'SC-5-10-3'
    const scCut91 = 'SC-CUT-9-1'

    /** @type {Map<string, Record<string, unknown>[]>} */
    const layerCache = new Map([
      [
        'HEAD',
        [
          {
            id: 1,
            kcaa01: 'CUT-BAG<9-1>',
            kcac01: 'HEAD',
            kcac02: scCut91,
            systemcode: scCut91,
            kcac04: 1,
            kcac05: 0,
          },
          {
            id: 2,
            kcaa01: 'CUT-BAG<10-1>',
            kcac01: 'HEAD',
            kcac02: sharedBn5,
            systemcode: sc5a,
            kcac04: 1,
            kcac05: 0,
          },
          {
            id: 3,
            kcaa01: 'CUT-BAG<10-2>',
            kcac01: 'HEAD',
            kcac02: sharedBn5,
            systemcode: sc5b,
            kcac04: 1,
            kcac05: 0,
          },
          {
            id: 4,
            kcaa01: 'CUT-BAG<10-3>',
            kcac01: 'HEAD',
            kcac02: sharedBn5,
            systemcode: sc5c,
            kcac04: 1,
            kcac05: 0,
          },
        ],
      ],
      [scCut91, [{ id: 5, kcaa01: 'BN-0008/-', kcac01: scCut91, kcac02: '', systemcode: 'SC-8-9-1', kcac04: 1, kcac05: 0 }]],
      [sc5a, [{ id: 10, kcaa01: 'BN-0005/-', kcac01: sc5a, kcac02: 'BN-0005/-', systemcode: 'SC-BN5-10-1', kcac04: 1, kcac05: 0 }]],
      [sc5b, [{ id: 11, kcaa01: 'BN-0005/-', kcac01: sc5b, kcac02: 'BN-0005/-', systemcode: 'SC-BN5-10-2', kcac04: 1, kcac05: 0 }]],
      [sc5c, [{ id: 12, kcaa01: 'BN-0005/-', kcac01: sc5c, kcac02: 'BN-0005/-', systemcode: 'SC-BN5-10-3', kcac04: 1, kcac05: 0 }]],
      ['SC-BN5-10-1', [{ id: 20, kcaa01: 'BN-0008/-', kcac01: 'SC-BN5-10-1', kcac02: '', systemcode: 'SC-8-10-1', kcac04: 1, kcac05: 0 }]],
      ['SC-BN5-10-2', [{ id: 21, kcaa01: 'BN-0008/-', kcac01: 'SC-BN5-10-2', kcac02: '', systemcode: 'SC-8-10-2', kcac04: 1, kcac05: 0 }]],
      ['SC-BN5-10-3', [{ id: 22, kcaa01: 'BN-0008/-', kcac01: 'SC-BN5-10-3', kcac02: '', systemcode: 'SC-8-10-3', kcac04: 1, kcac05: 0 }]],
      // 旧逻辑误用 kcac02 时会读到这一整池（3 行 BN-0008）
      [
        sharedBn5,
        [
          { id: 20, kcaa01: 'BN-0008/-', kcac01: sharedBn5, kcac02: '', systemcode: 'X1', kcac04: 1, kcac05: 0 },
          { id: 21, kcaa01: 'BN-0008/-', kcac01: sharedBn5, kcac02: '', systemcode: 'X2', kcac04: 1, kcac05: 0 },
          { id: 22, kcaa01: 'BN-0008/-', kcac01: sharedBn5, kcac02: '', systemcode: 'X3', kcac04: 1, kcac05: 0 },
        ],
      ],
    ])

    const tree = buildPiBomUsageTreeNodesFromLayerCache(
      'HEAD',
      1,
      new Set(['HEAD']),
      layerCache,
      'PQ-3633A1/BLU4',
    )
    const flat = flattenPiBomTreeForEdit(tree)
    const bn08 = flat.filter((r) => r.kcaa01 === 'BN-0008/-')
    assert.equal(bn08.length, 4)
    assert.equal(new Set(bn08.map((r) => r.id)).size, 4)

    const cut10 = tree.find((n) => n.kcaa01 === 'CUT-BAG<10-1>')
    const bn5 = cut10?.children?.find((c) => c.kcaa01 === 'BN-0005/-')
    assert.equal(bn5?.children?.filter((c) => c.kcaa01 === 'BN-0008/-').length ?? 0, 1)
  })

  test('虚拟根合成节点使用 TAG 真实 kcac04=7 参与用量乘算', () => {
    const qtyByKcaa01 = new Map([['TAG-PQ3633A1/BLU4', { kcac04: 7, kcac05: 0 }]])
    const children = [
      {
        id: 1,
        kcaa01: 'CUT-TAGPQ3633A1/BLU4<1-1>',
        kcac04: 1,
        kcac05: 0,
        children: [
          {
            id: 2,
            kcaa01: 'MB-0089/CFL',
            kcac04: 1,
            kcac05: 0,
            children: [],
          },
        ],
      },
    ]
    const meta = inferVirtualRootTopLevelMeta(children, 'PQ-3633A1/BLU4', qtyByKcaa01)
    assert.equal(meta.kcaa01, 'TAG-PQ3633A1/BLU4')
    assert.equal(meta.kcac04, 7)

    const tree = [
      {
        id: null,
        kcaa01: meta.kcaa01,
        kcac04: meta.kcac04,
        kcac05: meta.kcac05,
        kcaa33: 0,
        children,
      },
    ]
    const flat = flattenBomPartsCostUsageFlatForBomCost(tree, null, [])
    const mb = flat.find((r) => r.kcaa01 === 'MB-0089/CFL')
    assert.equal(mb?.yl, 7)
  })

  test('多明细款共用 kcac01 父键时 pkcaa01 预过滤后各款树互不影响', () => {
    const sharedBn5 = '637E4014-AAC0-492D-87EF-30F1930A89E2'
    const scCut101 = 'SC-CUT-10-1'
    const productA = 'PQ-3633A1/BLU4'
    const productB = 'PQ-3119B2/GRN'

    /** 模拟 prefetchPiBomListLayers 已按 pkcaa01 过滤后的 BLU4 层缓存 */
    /** @type {Map<string, Record<string, unknown>[]>} */
    const blu4Cache = new Map([
      [
        'HEAD-A',
        [
          {
            id: 2,
            kcaa01: 'CUT-BAG<10-1>',
            kcac01: 'HEAD-A',
            kcac02: scCut101,
            systemcode: scCut101,
            kcac04: 1,
            kcac05: 0,
          },
        ],
      ],
      [
        scCut101,
        [
          {
            id: 10,
            kcaa01: 'BN-0005/-',
            kcac01: scCut101,
            kcac02: sharedBn5,
            systemcode: sharedBn5,
            kcac04: 1,
            kcac05: 0,
          },
        ],
      ],
      [
        sharedBn5,
        [
          {
            id: 100,
            kcaa01: 'BN-0008/-',
            kcac01: sharedBn5,
            kcac02: '',
            systemcode: 'SC-8-BLU4',
            kcac04: 1,
            kcac05: 0,
          },
        ],
      ],
    ])

    /** 若未过滤，sharedBn5 下还会有 GRN 的 BN-0008 */
    /** @type {Map<string, Record<string, unknown>[]>} */
    const mixedCache = new Map(blu4Cache)
    mixedCache.set(sharedBn5, [
      ...(blu4Cache.get(sharedBn5) ?? []),
      {
        id: 200,
        kcaa01: 'BN-0008/-',
        kcac01: sharedBn5,
        kcac02: '',
        systemcode: 'SC-8-GRN',
        kcac04: 1,
        kcac05: 0,
      },
    ])

    const treeFiltered = buildPiBomUsageTreeNodesFromLayerCache(
      'HEAD-A',
      1,
      new Set(['HEAD-A']),
      blu4Cache,
      productA,
    )
    const treeMixed = buildPiBomUsageTreeNodesFromLayerCache(
      'HEAD-A',
      1,
      new Set(['HEAD-A']),
      mixedCache,
      productA,
    )

    function bn08Under101(tree) {
      const cut = tree.find((n) => n.kcaa01 === 'CUT-BAG<10-1>')
      const bn5 = cut?.children?.find((c) => c.kcaa01 === 'BN-0005/-')
      return bn5?.children?.filter((c) => c.kcaa01 === 'BN-0008/-').length ?? 0
    }

    assert.equal(bn08Under101(treeFiltered), 1, `${productA} 过滤后 10-1 下应 1 行 BN-0008`)
    assert.equal(bn08Under101(treeMixed), 2, '未按 pkcaa01 过滤时会误读另一明细款')
    assert.notEqual(productA, productB)
  })
})
