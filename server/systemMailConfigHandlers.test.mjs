import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  buildSystemMailSystemcode,
  encryptMailPassword,
  formatSystemMailConfigTimestamp,
} from './systemMailConfigHandlers.js'

describe('系统EMAIL配置工具', () => {
  test('邮件密码保存为带版本前缀的密文', () => {
    const encrypted = encryptMailPassword('mail-secret', 'test-crypto-key')
    assert.match(encrypted, /^enc:v1:/)
    assert.notEqual(encrypted.includes('mail-secret'), true)
  })

  test('核心编码使用年月日开头并限制在 50 位内', () => {
    const code = buildSystemMailSystemcode(new Date('2026-06-30T08:09:10'))
    assert.match(code, /^20260630/)
    assert.ok(code.length <= 50)
  })

  test('时间格式使用 SQL Server 2008 R2 兼容字符串', () => {
    assert.equal(formatSystemMailConfigTimestamp(new Date('2026-06-30T08:09:10')), '2026-06-30 08:09:10')
  })
})
