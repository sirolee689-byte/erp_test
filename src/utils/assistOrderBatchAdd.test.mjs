import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  ASSIST_BATCH_REJECT_PI_MISMATCH,
  parseAssistBatchResultPayload,
  validateBatchApply,
} from './assistOrderBatchAdd.js'

describe('assistOrderBatchAdd', () => {
  test('parseAssistBatchResultPayload parses valid JSON with lines', () => {
    const raw = JSON.stringify({
      sessionId: 'abc',
      lines: [{ kcaa01: 'MAT-1', wxak03: 2 }],
    })
    const payload = parseAssistBatchResultPayload(raw)
    assert.equal(payload.sessionId, 'abc')
    assert.equal(payload.lines.length, 1)
    assert.equal(payload.lines[0].kcaa01, 'MAT-1')
  })

  test('parseAssistBatchResultPayload returns null for invalid or empty payload', () => {
    assert.equal(parseAssistBatchResultPayload(null), null)
    assert.equal(parseAssistBatchResultPayload(''), null)
    assert.equal(parseAssistBatchResultPayload('{bad'), null)
    assert.equal(parseAssistBatchResultPayload(JSON.stringify({ lines: [] })), null)
    assert.equal(parseAssistBatchResultPayload({ sessionId: 'x' }), null)
  })

  test('validateBatchApply accepts matching PI numbers', () => {
    const result = validateBatchApply({
      openedPiNo: ' PI-2026-001 ',
      currentPiNo: 'PI-2026-001',
    })
    assert.deepEqual(result, { ok: true })
  })

  test('validateBatchApply rejects PI mismatch', () => {
    const result = validateBatchApply({
      openedPiNo: 'PI-A',
      currentPiNo: 'PI-B',
    })
    assert.deepEqual(result, { ok: false, reason: ASSIST_BATCH_REJECT_PI_MISMATCH })
  })

  test('validateBatchApply rejects missing PI', () => {
    assert.deepEqual(
      validateBatchApply({ openedPiNo: '', currentPiNo: 'PI-1' }),
      { ok: false, reason: 'missing-pi' },
    )
    assert.deepEqual(
      validateBatchApply({ openedPiNo: 'PI-1', currentPiNo: '' }),
      { ok: false, reason: 'missing-pi' },
    )
  })
})
