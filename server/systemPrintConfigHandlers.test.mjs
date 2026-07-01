import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  buildSystemPrintSystemcode,
  formatSystemPrintConfigTimestamp,
  parseNullableInt,
} from './systemPrintConfigHandlers.js'

describe('打印设定工具', () => {
  test('核心编码使用年月日开头并限制在 200 位内', () => {
    const code = buildSystemPrintSystemcode(new Date('2026-06-30T08:09:10'))
    assert.match(code, /^20260630/)
    assert.ok(code.length <= 200)
  })

  test('时间格式使用 SQL Server 2008 R2 兼容字符串', () => {
    assert.equal(formatSystemPrintConfigTimestamp(new Date('2026-06-30T08:09:10')), '2026-06-30 08:09:10')
  })

  test('真实表 int 字段空值保存为 NULL', () => {
    assert.equal(parseNullableInt('', '系统中文语言包'), null)
    assert.equal(parseNullableInt(null, '系统中文语言包'), null)
  })

  test('真实表 int 字段只允许整数', () => {
    assert.equal(parseNullableInt('12', '系统中文语言包'), 12)
    assert.throws(() => parseNullableInt('1.5', '系统中文语言包'), /必须是整数/)
  })
})
