import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildBomPartsUsageTreeNodesFromLayerCache,
  normalizeUsageTreeParentKey,
} from './bomUsageTreeBuild.js'

/**
 * @param {Array<Record<string, unknown>>} flat
 * @returns {Map<string, Record<string, unknown>[]>}
 */
function layerCacheFromFlat(flat) {
  /** @type {Map<string, Record<string, unknown>[]>} */
  const cache = new Map()
  for (const row of flat) {
    const parent = normalizeUsageTreeParentKey(row.kcac01_parent)
    if (!cache.has(parent)) cache.set(parent, [])
    cache.get(parent).push(row)
  }
  return cache
}

/** @param {any[]} nodes */
function treeSnapshot(nodes) {
  return nodes.map((n) => ({
    kcaa01: n.kcaa01,
    kcac02: n.kcac02,
    level: n.level,
    childCodes: (n.children ?? []).map((c) => c.kcaa01),
  }))
}

test('buildBomPartsUsageTreeNodesFromLayerCache DFS 顺序与子层', () => {
  const cache = layerCacheFromFlat([
    {
      kcac01_parent: 'ROOT',
      id: 1,
      kcaa01: 'CUT-A',
      kcac02: 'SC-A',
      kcac04: 2,
      kcac05: 0,
      kcaa33: 0,
      kcaa13: 0,
      Describe: '',
      Seq: 1,
    },
    {
      kcac01_parent: 'ROOT',
      id: 2,
      kcaa01: 'BN-1',
      kcac02: '',
      kcac04: 1,
      kcac05: 0,
      kcaa33: 0,
      kcaa13: 0,
      Describe: 'r1',
      Seq: 2,
    },
    {
      kcac01_parent: 'SC-A',
      id: 3,
      kcaa01: 'LA-1',
      kcac02: '',
      kcac04: 0.5,
      kcac05: 0,
      kcaa33: 0,
      kcaa13: 0,
      Describe: '',
      Seq: 1,
    },
  ])
  const tree = buildBomPartsUsageTreeNodesFromLayerCache('ROOT', 1, new Set(['ROOT']), cache)
  assert.equal(tree.length, 2)
  assert.deepEqual(treeSnapshot(tree), [
    { kcaa01: 'CUT-A', kcac02: 'SC-A', level: 1, childCodes: ['LA-1'] },
    { kcaa01: 'BN-1', kcac02: '', level: 1, childCodes: [] },
  ])
  assert.equal(tree[0].children[0].level, 2)
  assert.equal(tree[0].children[0].kcac04, 0.5)
})

test('buildBomPartsUsageTreeNodesFromLayerCache 循环引用抛 BOM_CYCLE', () => {
  const cache = layerCacheFromFlat([
    {
      kcac01_parent: 'A',
      id: 1,
      kcaa01: 'X',
      kcac02: 'B',
      kcac04: 1,
      kcac05: 0,
      kcaa33: 0,
      kcaa13: 0,
      Describe: '',
      Seq: 1,
    },
    {
      kcac01_parent: 'B',
      id: 2,
      kcaa01: 'Y',
      kcac02: 'A',
      kcac04: 1,
      kcac05: 0,
      kcaa33: 0,
      kcaa13: 0,
      Describe: '',
      Seq: 1,
    },
  ])
  assert.throws(
    () => buildBomPartsUsageTreeNodesFromLayerCache('A', 1, new Set(['A']), cache),
    (e) => e.code === 'BOM_CYCLE',
  )
})

test('预取与逐层填充同一 cache 时树结构一致', () => {
  const flat = [
    {
      kcac01_parent: 'R',
      id: 10,
      kcaa01: 'P1',
      kcac02: 'C1',
      kcac04: 1,
      kcac05: 0,
      kcaa33: 0,
      kcaa13: 0,
      Describe: '',
      Seq: 1,
    },
    {
      kcac01_parent: 'R',
      id: 11,
      kcaa01: 'P2',
      kcac02: 'C1',
      kcac04: 1,
      kcac05: 0,
      kcaa33: 0,
      kcaa13: 0,
      Describe: '',
      Seq: 2,
    },
    {
      kcac01_parent: 'C1',
      id: 12,
      kcaa01: 'LEAF',
      kcac02: '',
      kcac04: 3,
      kcac05: 0,
      kcaa33: 0,
      kcaa13: 0,
      Describe: 'd',
      Seq: 1,
    },
  ]
  const fullCache = layerCacheFromFlat(flat)
  const treeBatch = buildBomPartsUsageTreeNodesFromLayerCache('R', 1, new Set(['R']), fullCache)

  /** 模拟旧版：仅按需放入单层 */
  /** @type {Map<string, Record<string, unknown>[]>} */
  const lazyCache = new Map()
  function getLayer(parent) {
    const key = normalizeUsageTreeParentKey(parent)
    if (!lazyCache.has(key)) {
      lazyCache.set(key, fullCache.get(key) ?? [])
    }
    return lazyCache.get(key)
  }
  function buildLazy(parent, level, stack) {
    const rows = getLayer(parent)
    const out = []
    for (const row of rows) {
      const childSc = normalizeUsageTreeParentKey(row.kcac02)
      let children = []
      if (childSc) {
        const next = new Set(stack)
        next.add(childSc)
        children = buildLazy(childSc, level + 1, next)
      }
      out.push({
        kcaa01: String(row.kcaa01 ?? ''),
        kcac02: String(row.kcac02 ?? ''),
        level,
        children: children.map((c) => ({ kcaa01: c.kcaa01, children: c.children })),
      })
    }
    return out
  }
  const treeLazy = buildLazy('R', 1, new Set(['R']))
  assert.deepEqual(treeSnapshot(treeBatch), treeSnapshot(treeLazy))
})

test('buildBomPartsUsageTreeNodesFromLayerCache usageTree 子层按 systemcode 展开', () => {
  const cache = layerCacheFromFlat([
    {
      kcac01_parent: 'ROOT',
      id: 1,
      kcaa01: 'CUT-A',
      systemcode: 'SC-CUT-A',
      kcac02: 'WRONG-KEY',
      kcac04: 1,
      kcac05: 0,
      kcaa33: 0,
      kcaa13: 0,
      Describe: '',
      Seq: 1,
    },
    {
      kcac01_parent: 'SC-CUT-A',
      id: 2,
      kcaa01: 'LA-1',
      systemcode: '',
      kcac02: '',
      kcac04: 0.5,
      kcac05: 0,
      kcaa33: 0,
      kcaa13: 0,
      Describe: '',
      Seq: 1,
    },
  ])
  const legacy = buildBomPartsUsageTreeNodesFromLayerCache('ROOT', 1, new Set(['ROOT']), cache, false)
  assert.deepEqual(treeSnapshot(legacy), [
    { kcaa01: 'CUT-A', kcac02: 'WRONG-KEY', level: 1, childCodes: [] },
  ])
  const piWrite = buildBomPartsUsageTreeNodesFromLayerCache('ROOT', 1, new Set(['ROOT']), cache, true)
  assert.deepEqual(treeSnapshot(piWrite), [
    { kcaa01: 'CUT-A', kcac02: 'WRONG-KEY', level: 1, childCodes: ['LA-1'] },
  ])
})
