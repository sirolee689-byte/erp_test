import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  buildAssistReturnLineKey,
  buildBomPartInfoText,
  computeBomFixedTaxPrice,
  computeBomPartUnitPrice,
  computePartLossRate,
  computePartUsageTotal,
  flattenAssistReturnBomTree,
  resolveBomRate,
} from './stockInAssistReturnBatchAdd.js'

describe('stockInAssistReturnBatchAdd', () => {
  test('buildAssistReturnLineKey 使用 systemcode + pm', () => {
    assert.equal(buildAssistReturnLineKey('SC-001', 'BAG-01'), 'sc-001|bag-01')
    assert.equal(buildAssistReturnLineKey('', 'BAG-01'), '')
  })

  test('resolveBomRate 空值默认 1，不用 rate 回退', () => {
    assert.equal(resolveBomRate(null), 1)
    assert.equal(resolveBomRate(''), 1)
    assert.equal(resolveBomRate(0), 1)
    assert.equal(resolveBomRate(6.5), 6.5)
  })

  test('computeBomPartUnitPrice = sale_price / bom_rate', () => {
    assert.equal(computeBomPartUnitPrice(10, 2), 5)
    assert.equal(computeBomPartUnitPrice(10, 0), 10)
  })

  test('computeBomFixedTaxPrice 固定 8%', () => {
    assert.equal(computeBomFixedTaxPrice(100), 108)
  })

  test('computePartUsageTotal 含损耗', () => {
    assert.equal(computePartUsageTotal(2, 0.1), 2.2)
  })

  test('buildBomPartInfoText 拼接 Describe/d_info/remark', () => {
    assert.equal(
      buildBomPartInfoText({ Describe: '搭配A', d_info: '补充', remark: '备注' }),
      '搭配A / 补充 / 备注',
    )
    assert.equal(buildBomPartInfoText({}), '')
  })

  test('flattenAssistReturnBomTree 叶子合并同编码', () => {
    const tree = [
      {
        kcaa01: 'MAT-A',
        kcac04: 2,
        kcac05: 0,
        children: [],
      },
      {
        kcaa01: 'MAT-A',
        kcac04: 1,
        kcac05: 0,
        children: [],
      },
    ]
    const map = flattenAssistReturnBomTree(tree)
    assert.equal(map.size, 1)
    assert.equal(map.get('mat-a').totalUsage, 3)
  })

  test('flattenAssistReturnBomTree 三层连乘', () => {
    const tree = [
      {
        kcaa01: 'ASM',
        kcac04: 2,
        kcac05: 0,
        children: [
          {
            kcaa01: 'SUB',
            kcac04: 3,
            kcac05: 0,
            children: [
              { kcaa01: 'LEAF', kcac04: 4, kcac05: 0, children: [] },
            ],
          },
        ],
      },
    ]
    const map = flattenAssistReturnBomTree(tree)
    assert.equal(map.get('leaf').totalUsage, 24)
  })

  test('computePartLossRate 优先 kcac05', () => {
    assert.equal(computePartLossRate(0.05, 0.1), 0.05)
    assert.equal(computePartLossRate(5, 0), 0.05)
  })
})
