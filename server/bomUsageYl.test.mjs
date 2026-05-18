import test from 'node:test'
import assert from 'node:assert/strict'
import {
  bomCostMaterialStartsWithCutPrefix,
  bomCostUsageMatchesHidePrefix,
  buildBomCostInsertPayloadFromFlatUsage,
  computeBomUsageYlFromParent,
} from './bomUsageYl.js'

test('bomCostMaterialStartsWithCutPrefix', () => {
  assert.equal(bomCostMaterialStartsWithCutPrefix('CUT-BAGPQ2803H1/R-TEST<5-1>'), true)
  assert.equal(bomCostMaterialStartsWithCutPrefix('BN-0001/580'), false)
})

test('computeBomUsageYlFromParent 普通父级乘算', () => {
  assert.equal(computeBomUsageYlFromParent(0.5, 2, false), 1)
  assert.equal(computeBomUsageYlFromParent(0.017, null, false), 0.017)
})

test('computeBomUsageYlFromParent CUT 父级不乘父用量', () => {
  assert.equal(computeBomUsageYlFromParent(0.017, 2, true), 0.017)
  assert.equal(computeBomUsageYlFromParent(0.008, 2, true), 0.008)
})

test('bomCostUsageMatchesHidePrefix', () => {
  assert.equal(bomCostUsageMatchesHidePrefix('CUT-X', ['CUT-']), true)
  assert.equal(bomCostUsageMatchesHidePrefix('BN-1', ['CUT-']), false)
})

test('buildBomCostInsertPayloadFromFlatUsage 平铺不合并、剔除展示隐藏前缀', () => {
  const hide = ['CUT-', 'BAG-']
  const flat = [
    { kcaa01: 'CUT-A', Describe: '', yl: 2, loss_rate: 0, total_qty: 2 },
    { kcaa01: 'BAG-PQ1', Describe: '', yl: 1, loss_rate: 0, total_qty: 1 },
    { kcaa01: 'ZS-0034/CFL', Describe: '', yl: 1, loss_rate: 0, total_qty: 1 },
    { kcaa01: 'BN-1', Describe: 'A', yl: 0.017, loss_rate: 0, total_qty: 0.017 },
    { kcaa01: 'BN-1', Describe: 'A', yl: 0.008, loss_rate: 0, total_qty: 0.008 },
  ]
  const rows = buildBomCostInsertPayloadFromFlatUsage(flat, hide)
  assert.equal(rows.length, 3)
  assert.equal(rows[0].kcaa01, 'ZS-0034/CFL')
  assert.equal(rows[1].kcac04, 0.017)
  assert.equal(rows[2].kcac04, 0.008)
})

test('buildBomCostInsertPayloadFromFlatUsage 跳过主 BOM 根行 pq', () => {
  const flat = [
    { kcaa01: 'BAG-PQ2803H1/R-TEST', Describe: '', yl: 1, loss_rate: 0, total_qty: 1 },
    { kcaa01: 'BN-1', Describe: '', yl: 0.5, loss_rate: 0, total_qty: 0.5 },
  ]
  const rows = buildBomCostInsertPayloadFromFlatUsage(flat, [], 'BAG-PQ2803H1/R-TEST')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].kcaa01, 'BN-1')
})
