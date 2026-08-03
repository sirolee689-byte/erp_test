import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { shouldKeepDiningCardFocus } from './focusPolicy.js'

describe('饭堂刷卡输入框聚焦策略', () => {
  test('测试模式也保持刷卡机焦点', () => {
    assert.equal(shouldKeepDiningCardFocus({ testMode: true }), true)
  })

  test('正式刷卡模式继续保持读卡输入框焦点', () => {
    assert.equal(shouldKeepDiningCardFocus({ testMode: false }), true)
    assert.equal(shouldKeepDiningCardFocus(null), false)
  })
})
