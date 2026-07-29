import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { buildStockInPrintBlocks } from './printPagination.js'

function makeDoc(lineCount) {
  return {
    header: { systemcode: 'S1', kcan01: 'R001' },
    lines: Array.from({ length: lineCount }, (_, index) => ({
      seq: index + 1,
      kcaa01: `M${index + 1}`,
    })),
    pageIndex: 1,
    pageTotal: 1,
    printMode: '2',
    totalQtyText: '8',
  }
}

describe('stock-in print pagination', () => {
  test('splits one receipt into print blocks while keeping the total on the last block', () => {
    const blocks = buildStockInPrintBlocks([makeDoc(8)], '4')

    assert.equal(blocks.length, 2)
    assert.deepEqual(blocks.map((block) => block.lines.length), [4, 4])
    assert.deepEqual(blocks.map((block) => block.pageLabel), ['1/2页', '2/2页'])
    assert.deepEqual(blocks.map((block) => block.showTotal), [false, true])
  })

  test('uses fixed paper without a trailing blank page and shows the sign on every block', () => {
    const source = readFileSync(new URL('./print.vue', import.meta.url), 'utf8')

    assert.match(source, /@page\s*\{[\s\S]*size:\s*215mm\s+139mm\s*;[\s\S]*margin:\s*0\s*;/i)
    assert.match(source, /@media\s+print\s*\{[\s\S]*\.stock-in-print-doc\s*\{[\s\S]*min-height:\s*0\s*;[\s\S]*height:\s*auto\s*;[\s\S]*overflow:\s*visible\s*;/i)
    assert.match(source, /\.stock-in-print-doc\s*\+\s*\.stock-in-print-doc\s*\{[\s\S]*break-before:\s*page\s*;[\s\S]*page-break-before:\s*always\s*;/i)
    assert.doesNotMatch(source, /page-break-after:\s*always\s*;/i)
    assert.doesNotMatch(source, /setTimeout\s*\(\s*cleanup\s*,\s*3000\s*\)/i)
    assert.doesNotMatch(source, /print-stock-in/i)
    assert.match(source, /<footer\s+class="stock-in-print-sign"/)
    assert.doesNotMatch(source, /<footer\s+v-if="doc\.showTotal"/)
    assert.match(source, /<tr\s+v-if="doc\.showTotal"\s+class="stock-in-print-total"/)
  })
})
