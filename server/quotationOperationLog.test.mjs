import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { buildQuotationOperationLogPayload } from './createQuotationHandlers.js'

const purchaseLogConfig = {
  code: 'UB_ERP_Buy_offer',
  documentName: '采购报价单',
  systemcodeCol: 'systemcode',
}

test('采购报价反审、删除和彻底删除使用固定日志名称与单据标识', () => {
  const cases = [
    ['unaudit', '采购报价单反审核'],
    ['delete', '采购报价单删除'],
    ['permanent-delete', '采购报价单彻底删除'],
  ]
  for (const [operation, actName] of cases) {
    const payload = buildQuotationOperationLogPayload({
      operation,
      operationLog: purchaseLogConfig,
      docNo: 'BJ-260713-1',
      systemcode: 'PQ-SYS-1',
      nowStr: '2026-07-13 10:20:30',
      actorName: '张三',
    })
    assert.equal(payload.actName, actName)
    assert.equal(payload.code, 'UB_ERP_Buy_offer')
    assert.equal(payload.systemcode, 'PQ-SYS-1')
    assert.match(payload.actInfo, /采购报价单号：BJ-260713-1/)
    assert.match(payload.actInfo, /操作时间：2026-07-13 10:20:30/)
    assert.match(payload.actInfo, /操作人：张三/)
  }
})

test('未配置日志的外协报价不生成生命周期日志', () => {
  assert.equal(buildQuotationOperationLogPayload({ operation: 'delete', operationLog: null }), null)
})

test('采购报价三种生命周期操作均在事务内写日志', () => {
  const source = readFileSync(new URL('./createQuotationHandlers.js', import.meta.url), 'utf8')
  for (const operation of ['unaudit', 'delete', 'permanent-delete']) {
    assert.match(source, new RegExp(`writeLifecycleOperationLog\\(req, tx, '${operation}'`))
  }
  assert.match(source, /await tx\.rollback\(\)/)
})
