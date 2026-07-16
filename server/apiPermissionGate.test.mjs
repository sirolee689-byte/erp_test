/**
 * 权限规则 characterization（纯内存，无 DB）
 * 锁定 matchApiPermissionRule 对 BOM 用量运算、采购报价等路径的匹配结果。
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  isRecyclePermanentDeleteRequest,
  isSuperAdminIdentityChangeRequest,
  matchApiPermissionRule,
} from './apiPermissionGate.js'

function ruleKey(rule) {
  if (!rule) return null
  if (rule.anyOf) {
    return rule.anyOf.map((x) => `${x.menuPath}:${x.action}`).sort().join('|')
  }
  return `${rule.menuPath}:${rule.action}`
}

describe('超级管理员物理删除门禁', () => {
  test('所有既有物理删除路径都会被全局门禁识别', () => {
    for (const [method, path] of [
      ['DELETE', '/api/inventory/bom/systemcode/SC-001/permanent'],
      ['DELETE', '/api/stock-in/1/hard'],
      ['DELETE', '/api/dorm/delete-checkin'],
      ['POST', '/api/sales-order/1/hard-delete'],
    ]) {
      assert.equal(isRecyclePermanentDeleteRequest(method, path), true)
    }
  })

  test('普通删除接口不会被误判为物理删除', () => {
    assert.equal(isRecyclePermanentDeleteRequest('DELETE', '/api/stock-in/1'), false)
    assert.equal(isRecyclePermanentDeleteRequest('POST', '/api/sales-order/1/audit'), false)
  })

  test('只有操作员新增和编辑携带超级管理员字段时进入身份变更门禁', () => {
    assert.equal(isSuperAdminIdentityChangeRequest('POST', '/api/users', { is_admin: 1 }), true)
    assert.equal(isSuperAdminIdentityChangeRequest('PUT', '/api/users', { IsAdmin: 0 }), true)
    assert.equal(isSuperAdminIdentityChangeRequest('PUT', '/api/users', { RoleID: 1 }), false)
    assert.equal(isSuperAdminIdentityChangeRequest('PUT', '/api/roles', { is_admin: 1 }), false)
  })
})

describe('审核与反审权限拆分', () => {
  test('同一入库单的审核和反审返回不同权限动作', () => {
    assert.deepEqual(
      matchApiPermissionRule('POST', '/api/stock-in/1/audit', {}, {}),
      { menuPath: 'inventory/daily/stock-in', action: 'audit' },
    )
    assert.deepEqual(
      matchApiPermissionRule('POST', '/api/stock-in/1/unaudit', {}, {}),
      { menuPath: 'inventory/daily/stock-in', action: 'unaudit' },
    )
  })

  test('反审别名与销售订单反审均要求 unaudit', () => {
    assert.deepEqual(
      matchApiPermissionRule('PUT', '/api/dorm/un-audit', {}, {}),
      { menuPath: 'hr/dormitory/lodging-records', action: 'unaudit' },
    )
    assert.deepEqual(
      matchApiPermissionRule('POST', '/api/sales-order/1/unapprove', {}, {}),
      { menuPath: 'supply-chain/daily/sales-order', action: 'unaudit' },
    )
  })
})

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

  test('POST Excel 物料核验 → add', () => {
    assert.deepEqual(
      matchApiPermissionRule('POST', '/api/supply-chain/purchase-quotations/excel-import/materials', {}, {}),
      { menuPath: 'supply-chain/daily/purchase-quote', action: 'add' },
    )
  })

  test('转向物料查询使用采购报价 view 权限', () => {
    assert.deepEqual(
      matchApiPermissionRule('GET', '/api/supply-chain/purchase-quotations/material-query', {}, {}),
      { menuPath: 'supply-chain/daily/purchase-quote', action: 'view' },
    )
  })
})

describe('matchApiPermissionRule — 采购 PI 候选（物料单共用）', () => {
  test('GET /api/buy-order/pi-options：采购订单或物料单 view 任一即可', () => {
    const rule = matchApiPermissionRule('GET', '/api/buy-order/pi-options', {}, {})
    assert.ok(rule?.anyOf)
    const keys = rule.anyOf.map((x) => `${x.menuPath}:${x.action}`).sort()
    assert.deepEqual(keys, [
      'production/analysis/material-sheet:view',
      'supply-chain/daily/purchase-order:view',
    ])
  })

  test('其它 buy-order 只读列表仍仅挂采购订单 view（未扩大）', () => {
    const rule = matchApiPermissionRule('GET', '/api/buy-order/list', {}, {})
    assert.deepEqual(rule, {
      menuPath: 'supply-chain/daily/purchase-order',
      action: 'view',
    })
  })
})

describe('matchApiPermissionRule — 物料单外协清单', () => {
  test('GET /api/production/material-sheet/outsourcing-list：销售订单或物料单 view 任一即可', () => {
    const rule = matchApiPermissionRule('GET', '/api/production/material-sheet/outsourcing-list', {}, {})
    assert.ok(rule?.anyOf)
    const keys = rule.anyOf.map((x) => `${x.menuPath}:${x.action}`).sort()
    assert.deepEqual(keys, [
      'production/analysis/material-sheet:view',
      'supply-chain/daily/sales-order:view',
    ])
  })
})

describe('matchApiPermissionRule — 物料单位置裁片清单', () => {
  test('GET /api/production/material-sheet/cut-position-list：销售订单或物料单 view 任一即可', () => {
    const rule = matchApiPermissionRule('GET', '/api/production/material-sheet/cut-position-list', {}, {})
    assert.ok(rule?.anyOf)
    const keys = rule.anyOf.map((x) => `${x.menuPath}:${x.action}`).sort()
    assert.deepEqual(keys, [
      'production/analysis/material-sheet:view',
      'supply-chain/daily/sales-order:view',
    ])
  })
})

describe('matchApiPermissionRule — 未匹配路径', () => {
  test('未知路径返回 null（仅登录校验）', () => {
    assert.equal(matchApiPermissionRule('GET', '/api/not-a-real-route', {}, {}), null)
  })
})

describe('matchApiPermissionRule - 出库统计表', () => {
  test('出库统计表接口走统计分析出库统计表 view 权限', () => {
    for (const path of [
      '/api/stock-out-stats/warehouse-options',
      '/api/stock-out-stats/material-options',
      '/api/stock-out-stats/category-options',
      '/api/stock-out-stats/related-party-options',
      '/api/stock-out-stats/report',
      '/api/stock-out-stats/print-header',
    ]) {
      assert.deepEqual(matchApiPermissionRule('GET', path, {}, {}), {
        menuPath: 'inventory/analysis/stock-out-stats',
        action: 'view',
      })
    }
  })
})

describe('matchApiPermissionRule - 出入库统计表', () => {
  test('出入库统计表接口走统计分析出入库统计表 view 权限', () => {
    for (const path of [
      '/api/stock-movement-stats/warehouse-options',
      '/api/stock-movement-stats/material-options',
      '/api/stock-movement-stats/category-options',
      '/api/stock-movement-stats/report',
      '/api/stock-movement-stats/print-header',
    ]) {
      assert.deepEqual(matchApiPermissionRule('GET', path, {}, {}), {
        menuPath: 'inventory/analysis/stock-movement-stats',
        action: 'view',
      })
    }
  })
})

describe('matchApiPermissionRule — 入库统计表', () => {
  test('入库统计表接口走统计分析入库统计表 view 权限', () => {
    for (const path of [
      '/api/stock-in-stats/warehouse-options',
      '/api/stock-in-stats/material-options',
      '/api/stock-in-stats/category-options',
      '/api/stock-in-stats/related-party-options',
      '/api/stock-in-stats/report',
      '/api/stock-in-stats/print-header',
    ]) {
      assert.deepEqual(matchApiPermissionRule('GET', path, {}, {}), {
        menuPath: 'inventory/analysis/stock-in-stats',
        action: 'view',
      })
    }
  })
})

describe('matchApiPermissionRule - 进销存统计报表', () => {
  test('进销存统计报表接口继续走 stock-io-stats view 权限', () => {
    for (const path of [
      '/api/stock-io-stats/warehouse-options',
      '/api/stock-io-stats/material-options',
      '/api/stock-io-stats/category-options',
      '/api/stock-io-stats/report',
      '/api/stock-io-stats/print-header',
    ]) {
      assert.deepEqual(matchApiPermissionRule('GET', path, {}, {}), {
        menuPath: 'inventory/analysis/stock-io-stats',
        action: 'view',
      })
    }
  })
})
describe('matchApiPermissionRule - 历史价格查询', () => {
  test('历史价格查询接口走销售采购外协统计分析历史价格查询 view 权限', () => {
    for (const path of [
      '/api/history-price-query/print-header',
      '/api/history-price-query/supplier-options',
      '/api/history-price-query/material-options',
      '/api/history-price-query/report',
    ]) {
      assert.deepEqual(matchApiPermissionRule('GET', path, {}, {}), {
        menuPath: 'supply-chain/analysis/price-query',
        action: 'view',
      })
    }
  })
})
