import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  buildStockOutColorText,
  buildStockOutExpandLinesSql,
  coerceScalarValue,
  enrichStockOutExpandLine,
  kcaa01ColorCodeExpr,
} from './stockOutExpandLines.js'

describe('stockOutExpandLines', () => {
  test('expand lines sql filters del=0 and orders by seq without duplicate numeric aliases', () => {
    const sqlText = buildStockOutExpandLinesSql()
    assert.match(sqlText, /UB_ERP_Stocks_out_list/i)
    assert.match(sqlText, /UB_ERP_Stocks_colorcode/i)
    assert.match(sqlText, /ISNULL\(l\.\[del\]/i)
    assert.match(sqlText, /ORDER BY ISNULL\(l\.\[seq\], l\.\[id\]\)/i)
    assert.match(sqlText, /CHARINDEX\(N'\/'/i)
    assert.doesNotMatch(sqlText, /AS kcaq03/i)
    assert.doesNotMatch(sqlText, /safeDecimalExpr/i)
    assert.doesNotMatch(sqlText, /OFFSET/i)
  })

  test('kcaa01 color code expr extracts suffix after slash', () => {
    assert.match(kcaa01ColorCodeExpr('l'), /RIGHT\(/i)
    assert.match(kcaa01ColorCodeExpr('l'), /CHARINDEX\(N'\/'/i)
  })

  test('coerceScalarValue unwraps duplicate-column arrays', () => {
    assert.equal(coerceScalarValue([2, 2]), 2)
    assert.equal(coerceScalarValue([45.9292, 45.9292]), 45.9292)
    assert.equal(coerceScalarValue(3.5), 3.5)
    assert.equal(coerceScalarValue([]), null)
  })

  test('buildStockOutColorText formats TM(深啡色)', () => {
    assert.equal(buildStockOutColorText('TM', '深啡色'), 'TM(深啡色)')
    assert.equal(buildStockOutColorText('TM', ''), 'TM')
    assert.equal(buildStockOutColorText('', '深啡色'), '深啡色')
    assert.equal(buildStockOutColorText('', ''), '')
  })

  test('enrichStockOutExpandLine maps colorText tax and unwraps numeric arrays', () => {
    const row = enrichStockOutExpandLine({
      kcaa11: 'TM',
      colorName: '深啡色',
      kcaq03: [2, 2],
      kcaq04: [45.9292, 45.9292],
      kcaq05: [45.93, 45.93],
      Tax: [0.13, 0.13],
      Reference: 'PI-001',
      Describe: '备注行',
    })
    assert.equal(row.colorText, 'TM(深啡色)')
    assert.equal(row.kcaq03, 2)
    assert.equal(row.kcaq04, 45.9292)
    assert.equal(row.kcaq05, 45.93)
    assert.equal(row.tax, 0.13)
    assert.equal(row.reference, 'PI-001')
    assert.equal(row.Describe, '备注行')
  })
})
