import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyBomCostAuditToRows,
  enrichBomCostInsertRowsFromBom000,
  BOM_COST_DEFAULT_TYPE,
  BOM_COST_DEFAULT_VERSION,
  bomCostParseDecimal6OrNull,
  resolveBom000GuidForBomCostRow,
} from './bomCostEnrichFromBom000.js'

test('enrichBomCostInsertRowsFromBom000 单位双写且不覆盖 kcaa02/kcaa03/用量', () => {
  const bom000Map = new Map([
    [
      'bn-0001/580',
      {
        kcaa04: 'YD',
        kcaa02_en: 'FABRIC EN',
        cost_price: 1.5,
        sale_price: null,
        type: null,
        version: null,
        kcaa33: 0.05,
        master_guid: 'GUID-BN-001',
        systemcode_disp: 'GUID-BN-001',
      },
    ],
  ])
  const rows = enrichBomCostInsertRowsFromBom000(
    [
      {
        kcaa01: 'BN-0001/580',
        kcaa02: '树名称',
        kcaa03: '树规格',
        kcaa04: '旧单位',
        Describe: '备注A',
        kcac04: 0.025,
        kcac05: 0.1,
        kcac06: 0.0275,
      },
    ],
    bom000Map,
  )
  assert.equal(rows.length, 1)
  const r = rows[0]
  assert.equal(r.kcaa02, '树名称')
  assert.equal(r.kcaa03, '树规格')
  assert.equal(r.kcac03, 'YD')
  assert.equal(r.kcaa04, 'YD')
  assert.equal(r.kcac04, 0.025)
  assert.equal(r.kcac05, 0.1)
  assert.equal(r.kcaa02_en, 'FABRIC EN')
  assert.equal(r.cost_price, 1.5)
  assert.equal(r.sale_price, null)
  assert.equal(r.type, BOM_COST_DEFAULT_TYPE)
  assert.equal(r.version, BOM_COST_DEFAULT_VERSION)
  assert.equal(r.kcaa33, 0.05)
  assert.equal(r.binfo, '备注A')
  assert.equal(r.GUID, 'GUID-BN-001')
  assert.equal(r.systemcode, 'GUID-BN-001')
})

test('resolveBom000GuidForBomCostRow 优先 GUID 否则 systemcode', () => {
  assert.equal(resolveBom000GuidForBomCostRow({ master_guid: 'G1', systemcode_disp: 'S1' }), 'G1')
  assert.equal(resolveBom000GuidForBomCostRow({ master_guid: '', systemcode_disp: 'S1' }), 'S1')
  assert.equal(resolveBom000GuidForBomCostRow(null), null)
})

test('enrichBomCostInsertRowsFromBom000 无 GUID 时写 NULL', () => {
  const rows = enrichBomCostInsertRowsFromBom000(
    [{ kcaa01: 'X-1', Describe: 'd1', kcac04: 1, kcac05: 0, kcac06: 1 }],
    new Map(),
  )
  assert.equal(rows[0].binfo, 'd1')
  assert.equal(rows[0].GUID, null)
  assert.equal(rows[0].systemcode, null)
})

test('applyBomCostAuditToRows 写入登录审计', () => {
  const rows = applyBomCostAuditToRows([{ kcaa01: 'A' }], {
    actor: { uidInt: 9, uname: 'u01', utruename: '张三' },
    addtime: '2026-5-18 10:00:00',
  })
  assert.equal(rows[0].uid, '9')
  assert.equal(rows[0].uname, 'u01')
  assert.equal(rows[0].utruename, '张三')
  assert.equal(rows[0].addtime, '2026-5-18 10:00:00')
})

test('enrichBomCostInsertRowsFromBom000 无主档命中仍写 type/version 默认', () => {
  const rows = enrichBomCostInsertRowsFromBom000(
    [{ kcaa01: 'UNKNOWN-1', kcaa02: 'N', kcac04: 1, kcac05: 0, kcac06: 1 }],
    new Map(),
  )
  assert.equal(rows[0].type, BOM_COST_DEFAULT_TYPE)
  assert.equal(rows[0].version, BOM_COST_DEFAULT_VERSION)
})

test('bomCostParseDecimal6OrNull', () => {
  assert.equal(bomCostParseDecimal6OrNull(''), null)
  assert.equal(bomCostParseDecimal6OrNull('abc'), null)
  assert.equal(bomCostParseDecimal6OrNull(1.23456789), 1.234568)
})
