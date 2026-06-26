import test from 'node:test'
import assert from 'node:assert/strict'

import { buildDispatchAvailabilityScope } from './dispatchOrderSaveService.js'

test('本厂派工按 PI+车间独立统计已派工', () => {
  const { dispatchScope, bindWorkshopCode } = buildDispatchAvailabilityScope({
    dispatchType: '0',
    workshopCode: '03',
    workshopName: '包装部',
  })
  assert.equal(bindWorkshopCode, true)
  assert.match(dispatchScope, /scaj04.*@pi/s)
  assert.match(dispatchScope, /scaj05.*@workshopCode/s)
})

test('大板派工按 PI+车间独立统计已派工', () => {
  const { dispatchScope, bindWorkshopCode } = buildDispatchAvailabilityScope({
    dispatchType: '1',
    workshopCode: '0901',
    workshopName: '车缝车间',
  })
  assert.equal(bindWorkshopCode, true)
  assert.match(dispatchScope, /scaj04.*@pi/s)
  assert.match(dispatchScope, /scaj05.*@workshopCode/s)
})

test('委外派工且车间名含生产时按 cj like 生产统计', () => {
  const { dispatchScope, bindWorkshopCode } = buildDispatchAvailabilityScope({
    dispatchType: '2',
    workshopCode: 'XX',
    workshopName: '生产车间A',
  })
  assert.equal(bindWorkshopCode, false)
  assert.match(dispatchScope, /cj.*%生产%/s)
  assert.doesNotMatch(dispatchScope, /@pi/)
})

test('委外派工普通车间按 scaj05 统计', () => {
  const { dispatchScope, bindWorkshopCode } = buildDispatchAvailabilityScope({
    dispatchType: '2',
    workshopCode: 'SUP01',
    workshopName: '外协厂',
  })
  assert.equal(bindWorkshopCode, true)
  assert.match(dispatchScope, /scaj05.*@workshopCode/s)
  assert.doesNotMatch(dispatchScope, /@pi/)
})
