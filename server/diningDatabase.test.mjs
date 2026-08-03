import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  createDiningTableRefs,
  isDiningTerminalTestMode,
  resolveDiningDatabaseName,
} from './diningDatabase.js'

describe('饭堂独立数据库配置', () => {
  test('必须显式指定饭堂数据库，避免测试期间误写正式库', () => {
    assert.throws(() => resolveDiningDatabaseName(''), /DINING_DB_DATABASE/)
    const tables = createDiningTableRefs('UB_ERP_V2.0')
    assert.equal(tables.meals, '[UB_ERP_V2.0].dbo.[UB_ERP_Dining_meal]')
    assert.equal(tables.mealLogs, '[UB_ERP_V2.0].dbo.[UB_ERP_Dining_meal_log]')
    assert.equal(tables.machines, '[UB_ERP_V2.0].dbo.[UB_ERP_Dining_machine]')
  })

  test('拒绝把环境变量当成 SQL 片段', () => {
    assert.throws(() => resolveDiningDatabaseName('ERP_UB]; DROP TABLE x;--'), /正确配置/)
  })

  test('手动日期餐别只允许在 UB_ERP_V2.0 开启', () => {
    assert.equal(isDiningTerminalTestMode('UB_ERP_V2.0', 'true'), true)
    assert.equal(isDiningTerminalTestMode('ERP_UB', 'true'), false)
    assert.equal(isDiningTerminalTestMode('UB_ERP_V2.0', 'false'), false)
  })
})
