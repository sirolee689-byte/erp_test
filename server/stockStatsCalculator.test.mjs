import test from 'node:test'
import assert from 'node:assert/strict'
import { computeStockStatsRow } from './stockStatsCalculator.js'
import { isStockStatsMaterialExcluded } from './stockStatsMaterialExclude.js'

test('computeStockStatsRow：期初与本期加权出库', () => {
  const row = computeStockStatsRow({
    kcaa01: 'LA-0001',
    warehouseCode: '01',
    openingInQty: 100,
    openingOutQty: 20,
    openingInMoney: 1000,
    periodIn010125Qty: 50,
    periodIn010125Money: 600,
    periodOut1Qty: 10,
    periodOut1Money: 100,
    periodOut407102Qty: 30,
    periodIn34Qty: 5,
    periodOut8Qty: 2,
    periodIn7Qty: 3,
    periodIn7Money: 30,
    periodOut9Qty: 1,
    periodOut9Money: 10,
  })

  assert.equal(row.lastsum, 80)
  assert.equal(row.lastprice, 10)
  assert.equal(row.lastmoney, 800)
  assert.equal(row.nowin, 40)
  assert.equal(row.nowmoney, 500)
  assert.equal(row.nowout, 25)
  const weighted = (800 + 500) / (80 + 40)
  assert.ok(Math.abs(row.nowoutprice - weighted) < 0.0001)
  assert.equal(row.nowbs, 2)
  assert.equal(row.hzkcm, 2)
  assert.equal(row.hzmoney, 20)
  assert.equal(row.nowsum, 80 + 40 - 25 - 2 + 2)
})

test('computeStockStatsRow：本期入库为 0 时入库单价为 0', () => {
  const row = computeStockStatsRow({
    openingInQty: 10,
    openingOutQty: 0,
    openingInMoney: 100,
    periodIn010125Qty: 0,
    periodIn010125Money: 0,
    periodOut1Qty: 0,
    periodOut1Money: 0,
    periodOut407102Qty: 0,
    periodIn34Qty: 0,
    periodOut8Qty: 0,
    periodIn7Qty: 0,
    periodIn7Money: 0,
    periodOut9Qty: 0,
    periodOut9Money: 0,
  })
  assert.equal(row.nowinprice, 0)
  assert.equal(row.nowsum, 10)
})

test('isStockStatsMaterialExcluded：前缀与 -OUT 例外', () => {
  assert.equal(isStockStatsMaterialExcluded('PQ-1001'), true)
  assert.equal(isStockStatsMaterialExcluded('LA-0274'), false)
  assert.equal(isStockStatsMaterialExcluded('XX-OUT-YY'), true)
  assert.equal(isStockStatsMaterialExcluded('kt-OUT-01'), false)
  assert.equal(isStockStatsMaterialExcluded('kc-OUT-02'), false)
})
