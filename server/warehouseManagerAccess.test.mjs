import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  enameContainsUsercode,
  normalizeWarehouseManagerUsercode,
  sqlWarehouseEnameContainsUsercode,
} from './warehouseManagerAccess.js'

describe('warehouseManagerAccess', () => {
  test('normalize 去首尾空白', () => {
    assert.equal(normalizeWarehouseManagerUsercode(' 12580 '), '12580')
    assert.equal(normalizeWarehouseManagerUsercode(null), '')
  })

  test('空 ename 不匹配任何人（1A）', () => {
    assert.equal(enameContainsUsercode('', '12580'), false)
    assert.equal(enameContainsUsercode('   ', '12580'), false)
    assert.equal(enameContainsUsercode(null, '12580'), false)
  })

  test('精确令牌匹配：前后分号、多账号', () => {
    assert.equal(enameContainsUsercode('12580;', '12580'), true)
    assert.equal(enameContainsUsercode('001;12580;system;', '12580'), true)
    assert.equal(enameContainsUsercode('12580', '12580'), true)
  })

  test('防前缀误配：1258 不能匹配 12580', () => {
    assert.equal(enameContainsUsercode('12580;', '1258'), false)
    assert.equal(enameContainsUsercode('1258;', '12580'), false)
  })

  test('无 usercode 永不匹配', () => {
    assert.equal(enameContainsUsercode('12580;', ''), false)
    assert.equal(enameContainsUsercode('12580;', '  '), false)
  })

  test('ename 内空白会被忽略后匹配', () => {
    assert.equal(enameContainsUsercode('12580 ; 001;', '12580'), true)
  })

  test('SQL 片段含分号包裹与 LIKE 参数', () => {
    const frag = sqlWarehouseEnameContainsUsercode('[ename]', 'usercode')
    assert.match(frag, /N';'/)
    assert.match(frag, /@usercode/)
    assert.match(frag, /LIKE/)
    assert.match(frag, /\[ename\]/)
  })
})
