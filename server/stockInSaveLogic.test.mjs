import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  buildNextStockInNo,
  calcStockInAmounts,
  customerSupplyLabel,
  normalizeCustomerSupplyInt,
  normalizeStockInHeader,
  normalizeStockInLine,
  validateStockInPayload,
} from './stockInSaveLogic.js'

describe('stockInSaveLogic', () => {
  test('入库单号按保存当天生成，并跳过当日已有流水', () => {
    const no = buildNextStockInNo({
      saveDate: new Date('2026-06-17T10:00:00'),
      existingReceiptNos: ['R26061701', 'R26061702', 'R26061699'],
    })
    assert.equal(no, 'R26061703')
  })

  test('类型 4 生产入库必须有关联派工单，类型 5 生产退料允许为空', () => {
    const base = {
      header: { inboundType: '4', inboundDate: '2026-06-17', warehouseCode: 'WH', relatedPartyCode: 'CJ01', paperNo: 'PI-1' },
      lines: [{ kcaa01: 'M-1', kcao03: 1, kcao02: 'SRC-LINE' }],
    }
    assert.match(validateStockInPayload(base), /生产入库必须选择派工单/)

    const ret = {
      header: { inboundType: '5', inboundDate: '2026-06-17', warehouseCode: 'WH', relatedPartyCode: 'CJ01', paperNo: 'PI-1' },
      lines: [{ kcaa01: 'M-1', kcao03: 1 }],
    }
    assert.equal(validateStockInPayload(ret), null)
  })

  test('关联型入库不允许无来源明细，其他入库允许手工明细', () => {
    const purchase = {
      header: { inboundType: '1', inboundDate: '2026-06-17', warehouseCode: 'WH', relatedPartyCode: 'SUP', sourceOrderNo: 'PO1', paperNo: 'DN-1' },
      lines: [{ kcaa01: 'M-1', kcao03: 1 }],
    }
    assert.match(validateStockInPayload(purchase), /必须来自关联单据/)

    const other = {
      header: { inboundType: '0', inboundDate: '2026-06-17', warehouseCode: 'WH', relatedPartyName: '临时单位', paperNo: 'PN-1' },
      lines: [{ kcaa01: 'M-1', kcao03: 1 }],
    }
    assert.equal(validateStockInPayload(other), null)
  })

  test('kcan08 统一必填，未填来货单号/PI号/PO号/纸质单号时不允许保存', () => {
    const err = validateStockInPayload({
      header: { inboundType: '0', inboundDate: '2026-06-17', warehouseCode: 'WH' },
      lines: [{ kcaa01: 'M-1', kcao03: 1 }],
    })
    assert.match(err, /来货单号不能为空/)
  })

  test('外协退料来货单号 kcan08 允许为空', () => {
    const ok = validateStockInPayload({
      header: {
        inboundType: '3',
        inboundDate: '2026-06-17',
        warehouseCode: 'WH',
        relatedPartyCode: 'OUT',
        sourceOrderNo: 'WX1',
      },
      lines: [{ kcaa01: 'M-1', kcao02: 'SRC-1', kcao03: 1, kcao031: 100000 }],
    })
    assert.equal(ok, null)

    const purchase = validateStockInPayload({
      header: { inboundType: '1', inboundDate: '2026-06-17', warehouseCode: 'WH', relatedPartyCode: 'SUP', sourceOrderNo: 'PO1' },
      lines: [{ kcaa01: 'M-1', kcao02: 'SRC-1', kcao03: 1 }],
    })
    assert.match(purchase, /来货单号不能为空/)
  })

  test('normalizeStockInLine 兼容物理列 Tax 大写', () => {
    const header = normalizeStockInHeader({ inboundType: '1', warehouseCode: 'WH', paperNo: 'DN-1' })
    const line = normalizeStockInLine(
      { kcaa01: 'M-1', kcao03: 2, kcao04: 10, Tax: 0.13 },
      1,
      header,
    )
    assert.equal(line.tax, 0.13)
    assert.equal(line.kcao041, 11.3)
  })

  test('不含税模式税点只能为 0，并按不含税单价计算金额', () => {
    const err = validateStockInPayload({
      header: { inboundType: '0', inboundDate: '2026-06-17', warehouseCode: 'WH', inTax: '2', paperNo: 'PN-1' },
      lines: [{ kcaa01: 'M-1', kcao03: 2, kcao04: 10, tax: 0.13 }],
    })
    assert.match(err, /不含税模式/)

    const amounts = calcStockInAmounts({ qty: 2, priceExTax: 10, tax: 0.13 })
    assert.equal(amounts.kcao04, 10)
    assert.equal(amounts.kcao041, 11.3)
    assert.equal(amounts.kcao05, 20)
    assert.equal(amounts.kcao051, 22.6)
  })

  test('明细映射保留 Describe、kcao02、kcao031 和真实 location', () => {
    const header = normalizeStockInHeader({ inboundType: '0', warehouseCode: 'WH', paperNo: 'PN-1' })
    const line = normalizeStockInLine(
      { kcaa01: 'M-1', kcao02: 'SRC-1', kcao03: 3, info: '行备注', location: 'A-01', version: 'V1' },
      1,
      header,
    )
    assert.equal(line.kcao02, 'SRC-1')
    assert.equal(line.kcao031, 3)
    assert.equal(line.Describe, '行备注')
    assert.equal(line.location, 'A-01')
    assert.equal(line.version, 'V1')
  })

  test('采购入库保存按 kcao031 上限校验入库数量', () => {
    const over = validateStockInPayload({
      header: { inboundType: '1', inboundDate: '2026-06-17', warehouseCode: 'WH', relatedPartyCode: 'SUP', sourceOrderNo: 'PO1', paperNo: 'DN-1' },
      lines: [{ kcaa01: 'M-1', kcao02: 'SRC-1', kcao03: 12, kcao031: 10, tempx: 8 }],
    })
    assert.match(over, /不能大于可入库上限/)

    const ok = validateStockInPayload({
      header: { inboundType: '1', inboundDate: '2026-06-17', warehouseCode: 'WH', relatedPartyCode: 'SUP', sourceOrderNo: 'PO1', paperNo: 'DN-1' },
      lines: [{ kcaa01: 'M-1', kcao02: 'SRC-1', kcao03: 8, kcao031: 10, tempx: 8 }],
    })
    assert.equal(ok, null)
  })

  test('关联入库类型保存统一按可入库上限校验', () => {
    const over = validateStockInPayload({
      header: { inboundType: '2', inboundDate: '2026-06-17', warehouseCode: 'WH', relatedPartyCode: 'OUT', sourceOrderNo: 'WX1', paperNo: 'DN-1' },
      lines: [{ kcaa01: 'M-1', kcao02: 'SRC-1', kcao03: 6, kcao031: 5, availableQty: 4 }],
    })
    assert.match(over, /不能大于可入库上限/)

    const free = validateStockInPayload({
      header: { inboundType: '7', inboundDate: '2026-06-17', warehouseCode: 'WH', paperNo: 'PN-1' },
      lines: [{ kcaa01: 'M-1', kcao03: 999, kcao031: 0 }],
    })
    assert.equal(free, null)
  })

  test('编辑模式税点不能为空，0 可以保存', () => {
    const emptyTax = validateStockInPayload({
      isEdit: true,
      header: { inboundType: '0', inboundDate: '2026-06-17', warehouseCode: 'WH', inTax: '1', paperNo: 'PN-1' },
      rawLines: [{ kcaa01: 'M-1', kcao03: 1, tax: '' }],
      lines: [{ kcaa01: 'M-1', kcao03: 1, tax: '' }],
    })
    assert.match(emptyTax, /税点不能为空/)

    const zeroTax = validateStockInPayload({
      isEdit: true,
      header: { inboundType: '0', inboundDate: '2026-06-17', warehouseCode: 'WH', inTax: '1', paperNo: 'PN-1' },
      rawLines: [{ kcaa01: 'M-1', kcao03: 1, tax: 0 }],
      lines: [{ kcaa01: 'M-1', kcao03: 1, tax: 0 }],
    })
    assert.equal(zeroTax, null)
  })

  test('外协退料（类型3）不按可入库上限卡数量', () => {
    const err = validateStockInPayload({
      header: {
        inboundType: '3',
        inboundDate: '2026-06-17',
        warehouseCode: 'WH',
        inTax: '1',
        paperNo: 'PN-1',
        sourceOrderNo: 'WX-001',
        relatedPartyCode: 'S-01',
      },
      lines: [{
        kcaa01: 'MAT-1',
        kcao02: 'SC-001',
        kcao03: 50,
        kcao031: 100000,
        tempx: 0,
        tax: 0,
      }],
    })
    assert.equal(err, null)
  })

  test('customerSupplyLabel / normalizeCustomerSupplyInt 客供展示与落库', () => {
    assert.equal(customerSupplyLabel('1'), '是')
    assert.equal(customerSupplyLabel('0'), '否')
    assert.equal(customerSupplyLabel('2'), '否')
    assert.equal(customerSupplyLabel('否'), '否')

    assert.equal(normalizeCustomerSupplyInt('是'), 1)
    assert.equal(normalizeCustomerSupplyInt('否'), 2)
    assert.equal(normalizeCustomerSupplyInt('0'), 0)
    assert.equal(normalizeCustomerSupplyInt('1'), 1)
    assert.equal(normalizeCustomerSupplyInt(''), null)
  })

  test('normalizeStockInLine 将界面客供「否」归一为整型', () => {
    const header = normalizeStockInHeader({ inboundType: '3', warehouseCode: 'WH' })
    const line = normalizeStockInLine(
      { kcaa01: 'M-1', kcao03: 1, kcao02: 'SRC-1', Customer_supply: '否' },
      1,
      header,
    )
    assert.equal(line.Customer_supply, 2)
  })
})

