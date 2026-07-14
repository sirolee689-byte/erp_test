import test from 'node:test'
import assert from 'node:assert/strict'
import {
  aggregateOutsourcingMaterials,
  attachCutInfoToMaterials,
  formatCutLeatherLabel,
  formatCutPosition,
  matchCutForOutsourcingMaterial,
  normalizeOutsourcingListDate,
  stripLeatherTokensForMatch,
} from './salesOrderOutsourcingListService.js'

test('stripLeatherTokensForMatch removes 主皮色/主皮/副皮色/副皮', () => {
  assert.equal(stripLeatherTokensForMatch('主皮色围顶'), '围顶')
  assert.equal(stripLeatherTokensForMatch('副皮左侧'), '左侧')
  assert.equal(stripLeatherTokensForMatch('主皮'), '')
})

test('formatCutPosition takes first space-separated segment', () => {
  assert.equal(formatCutPosition('袋底托 放大'), '袋底托')
  assert.equal(formatCutPosition('电脑袋'), '电脑袋')
  assert.equal(formatCutPosition(''), '-')
})

test('formatCutLeatherLabel joins 描述/名称 + 编码', () => {
  assert.equal(formatCutLeatherLabel({ Describe: '主皮', kcaa02: 'DAYTONA皮', kcaa01: 'LA-0240/N' }), '主皮 LA-0240/N')
  assert.equal(formatCutLeatherLabel({ Describe: '', kcaa02: 'DAYTONA皮', kcaa01: 'LA-0240/N' }), 'DAYTONA皮 LA-0240/N')
  assert.equal(formatCutLeatherLabel(null), '-')
})

test('matchCutForOutsourcingMaterial fuzzy-matches cleaned names', () => {
  const cuts = [
    { kcaa01: 'CUT-1', kcaa02: '主皮色围顶', systemcode: 'SC-CUT-1' },
    { kcaa01: 'CUT-2', kcaa02: '袋底托', systemcode: 'SC-CUT-2' },
  ]
  const hit = matchCutForOutsourcingMaterial({ kcaa02: '围顶', kcaa03: '' }, cuts)
  assert.equal(hit?.systemcode, 'SC-CUT-1')
  assert.equal(matchCutForOutsourcingMaterial({ kcaa02: '不存在', kcaa03: '' }, cuts), null)
})

test('aggregateOutsourcingMaterials merges by code+color+name+spec and scales total', () => {
  const out = aggregateOutsourcingMaterials(
    [
      {
        kcaa01: 'BN-0005/-',
        kcaa02: '牛津布',
        kcaa03: '58"',
        kcaa11: '580',
        colorName: '黑色',
        kcac03: 'YD',
        kcaa04: '',
        kcac06: 0.01,
        px: 14,
      },
      {
        kcaa01: 'BN-0005/-',
        kcaa02: '牛津布',
        kcaa03: '58"',
        kcaa11: '580',
        colorName: '黑色',
        kcac03: 'YD',
        kcaa04: '',
        kcac06: 0.02,
        px: 10,
      },
      {
        kcaa01: 'CMT-1',
        kcaa02: '章',
        kcaa03: '',
        kcaa11: '',
        colorName: '',
        kcac03: '',
        kcaa04: 'PC',
        kcac06: 1,
        px: 23,
      },
    ],
    100,
  )
  assert.equal(out.length, 2)
  assert.equal(out[0].kcaa01, 'BN-0005/-')
  assert.equal(out[0].kcaa11, '580,黑色')
  assert.equal(out[0].unitUsage, 0.03)
  assert.equal(out[0].totalQty, 3)
  assert.equal(out[0].px, 10)
  assert.equal(out[1].unit, 'PC')
  assert.equal(out[1].totalQty, 100)
})

test('attachCutInfoToMaterials fills position and cutLeather', () => {
  const materials = aggregateOutsourcingMaterials(
    [{ kcaa01: 'M1', kcaa02: '围顶', kcaa03: '', kcaa11: '', kcac06: 1, px: 1, kcac03: 'PC' }],
    2,
  )
  const cutRows = [{ kcaa01: 'CUT-1', kcaa02: '主皮 围顶 托', systemcode: 'SC1' }]
  const children = new Map([
    ['SC1', [{ Describe: '主皮', kcaa02: '皮', kcaa01: 'LA-1' }]],
  ])
  const out = attachCutInfoToMaterials(materials, cutRows, children)
  assert.equal(out[0].position, '主皮')
  assert.equal(out[0].cutLeather, '主皮 LA-1')
  assert.equal(out[0].totalQty, 2)
})

test('normalizeOutsourcingListDate parses yyyy-mm-dd', () => {
  assert.equal(normalizeOutsourcingListDate('2026-07-01'), '2026-07-01')
  assert.equal(normalizeOutsourcingListDate('2026-07-01T12:00:00'), '2026-07-01')
  assert.equal(normalizeOutsourcingListDate(''), '')
})
