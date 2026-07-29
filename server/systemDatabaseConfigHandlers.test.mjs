import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { getDefaultDatabaseConfigs } from './systemDatabaseConfigHandlers.js'

describe('数据库配置表清单', () => {
  test('已停用快照表和未使用兼容表不出现在默认业务清单', () => {
    const names = new Set(getDefaultDatabaseConfigs().map((row) => row.tableName.toLowerCase()))
    for (const name of [
      'ub_erp_stock_stats_snapshot',
      'ub_erp_stock_stats_snapshot_line',
      'inv_stockin',
      'sys_operationlogs',
      'sys_roles',
      'sys_users',
    ]) {
      assert.equal(names.has(name), false)
    }
  })

  test('默认清单保留连续排序序号', () => {
    const rows = getDefaultDatabaseConfigs()
    assert.deepEqual(rows.map((row) => row.sortOrder), rows.map((_row, index) => index + 1))
  })
})
