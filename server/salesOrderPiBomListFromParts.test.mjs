/**
 * PI BOM list 列快照：纯函数单测（不连库）
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  buildBomPartsSelectListForPiCopy,
  mergePiListPartRowWithBom000Override,
} from './salesOrderPiBomListFromParts.js'

describe('salesOrderPiBomListFromParts', () => {
  test('buildBomPartsSelectListForPiCopy 含 seq 与数值列', () => {
    const sql = buildBomPartsSelectListForPiCopy([
      { targetCol: 'seq', sourceCol: 'Seq', dataType: 'int' },
      { targetCol: 'kcac04', sourceCol: 'kcac04', dataType: 'decimal' },
      { targetCol: 'kcaa02', sourceCol: 'kcaa02', dataType: 'nvarchar' },
    ])
    assert.match(sql, /AS \[seq\]/)
    assert.match(sql, /AS \[kcac04\]/)
    assert.match(sql, /AS \[kcaa02\]/)
  })

  test('mergePiListPartRowWithBom000Override 有主档则覆盖，无主档保留 parts', () => {
    const parts = {
      kcaa01: 'PART-A',
      GUID: 'guid-parts',
      kcac03: 'U-PARTS',
      version: 1,
      location: 'LOC-PARTS',
      sale_price: 1,
      remark: 'from parts',
    }
    assert.deepEqual(mergePiListPartRowWithBom000Override(parts, undefined), parts)
    const merged = mergePiListPartRowWithBom000Override(parts, {
      GUID: 'guid-bom',
      kcac03: 'PCS',
      version: 100,
      location: 'LOC-000',
      sale_price: 99,
      remark: 'from bom',
    })
    assert.equal(merged.GUID, 'guid-bom')
    assert.equal(merged.kcac03, 'PCS')
    assert.equal(merged.version, 100)
    assert.equal(merged.location, 'LOC-000')
    assert.equal(merged.sale_price, 99)
    assert.equal(merged.remark, 'from bom')
    assert.equal(merged.kcaa01, 'PART-A')
  })
})
