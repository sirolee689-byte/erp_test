/**
 * 权限规则 characterization（纯内存，无 DB）
 * 锁定 matchApiPermissionRule 对 BOM 用量运算、采购报价等路径的匹配结果。
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { matchApiPermissionRule } from './apiPermissionGate.js'

function ruleKey(rule) {
  if (!rule) return null
  if (rule.anyOf) {
    return rule.anyOf.map((x) => `${x.menuPath}:${x.action}`).sort().join('|')
  }
  return `${rule.menuPath}:${rule.action}`
}

describe('matchApiPermissionRule — BOM 资料', () => {
  test('POST /api/bom/usage-calc → inv/bom 或 bom-data 的 edit', () => {
    const rule = matchApiPermissionRule('POST', '/api/bom/usage-calc', {}, {})
    assert.ok(rule?.anyOf)
    const keys = rule.anyOf.map((x) => `${x.menuPath}:${x.action}`)
    assert.ok(keys.includes('inv/bom:edit'))
    assert.ok(keys.includes('inventory/basic/bom-data:edit'))
  })

  test('POST /api/bom/usage-calc-batch 与 usage-calc 同权限', () => {
    const a = ruleKey(matchApiPermissionRule('POST', '/api/bom/usage-calc', {}, {}))
    const b = ruleKey(matchApiPermissionRule('POST', '/api/bom/usage-calc-batch', {}, {}))
    assert.equal(a, b)
  })

  test('GET /api/bom/tree → view（须与 usage-calc 区分）', () => {
    const rule = matchApiPermissionRule('GET', '/api/bom/tree', {}, {})
    assert.ok(rule?.anyOf)
    assert.ok(rule.anyOf.some((x) => x.action === 'view'))
    assert.ok(!rule.anyOf.some((x) => x.action === 'edit'))
  })

  test('GET /api/inventory/bom/parts/:id 先于泛化 GET /api/inventory/bom/:id', () => {
    const parts = matchApiPermissionRule('GET', '/api/inventory/bom/parts/SC-001', {}, {})
    const generic = matchApiPermissionRule('GET', '/api/inventory/bom/123', {}, {})
    assert.ok(parts?.anyOf?.some((x) => x.action === 'view'))
    assert.ok(generic?.anyOf?.some((x) => x.action === 'view'))
  })

  test('PUT /api/inventory/bom/parts/:id → edit', () => {
    const rule = matchApiPermissionRule('PUT', '/api/inventory/bom/parts/SC-001', {}, {})
    assert.ok(rule?.anyOf?.some((x) => x.action === 'edit'))
  })
})

describe('matchApiPermissionRule — 采购报价', () => {
  test('POST 新增 → add', () => {
    const rule = matchApiPermissionRule('POST', '/api/supply-chain/purchase-quotations', {}, {})
    assert.deepEqual(rule, {
      menuPath: 'supply-chain/daily/purchase-quote',
      action: 'add',
    })
  })

  test('PUT 保存 → edit', () => {
    const rule = matchApiPermissionRule('PUT', '/api/supply-chain/purchase-quotations', {}, {})
    assert.deepEqual(rule, {
      menuPath: 'supply-chain/daily/purchase-quote',
      action: 'edit',
    })
  })

  test('DELETE permanent 须先于泛化 DELETE /:id', () => {
    const perm = matchApiPermissionRule(
      'DELETE',
      '/api/supply-chain/purchase-quotations/99/permanent',
      {},
      {},
    )
    const soft = matchApiPermissionRule('DELETE', '/api/supply-chain/purchase-quotations/99', {}, {})
    assert.equal(perm?.action, 'delete')
    assert.equal(soft?.action, 'delete')
    assert.match(
      matchApiPermissionRule(
        'DELETE',
        '/api/supply-chain/purchase-quotations/99/permanent',
        {},
        {},
      )?.menuPath ?? '',
      /purchase-quote/,
    )
  })

  test('GET bom-detail 允许多菜单 view', () => {
    const rule = matchApiPermissionRule(
      'GET',
      '/api/supply-chain/purchase-quotations/bom-detail',
      {},
      {},
    )
    assert.ok(rule?.anyOf?.length >= 2)
  })
})

describe('matchApiPermissionRule — 未匹配路径', () => {
  test('未知路径返回 null（仅登录校验）', () => {
    assert.equal(matchApiPermissionRule('GET', '/api/not-a-real-route', {}, {}), null)
  })
})
