import test from 'node:test'
import assert from 'node:assert/strict'
import { aggregateBomCostUsageFlatForDisplay } from './bomCostUsageAggregate.js'

test('aggregateBomCostUsageFlatForDisplay 按 Seq 排序（非编码字母序）', () => {
  const rows = [
    { kcaa01: 'NN-0021/xx', Describe: '', yl: 1, loss_rate: 0, total_qty: 1, Seq: 2 },
    { kcaa01: 'LA-0368/xx', Describe: '', yl: 2, loss_rate: 0, total_qty: 2, Seq: 1 },
  ]
  const out = aggregateBomCostUsageFlatForDisplay(rows, [])
  assert.equal(out.length, 2)
  assert.equal(out[0].kcaa01, 'LA-0368/xx')
  assert.equal(out[1].kcaa01, 'NN-0021/xx')
})

test('aggregateBomCostUsageFlatForDisplay 合并行取最小 Seq', () => {
  const rows = [
    { kcaa01: 'LA-0368/xx', Describe: 'a', yl: 1, loss_rate: 0, total_qty: 1, Seq: 1 },
    { kcaa01: 'LA-0368/xx', Describe: 'a', yl: 1, loss_rate: 0, total_qty: 1, Seq: 1 },
    { kcaa01: 'NN-0021/xx', Describe: '', yl: 1, loss_rate: 0, total_qty: 1, Seq: 2 },
  ]
  const out = aggregateBomCostUsageFlatForDisplay(rows, [])
  assert.equal(out[0].kcaa01, 'LA-0368/xx')
  assert.equal(out[0].yl, 2)
})

test('aggregateBomCostUsageFlatForDisplay 有 px 时优先按 px 排序', () => {
  const rows = [
    { kcaa01: 'NN-0021/xx', Describe: '', yl: 1, loss_rate: 0, total_qty: 1, px: 20, Seq: 1 },
    { kcaa01: 'LA-0368/xx', Describe: '', yl: 1, loss_rate: 0, total_qty: 1, px: 10, Seq: 2 },
  ]
  const out = aggregateBomCostUsageFlatForDisplay(rows, [])
  assert.equal(out[0].kcaa01, 'LA-0368/xx')
  assert.equal(out[1].kcaa01, 'NN-0021/xx')
})

test('aggregateBomCostUsageFlatForDisplay 空 px 排在有 px 后面', () => {
  const rows = [
    { kcaa01: 'NO-PX', Describe: '', yl: 1, loss_rate: 0, total_qty: 1, Seq: 1 },
    { kcaa01: 'HAS-PX', Describe: '', yl: 1, loss_rate: 0, total_qty: 1, px: 99, Seq: 2 },
  ]
  const out = aggregateBomCostUsageFlatForDisplay(rows, [])
  assert.equal(out[0].kcaa01, 'HAS-PX')
  assert.equal(out[1].kcaa01, 'NO-PX')
})

test('aggregateBomCostUsageFlatForDisplay 合并行取最小 px 排序', () => {
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
