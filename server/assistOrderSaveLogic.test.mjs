import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  buildAssistOrderGuid,
  buildAssistOrderNoForDate,
  buildNextAssistOrderNo,
  formatAssistOrderDeliveryDate,
  normalizeAssistOrderHeader,
  resolveAssistOrderPiValue,
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

  test('formats delivery date as YYYY-MM-DD 00:00:00', () => {
    assert.equal(formatAssistOrderDeliveryDate('2026-06-29'), '2026-06-29 00:00:00')
    assert.equal(formatAssistOrderDeliveryDate('2026-06-29T15:30:00'), '2026-06-29 00:00:00')
    assert.equal(formatAssistOrderDeliveryDate(''), null)
    assert.equal(formatAssistOrderDeliveryDate(null), null)
  })

  test('resolves pi from reference number', () => {
    assert.equal(resolveAssistOrderPiValue('PI-4152'), 'PI-4152')
    assert.equal(resolveAssistOrderPiValue('  '), null)
    assert.equal(resolveAssistOrderPiValue(''), null)
  })

  test('buildAssistOrderGuid matches WX-yyMMdd + 34 uppercase hex', () => {
    const guid = buildAssistOrderGuid('2026-06-10')
    assert.match(guid, /^WX-260610[0-9A-F]{34}$/)
    assert.equal(guid.length, 43)
  })

  test('validateAssistOrderHeader rejects delivery date before assist date', () => {
    const base = {
      assistDate: '2026-06-10',
      assistType: '0',
      supplierCode: 'S001',
      taxIncluded: '1',
      currencyCode: 'RMB',
      decimalPlaces: 4,
    }
    assert.equal(
      validateAssistOrderHeader(normalizeAssistOrderHeader({ ...base, deliveryDate: '2026-06-09' })),
      '交货日期不能早于外协日期',
    )
    assert.equal(
      validateAssistOrderHeader(normalizeAssistOrderHeader({ ...base, deliveryDate: '2026-06-10' })),
      null,
    )
    assert.equal(
      validateAssistOrderHeader(normalizeAssistOrderHeader({ ...base, deliveryDate: '2026-06-11' })),
      null,
    )
    assert.equal(
      validateAssistOrderHeader(normalizeAssistOrderHeader({ ...base, deliveryDate: '' })),
      null,
    )
  })
})
