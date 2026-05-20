import test from 'node:test'
import assert from 'node:assert/strict'
import { isSqlTruncationError, mapSqlServerWriteError } from './sqlServerWriteErrors.js'
import {
  clipNvarcharForColumn,
  resolveSysUsersPasswordForStorage,
  SYS_USERS_BCRYPT_MIN_COLUMN_LEN,
} from './sysUsersDb.js'

test('isSqlTruncationError 识别 8152', () => {
  assert.equal(isSqlTruncationError({ number: 8152 }), true)
  assert.equal(isSqlTruncationError({ message: 'String or binary data would be truncated.' }), true)
})

test('mapSqlServerWriteError 8152 返回中文', () => {
  const m = mapSqlServerWriteError({ number: 8152 })
  assert.ok(m)
  assert.equal(m.status, 400)
  assert.match(m.msg, /列长度/)
})

test('clipNvarcharForColumn', () => {
  assert.equal(clipNvarcharForColumn('abcdef', 3), 'abc')
})

test('resolveSysUsersPasswordForStorage 短列拒绝 bcrypt', async () => {
  const meta = { maxLenByLower: new Map([['password', 20]]) }
  const r = await resolveSysUsersPasswordForStorage('123', meta, async () => '$2b$10$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')
  assert.ok(r.error)
  assert.match(r.error, /password 列过短/)
})

test('resolveSysUsersPasswordForStorage 长列 bcrypt', async () => {
  const meta = { maxLenByLower: new Map([['password', SYS_USERS_BCRYPT_MIN_COLUMN_LEN]]) }
  const hash = '$2b$10$hash'
  const r = await resolveSysUsersPasswordForStorage('123', meta, async () => hash)
  assert.equal(r.mode, 'bcrypt')
  assert.equal(r.stored, hash)
})

test('resolveSysUsersPasswordForStorage 极短列拒绝', async () => {
  const meta = { maxLenByLower: new Map([['password', 5]]) }
  const r = await resolveSysUsersPasswordForStorage('123', meta, async () => '$2b$10$hash')
  assert.ok(r.error)
})
