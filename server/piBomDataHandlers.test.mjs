import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { buildPiBomReplaceBomSelectList, buildPiBomReplaceWhereSql } from './piBomDataHandlers.js'

describe('piBomDataHandlers', () => {
  test('PI-BOM material replace always filters Describe; empty form value matches empty rows only', () => {
    const sql = buildPiBomReplaceWhereSql(false)
    assert.match(sql, /@matchDescribe/)
    assert.doesNotMatch(sql, /hasMatch|不限/)
    const sqlWithPq = buildPiBomReplaceWhereSql(true)
    assert.match(sqlWithPq, /@matchDescribe/)
    assert.match(sqlWithPq, /@pq/)
  })

  test('PI-BOM material replace maps list kcac03 from bom_000 kcaa25', () => {
    const selectList = buildPiBomReplaceBomSelectList(['kcaa01', 'kcac03', 'cost_price'])

    assert.match(selectList, /b\.\[kcaa01\] AS \[kcaa01\]/)
    assert.match(selectList, /b\.\[kcaa25\] AS \[kcac03\]/)
    assert.match(selectList, /b\.\[cost_price\] AS \[cost_price\]/)
    assert.doesNotMatch(selectList, /b\.\[kcac03\]/)
  })
})
