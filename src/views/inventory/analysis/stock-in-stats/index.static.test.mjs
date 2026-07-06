import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = readFileSync(new URL('./index.vue', import.meta.url), 'utf8')

function extractFunctionBody(name) {
  const start = source.indexOf(`function ${name}(`)
  assert.notEqual(start, -1, `${name} should exist`)
  const bodyStart = source.indexOf('{', start)
  assert.notEqual(bodyStart, -1, `${name} should have a body`)
  let depth = 0
  for (let i = bodyStart; i < source.length; i += 1) {
    const ch = source[i]
    if (ch === '{') depth += 1
    if (ch === '}') {
      depth -= 1
      if (depth === 0) return source.slice(bodyStart + 1, i)
    }
  }
  assert.fail(`${name} body should close`)
}

test('入库统计表显示行只生成明细和总计，不生成仓库小计行', () => {
  const body = extractFunctionBody('buildDisplayRows')
  assert.doesNotMatch(body, /rowType:\s*['"]subtotal['"]/)
  assert.doesNotMatch(body, /pushSubtotal/)
  assert.match(body, /rowType:\s*['"]total['"]/)
})
