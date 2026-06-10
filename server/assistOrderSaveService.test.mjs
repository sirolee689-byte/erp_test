import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  formatAssistOrderDeliveryDate,
  resolveAssistOrderPiValue,
} from './assistOrderSaveLogic.js'

describe('assistOrderSaveService header field helpers', () => {
  test('delivery date and pi align with save plan', () => {
    assert.equal(formatAssistOrderDeliveryDate('2026-06-29'), '2026-06-29 00:00:00')
    assert.equal(resolveAssistOrderPiValue('PI-TEST111'), 'PI-TEST111')
    assert.equal(resolveAssistOrderPiValue(undefined), null)
  })
})
