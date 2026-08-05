import test from 'node:test'
import assert from 'node:assert/strict'
import * as XLSX from 'xlsx'
import {
  normalizeTjDateYm,
  parseElectricBatchExcel,
} from './dormElectricBatchService.js'

function toBase64Sheet(rows) {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(rows)
  XLSX.utils.book_append_sheet(wb, ws, 'sheet1')
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })).toString('base64')
}

test('normalizeTjDateYm 规范为 YYYY-M', () => {
  assert.equal(normalizeTjDateYm('2026-07'), '2026-7')
  assert.equal(normalizeTjDateYm('2026-7'), '2026-7')
  assert.equal(normalizeTjDateYm('bad'), '')
})

test('parseElectricBatchExcel 跳过表头并解析三列', () => {
  const b64 = toBase64Sheet([
    ['房号', '上期读数', '本期读数'],
    ['A101', 100, 120],
    ['A102', 50, 40],
  ])
  const parsed = parseElectricBatchExcel(b64, 't.xlsx')
  assert.equal(parsed.ok, true)
  assert.equal(parsed.rows.length, 2)
  assert.equal(parsed.rows[0].room_code, 'A101')
  assert.equal(parsed.rows[0].c_star, 100)
  assert.equal(parsed.rows[0].c_this, 120)
  assert.equal(parsed.rows[1].c_this, 40)
})

test('parseElectricBatchExcel 无表头也可解析', () => {
  const b64 = toBase64Sheet([['B201', 10, 15]])
  const parsed = parseElectricBatchExcel(b64, 't.xls')
  assert.equal(parsed.ok, true)
  assert.equal(parsed.rows[0].room_code, 'B201')
})
