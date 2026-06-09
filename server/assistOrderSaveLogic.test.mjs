import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  buildAssistOrderNoForDate,
  buildNextAssistOrderNo,
  normalizeAssistOrderHeader,
  validateAssistOrderHeader,
} from './assistOrderSaveLogic.js'

describe('assistOrderSaveLogic', () => {
  test('builds suggested order number from save date and current numbers', () => {
    assert.equal(
      buildAssistOrderNoForDate(new Date('2026-06-09T10:20:00+08:00'), 1),
      'WX26060901',
    )
    assert.equal(
      buildAssistOrderNoForDate(new Date('2026-06-09T10:20:00+08:00'), 100),
      'WX260609100',
    )
    assert.equal(
      buildNextAssistOrderNo({
        saveDate: new Date('2026-06-09T10:20:00+08:00'),
        existingOrderNos: ['WX26060901', 'WX26060902'],
      }),
      'WX26060903',
    )
  })

  test('validates reference number only for linked assist types', () => {
    assert.equal(
      validateAssistOrderHeader(
        normalizeAssistOrderHeader({
          assistDate: '2026-06-09',
          assistType: '0',
          referenceNo: '',
          supplierCode: 'S001',
          taxIncluded: '1',
          currencyCode: 'RMB',
          decimalPlaces: 4,
        }),
      ),
      null,
    )
    assert.match(
      validateAssistOrderHeader(
        normalizeAssistOrderHeader({
          assistDate: '2026-06-09',
          assistType: '1',
          referenceNo: '',
          supplierCode: 'S001',
          taxIncluded: '1',
          currencyCode: 'RMB',
          decimalPlaces: 4,
        }),
      ),
      /关联单号/,
    )
  })

  test('normalizes tax flag and decimal places', () => {
    assert.deepEqual(
      normalizeAssistOrderHeader({
        assistDate: '2026-06-09',
        assistType: '2',
        referenceNo: 'PI-001',
        supplierCode: 'S001',
        taxIncluded: '9',
        currencyCode: 'RMB',
        decimalPlaces: 9,
      }),
      {
        assistOrderNo: '',
        assistDate: '2026-06-09',
        assistType: '2',
        referenceNo: 'PI-001',
        supplierCode: 'S001',
        taxIncluded: '1',
        currencyCode: 'RMB',
        deliveryDate: '',
        remark: '',
        notes: '',
        decimalPlaces: 6,
      },
    )
  })
})
