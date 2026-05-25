import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  buildSalesOrderListQueryParams,
  formatSalesOrderDate,
  passIsAudited,
} from './salesOrderDisplay.js'

describe('salesOrderDisplay', () => {
  test('passIsAudited 识别 pass=1', () => {
    assert.equal(passIsAudited({ pass: '1' }), true)
    assert.equal(passIsAudited({ pass: '0' }), false)
    assert.equal(passIsAudited({}), false)
  })

  test('buildSalesOrderListQueryParams 组装列表查询参数', () => {
    const params = buildSalesOrderListQueryParams({
      page: 2,
      pageSize: 50,
      filters: {
        piNo: ' PI-4166 ',
        systemCode: 'PI-2026',
        customer: 'Piquadro',
        salesDateFrom: '2026-05-01',
        salesDateTo: '2026-05-31',
        showRecycle: true,
      },
    })
    assert.equal(params.page, 2)
    assert.equal(params.pageSize, 50)
    assert.equal(params.recycled, 1)
    assert.equal(params.piNo, 'PI-4166')
    assert.equal(params.systemCode, 'PI-2026')
    assert.equal(params.customer, 'Piquadro')
    assert.equal(params.salesDateFrom, '2026-05-01')
    assert.equal(params.salesDateTo, '2026-05-31')
  })

  test('formatSalesOrderDate 格式化为本地日期', () => {
    assert.equal(formatSalesOrderDate('2026-05-14T00:00:00.000Z'), '2026-05-14')
    assert.equal(formatSalesOrderDate(''), '—')
  })
})
