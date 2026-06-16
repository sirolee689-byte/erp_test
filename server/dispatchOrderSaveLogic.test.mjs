import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildDispatchOrderNoForDate,
  buildNextDispatchOrderNo,
  normalizeDispatchOrderHeader,
  validateDispatchOrderPayload,
  validateDispatchOrderQuantities,
} from './dispatchOrderSaveLogic.js'

test('派工单号按 PG + 年月日 + 当日流水生成，删除记录也占号', () => {
  assert.equal(buildDispatchOrderNoForDate('2025-06-15', 1), 'PG25061501')
  assert.equal(
    buildNextDispatchOrderNo({
      dispatchDate: '2025-06-15',
      existingOrderNos: ['PG25061501', 'PG25061502', 'PG25061499'],
    }),
    'PG25061503',
  )
})

test('委外派工主表 scaj04 和 kid 保存供应商，明细 PI 仍由明细自己带入', () => {
  const header = normalizeDispatchOrderHeader({
    dispatchType: '2',
    referenceNo: 'SUP-001',
    supplierCode: 'SUP-002',
    piNo: 'PI-001',
  })
  assert.equal(header.dispatchType, '2')
  assert.equal(header.referenceNo, 'SUP-002')
  assert.equal(header.supplierCode, 'SUP-002')
})

test('正式保存必须有明细、数量大于 0、同单不能重复货号、不能混 PI', () => {
  const header = {
    dispatchDate: '2025-06-15',
    dispatchType: '0',
    workshopCode: 'CJ01',
    referenceNo: 'PI-001',
  }
  assert.equal(validateDispatchOrderPayload({ header, lines: [] }), '派工单至少需要一条明细')
  assert.equal(
    validateDispatchOrderPayload({ header, lines: [{ kcaa01: 'A', scak03: 0, pi: 'PI-001' }] }),
    '第 1 行本次派工数量必须大于 0',
  )
  assert.equal(
    validateDispatchOrderPayload({
      header,
      lines: [
        { kcaa01: 'A', scak03: 1, pi: 'PI-001' },
        { kcaa01: 'A', scak03: 1, pi: 'PI-001' },
      ],
    }),
    '同一张派工单不能重复选择货品 A',
  )
  assert.equal(
    validateDispatchOrderPayload({
      header,
      lines: [
        { kcaa01: 'A', scak03: 1, pi: 'PI-001' },
        { kcaa01: 'B', scak03: 1, pi: 'PI-002' },
      ],
    }),
    '一张派工单只能关联一个 PI',
  )
})

test('后端按实时可派工数量拦截超额派工，不依赖 scak04 快照', () => {
  const err = validateDispatchOrderQuantities({
    lines: [{ kcaa01: 'A', kcaa02: '成品A', scak03: 6, pi: 'PI-001', scak04: 999 }],
    availabilityByKey: new Map([['PI-001\u0000A', { availableQty: 5 }]]),
  })
  assert.equal(err, '成品A 本次派工数量 6 超过可派工数量 5')
})
