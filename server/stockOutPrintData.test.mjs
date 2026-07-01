import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  buildStockOutPrintDetailLinesSql,
  buildStockOutPrintSummaryLinesSql,
  fetchStockOutPrintDocuments,
  parseStockOutPrintSystemcodes,
} from './stockOutPrintData.js'

describe('stock-out print data', () => {
  test('parseStockOutPrintSystemcodes splits p_sum and removes empty values', () => {
    assert.deepEqual(parseStockOutPrintSystemcodes(' A , ,B,C '), ['A', 'B', 'C'])
  })

  test('empty p_sum returns old-system error code', async () => {
    const result = await fetchStockOutPrintDocuments({ request() { throw new Error('should not query') } }, { pSum: '' })
    assert.equal(result.ok, false)
    assert.equal(result.msg, 'Error,Code:208')
  })

  test('detail SQL reads lines by outbound no and joins color code by kcaa11', () => {
    const sqlText = buildStockOutPrintDetailLinesSql()
    assert.match(sqlText, /UB_ERP_Stocks_out_list/i)
    assert.match(sqlText, /UB_ERP_Stocks_colorcode/i)
    assert.match(sqlText, /l\.\[kcaq01\].*?@outboundNo/is)
    assert.match(sqlText, /c\.\[code\].*?l\.\[kcaa11\]/is)
    assert.match(sqlText, /l\.\[del\]/i)
  })

  test('summary SQL groups by material fields and sums quantity', () => {
    const sqlText = buildStockOutPrintSummaryLinesSql()
    assert.match(sqlText, /SUM\(ISNULL\(l\.\[kcaq03\], 0\)\) AS kcaq03/i)
    assert.match(sqlText, /GROUP BY/i)
    for (const field of ['kcaa01', 'kcaa02', 'kcaa03', 'kcaa11', 'kcaa04']) {
      assert.match(sqlText, new RegExp(`l\\.\\[${field}\\]`, 'i'))
    }
  })

  test('fetchStockOutPrintDocuments queries headers by systemcode and keeps p_sum order', async () => {
    const queries = []
    const pool = {
      request() {
        const inputs = {}
        return {
          input(name, _type, value) {
            inputs[name] = value
            return this
          },
          async query(sqlText) {
            queries.push({ sqlText, inputs: { ...inputs } })
            if (/UB_ERP_System_Head/i.test(sqlText)) {
              return { recordset: [{ logo: '<img src="/system-kernel-images/stock-out.png" />' }] }
            }
            if (/UB_ERP_Stocks_out\]/i.test(sqlText) && /systemcode/i.test(sqlText)) {
              return {
                recordset: [{
                  id: inputs.systemcode === 'S2' ? 2 : 1,
                  systemcode: inputs.systemcode,
                  kcap01: inputs.systemcode === 'S2' ? 'C002' : 'C001',
                  kcap03: inputs.systemcode === 'S2' ? '2' : '0',
                  pass: '1',
                  del: '0',
                }],
              }
            }
            return {
              recordset: [{
                id: inputs.outboundNo === 'C002' ? 20 : 10,
                kcaq01: inputs.outboundNo,
                kcaa01: inputs.outboundNo === 'C002' ? 'B' : 'A',
                kcaa02: 'Material',
                kcaa03: 'Spec',
                kcaa11: '580',
                kcaa04: 'PCS',
                colorName: '黑色',
                kcaq03: 3,
              }],
            }
          },
        }
      },
    }

    const result = await fetchStockOutPrintDocuments(pool, { pSum: 'S1,S2', printMode: '1', actor: { trueName: '超级管理员' } })
    assert.equal(result.ok, true)
    assert.deepEqual(result.list.map((doc) => doc.header.systemcode), ['S1', 'S2'])
    assert.deepEqual(result.list.map((doc) => doc.header.kcap01), ['C001', 'C002'])
    assert.equal(result.list[0].pageIndex, 1)
    assert.equal(result.list[1].pageIndex, 2)
    assert.equal(result.list[0].pageTotal, 2)
    assert.equal(result.list[0].makerName, '超级管理员')
    assert.equal(result.printConfig.logoSrc, '/system-kernel-images/stock-out.png')
    assert.equal(result.list[0].lines[0].colorText, '(580) 黑色')
    assert.equal(queries[1].inputs.systemcode, 'S1')
    assert.equal(queries[1].sqlText.includes('[systemcode]'), true)
  })

  test('missing systemcode returns the old missing-document message', async () => {
    const pool = {
      request() {
        return {
          input() { return this },
          async query() { return { recordset: [] } },
        }
      },
    }
    const result = await fetchStockOutPrintDocuments(pool, { pSum: 'NOPE' })
    assert.equal(result.ok, false)
    assert.equal(result.status, 404)
    assert.equal(result.msg, '其中第【1】张单数据不存在，请返回检测！')
  })
})
