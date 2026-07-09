import test from 'node:test'
import assert from 'node:assert/strict'
import { aggregateBomCostUsageFlatForDisplay } from './bomCostUsageAggregate.js'

function round6(n) {
  return Math.round(Number(n) * 1e6) / 1e6
}

test('aggregateBomCostUsageFlatForDisplay sorts by Seq instead of code', () => {
  const rows = [
    { kcaa01: 'NN-0021/xx', Describe: '', yl: 1, loss_rate: 0, total_qty: 1, Seq: 2 },
    { kcaa01: 'LA-0368/xx', Describe: '', yl: 2, loss_rate: 0, total_qty: 2, Seq: 1 },
  ]
  const out = aggregateBomCostUsageFlatForDisplay(rows, [])
  assert.equal(out.length, 2)
  assert.equal(out[0].kcaa01, 'LA-0368/xx')
  assert.equal(out[1].kcaa01, 'NN-0021/xx')
})

test('aggregateBomCostUsageFlatForDisplay merges same code and same remark', () => {
  const rows = [
    { kcaa01: 'LA-0368/xx', Describe: 'a', yl: 1, loss_rate: 0, total_qty: 1, Seq: 1 },
    { kcaa01: 'LA-0368/xx', Describe: 'a', yl: 1, loss_rate: 0, total_qty: 1, Seq: 1 },
    { kcaa01: 'NN-0021/xx', Describe: '', yl: 1, loss_rate: 0, total_qty: 1, Seq: 2 },
  ]
  const out = aggregateBomCostUsageFlatForDisplay(rows, [])
  assert.equal(out[0].kcaa01, 'LA-0368/xx')
  assert.equal(out[0].yl, 2)
})

test('aggregateBomCostUsageFlatForDisplay splits same code by Describe', () => {
  const rows = [
    { kcaa01: 'LA-0240/N', Describe: '主皮', yl: 1, loss_rate: 0, total_qty: 1, Seq: 1 },
    { kcaa01: 'LA-0240/N', Describe: '副皮', yl: 2, loss_rate: 0, total_qty: 2, Seq: 1 },
  ]
  const out = aggregateBomCostUsageFlatForDisplay(rows, [])
  assert.equal(out.length, 2)
  assert.deepEqual(
    out.map((r) => r.Describe).sort(),
    ['主皮', '副皮'].sort(),
  )
})

test('aggregateBomCostUsageFlatForDisplay falls back to binfo for old cache', () => {
  const rows = [
    { kcaa01: 'LA-0240/N', Describe: '', binfo: '主皮', yl: 1, loss_rate: 0, total_qty: 1, Seq: 1 },
    { kcaa01: 'LA-0240/N', Describe: '', binfo: '副皮', yl: 2, loss_rate: 0, total_qty: 2, Seq: 1 },
  ]
  const out = aggregateBomCostUsageFlatForDisplay(rows, [])
  assert.equal(out.length, 2)
  assert.deepEqual(
    out.map((r) => r.Describe).sort(),
    ['主皮', '副皮'].sort(),
  )
})

test('aggregateBomCostUsageFlatForDisplay prefers Describe over binfo', () => {
  const rows = [
    { kcaa01: 'LA-0240/N', Describe: '新备注', binfo: '旧备注A', yl: 1, loss_rate: 0, total_qty: 1, Seq: 1 },
    { kcaa01: 'LA-0240/N', Describe: '新备注', binfo: '旧备注B', yl: 2, loss_rate: 0, total_qty: 2, Seq: 1 },
  ]
  const out = aggregateBomCostUsageFlatForDisplay(rows, [])
  assert.equal(out.length, 1)
  assert.equal(out[0].Describe, '新备注')
  assert.equal(out[0].yl, 3)
})

test('aggregateBomCostUsageFlatForDisplay sorts by px when px exists', () => {
  const rows = [
    { kcaa01: 'NN-0021/xx', Describe: '', yl: 1, loss_rate: 0, total_qty: 1, px: 20, Seq: 1 },
    { kcaa01: 'LA-0368/xx', Describe: '', yl: 1, loss_rate: 0, total_qty: 1, px: 10, Seq: 2 },
  ]
  const out = aggregateBomCostUsageFlatForDisplay(rows, [])
  assert.equal(out[0].kcaa01, 'LA-0368/xx')
  assert.equal(out[1].kcaa01, 'NN-0021/xx')
})

test('aggregateBomCostUsageFlatForDisplay sorts empty px after px rows', () => {
  const rows = [
    { kcaa01: 'NO-PX', Describe: '', yl: 1, loss_rate: 0, total_qty: 1, Seq: 1 },
    { kcaa01: 'HAS-PX', Describe: '', yl: 1, loss_rate: 0, total_qty: 1, px: 99, Seq: 2 },
  ]
  const out = aggregateBomCostUsageFlatForDisplay(rows, [])
  assert.equal(out[0].kcaa01, 'HAS-PX')
  assert.equal(out[1].kcaa01, 'NO-PX')
})

