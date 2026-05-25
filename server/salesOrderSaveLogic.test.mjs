import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  mergeSalesOrderLinesByKcaa01,
  planPiBomAlign,
  shouldMarkSalesOrderUncalculated,
  buildNextSalesOrderSystemCode,
} from './salesOrderSaveLogic.js'

describe('salesOrderSaveLogic', () => {
  test('mergeSalesOrderLinesByKcaa01 同 PI 同编码合并数量', () => {
    const merged = mergeSalesOrderLinesByKcaa01([
      { kcaa01: ' BAG-A ', orderQty: 2 },
      { kcaa01: 'BAG-A', orderQty: 3 },
      { kcaa01: 'BAG-B', orderQty: 1 },
    ])
    assert.equal(merged.length, 2)
    assert.equal(merged[0].kcaa01, 'BAG-A')
    assert.equal(merged[0].orderQty, 5)
    assert.equal(merged[1].kcaa01, 'BAG-B')
    assert.equal(merged[1].orderQty, 1)
  })

  test('planPiBomAlign 删款/新款/保留', () => {
    const plan = planPiBomAlign({
      detailKcaa01: ['BAG-B', 'BAG-C'],
      existingPiBomKcaa01: ['BAG-A', 'BAG-B'],
    })
    assert.deepEqual(plan.toDelete.sort(), ['BAG-A'])
    assert.deepEqual(plan.toCreate.sort(), ['BAG-C'])
    assert.deepEqual(plan.toKeep.sort(), ['BAG-B'])
  })

  test('shouldMarkSalesOrderUncalculated 编码集合或数量变化', () => {
    const oldLines = [{ kcaa01: 'A', orderQty: 1 }]
    assert.equal(
      shouldMarkSalesOrderUncalculated(oldLines, [{ kcaa01: 'A', orderQty: 2 }]),
      true,
    )
    assert.equal(
      shouldMarkSalesOrderUncalculated(oldLines, [{ kcaa01: 'B', orderQty: 1 }]),
      true,
    )
    assert.equal(
      shouldMarkSalesOrderUncalculated(oldLines, [{ kcaa01: 'A', orderQty: 1 }]),
      false,
    )
  })

  test('buildNextSalesOrderSystemCode 同日序号 +1', () => {
    const d = new Date('2026-05-24T10:00:00')
    assert.equal(
      buildNextSalesOrderSystemCode({
        salesDate: d,
        existingCodes: ['PI-20260524-001', 'PI-20260524-005'],
      }),
      'PI-20260524-006',
    )
    assert.equal(
      buildNextSalesOrderSystemCode({ salesDate: d, existingCodes: [] }),
      'PI-20260524-001',
    )
  })

  test('buildNextSalesOrderSystemCode 满 999 失败', () => {
    const d = new Date('2026-05-24T10:00:00')
    const existing = []
    for (let i = 1; i <= 999; i++) {
      existing.push(`PI-20260524-${String(i).padStart(3, '0')}`)
    }
    assert.throws(
      () => buildNextSalesOrderSystemCode({ salesDate: d, existingCodes: existing }),
      /999/,
    )
  })
})
