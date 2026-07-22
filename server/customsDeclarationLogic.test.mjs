import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeExcelPi,
  excelPiMatchMode,
  buildMaterialCode,
  isOutCustomerStyle,
  stripHyphens,
  materialStylePrefix,
  materialColorSegment,
  styleLooseContains,
  softMatchFactoryColor,
  parseShipDate,
  defaultInboundDateFromShip,
  buildGroupKey,
  buildOutboundGroupKey,
  resolveInboundQtyAgainstTempx,
  allocateTempxAcrossLines,
  joinCustomsNos,
  buildPendingInboundByMaterial,
  initWarehouseRemaining,
  resolveOutboundQtyAgainstWarehouse,
  deductWarehouseRemaining,
} from './customsDeclarationLogic.js'

test('normalizeExcelPi', () => {
  assert.equal(normalizeExcelPi('PI4106'), 'PI-4106')
  assert.equal(normalizeExcelPi('pi-4106a'), 'PI-4106A')
  assert.equal(normalizeExcelPi('PI4106B'), 'PI-4106B')
})

test('excelPiMatchMode', () => {
  assert.deepEqual(excelPiMatchMode('PI4106'), { mode: 'prefix', value: 'PI-4106' })
  assert.deepEqual(excelPiMatchMode('PI-4106A'), { mode: 'exact', value: 'PI-4106A' })
})

test('buildMaterialCode', () => {
  assert.equal(buildMaterialCode('PQ-3689A1', '14'), 'PQ-3689A1/14')
  assert.equal(buildMaterialCode('PQ-3631B1', 'N'), 'PQ-3631B1/N')
  assert.equal(buildMaterialCode('PQ-2284A1', 'BLU', 'OUTCA1358VI'), 'PQ-2284A1/BLU-OUT')
  assert.equal(buildMaterialCode('PQ-2284A1', 'BLU', 'CA1358VI'), 'PQ-2284A1/BLU')
  assert.equal(buildMaterialCode('PQ-2284A1', 'BLU', 'xxOUTyy'), 'PQ-2284A1/BLU')
})

test('isOutCustomerStyle', () => {
  assert.equal(isOutCustomerStyle('OUTCA1358VI'), true)
  assert.equal(isOutCustomerStyle('outca'), true)
  assert.equal(isOutCustomerStyle('CAOUT'), false)
})

test('style loose match ATG', () => {
  assert.equal(stripHyphens('PQ-3490A1'), 'PQ3490A1')
  assert.equal(materialStylePrefix('ATG-PQ3490A1/BLU2'), 'ATG-PQ3490A1')
  assert.equal(materialColorSegment('ATG-PQ3490A1/BLU2'), 'BLU2')
  assert.equal(styleLooseContains('PQ-3490A1', 'ATG-PQ3490A1'), true)
  assert.equal(softMatchFactoryColor('PQ-3490A1', 'BLU2', 'ATG-PQ3490A1/BLU2'), true)
  assert.equal(softMatchFactoryColor('PQ-3490A1', 'N', 'ATG-PQ3490A1/BLU2'), false)
  assert.equal(softMatchFactoryColor('PQ-9999A1', 'BLU2', 'ATG-PQ3490A1/BLU2'), false)
})

test('parseShipDate and default inbound -3 days', () => {
  assert.equal(parseShipDate('2026-03-11'), '2026-03-11')
  assert.equal(parseShipDate('20260311'), '2026-03-11')
  assert.equal(defaultInboundDateFromShip('20260311', 3), '2026-03-08')
  assert.equal(defaultInboundDateFromShip('2026-03-11', 3), '2026-03-08')
})

test('buildGroupKey', () => {
  assert.equal(buildGroupKey('PI-4106A', '2026-03-08', 'PG25112703'), 'PI-4106A|2026-03-08|PG25112703')
})

test('buildOutboundGroupKey', () => {
  assert.equal(buildOutboundGroupKey('PI-4106A', '2026-03-11', 'PG25112703'), 'PI-4106A|2026-03-11|PG25112703')
})

test('resolveInboundQtyAgainstTempx truncate', () => {
  const r = resolveInboundQtyAgainstTempx(100, 50)
  assert.equal(r.ok, true)
  assert.equal(r.inboundQty, 50)
  assert.equal(r.truncated, true)
  const fail = resolveInboundQtyAgainstTempx(10, 0)
  assert.equal(fail.ok, false)
})

test('allocateTempxAcrossLines sequential', () => {
  const out = allocateTempxAcrossLines(
    [
      { kcao02: 'A', declareQty: 40 },
      { kcao02: 'A', declareQty: 40 },
    ],
    () => 50,
  )
  assert.equal(out[0].ok, true)
  assert.equal(out[0].inboundQty, 40)
  assert.equal(out[1].ok, true)
  assert.equal(out[1].inboundQty, 10)
  assert.equal(out[1].truncated, true)
})

test('joinCustomsNos', () => {
  assert.equal(joinCustomsNos(['a', 'a', 'b']), 'a；b')
})

test('buildPendingInboundByMaterial', () => {
  const map = buildPendingInboundByMaterial([
    { kcaa01: 'A/B', inboundQty: 40 },
    { kcaa01: 'A/B', inboundQty: 60 },
    { kcaa01: 'C/D', inboundQty: 10 },
  ])
  assert.equal(map.get('A/B'), 100)
  assert.equal(map.get('C/D'), 10)
})

test('initWarehouseRemaining and resolveOutboundQtyAgainstWarehouse', () => {
  const pending = buildPendingInboundByMaterial([{ kcaa01: 'M1', inboundQty: 100 }])
  const stockActual = new Map([['M1', 0]])
  const remaining = initWarehouseRemaining(stockActual, pending)
  const ok = resolveOutboundQtyAgainstWarehouse(60, 'M1', remaining, pending)
  assert.equal(ok.ok, true)
  assert.equal(ok.available, 100)
  deductWarehouseRemaining(remaining, 'M1', 60)
  const fail = resolveOutboundQtyAgainstWarehouse(60, 'M1', remaining, pending)
  assert.equal(fail.ok, false)
  assert.match(fail.reason, /本批入库后成品仓仍不足/)
})

test('resolveOutboundQtyAgainstWarehouse without batch inbound', () => {
  const pending = new Map()
  const remaining = initWarehouseRemaining(new Map([['M1', 20]]), pending)
  const fail = resolveOutboundQtyAgainstWarehouse(30, 'M1', remaining, pending)
  assert.equal(fail.ok, false)
  assert.match(fail.reason, /请先生成入库/)
})
