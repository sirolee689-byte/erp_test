import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { createDiningTableRefs, resolveDiningDatabaseName } from './diningDatabase.js'

describe('报餐正式库表名', () => {
  test('默认只指向 ERP_UB，不改变 ERP 当前数据库连接', () => {
    assert.equal(resolveDiningDatabaseName(undefined), 'ERP_UB')
    assert.equal(createDiningTableRefs('ERP_UB').meals, '[ERP_UB].dbo.[UB_ERP_Dining_meal]')
  })

  test('拒绝把环境变量当成 SQL 片段', () => {
    assert.throws(() => resolveDiningDatabaseName('ERP_UB]; DROP TABLE x;--'), /配置无效/)
  })
})
