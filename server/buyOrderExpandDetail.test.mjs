import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const service = readFileSync(new URL('./buyOrderExpandDetail.js', import.meta.url), 'utf8')
const handlers = readFileSync(new URL('./buyOrderHandlers.js', import.meta.url), 'utf8')
const gate = readFileSync(new URL('./apiPermissionGate.js', import.meta.url), 'utf8')

test('purchase order expand detail reads purchase lines, inbound rows, returns and fees', () => {
  assert.match(service, /UB_ERP_Buy_order_list/)
  assert.match(service, /UB_ERP_Stocks_Storage/)
  assert.match(service, /UB_ERP_Stocks_Storage_list/)
  assert.match(service, /UB_ERP_Stocks_out/)
  assert.match(service, /UB_ERP_Stocks_out_list/)
  assert.match(service, /UB_ERP_Buy_order_money/)
})

test('purchase order expand detail keeps stock matching compatible with material code and systemcode', () => {
  assert.match(service, /materialCode/)
  assert.match(service, /materialSystemCode/)
  assert.match(service, /kcao02/)
  assert.match(service, /kcak02/)
})

test('purchase order expand detail route is registered before generic id route and guarded as view', () => {
  const expandIndex = handlers.indexOf("app.get('/api/buy-order/:id/expand-detail'")
  const detailIndex = handlers.indexOf("app.get('/api/buy-order/:id', detail)")
  assert.ok(expandIndex > 0)
  assert.ok(detailIndex > expandIndex)
  assert.match(gate, /buy-order\\\/\\d\+\\\/expand-detail/)
  assert.match(gate, /action: 'view'/)
})

test('purchase order expand detail avoids SQL Server 2012-only syntax', () => {
  assert.doesNotMatch(service, /TRY_CONVERT|TRY_CAST|OFFSET\s+|FORMAT\(|IIF\(|CONCAT\(/i)
})

test('purchase order expand detail uses safe decimal reads for legacy nvarchar numeric columns', () => {
  assert.match(service, /buyOrderSqlSafe/)
  assert.match(service, /safeDecimalExpr\('l', 'kcak03'\)/)
  assert.match(service, /safeDecimalExpr\('f', 'money'\)/)
  assert.doesNotMatch(service, /ISNULL\(l\.\[kcak03\], 0\)/)
})

test('purchase order expand detail uses safe text read for numeric kcak06 top material code', () => {
  assert.match(service, /nvarcharTextExpr\('l', 'kcak06'/)
  assert.doesNotMatch(service, /ISNULL\(l\.\[kcak06\], N''\)/)
})
