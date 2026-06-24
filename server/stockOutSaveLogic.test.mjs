import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  buildNextStockOutNo,
  calcStockOutAmounts,
  normalizeStockOutHeader,
  validateStockOutPayload,
} from './stockOutSaveLogic.js'

describe('stockOutSaveLogic', () => {
  test('出库单号按保存当天生成，并跳过当日已有流水', () => {
    const no = buildNextStockOutNo({
      saveDate: new Date('2026-06-24T08:00:00'),
      existingOutboundNos: ['C26062401', 'C26062402', 'C26062399'],
    })
    assert.equal(no, 'C26062403')
  })

  test('新增出库单默认待审核，不支持自动审核字段覆盖', () => {
    const h = normalizeStockOutHeader({ outboundType: '0', pass: '1', warehouseCode: 'CK01', inTax: '1' })
    assert.equal(h.pass, '0')
    assert.equal(h.outboundType, '0')
  })

  test('类型 7 8 10 允许校验通过（与普通过账类型一致）', () => {
    assert.equal(validateStockOutPayload({ header: { outboundType: '7', warehouseCode: 'CK01', inTax: '1' }, lines: [{ kcaa01: 'A', kcaq03: 1 }] }), null)
    assert.equal(validateStockOutPayload({ header: { outboundType: '10', warehouseCode: 'CK01', inTax: '1' }, lines: [{ kcaa01: 'A', kcaq03: 1 }] }), null)
  })

  test('批量添加公共前置字段和明细来源校验', () => {
    assert.match(validateStockOutPayload({ header: { outboundType: '', warehouseCode: 'CK01', inTax: '1' }, lines: [{ kcaa01: 'A', kcaq03: 1 }] }), /出库类型/)
    assert.match(validateStockOutPayload({ header: { outboundType: '0', warehouseCode: '', inTax: '1' }, lines: [{ kcaa01: 'A', kcaq03: 1 }] }), /仓库/)
    assert.match(validateStockOutPayload({ header: { outboundType: '1', warehouseCode: 'CK01', inTax: '1', sourceOrderNo: 'PO1', relatedPartyCode: 'S1' }, lines: [{ kcaa01: 'A', kcaq03: 1 }] }), /关联单据/)
  })

  test('纸质单号与预留单号分别映射 kcap08 kcap09', () => {
    const h = normalizeStockOutHeader({ paperNo: 'PN-1', reserveNo: 'RSV-9', kcap08: 'OLD', kcap09: 'OLD2' })
    assert.equal(h.paperNo, 'PN-1')
    assert.equal(h.reserveNo, 'RSV-9')
    const legacy = normalizeStockOutHeader({ referenceNo: 'PI-88' })
    assert.equal(legacy.paperNo, 'PI-88')
  })

  test('不含税模式税点只能为 0，金额从不含税单价计算', () => {
    assert.match(validateStockOutPayload({ header: { outboundType: '0', warehouseCode: 'CK01', inTax: '2' }, lines: [{ kcaa01: 'A', kcaq03: 1, tax: 0.13 }] }), /税点只能为 0/)
    const amount = calcStockOutAmounts({ qty: 2, priceExTax: 10, tax: 0.13 })
    assert.equal(amount.kcaq04, 10)
    assert.equal(amount.kcaq041, 11.3)
    assert.equal(amount.kcaq05, 20)
    assert.equal(amount.kcaq051, 22.6)
  })
})

