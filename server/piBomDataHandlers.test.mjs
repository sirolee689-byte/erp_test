import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  assertErpCoreConfigKey,
  buildPiBomReplaceBomSelectList,
  buildPiBomReplaceWhereSql,
} from './piBomDataHandlers.js'

describe('piBomDataHandlers', () => {
  test('PI-BOM material replace always filters Describe; empty form value matches empty rows only', () => {
    const sql = buildPiBomReplaceWhereSql(false)
    assert.match(sql, /@matchDescribe/)
    assert.doesNotMatch(sql, /hasMatch|不限/)
    const sqlWithPq = buildPiBomReplaceWhereSql(true)
    assert.match(sqlWithPq, /@matchDescribe/)
    assert.match(sqlWithPq, /@pq/)
  })

  test('PI-BOM material replace maps list kcac03 from UB_ERP_Bom_000 kcaa25', () => {
    const selectList = buildPiBomReplaceBomSelectList(['kcaa01', 'kcac03', 'cost_price'])

    assert.match(selectList, /b\.\[kcaa01\] AS \[kcaa01\]/)
    assert.match(selectList, /b\.\[kcaa25\] AS \[kcac03\]/)
    assert.match(selectList, /b\.\[cost_price\] AS \[cost_price\]/)
    assert.doesNotMatch(selectList, /b\.\[kcac03\]/)
  })

  test('assertErpCoreConfigKey matches ERP_CORE_CONFIG_KEY like system kernel', () => {
    const prev = process.env.ERP_CORE_CONFIG_KEY
    try {
      delete process.env.ERP_CORE_CONFIG_KEY
      const missing = assertErpCoreConfigKey('any')
      assert.equal(missing.ok, false)
      assert.equal(missing.status, 500)

      process.env.ERP_CORE_CONFIG_KEY = 'erp-core-secret'
      const empty = assertErpCoreConfigKey('')
      assert.equal(empty.ok, false)
      assert.equal(empty.status, 400)

      const wrong = assertErpCoreConfigKey('wrong')
      assert.equal(wrong.ok, false)
      assert.equal(wrong.status, 403)

      const ok = assertErpCoreConfigKey('erp-core-secret')
      assert.equal(ok.ok, true)
    } finally {
      if (prev === undefined) delete process.env.ERP_CORE_CONFIG_KEY
      else process.env.ERP_CORE_CONFIG_KEY = prev
    }
  })
})
