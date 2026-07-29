import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import {
  buildStockOutPrintBlocks,
  normalizePrintRowsPerPage,
} from './printPagination.js'

function makeDoc(lineCount, overrides = {}) {
  return {
    header: { systemcode: 'S1', kcap01: 'C001' },
    lines: Array.from({ length: lineCount }, (_, index) => ({ seq: index + 1, kcaa01: `M${index + 1}` })),
    pageIndex: 1,
    pageTotal: 1,
    printMode: '2',
    totalQtyText: '51.00',
    ...overrides,
  }
}

describe('stock-out print pagination', () => {
  test('normalizes row count to 2 through 10 only', () => {
    assert.equal(normalizePrintRowsPerPage(''), 0)
    assert.equal(normalizePrintRowsPerPage('1'), 0)
    assert.equal(normalizePrintRowsPerPage('2'), 2)
    assert.equal(normalizePrintRowsPerPage('10'), 10)
    assert.equal(normalizePrintRowsPerPage('11'), 0)
  })

  test('keeps one natural browser page block when no fixed row count is selected', () => {
    const blocks = buildStockOutPrintBlocks([makeDoc(51)], '')
    assert.equal(blocks.length, 1)
    assert.equal(blocks[0].lines.length, 51)
    assert.equal(blocks[0].showTotal, true)
    assert.equal(blocks[0].manualPageBreak, false)
    assert.equal(blocks[0].pageLabel, '')
  })

  test('splits 51 rows into 6 blocks when 10 rows per page is selected', () => {
    const blocks = buildStockOutPrintBlocks([makeDoc(51)], '10')
    assert.equal(blocks.length, 6)
    assert.deepEqual(blocks.map((block) => block.lines.length), [10, 10, 10, 10, 10, 1])
    assert.deepEqual(blocks.map((block) => block.showTotal), [false, false, false, false, false, true])
    assert.equal(blocks[0].pageLabel, '1/6页')
    assert.equal(blocks[5].pageLabel, '6/6页')
  })

  test('restarts page numbering for each document in a batch', () => {
    const blocks = buildStockOutPrintBlocks([
      makeDoc(32, { header: { systemcode: 'S1', kcap01: 'C0001' } }),
      makeDoc(11, { header: { systemcode: 'S2', kcap01: 'C0002' } }),
    ], '4')
    const firstDocBlocks = blocks.filter((block) => block.header.kcap01 === 'C0001')
    const secondDocBlocks = blocks.filter((block) => block.header.kcap01 === 'C0002')

    assert.equal(firstDocBlocks[0].pageLabel, '1/8页')
    assert.equal(firstDocBlocks.at(-1).pageLabel, '8/8页')
    assert.equal(secondDocBlocks[0].pageLabel, '1/3页')
    assert.equal(secondDocBlocks.at(-1).pageLabel, '3/3页')
  })

  test('splits C26072802 equivalent 8 rows into 2 pages at 4 rows per page', () => {
    const blocks = buildStockOutPrintBlocks([
      makeDoc(8, { header: { systemcode: 'C-26072802', kcap01: 'C26072802' } }),
    ], '4')

    assert.equal(blocks.length, 2)
    assert.deepEqual(blocks.map((block) => block.lines.length), [4, 4])
    assert.deepEqual(blocks.map((block) => block.pageLabel), ['1/2页', '2/2页'])
    assert.deepEqual(blocks.map((block) => block.showTotal), [false, true])
  })

  test('uses the same split logic for detail and summary print modes', () => {
    const detailBlocks = buildStockOutPrintBlocks([makeDoc(5, { printMode: '1' })], '2')
    const summaryBlocks = buildStockOutPrintBlocks([makeDoc(5, { printMode: '2' })], '2')
    assert.deepEqual(detailBlocks.map((block) => block.lines.length), [2, 2, 1])
    assert.deepEqual(summaryBlocks.map((block) => block.lines.length), [2, 2, 1])
  })

  test('uses fixed 215mm by 139mm paper without a trailing blank page', () => {
    const source = readFileSync(new URL('./print.vue', import.meta.url), 'utf8')

    assert.match(source, /@page\s*\{[\s\S]*size:\s*215mm\s+139mm\s*;[\s\S]*margin:\s*0\s*;/i)
    assert.match(source, /\.stock-out-print-doc\s*\{[\s\S]*width:\s*215mm\s*;[\s\S]*min-height:\s*139mm\s*;/i)
    assert.match(source, /@media\s+print\s*\{[\s\S]*\.stock-out-print-doc\s*\{[\s\S]*min-height:\s*0\s*;[\s\S]*height:\s*auto\s*;[\s\S]*overflow:\s*visible\s*;/i)
    assert.match(source, /\.stock-out-print-doc\s*\+\s*\.stock-out-print-doc\s*\{[\s\S]*break-before:\s*page\s*;[\s\S]*page-break-before:\s*always\s*;/i)
    assert.doesNotMatch(source, /page-break-after:\s*always\s*;/i)
    assert.doesNotMatch(source, /setTimeout\s*\(\s*cleanup\s*,\s*3000\s*\)/i)
    assert.doesNotMatch(source, /print-stock-out/i)
    assert.match(source, /\.stock-out-print-sign\s*\{[\s\S]*margin-top:\s*\d+px\s*;/i)
  })

  test('shows the sign on every print block and the total on the last block only', () => {
    const source = readFileSync(new URL('./print.vue', import.meta.url), 'utf8')
    assert.match(source, /rowsPerPage\s*=\s*ref\(['"]{2}\)/)
    assert.match(source, /<footer\s+class="stock-out-print-sign"/)
    assert.doesNotMatch(source, /<footer\s+v-if="doc\.showTotal"/)
    assert.match(source, /<tr\s+v-if="doc\.showTotal"\s+class="stock-out-print-total"/)
  })
})
