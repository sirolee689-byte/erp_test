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
