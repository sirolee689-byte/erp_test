import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'

const source = readFileSync(resolve('src/views/inventory/analysis/stock-out-stats/index.vue'), 'utf8')

function extractFunctionBody(name) {
  const start = source.indexOf(`function ${name}`)
  assert.notEqual(start, -1, `未找到 ${name}`)
  const braceStart = source.indexOf('{', start)
  let depth = 0
  for (let i = braceStart; i < source.length; i += 1) {
    const ch = source[i]
    if (ch === '{') depth += 1
    if (ch === '}') {
      depth -= 1
      if (depth === 0) return source.slice(braceStart + 1, i)
    }
  }
  throw new Error(`无法提取 ${name}`)
}

test('出库统计表显示行只生成明细和总计，不生成仓库小计行', () => {
  const body = extractFunctionBody('buildDisplayRows')
  assert.doesNotMatch(body, /rowType:\s*['"]subtotal['"]/)
  assert.doesNotMatch(body, /pushSubtotal/)
  assert.match(body, /rowType:\s*['"]total['"]/)
})
