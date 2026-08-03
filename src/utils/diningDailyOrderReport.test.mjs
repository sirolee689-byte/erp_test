import assert from 'node:assert/strict'
import test from 'node:test'
import { pairDiningDailyOrderRows } from './diningDailyOrderReport.js'

test('每天订餐名单按连续序号组成左右奇偶双栏', () => {
  const rows = [
    { sequence: 1, employeeName: '甲' },
    { sequence: 2, employeeName: '乙' },
    { sequence: 3, employeeName: '丙' },
  ]
  assert.deepEqual(pairDiningDailyOrderRows(rows), [
    { left: rows[0], right: rows[1] },
    { left: rows[2], right: null },
  ])
})
