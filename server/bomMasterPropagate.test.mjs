import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildBomPartsPropagateSetClauses,
  buildBomCostPropagateSetClauses,
  BOM_PARTS_KCAA_SYNC_NAMES,
} from './bomMasterPropagate.js'

test('buildBomPartsPropagateSetClauses 含 kcaa01-35 与 kcac02', () => {
  const colset = new Set([...BOM_PARTS_KCAA_SYNC_NAMES, 'kcac02', 'systemcode', 'kcac04'])
  const parts = buildBomPartsPropagateSetClauses(colset)
  assert.ok(parts.some((p) => p.includes('p.[kcaa02] = src.[kcaa02]')))
  assert.ok(parts.some((p) => p.includes('p.[kcac02]')))
  assert.ok(parts.some((p) => p.includes('p.[systemcode]')))
  assert.equal(parts.filter((p) => p.startsWith('p.[kcaa')).length, 35)
  assert.ok(!parts.some((p) => p.includes('kcac04')))
})

test('buildBomPartsPropagateSetClauses 含 kcaa02_en 与 location（非 kcaa01～35）', () => {
  const colset = new Set([...BOM_PARTS_KCAA_SYNC_NAMES, 'kcaa02_en', 'location'])
  const parts = buildBomPartsPropagateSetClauses(colset)
  assert.ok(parts.some((p) => p === 'p.[kcaa02_en] = src.[kcaa02_en]'))
  assert.ok(parts.some((p) => p === 'p.[location] = src.[location]'))
})

test('buildBomCostPropagateSetClauses 覆盖名称规格与价格，不含 kcac04', () => {
  const colset = new Set([
    'kcaa02',
    'kcaa03',
    'kcaa04',
    'kcac03',
    'kcac04',
    'kcac05',
    'sale_price',
    'cost_price',
    'type',
    'version',
  ])
  const parts = buildBomCostPropagateSetClauses(colset)
  assert.ok(parts.some((p) => p.includes('c.[kcaa02] = src.[kcaa02]')))
  assert.ok(parts.some((p) => p.includes('c.[kcaa03] = src.[kcaa03]')))
  assert.ok(!parts.some((p) => p.includes('kcac04')))
  assert.ok(!parts.some((p) => p.includes('kcac05')))
})
