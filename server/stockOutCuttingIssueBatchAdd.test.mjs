import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CUTTING_WORKSHOP_CODE,
  aggregateCuttingIssueRows,
  buildCuttingIssueSourceLineCode,
  isCuttingWorkshop,
  isPiCostCutStructureRow,
  __buildPiCostCuttingIssueSqlForTest,
} from './stockOutCuttingIssueBatchAdd.js'
import {
  computeProductionDualStillNeedQty,
  computeProductionIssueDefaultQty,
  resolveProductionIssueDualQtyCaps,
} from './stockOutProductionIssueBatchAdd.js'

describe('stockOutCuttingIssueBatchAdd', () => {
  test('isCuttingWorkshop 仅车间 04', () => {
    assert.equal(isCuttingWorkshop('04'), true)
    assert.equal(isCuttingWorkshop('03'), false)
    assert.equal(CUTTING_WORKSHOP_CODE, '04')
  })

  test('isPiCostCutStructureRow 识别 CUT 裁片', () => {
    assert.equal(isPiCostCutStructureRow({ t_kcaa01: 'CUT-001/A' }), true)
    assert.equal(isPiCostCutStructureRow({ top_kcaa01: 'cut-002' }), true)
    assert.equal(isPiCostCutStructureRow({ t_kcaa01: 'BAG-001' }), false)
  })

  test('aggregateCuttingIssueRows 按 kcaa01 累加 kcac06×temp', () => {
    const rows = [
      { kcaa01: 'BN-0001/-', kcac06: 0.5, temp: 10, t_kcaa01: 'CUT-001/A' },
      { kcaa01: 'BN-0001/-', kcac06: 0.3, temp: 10, t_kcaa01: 'CUT-001/A' },
      { kcaa01: 'BN-0002/-', kcac06: 2, temp: 5, t_kcaa01: 'CUT-002/A' },
    ]
    const agg = aggregateCuttingIssueRows(rows)
    assert.equal(agg.length, 2)
    const a = agg.find((x) => x.childKcaa01 === 'BN-0001/-')
    assert.equal(a.sourceDemandQty, 8)
    const b = agg.find((x) => x.childKcaa01 === 'BN-0002/-')
    assert.equal(b.sourceDemandQty, 10)
  })

  test('开料需求先按六位累计，最终三位数量与物料单一致', () => {
    const rows = [
      { kcaa01: 'BN-0001/580', kcac06: 0.010768, temp: 150 },
      { kcaa01: 'BN-0001/580', kcac06: 0.005121, temp: 150 },
      { kcaa01: 'BN-0001/580', kcac06: 0.005325, temp: 80 },
      { kcaa01: 'BN-0001/580', kcac06: 0.00665, temp: 80 },
      { kcaa01: 'BN-0001/580', kcac06: 0.002014, temp: 100 },
      { kcaa01: 'BN-0001/580', kcac06: 0.00434, temp: 100 },
      { kcaa01: 'BN-0001/580', kcac06: 0.00798, temp: 200 },
      { kcaa01: 'BN-0001/580', kcac06: 0.004097, temp: 200 },
    ]

    const [line] = aggregateCuttingIssueRows(rows)
    assert.equal(line.sourceDemandQty, 6.39215)
    const caps = resolveProductionIssueDualQtyCaps({
      sourceDemandQty: line.sourceDemandQty,
      piDemandQty: 6.392,
      warehouseActualQty: 100,
    })
    assert.equal(caps.sourceDemandQty, 6.392)
    assert.equal(caps.stillNeedQty, 6.392)
  })

  test('buildCuttingIssueSourceLineCode 合成 kcaq02', () => {
    assert.equal(buildCuttingIssueSourceLineCode('BN-0001/-'), 'CUT|BN-0001/-')
  })

  test('开料双道限制：PI剩余更紧时还需出库取PI剩余', () => {
    const dual = computeProductionDualStillNeedQty({
      sourceDemandQty: 100,
      dispatchApprovedOutQty: 0,
      dispatchPendingOutQty: 0,
      piDemandQty: 80,
      piIssuedQty: 75,
    })
    assert.equal(dual.stillNeedQty, 5)
    const caps = resolveProductionIssueDualQtyCaps({
      sourceDemandQty: 100,
      dispatchApprovedOutQty: 0,
      dispatchPendingOutQty: 0,
      piDemandQty: 80,
      piIssuedQty: 75,
      warehouseActualQty: 50,
    })
    assert.equal(caps.issueableQty, 5)
  })

  test('开料默认可选 = min(还需出库, 实际库存)', () => {
    const dual = computeProductionDualStillNeedQty({
      sourceDemandQty: 100,
      dispatchApprovedOutQty: 20,
      dispatchPendingOutQty: 10,
      piDemandQty: 500,
      piIssuedQty: 0,
    })
    assert.equal(dual.stillNeedQty, 70)
    const issueable = computeProductionIssueDefaultQty({ stillNeedQty: dual.stillNeedQty, warehouseActualQty: 50 })
    assert.equal(issueable, 50)
  })

  test('开料 SQL 含 CUT 与 kcaa05 筛选', () => {
    const sql = __buildPiCostCuttingIssueSqlForTest()
    assert.match(sql, /CUT-%/i)
    assert.match(sql, /kcaa05/i)
    assert.match(sql, /isok/i)
  })
})
