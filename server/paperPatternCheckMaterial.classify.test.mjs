import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { classifyErpCodesAgainstKeySet } from './paperPatternCheckMaterial.js'

describe('classifyErpCodesAgainstKeySet', () => {
  it('空编码归入 failed（去重一条空串）', () => {
    const r = classifyErpCodesAgainstKeySet(['', '  ', '\t'], new Set(['x']))
    assert.deepEqual(r.failed, [''])
    assert.deepEqual(r.success, [])
  })

  it('不存在', () => {
    const r = classifyErpCodesAgainstKeySet(['LA-0368/NN'], new Set(['la-0368/n']))
    assert.deepEqual(r.failed, ['LA-0368/NN'])
    assert.deepEqual(r.success, [])
  })

  it('大小写不同仍命中', () => {
    const r = classifyErpCodesAgainstKeySet(['la-0368/n'], new Set(['la-0368/n']))
    assert.deepEqual(r.success, ['la-0368/n'])
    assert.deepEqual(r.failed, [])
  })

  it('首尾空格归一后命中', () => {
    const r = classifyErpCodesAgainstKeySet(['  LA-0368/N  '], new Set(['la-0368/n']))
    assert.deepEqual(r.success, ['LA-0368/N'])
  })

  it('重复编码在 success 中只出现一次', () => {
    const r = classifyErpCodesAgainstKeySet(['LA-0368/N', 'LA-0368/N'], new Set(['la-0368/n']))
    assert.deepEqual(r.success, ['LA-0368/N'])
  })

  it('Accessory 可为空列表', () => {
    const r = classifyErpCodesAgainstKeySet([], new Set())
    assert.deepEqual(r.success, [])
    assert.deepEqual(r.failed, [])
  })
})
