/**
 * salesOrderPiBomMaintainLogic 单元测试
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  flattenPiBomTreeForEdit,
  parsePiBomMaintainLines,
  roundDecimal6,
  validatePiBomLineIdsBelongToProduct,
  validatePiBomMaintainOrderState,
} from './salesOrderPiBomMaintainLogic.js'

describe('salesOrderPiBomMaintainLogic', () => {
  test('roundDecimal6', () => {
    assert.equal(roundDecimal6('0.1'), 0.1)
    assert.equal(roundDecimal6('bad'), 0)
  })

  test('parsePiBomMaintainLines 拒绝空与重复 id', () => {
    assert.equal(parsePiBomMaintainLines([]).ok, false)
    const ok = parsePiBomMaintainLines([
      { id: 1, kcac04: 0.2, kcac05: 0 },
      { id: 2, kcac04: 1, kcac05: 0.05 },
    ])
    assert.equal(ok.ok, true)
    assert.equal(ok.lines?.length, 2)
    const dup = parsePiBomMaintainLines([
      { id: 1, kcac04: 1 },
      { id: 1, kcac04: 2 },
    ])
    assert.equal(dup.ok, false)
  })

  test('validatePiBomMaintainOrderState 已审拒绝', () => {
    assert.match(String(validatePiBomMaintainOrderState({ pass: '1', del: '0' }) ?? ''), /反审/)
  })

  test('flattenPiBomTreeForEdit', () => {
    const flat = flattenPiBomTreeForEdit([
      {
        id: 10,
        kcaa01: 'P1',
        kcac04: 1,
        kcac05: 0,
        Describe: '',
        level: 1,
        systemcode: 'SC1',
        children: [{ id: 11, kcaa01: 'C1', kcac04: 0.5, kcac05: 0, level: 2, systemcode: 'SC2' }],
      },
    ])
    assert.equal(flat.length, 2)
    assert.equal(flat[1].kcaa01, 'C1')
  })

  test('validatePiBomLineIdsBelongToProduct', () => {
    const err = validatePiBomLineIdsBelongToProduct([1, 2], [{ id: 3 }])
    assert.ok(err && /不属于/.test(err))
    assert.equal(validatePiBomLineIdsBelongToProduct([1, 2], [{ id: 1 }]), null)
  })
})
