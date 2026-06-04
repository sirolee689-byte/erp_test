import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  mapBom000ExtendedSnapshotRow,
  mapSalesOrderLineExtendedFromBom000Row,
  resolveSalesOrderLineTypeFromBom000,
} from './salesOrderLineBom000Snapshot.js'

describe('salesOrderLineBom000Snapshot', () => {
  test('resolveSalesOrderLineTypeFromBom000：有值抄 bom_000，空则 1', () => {
    assert.equal(resolveSalesOrderLineTypeFromBom000(2), 2)
    assert.equal(resolveSalesOrderLineTypeFromBom000('3'), 3)
    assert.equal(resolveSalesOrderLineTypeFromBom000(null), 1)
    assert.equal(resolveSalesOrderLineTypeFromBom000(''), 1)
    assert.equal(resolveSalesOrderLineTypeFromBom000('abc'), 1)
  })

  test('mapSalesOrderLineExtendedFromBom000Row：价格空写 NULL', () => {
    const mapped = mapSalesOrderLineExtendedFromBom000Row({
      kcaa02_en: ' Elastic ',
      kcaa32: '1.25',
      kcaa33: '',
      kcaa34: 'display-a',
      kcaa35: null,
      sale_price: '',
      cost_price: '0.88',
      type: null,
    })
    assert.equal(mapped.kcaa02_en, 'Elastic')
    assert.equal(mapped.kcaa32, 1.25)
    assert.equal(mapped.kcaa33, null)
    assert.equal(mapped.kcaa34, 'display-a')
    assert.equal(mapped.kcaa35, '')
    assert.equal(mapped.sale_price, null)
    assert.equal(mapped.cost_price, 0.88)
    assert.equal(mapped.type, 1)
  })

  test('mapBom000ExtendedSnapshotRow：含 kcaa12', () => {
    const mapped = mapBom000ExtendedSnapshotRow({ kcaa12: '7', type: 2 })
    assert.equal(mapped.kcaa12, 7)
    assert.equal(mapped.type, 2)
  })
})
