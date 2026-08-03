import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import {
  DINING_SUPPLEMENT_MSG_APPLY,
  parseDiningSupplementResultStorageEvent,
  readDiningSupplementContext,
  readDiningSupplementResult,
  removeDiningSupplementContext,
  removeDiningSupplementResult,
  writeDiningSupplementContext,
  writeDiningSupplementResult,
} from './diningSupplementBatch.js'

class MemoryStorage {
  constructor() { this.data = new Map() }
  getItem(key) { return this.data.has(key) ? this.data.get(key) : null }
  setItem(key, value) { this.data.set(key, String(value)) }
  removeItem(key) { this.data.delete(key) }
}

test('批量添加上下文和结果使用同站点共享存储，并可在处理后清理', () => {
  globalThis.localStorage = new MemoryStorage()
  const sessionId = 'supplement-test-1'
  const context = { existingIds: [1], maxStaff: 500 }
  const result = { type: DINING_SUPPLEMENT_MSG_APPLY, sessionId, rows: [{ id: 2 }] }

  writeDiningSupplementContext(sessionId, context)
  assert.deepEqual(readDiningSupplementContext(sessionId), context)
  assert.equal(writeDiningSupplementResult(sessionId, result), true)
  assert.deepEqual(readDiningSupplementResult(sessionId), result)

  const storagePayload = parseDiningSupplementResultStorageEvent({
    key: `dining-supplement-batch-result:${sessionId}`,
    newValue: JSON.stringify(result),
  })
  assert.deepEqual(storagePayload, result)

  removeDiningSupplementContext(sessionId)
  removeDiningSupplementResult(sessionId)
  assert.equal(readDiningSupplementContext(sessionId), null)
  assert.equal(readDiningSupplementResult(sessionId), null)
})

test('批量添加关闭按钮通过页面方法调用浏览器关闭动作', async () => {
  const source = await readFile(new URL('../views/canteen/records/supplement-staff-window.vue', import.meta.url), 'utf8')
  const parentSource = await readFile(new URL('../views/canteen/records/index.vue', import.meta.url), 'utf8')
  assert.match(source, /@click="closeWindow"/)
  assert.match(source, /function closeWindow\(\) \{ window\.close\(\) \}/)
  assert.doesNotMatch(source, /@click="window\.close\(\)"/)
  assert.match(parentSource, /child\.close\(\)/)
})

test('补录基础资料固定为两列350px', async () => {
  const source = await readFile(new URL('../views/canteen/records/index.vue', import.meta.url), 'utf8')
  assert.match(source, /grid-template-columns: repeat\(2, 350px\)/)
  assert.match(source, /\.supplement-field \{ width: 350px;/)
})

test('补录管理与审核按固定主明细列展示并拆分审核权限', async () => {
  const source = await readFile(new URL('../views/canteen/records/index.vue', import.meta.url), 'utf8')
  assert.match(source, /activeTab === 'audit'/)
  assert.match(source, /label="序号"[\s\S]*label="操作"[\s\S]*label="补录日期"[\s\S]*label="补录类型"[\s\S]*label="经手人"[\s\S]*label="添加时间"[\s\S]*label="补录总人数"/)
  assert.match(source, /label="员工名称"[\s\S]*label="卡号"/)
  assert.match(source, /v-permission="'audit'"/)
  assert.match(source, /v-permission="'unaudit'"/)
})
