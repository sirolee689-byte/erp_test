import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import {
  clearDiningAuth,
  getDiningToken,
  getDiningUser,
  saveDiningAuth,
} from './diningAuthStorage.js'

class MemoryStorage {
  constructor() { this.values = new Map() }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null }
  setItem(key, value) { this.values.set(key, String(value)) }
  removeItem(key) { this.values.delete(key) }
}

beforeEach(() => {
  globalThis.localStorage = new MemoryStorage()
})

test('报餐登录只读写 dining 键，不覆盖或清除 ERP 登录', () => {
  localStorage.setItem('erp_token', 'erp-token')
  localStorage.setItem('erp_user', '{"UserName":"admin"}')

  saveDiningAuth('dining-token', { new_code: 'E001', name: '员工甲' })
  assert.equal(getDiningToken(), 'dining-token')
  assert.equal(getDiningUser().new_code, 'E001')
  assert.equal(localStorage.getItem('erp_token'), 'erp-token')

  clearDiningAuth()
  assert.equal(getDiningToken(), '')
  assert.equal(localStorage.getItem('erp_token'), 'erp-token')
  assert.equal(localStorage.getItem('erp_user'), '{"UserName":"admin"}')
})
