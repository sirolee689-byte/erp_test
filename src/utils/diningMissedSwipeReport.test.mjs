import assert from 'node:assert/strict'
import test from 'node:test'
import { formatDiningMealDateWithWeek, getDiningMonthDateRange } from './diningMissedSwipeReport.js'

test('选择月份会回填当月首日和末日', () => {
  assert.deepEqual(getDiningMonthDateRange('2026-07'), { startDate: '2026-07-01', endDate: '2026-07-31' })
  assert.deepEqual(getDiningMonthDateRange('2024-02'), { startDate: '2024-02-01', endDate: '2024-02-29' })
  assert.equal(getDiningMonthDateRange('2026-13'), null)
})

test('订餐日期显示中文星期', () => {
  assert.equal(formatDiningMealDateWithWeek('2026-07-14'), '2026-07-14（周二）')
  assert.equal(formatDiningMealDateWithWeek('2026-02-30'), '2026-02-30')
})
