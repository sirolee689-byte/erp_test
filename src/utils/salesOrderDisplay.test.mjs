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
        keyword: ' PI-4166 ',
        salesDateFrom: '2026-05-01',
        salesDateTo: '2026-05-31',
        showUnAudited: true,
      },
    })
    assert.equal(params.page, 2)
    assert.equal(params.pageSize, 50)
    assert.equal(params.recycled, 0)
    assert.equal(params.pass, '0')
    assert.equal(params.keyword, 'PI-4166')
    assert.equal(params.salesDateFrom, '2026-05-01')
    assert.equal(params.salesDateTo, '2026-05-31')
  })

  test('buildSalesOrderListQueryParams 回收站不传审核状态', () => {
    const params = buildSalesOrderListQueryParams({
      page: 1,
      pageSize: 20,
      filters: {
        keyword: 'PI-4166',
        showRecycle: true,
        showUnAudited: true,
      },
    })
    assert.equal(params.recycled, 1)
    assert.equal(params.pass, undefined)
    assert.equal(params.keyword, 'PI-4166')
  })

  test('formatSalesOrderDate 格式化为本地日期', () => {
    assert.equal(formatSalesOrderDate('2026-05-14T00:00:00.000Z'), '2026-05-14')
    assert.equal(formatSalesOrderDate(''), '—')
  })
})
