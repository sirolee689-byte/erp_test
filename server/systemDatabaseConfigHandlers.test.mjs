import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  buildSystemDatabaseConfigSystemcode,
  formatSystemDatabaseConfigTimestamp,
  getDefaultDatabaseConfigs,
} from './systemDatabaseConfigHandlers.js'

describe('数据库配置工具', () => {
  test('默认清单包含关键业务表', () => {
    const names = getDefaultDatabaseConfigs().map((item) => item.tableName)
    assert.ok(names.includes('UB_ERP_Sales_order'))
    assert.ok(names.includes('UB_ERP_Stocks_Storage'))
    assert.ok(names.includes('UB_ERP_System_Database_Config'))
  })

  test('核心编码使用年月日开头并限制在 50 位内', () => {
    const code = buildSystemDatabaseConfigSystemcode(new Date('2026-07-06T08:09:10'))
    assert.match(code, /^20260706/)
    assert.ok(code.length <= 50)
  })

  test('时间格式兼容 SQL Server 2008 R2 字符串写入', () => {
    assert.equal(formatSystemDatabaseConfigTimestamp(new Date('2026-07-06T08:09:10')), '2026-07-06 08:09:10')
  })
})
