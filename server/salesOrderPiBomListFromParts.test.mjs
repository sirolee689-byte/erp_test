/**
 * PI BOM list 列快照：纯函数单测（不连库）
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { buildBomPartsSelectListForPiCopy } from './salesOrderPiBomListFromParts.js'

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
})
