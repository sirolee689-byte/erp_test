import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { buildStockOutSourceLinesSql, resolveStockOutSourceConfig } from './stockOutSourceLines.js'

describe('stockOutSourceLines', () => {
  test('supports first-version linked outbound types 1 to 6', () => {
    for (const type of ['1', '2', '3', '4', '5', '6']) {
      assert.ok(resolveStockOutSourceConfig(type), `type ${type} should have source config`)
    }
    assert.equal(resolveStockOutSourceConfig('0'), null)
    assert.equal(resolveStockOutSourceConfig('9'), null)
  })

  test('source line SQL exposes remaining quantity and uses SQL Server 2008 R2 syntax', () => {
    const sql = buildStockOutSourceLinesSql({
      config: resolveStockOutSourceConfig('1'),
      cols: new Set(['id', 'systemcode', 'kcak01', 'kcak03', 'kcak07', 'kcaa01', 'kcaa02', 'kcaa03', 'kcaa04', 'kcaa05', 'kcaa26', 'kcaa27']),
      hasKeyword: true,
    })
    assert.match(sql, /SELECT TOP 200/)
    assert.match(sql, /remainingQty/)
    assert.match(sql, /\[kcak03\]/)
    assert.match(sql, /\[kcak07\]/)
    assert.doesNotMatch(sql, /OFFSET|TRY_CONVERT|FORMAT|IIF|CONCAT|SEQUENCE/i)
  })
})
