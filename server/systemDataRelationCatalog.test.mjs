import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { getSystemDataRelationCatalog } from './systemDataRelationCatalog.js'
import { matchApiPermissionRule } from './apiPermissionGate.js'

function getSalesOrderActions() {
  const catalog = getSystemDataRelationCatalog()
  const salesOrder = catalog.modules.find((module) => module.id === 'sales-order')
  assert.ok(salesOrder)
  return salesOrder.actions
}

function getPurchaseOrderActions() {
  const catalog = getSystemDataRelationCatalog()
  const purchaseOrder = catalog.modules.find((module) => module.id === 'purchase-order')
  assert.ok(purchaseOrder)
  return purchaseOrder.actions
}

function getStockInActions() {
  const catalog = getSystemDataRelationCatalog()
  const stockIn = catalog.modules.find((module) => module.id === 'stock-in')
  assert.ok(stockIn)
  return stockIn.actions
}

function getModuleActions(moduleId) {
  const catalog = getSystemDataRelationCatalog()
  const module = catalog.modules.find((item) => item.id === moduleId)
  assert.ok(module)
  return module.actions
}

describe('系统内核数据关联目录', () => {
  test('销售订单首版固定包含四项核心动作', () => {
    assert.deepEqual(
      getSalesOrderActions().map((action) => action.id),
      ['save-order', 'save-pi-bom', 'sync-bom', 'calculate'],
    )
  })

  test('保存订单明确标记PI BOM对齐和条件性清理物料结果', () => {
    const action = getSalesOrderActions().find((item) => item.id === 'save-order')
    const writeByTable = new Map(action.writes.map((item) => [item.tableName, item]))
    assert.equal(writeByTable.get('UB_ERP_Sales_order_list')?.operation, '整单替换')
    assert.equal(writeByTable.get('UB_ERP_Bom_Sales')?.conditional, true)
    assert.equal(writeByTable.get('UB_ERP_Bom_Sales_list')?.conditional, true)
    assert.equal(writeByTable.get('UB_ERP_Bom_pi_cost')?.conditional, true)
  })

  test('保存PI BOM和同步BOM均注明当下不删除pi_cost', () => {
    for (const id of ['save-pi-bom', 'sync-bom']) {
      const action = getSalesOrderActions().find((item) => item.id === id)
      assert.ok(action.conditions.some((text) => text.includes('不删除 UB_ERP_Bom_pi_cost')))
    }
  })

  test('一键运算写pi_cost并按物理表存在条件写pi_consumption', () => {
    const action = getSalesOrderActions().find((item) => item.id === 'calculate')
    const writeByTable = new Map(action.writes.map((item) => [item.tableName, item]))
    assert.ok(writeByTable.has('UB_ERP_Bom_pi_cost'))
    assert.equal(writeByTable.get('UB_ERP_Bom_pi_consumption')?.conditional, true)
  })

  test('采购订单固定包含保存、审核和反审三项当前可见动作', () => {
    assert.deepEqual(
      getPurchaseOrderActions().map((action) => action.id),
      ['save-order', 'audit', 'unaudit'],
    )
  })

  test('采购订单保存整批重写明细、费用和BOM快照', () => {
    const action = getPurchaseOrderActions().find((item) => item.id === 'save-order')
    const writeByTable = new Map(action.writes.map((item) => [item.tableName, item]))
    assert.equal(writeByTable.get('UB_ERP_Buy_order')?.operation, '新增/更新')
    for (const tableName of [
      'UB_ERP_Buy_order_list',
      'UB_ERP_Buy_order_money',
      'UB_ERP_Bom_buy_order',
      'UB_ERP_Bom_buy_order_list',
    ]) {
      assert.equal(writeByTable.get(tableName)?.operation, '整单替换')
    }
    assert.ok(action.conditions.some((text) => text.includes('已有采购入库记录')))
  })

  test('采购订单审核只更新主表，反审另写原因表', () => {
    const audit = getPurchaseOrderActions().find((item) => item.id === 'audit')
    assert.deepEqual(audit.writes.map((item) => item.tableName), ['UB_ERP_Buy_order'])

    const unaudit = getPurchaseOrderActions().find((item) => item.id === 'unaudit')
    const writeByTable = new Map(unaudit.writes.map((item) => [item.tableName, item]))
    assert.equal(writeByTable.get('UB_ERP_Buy_order_sp')?.operation, '新增')
    assert.ok(unaudit.reads.some((item) => item.tableName === 'UB_ERP_Bom_buy_order'))
    assert.ok(unaudit.conditions.some((text) => text.includes('已有采购入库记录时当前代码仍允许反审')))
  })

  test('入库单固定包含保存、审核、反审核、复核和反复核', () => {
    assert.deepEqual(
      getStockInActions().map((action) => action.id),
      ['save-stock-in', 'audit', 'unaudit', 'review', 'unreview'],
    )
  })

  test('入库单保存按类型读取来源表且只写入库主从表', () => {
    const action = getStockInActions().find((item) => item.id === 'save-stock-in')
    const readTables = new Set(action.reads.map((item) => item.tableName))
    for (const tableName of [
      'UB_ERP_Buy_order',
      'UB_ERP_assist_order',
      'UB_ERP_Dispatch_order',
      'UB_ERP_Sales_order',
    ]) {
      assert.ok(readTables.has(tableName))
    }
    assert.deepEqual(
      action.writes.map((item) => item.tableName),
      ['UB_ERP_Stocks_Storage', 'UB_ERP_Stocks_Storage_list'],
    )
    assert.equal(action.writes[1]?.operation, '整单替换')
    assert.ok(action.conditions.some((text) => text.includes('保存不反写采购、外协、派工或销售来源表')))
  })

  test('入库单审核和反审核同步主从pass，复核和反复核同步主从sp_flag', () => {
    for (const id of ['audit', 'unaudit', 'review', 'unreview']) {
      const action = getStockInActions().find((item) => item.id === id)
      assert.deepEqual(
        action.writes.map((item) => item.tableName),
        ['UB_ERP_Stocks_Storage', 'UB_ERP_Stocks_Storage_list'],
      )
    }
    assert.ok(getStockInActions().find((item) => item.id === 'audit').conditions.some((text) => text.includes('空明细草稿')))
    assert.ok(getStockInActions().find((item) => item.id === 'unreview').conditions.some((text) => text.includes('库存统计数量不变')))
  })

  test('出库单包含保存、审核和反审核，并按类型条件回写来源明细', () => {
    const actions = getModuleActions('stock-out')
    assert.deepEqual(actions.map((action) => action.id), ['save-stock-out', 'audit', 'unaudit'])
    assert.deepEqual(
      actions[0].writes.map((item) => item.tableName),
      ['UB_ERP_Stocks_out', 'UB_ERP_Stocks_out_list'],
    )

    for (const id of ['audit', 'unaudit']) {
      const action = actions.find((item) => item.id === id)
      const writeByTable = new Map(action.writes.map((item) => [item.tableName, item]))
      for (const tableName of [
        'UB_ERP_Buy_order_list',
        'UB_ERP_assist_order_list',
        'UB_ERP_Dispatch_order_list',
        'UB_ERP_Sales_order_list',
      ]) {
        assert.equal(writeByTable.get(tableName)?.conditional, true)
      }
    }
    assert.ok(actions.find((item) => item.id === 'unaudit').conditions.some((text) => text.includes('最低 0')))
  })

  test('外协单包含保存、审核反审和结案反结案，生命周期只写主表', () => {
    const actions = getModuleActions('assist-order')
    assert.deepEqual(actions.map((action) => action.id), ['save-order', 'audit', 'unaudit', 'close', 'unclose'])
    assert.deepEqual(
      actions[0].writes.map((item) => item.tableName),
      ['UB_ERP_assist_order', 'UB_ERP_assist_order_list', 'UB_ERP_assist_order_money'],
    )
    for (const id of ['audit', 'unaudit', 'close', 'unclose']) {
      assert.deepEqual(
        actions.find((item) => item.id === id).writes.map((item) => item.tableName),
        ['UB_ERP_assist_order'],
      )
    }
    assert.ok(actions.find((item) => item.id === 'audit').conditions.some((text) => text.includes('不创建入库或出库数据')))
  })

  test('派工单保存读取销售订单和车间，审核反审核只同步派工主从表', () => {
    const actions = getModuleActions('dispatch-order')
    assert.deepEqual(actions.map((action) => action.id), ['save-order', 'audit', 'unaudit'])
    const saveReads = new Set(actions[0].reads.map((item) => item.tableName))
    for (const tableName of ['UB_ERP_Stocks_workshop', 'UB_ERP_Sales_order', 'UB_ERP_Sales_order_list']) {
      assert.ok(saveReads.has(tableName))
    }
    for (const id of ['audit', 'unaudit']) {
      assert.deepEqual(
        actions.find((item) => item.id === id).writes.map((item) => item.tableName),
        ['UB_ERP_Dispatch_order', 'UB_ERP_Dispatch_order_list'],
      )
    }
    assert.ok(actions[0].conditions.some((text) => text.includes('不写库存')))
  })

  test('目录返回独立副本，调用方修改不会污染下一次结果', () => {
    const first = getSystemDataRelationCatalog()
    first.modules[0].actions.length = 0
    assert.equal(getSalesOrderActions().length, 4)
    assert.equal(getPurchaseOrderActions().length, 3)
    assert.equal(getStockInActions().length, 5)
    assert.equal(getModuleActions('stock-out').length, 3)
    assert.equal(getModuleActions('assist-order').length, 5)
    assert.equal(getModuleActions('dispatch-order').length, 3)
  })
})

describe('系统内核数据关联接口权限', () => {
  test('读取接口沿用ERP内核view权限', () => {
    assert.deepEqual(matchApiPermissionRule('GET', '/api/system/kernel/data-relations', {}, {}), {
      menuPath: 'system/kernel/erp-core',
      action: 'view',
    })
  })
})
