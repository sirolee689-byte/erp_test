import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { buildStockOutLineAuditFields, buildValidateStockOutSourceOrderSql, buildWritableLineFields, resolveBomLineWriteValues, resolveRelatedParty, resolveStockOutSqlInputType } from './stockOutSaveService.js'

describe('stockOutSaveService', () => {
  test('字符串出库类型/税点/物料数值列按 int/decimal 绑定，避免 nvarchar→numeric', () => {
    assert.equal(resolveStockOutSqlInputType('type', '0'), 'int')
    assert.equal(resolveStockOutSqlInputType('kcap03', '0'), 'int')
    assert.equal(resolveStockOutSqlInputType('in_tax', '1'), 'int')
    assert.equal(resolveStockOutSqlInputType('version', ''), 'int')
    assert.equal(resolveStockOutSqlInputType('Tax', '0.13'), 'decimal')
    assert.equal(resolveStockOutSqlInputType('kcaq03', '3.5'), 'decimal')
    assert.equal(resolveStockOutSqlInputType('kcaa07', '100'), 'decimal')
    assert.equal(resolveStockOutSqlInputType('kcaa01', 'BM-001'), 'nvarchar')
  })

  test('明细写入字段映射 Reference/Tax，且 tax 不重复', () => {
    const lineCols = new Set(['reference', 'tax', 'describe', 'kcaq01'])
    const writable = buildWritableLineFields({
      kcaq01: 'C26062401',
      reference: 'PI-88',
      tax: 0.13,
      Tax: 0.13,
    }, lineCols)
    const cols = writable.map(([col]) => col)
    assert.deepEqual(cols, ['kcaq01', 'Reference', 'Tax'])
  })

  test('成品出库报关单价 kcaq08 可写入明细', () => {
    const lineCols = new Set(['kcaq08', 'kcaq01'])
    const writable = buildWritableLineFields({
      kcaq01: 'C26062401',
      kcaq08: 12.5,
    }, lineCols)
    const cols = writable.map(([col]) => col)
    assert.deepEqual(cols, ['kcaq01', 'kcaq08'])
    assert.equal(writable.find(([c]) => c === 'kcaq08')?.[1], 12.5)
  })

  test('保存明细时 kcaq02/GUID/systemcode 与 BOM.systemcode 一致，remark 抄 BOM.remark', () => {
    const result = resolveBomLineWriteValues({ systemcode: 'SC-BOM-001', remark: 'BOM备注A' }, 1)
    assert.deepEqual(result, { systemCode: 'SC-BOM-001', remark: 'BOM备注A' })
    const fromGuid = resolveBomLineWriteValues({ GUID: 'GUID-BOM-002', remark: '' }, 2)
    assert.equal(fromGuid.systemCode, 'GUID-BOM-002')
  })

  test('BOM 缺少 systemcode 时阻止保存', () => {
    assert.throws(
      () => resolveBomLineWriteValues({ systemcode: '', remark: 'X' }, 2),
      /第 2 行物料缺少 systemcode/,
    )
  })

  test('保存明细写入英文名称与操作员快照字段', () => {
    const audit = buildStockOutLineAuditFields(
      { uid: 1, uname: 'admin', utruename: '超级管理员' },
      '2026-06-24 18:00:00',
    )
    assert.deepEqual(audit, {
      uid: '1',
      uname: 'admin',
      utruename: '超级管理员',
      addtime: '2026-06-24 18:00:00',
    })

    const lineCols = new Set(['kcaa02_en', 'uid', 'uname', 'utruename', 'addtime'])
    const writable = buildWritableLineFields({
      kcaa02_en: 'Fine Mesh Material',
      ...audit,
    }, lineCols)
    const cols = writable.map(([col]) => col)
    assert.deepEqual(cols, ['kcaa02_en', 'uid', 'uname', 'utruename', 'addtime'])
  })

  test('其他出库未选关联单位时允许空编码', async () => {
    const result = await resolveRelatedParty(null, { outboundType: '0', relatedPartyCode: '' })
    assert.deepEqual(result, { ok: true, code: '', name: '' })
  })

  test('其他出库手填关联单位只写 kehu', async () => {
    const result = await resolveRelatedParty(null, { outboundType: '0', relatedPartyCode: '', relatedPartyName: '临时单位' })
    assert.deepEqual(result, { ok: true, code: '', name: '临时单位' })
  })

  test('其他出库按销售客户编码解析 kcap05/kehu', async () => {
    const pool = {
      request: () => ({
        input() { return this },
        async query() {
          return { recordset: [{ code: '7001', name: 'PQD' }] }
        },
      }),
    }
    const result = await resolveRelatedParty(pool, { outboundType: '0', relatedPartyCode: '7001' })
    assert.deepEqual(result, { ok: true, code: '7001', name: 'PQD' })
  })

  test('其他出库销售客户不存在时拒绝保存', async () => {
    const pool = {
      request: () => ({
        input() { return this },
        async query() {
          return { recordset: [] }
        },
      }),
    }
    const result = await resolveRelatedParty(pool, { outboundType: '0', relatedPartyCode: 'NOPE' })
    assert.equal(result.ok, false)
    assert.match(result.msg, /销售客户/)
  })

  test('成品出库按销售客户表解析 kcap05/kehu', async () => {
    let capturedSql = ''
    const pool = {
      request: () => ({
        input() { return this },
        async query(sqlText) {
          capturedSql = sqlText
          return { recordset: [{ code: 'C001', name: '客户A' }] }
        },
      }),
    }
    const result = await resolveRelatedParty(pool, { outboundType: '6', relatedPartyCode: 'C001' })
    assert.deepEqual(result, { ok: true, code: 'C001', name: '客户A' })
    assert.match(capturedSql, /UB_ERP_System_sales_customer/)
    assert.doesNotMatch(capturedSql, /UB_ERP_Customer/)
  })

  test('外协领料来源校验 SQL 含 wxaj01/wxaj05', () => {
    const sql = buildValidateStockOutSourceOrderSql('2')
    assert.match(sql, /wxaj01/)
    assert.match(sql, /wxaj05/)
    assert.match(sql, /pass/)
  })

  test('成品出库来源校验 SQL 指向销售订单且要求仍有可出货明细', () => {
    const sql = buildValidateStockOutSourceOrderSql('6')
    assert.match(sql, /UB_ERP_Sales_order\]/)
    assert.match(sql, /UB_ERP_Sales_order_list\]/)
    assert.match(sql, /xsaj01/)
    assert.match(sql, /xsaj05/)
    assert.match(sql, /xsak02[\s\S]*GUID/i)
    assert.match(sql, /xsak03[\s\S]*-[\s\S]*xsak06[\s\S]*>\s*0/i)
    assert.match(sql, /closed/)
    assert.match(sql, /pass/)
  })

  test('明细字段映射 kcaq02 与 systemcode 同写 BOM.systemcode（非成品出库）', () => {
    const lineCols = new Set(['kcaq02', 'systemcode'])
    const bomSc = 'BOM-SC-001'
    const writable = buildWritableLineFields({
      kcaq02: bomSc,
      systemcode: bomSc,
    }, lineCols)
    const map = Object.fromEntries(writable)
    assert.equal(map.kcaq02, bomSc)
    assert.equal(map.systemcode, bomSc)
  })

  test('成品出库明细 kcaq02 使用销售明细键而非 BOM systemcode', () => {
    const lineCols = new Set(['kcaq02', 'systemcode', 'guid'])
    const salesKey = 'XS-LINE-KEY-001'
    const writable = buildWritableLineFields({
      kcaq02: salesKey,
      systemcode: salesKey,
      GUID: salesKey,
    }, lineCols)
    const map = Object.fromEntries(writable)
    assert.equal(map.kcaq02, salesKey)
    assert.equal(map.systemcode, salesKey)
    assert.equal(map.GUID ?? map.guid, salesKey)
  })
})
