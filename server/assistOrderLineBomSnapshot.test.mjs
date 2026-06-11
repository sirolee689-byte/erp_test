import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  mapAssistOrderBomSnapshotRow,
  mergeBomSnapshotIntoAssistLine,
} from './assistOrderLineBomSnapshot.js'
import { normalizeAssistOrderLine } from './assistOrderLineSave.js'

describe('assistOrderLineBomSnapshot', () => {
  test('mapAssistOrderBomSnapshotRow maps kcaa01-kcaa35 and extended fields', () => {
    const mapped = mapAssistOrderBomSnapshotRow({
      kcaa01: 'MAT-1',
      kcaa02: '材料',
      kcaa12: 1,
      kcaa35: 'RMB',
      kcaa02_en: 'Material',
      kpname: '开票名',
      sale_price: 12.5,
      cost_price: 8,
      type: 2,
      Customer_Name: 'SUP-001',
    })
    assert.equal(mapped.kcaa01, 'MAT-1')
    assert.equal(mapped.kcaa02, '材料')
    assert.equal(mapped.kcaa12, 1)
    assert.equal(mapped.kcaa35, 'RMB')
    assert.equal(mapped.kcaa02En, 'Material')
    assert.equal(mapped.invoiceName, '开票名')
    assert.equal(mapped.salePrice, 12.5)
    assert.equal(mapped.costPrice, 8)
    assert.equal(mapped.type, 2)
    assert.equal(mapped.customerName, 'SUP-001')
  })

  test('mergeBomSnapshotIntoAssistLine overwrites material fields but keeps amounts', () => {
    const line = normalizeAssistOrderLine({
      kcaa01: 'MAT-1',
      kcaa02: '旧名',
      wxak03: 5,
      wxak04: 1.2,
    })
    const merged = mergeBomSnapshotIntoAssistLine(line, {
      kcaa02: '新名',
      kcaa12: 1,
      kcaa35: 'USD',
    })
    assert.equal(merged.kcaa02, '新名')
    assert.equal(merged.kcaa12, 1)
    assert.equal(merged.kcaa35, 'USD')
    assert.equal(merged.wxak03, 5)
    assert.equal(merged.wxak04, 1.2)
  })

  test('mergeBomSnapshotIntoAssistLine merges customerName from PI BOM snapshot', () => {
    const line = normalizeAssistOrderLine({ kcaa01: 'MAT-1', wxak03: 1 })
    const merged = mergeBomSnapshotIntoAssistLine(line, { customerName: 'PI-SUP-88' })
    assert.equal(merged.customerName, 'PI-SUP-88')
  })
})