test('aggregateBomCostUsageFlatForDisplay uses minimum px for merged rows', () => {
  const rows = [
    { kcaa01: 'MERGED', Describe: 'same', yl: 1, loss_rate: 0, total_qty: 1, px: 30 },
    { kcaa01: 'OTHER', Describe: '', yl: 1, loss_rate: 0, total_qty: 1, px: 20 },
    { kcaa01: 'MERGED', Describe: 'same', yl: 2, loss_rate: 0, total_qty: 2, px: 10 },
  ]
  const out = aggregateBomCostUsageFlatForDisplay(rows, [])
  assert.equal(out[0].kcaa01, 'MERGED')
  assert.equal(out[0].yl, 3)
  assert.equal(out[1].kcaa01, 'OTHER')
})

test('aggregateBomCostUsageFlatForDisplay keeps same code adjacent when another code interleaves', () => {
  // 同分类 px 相同，别的编码按原顺序（下标）夹在同编码不同备注之间，应聚团不被劈开
  const rows = [
    { kcaa01: 'GM-0002/419', Describe: '主里', yl: 1, loss_rate: 0, total_qty: 1, Seq: 1 },
    { kcaa01: 'GP-0002/419', Describe: '主里', yl: 1, loss_rate: 0, total_qty: 1, Seq: 2 },
    { kcaa01: 'GP-0002/419', Describe: '副里', yl: 1, loss_rate: 0, total_qty: 1, Seq: 3 },
    { kcaa01: 'GM-0002/419', Describe: '副里', yl: 1, loss_rate: 0, total_qty: 1, Seq: 4 },
  ]
  const out = aggregateBomCostUsageFlatForDisplay(rows, [])
  assert.deepEqual(
    out.map((r) => r.kcaa01),
    ['GM-0002/419', 'GM-0002/419', 'GP-0002/419', 'GP-0002/419'],
  )
})

test('aggregateBomCostUsageFlatForDisplay keeps 6-decimal actual loss rate', () => {
  const rows = [
    {
      kcaa01: 'LA-0240/N',
      Describe: 'main',
      yl: 1,
      loss_rate: 0.23456,
      total_qty: 1.23456,
      Seq: 1,
    },
  ]
  const out = aggregateBomCostUsageFlatForDisplay(rows, [])
  assert.equal(out.length, 1)
  assert.equal(round6(out[0].loss_rate), 0.23456)
  assert.equal(round6(out[0].total_qty), 1.23456)
})

test('aggregateBomCostUsageFlatForDisplay keeps actual loss when total is rounded', () => {
  const rows = [
    {
      kcaa01: 'LA-TEST/N',
      Describe: 'main',
      yl: 0.123456,
      loss_rate: 0.2432,
      total_qty: 0.15348,
      Seq: 1,
    },
  ]
  const out = aggregateBomCostUsageFlatForDisplay(rows, [])
  assert.equal(out.length, 1)
  assert.equal(out[0].loss_rate, 0.2432)
  assert.equal(out[0].total_qty, 0.15348)
})

test('aggregateBomCostUsageFlatForDisplay keeps same loss after merging rows', () => {
  const rows = [
    {
      kcaa01: 'LA-TEST/N',
      Describe: 'main',
      yl: 0.123456,
      loss_rate: 0.2433,
      total_qty: 0.153492,
      Seq: 1,
    },
    {
      kcaa01: 'LA-TEST/N',
      Describe: 'main',
      yl: 0.222222,
      loss_rate: 0.2433,
      total_qty: 0.276289,
      Seq: 1,
    },
  ]
  const out = aggregateBomCostUsageFlatForDisplay(rows, [])
  assert.equal(out.length, 1)
  assert.equal(out[0].loss_rate, 0.2433)
  assert.equal(round6(out[0].yl), 0.345678)
  assert.equal(round6(out[0].total_qty), 0.429781)
})

test('aggregateBomCostUsageFlatForDisplay computes weighted loss without 2-decimal truncation', () => {
  const rows = [
    {
      kcaa01: 'LA-0240/N',
      Describe: 'main',
      yl: 1,
      loss_rate: 0.23456,
      total_qty: 1.23456,
      Seq: 1,
    },
    {
      kcaa01: 'LA-0240/N',
      Describe: 'main',
      yl: 3,
      loss_rate: 0.34567,
      total_qty: 4.03701,
      Seq: 1,
    },
  ]
  const out = aggregateBomCostUsageFlatForDisplay(rows, [])
  assert.equal(out.length, 1)
  assert.equal(out[0].yl, 4)
  assert.equal(round6(out[0].total_qty), 5.27157)
  assert.equal(Math.round(Number(out[0].loss_rate) * 1e8) / 1e8, 0.3178925)
})
