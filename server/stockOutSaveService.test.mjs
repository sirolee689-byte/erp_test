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

  test('外协领料来源校验 SQL 含 wxaj01/wxaj05', () => {
    const sql = buildValidateStockOutSourceOrderSql('2')
    assert.match(sql, /wxaj01/)
    assert.match(sql, /wxaj05/)
    assert.match(sql, /pass/)
  })

  test('明细字段映射 kcaq02 与 systemcode 同写 BOM.systemcode', () => {
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
})
