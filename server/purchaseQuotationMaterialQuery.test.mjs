import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('./createQuotationHandlers.js', import.meta.url), 'utf8')

test('采购报价物料查询为空时直接返回空列表，只允许材料编码包含匹配', () => {
  assert.match(source, /const keyword = String\(req\.query\?\.keyword \?\? ''\)\.trim\(\)/)
  assert.match(source, /data: \{ total: 0, list: \[\], availableFields: \{ mq: false, zq: false \} \}/)
  assert.match(source, /requiredLineCols = \[lineDocNoCol, 'del', 'pass', 'kcaa01'\]/)
  assert.match(source, /l\.\$\{bracketIdent\(materialCodeCol\)\} LIKE @keyword/)
  assert.doesNotMatch(source, /MATERIAL_QUERY_FIELD_CANDIDATES/)
})

test('采购报价物料查询要求主从表均已审核且未删除，并按明细分页', () => {
  assert.match(source, /GET \$\{apiBase\}\/material-query/)
  assert.match(source, /l\.\$\{bracketIdent\('pass'\)\}.*N'1'/)
  assert.match(source, /h\.\$\{bracketIdent\('pass'\)\}.*N'1'/)
  assert.match(source, /ROW_NUMBER\(\) OVER \(ORDER BY/)
  assert.match(source, /COUNT\(1\) OVER \(\)/)
})

test('mq 和 zq 仅在实际列存在时通知页面显示', () => {
  assert.match(source, /availableFields: \{ mq: meta\.lineColNames\.has\('mq'\), zq: meta\.lineColNames\.has\('zq'\) \}/)
})
