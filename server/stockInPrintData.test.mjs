import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  buildStockInPrintDetailLinesSql,
  buildStockInPrintSummaryLinesSql,
  fetchStockInPrintDocuments,
  normalizeStockInPrintLine,
  parseStockInPrintReceiptNos,
} from './stockInPrintData.js'

describe('stock-in print data', () => {
  test('parseStockInPrintReceiptNos splits p_sum and removes empty values', () => {
    assert.deepEqual(parseStockInPrintReceiptNos(' R001 , ,R002,R003 '), ['R001', 'R002', 'R003'])
  })

  test('empty p_sum returns old-system error code', async () => {
    const result = await fetchStockInPrintDocuments({ request() { throw new Error('should not query') } }, { pSum: '' })
    assert.equal(result.ok, false)
    assert.equal(result.msg, 'Error,Code:208')
  })

  test('detail SQL reads lines by receipt no and joins color code by kcaa11', () => {
    const sqlText = buildStockInPrintDetailLinesSql()
    assert.match(sqlText, /UB_ERP_Stocks_Storage_list/i)
    assert.match(sqlText, /UB_ERP_Stocks_colorcode/i)
    assert.match(sqlText, /l\.\[kcao01\].*?@receiptNo/is)
    assert.match(sqlText, /c\.\[code\].*?l\.\[kcaa11\]/is)
    assert.match(sqlText, /l\.\[del\]/i)
  })

  test('summary SQL groups by material fields and sums quantity', () => {
    const sqlText = buildStockInPrintSummaryLinesSql()
    assert.match(sqlText, /SUM\(ISNULL\(l\.\[kcao03\], 0\)\) AS kcao03/i)
    assert.match(sqlText, /GROUP BY/i)
    for (const field of ['kcaa01', 'kcaa02', 'kcaa03', 'kcaa11', 'kcaa04']) {
      assert.match(sqlText, new RegExp(`l\\.\\[${field}\\]`, 'i'))
    }
  })

  test('normalizeStockInPrintLine formats quantity color and remark fallback', () => {
    const line = normalizeStockInPrintLine({
      kcao03: 11,
      kcaa11: 'CFL',
      colorName: '亮枪色',
      info: '亮枪',
    }, 0)
    assert.equal(line.seq, 1)
    assert.equal(line.quantityText, '11.00')
    assert.equal(line.colorText, '(CFL) 亮枪色')
    assert.equal(line.Describe, '亮枪')
  })

  test('fetchStockInPrintDocuments queries headers by kcan01 and keeps p_sum order', async () => {
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
              return { recordset: [{ logo: '<img src="/system-kernel-images/stock-in.png" />' }] }
            }
            if (/UB_ERP_Stocks_Storage\]/i.test(sqlText) && /kcan01/i.test(sqlText)) {
              return {
                recordset: [{
                  id: inputs.receiptNo === 'R002' ? 2 : 1,
                  kcan01: inputs.receiptNo,
                  kcan03: inputs.receiptNo === 'R002' ? '3' : '0',
                  pass: '1',
                  del: '0',
                }],
              }
            }
            return {
              recordset: [{
                id: inputs.receiptNo === 'R002' ? 20 : 10,
                kcao01: inputs.receiptNo,
                kcaa01: inputs.receiptNo === 'R002' ? 'MB-0415/CFL' : 'A',
                kcaa02: '15mm狗扣 DFM2068',
                kcaa03: 'Spec',
                kcaa11: 'CFL',
                kcaa04: 'PC',
                colorName: '亮枪色',
                kcao03: 11,
                info: '亮枪',
              }],
            }
          },
        }
      },
    }

    const result = await fetchStockInPrintDocuments(pool, { pSum: 'R001,R002', printMode: '1', actor: { trueName: '超级管理员' } })
    assert.equal(result.ok, true)
    assert.deepEqual(result.list.map((doc) => doc.header.kcan01), ['R001', 'R002'])
    assert.equal(result.list[0].pageIndex, 1)
    assert.equal(result.list[1].pageIndex, 2)
    assert.equal(result.list[0].pageTotal, 2)
    assert.equal(result.list[0].makerName, '超级管理员')
    assert.equal(result.printConfig.logoSrc, '/system-kernel-images/stock-in.png')
    assert.equal(result.list[1].lines[0].colorText, '(CFL) 亮枪色')
    assert.equal(queries[1].inputs.receiptNo, 'R001')
  })

  test('missing receipt no returns the old missing-document message', async () => {
    const pool = {
      request() {
        return {
          input() { return this },
          async query(sqlText) {
            if (/UB_ERP_System_Head/i.test(sqlText)) {
              return { recordset: [{ logo: '' }] }
            }
            return { recordset: [] }
          },
        }
      },
    }
    const result = await fetchStockInPrintDocuments(pool, { pSum: 'NOPE' })
    assert.equal(result.ok, false)
    assert.equal(result.status, 404)
    assert.equal(result.msg, '其中第【1】张单数据不存在，请返回检测！')
  })
})
