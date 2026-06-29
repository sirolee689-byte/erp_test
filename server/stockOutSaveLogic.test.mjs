import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  buildNextStockOutNo,
  calcStockOutAmounts,
  normalizeStockOutHeader,
  normalizeStockOutLine,
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

  test('类型 7 计划外领料：无关联单号可保存，但须生产车间', () => {
    assert.equal(validateStockOutPayload({
      header: { outboundType: '7', warehouseCode: 'CK01', inTax: '1', relatedPartyCode: 'WS01' },
      lines: [{ kcaa01: 'A', kcaq03: 1 }],
    }), null)
    assert.equal(validateStockOutPayload({
      header: { outboundType: '7', warehouseCode: 'CK01', inTax: '1', sourceOrderNo: '' },
      lines: [{ kcaa01: 'A', kcaq03: 1 }],
    }), '生产车间不能为空')
    assert.equal(validateStockOutPayload({
      header: { outboundType: '7', warehouseCode: 'CK01', inTax: '1', relatedPartyCode: 'WS01', sourceOrderNo: 'PG01' },
      lines: [{ kcaa01: 'A', kcaq03: 1 }],
    }), null)
  })

  test('类型 10 允许校验通过（与普通过账类型一致）', () => {
    assert.equal(validateStockOutPayload({ header: { outboundType: '10', warehouseCode: 'CK01', inTax: '1' }, lines: [{ kcaa01: 'A', kcaq03: 1 }] }), null)
    assert.equal(validateStockOutPayload({
      header: { outboundType: '10', warehouseCode: 'CK01', inTax: '1', sourceOrderNo: '手填单号' },
      lines: [{ kcaa01: 'A', kcaq03: 1 }],
    }), null)
  })

  test('类型 9 盘亏出库：关联单号可空，仍需仓库和是否含税', () => {
    assert.equal(validateStockOutPayload({
      header: { outboundType: '9', warehouseCode: 'CK01', inTax: '1', sourceOrderNo: '' },
      lines: [{ kcaa01: 'A', kcaq03: 1 }],
    }), null)
    assert.equal(validateStockOutPayload({
      header: { outboundType: '9', warehouseCode: '', inTax: '1', sourceOrderNo: '' },
      lines: [{ kcaa01: 'A', kcaq03: 1 }],
    }), '请先选择仓库。')
    assert.equal(validateStockOutPayload({
      header: { outboundType: '9', warehouseCode: 'CK01', inTax: '', sourceOrderNo: '' },
      lines: [{ kcaa01: 'A', kcaq03: 1 }],
    }), '请先选择是否含税。')
  })

  test('草稿允许空明细保存', () => {
    assert.equal(
      validateStockOutPayload({ header: { outboundType: '0', warehouseCode: 'CK01', inTax: '1' }, lines: [] }),
      null,
    )
  })

  test('批量添加公共前置字段和明细来源校验', () => {
    assert.match(validateStockOutPayload({ header: { outboundType: '', warehouseCode: 'CK01', inTax: '1' }, lines: [{ kcaa01: 'A', kcaq03: 1 }] }), /出库类型/)
    assert.match(validateStockOutPayload({ header: { outboundType: '0', warehouseCode: '', inTax: '1' }, lines: [{ kcaa01: 'A', kcaq03: 1 }] }), /仓库/)
    assert.match(validateStockOutPayload({ header: { outboundType: '1', warehouseCode: 'CK01', inTax: '1', sourceOrderNo: 'PO1', relatedPartyCode: 'S1' }, lines: [{ kcaa01: 'A', kcaq03: 1 }] }), /关联单据/)
  })

  test('关联型出库须带 sourceLineCode，不强制前端 kcaq02', () => {
    assert.match(validateStockOutPayload({
      header: { outboundType: '2', warehouseCode: 'CK01', inTax: '1', sourceOrderNo: 'WX1', relatedPartyCode: 'S1' },
      lines: [{ kcaa01: 'A', kcaq03: 1 }],
    }), /必须来自关联单据/)
    assert.equal(validateStockOutPayload({
      header: { outboundType: '2', warehouseCode: 'CK01', inTax: '1', sourceOrderNo: 'WX1', relatedPartyCode: 'S1' },
      lines: [{ kcaa01: 'A', kcaq03: 1, sourceLineCode: 'WX-LINE-1' }],
    }), null)
  })

  test('明细厂款号/PI号兼容 Reference 物理列名', () => {
    const line = normalizeStockOutLine({ kcaa01: 'A', kcaq03: 1, Reference: 'PI-2026-001' }, 1, {})
    assert.equal(line.reference, 'PI-2026-001')
  })

  test('成品出库报关单价 kcaq08 在 normalize 中保留', () => {
    const line = normalizeStockOutLine({ kcaa01: 'A', kcaq03: 1, kcaq08: 9.8765 }, 1, {})
    assert.equal(line.kcaq08, 9.8765)
  })

  test('纸质单号与预留单号分别映射 kcap08 kcap09', () => {
    const h = normalizeStockOutHeader({ paperNo: 'PN-1', reserveNo: 'RSV-9', kcap08: 'OLD', kcap09: 'OLD2' })
    assert.equal(h.paperNo, 'PN-1')
    assert.equal(h.reserveNo, 'RSV-9')
    const legacy = normalizeStockOutHeader({ referenceNo: 'PI-88' })
    assert.equal(legacy.paperNo, 'PI-88')
  })

  test('外协领料 PI 号映射 kcap08，预留单号仍映射 kcap09', () => {
    const h = normalizeStockOutHeader({ outboundType: '2', piNo: 'PI-1', paperNo: 'PN-IGNORED', reserveNo: 'RSV-2' })
    assert.equal(h.paperNo, '')
    assert.equal(h.piNo, 'PI-1')
    assert.equal(h.reserveNo, 'RSV-2')
  })

  test('生产领料 PI 号映射 kcap08', () => {
    const h = normalizeStockOutHeader({ outboundType: '4', piNo: 'PI-PG-1', paperNo: 'PN-IGNORED', relatedPartyCode: 'WS01' })
    assert.equal(h.paperNo, '')
    assert.equal(h.piNo, 'PI-PG-1')
  })

  test('不含税模式税点只能为 0，金额从不含税单价计算', () => {
    assert.match(validateStockOutPayload({ header: { outboundType: '0', warehouseCode: 'CK01', inTax: '2' }, lines: [{ kcaa01: 'A', kcaq03: 1, tax: 0.13 }] }), /税点只能为 0/)
    const amount = calcStockOutAmounts({ qty: 2, priceExTax: 10, tax: 0.13 })
    assert.equal(amount.kcaq04, 10)
    assert.equal(amount.kcaq041, 11.3)
    assert.equal(amount.kcaq05, 20)
    assert.equal(amount.kcaq051, 22.6)
  })

  test('出库数量与可出库数量比较前统一三位小数', () => {
    assert.equal(validateStockOutPayload({
      header: { outboundType: '2', warehouseCode: 'CK01', inTax: '1', sourceOrderNo: 'WX1', relatedPartyCode: 'S1' },
      lines: [{
        kcaa01: 'GB-0004/580',
        sourceLineCode: 'LINE1',
        kcaq03: 186.667,
        availableQty: 186.6666,
      }],
    }), null)
  })
})
