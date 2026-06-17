import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  buildNextStockInNo,
  calcStockInAmounts,
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
      header: { inboundType: '4', inboundDate: '2026-06-17', warehouseCode: 'WH', relatedPartyCode: 'CJ01' },
      lines: [{ kcaa01: 'M-1', kcao03: 1, kcao02: 'SRC-LINE' }],
    }
    assert.match(validateStockInPayload(base), /生产入库必须选择派工单/)

    const ret = {
      header: { inboundType: '5', inboundDate: '2026-06-17', warehouseCode: 'WH', relatedPartyCode: 'CJ01' },
      lines: [{ kcaa01: 'M-1', kcao03: 1 }],
    }
    assert.equal(validateStockInPayload(ret), null)
  })

  test('关联型入库不允许无来源明细，其他入库允许手工明细', () => {
    const purchase = {
      header: { inboundType: '1', inboundDate: '2026-06-17', warehouseCode: 'WH', relatedPartyCode: 'SUP', sourceOrderNo: 'PO1' },
      lines: [{ kcaa01: 'M-1', kcao03: 1 }],
    }
    assert.match(validateStockInPayload(purchase), /必须来自关联单据/)

    const other = {
      header: { inboundType: '0', inboundDate: '2026-06-17', warehouseCode: 'WH', relatedPartyName: '临时单位' },
      lines: [{ kcaa01: 'M-1', kcao03: 1 }],
    }
    assert.equal(validateStockInPayload(other), null)
  })

  test('不含税模式税点只能为 0，并按不含税单价计算金额', () => {
    const err = validateStockInPayload({
      header: { inboundType: '0', inboundDate: '2026-06-17', warehouseCode: 'WH', inTax: '2' },
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
    const header = normalizeStockInHeader({ inboundType: '0', warehouseCode: 'WH' })
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
})

